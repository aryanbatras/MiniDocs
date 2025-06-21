
//=============================================================================
// CONFIGURATION
//=============================================================================

const API_KEY = 'AIzaSyATBmW55Otr0eNRlO07wtkcg06ECfPCzcY';
const CLIENT_ID = '422794837643-q153tedtes9n5sdg4557dv2c0asukqua.apps.googleusercontent.com';
const DISCOVERY_DOCS = [
    'https://docs.googleapis.com/$discovery/rest?version=v1',
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
];

const SCOPES = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive';


//=============================================================================
// DOM ELEMENTS
//=============================================================================

const editorElement = document.getElementById('editor');
const loginOverlayElement = document.getElementById('login-overlay');
const googleLoginButton = document.getElementById('google-login-btn');
const statusMessageElement = document.getElementById('status-message');

//=============================================================================
// APPLICATION STATE
//=============================================================================

let isUserAuthenticated = false;
let googleTokenClient = null;
let userAccessToken = null;
let tokenRefreshTimeout = null;
let currentDocumentId = null;
let autoSaveTimeout = null;

//=============================================================================
// AUTHENTICATION
//=============================================================================

function initializeGoogleApiClient() {
    gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    }).then(() => {
        googleLoginButton.addEventListener('click', authenticateWithGoogle);
        editorElement.addEventListener('input', scheduleAutoSave);
        editorElement.addEventListener('drop', handleDrop, false);
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e =>
            editorElement.addEventListener(e, e => e.preventDefault(), false)
        );
    }).catch(error => {
        displayStatusMessage('Error initializing Google API');
        console.error(error);
    });
}

function authenticateWithGoogle() {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: tokenResponse => {
            if (tokenResponse.access_token) {
                userAccessToken = tokenResponse.access_token;
                gapi.client.setToken({ access_token: userAccessToken });
                isUserAuthenticated = true;
                updateUserInterface(true);
                displayStatusMessage("Signed in");
            } else {
                displayStatusMessage("Failed to sign in");
            }
        }
    });
    googleTokenClient.requestAccessToken();
}

function updateUserInterface(isSignedIn) {
    isUserAuthenticated = isSignedIn;
    if (isSignedIn) {
        loginOverlayElement.classList.add('hidden');
        loadExistingOrCreateNewDocument();
    } else {
        loginOverlayElement.classList.remove('hidden');
    }
}

//=============================================================================
// DOCUMENT MANAGEMENT
//=============================================================================

function loadExistingOrCreateNewDocument() {
    const savedDocumentId = localStorage.getItem('miniDocsDocId');
    if (savedDocumentId) {
        currentDocumentId = savedDocumentId;
        loadDocumentContent(currentDocumentId);
    } else {
        createNewGoogleDocument();
    }
}

function createNewGoogleDocument() {
    gapi.client.docs.documents.create({ title: 'MiniDocs Document' }).then(res => {
        currentDocumentId = res.result.documentId;
        localStorage.setItem('miniDocsDocId', currentDocumentId);
        displayStatusMessage('New document created');
    }).catch(err => {
        displayStatusMessage('Error creating document');
        console.error(err);
    });
}

function loadDocumentContent(documentId) {
    gapi.client.docs.documents.get({ documentId }).then(res => {
        let documentText = '';
        const body = res.result.body.content;

        if (Array.isArray(body)) {
            body.forEach(item => {
                if (item.paragraph?.elements) {
                    item.paragraph.elements.forEach(el => {
                        if (el.textRun?.content) {
                            documentText += el.textRun.content;
                        }
                    });
                }
            });
        }

        editorElement.innerText = documentText;
        displayStatusMessage('Document loaded');
    }).catch(err => {
        displayStatusMessage('Error loading document');
        console.error(err);
    });
}

function saveDocumentToGoogleDocs() {
    if (!currentDocumentId || !isUserAuthenticated) return;

    const content = editorElement.innerText;

    gapi.client.docs.documents.get({ documentId: currentDocumentId }).then(res => {
        const body = res.result.body.content;
        const maxEnd = (body[body.length - 1]?.endIndex ?? 1) - 1;

        const requests = [
            {
                deleteContentRange: {
                    range: { startIndex: 1, endIndex: maxEnd }
                }
            },
            {
                insertText: {
                    location: { index: 1 },
                    text: content
                }
            }
        ];

        return gapi.client.docs.documents.batchUpdate({
            documentId: currentDocumentId,
            requests
        });
    }).then(() => {
        displayStatusMessage('Document saved');
    }).catch(err => {
        displayStatusMessage('Error saving document');
        location.reload();
        console.error(err);
    });
}

//=============================================================================
// IMAGE UPLOAD (NO UI DISPLAY)
//=============================================================================

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0 && isUserAuthenticated) {
        let cursorPosition = editorElement.innerText.length;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.type.startsWith('image/')) {
                displayStatusMessage('Uploading image...');
                uploadImageToDrive(file, cursorPosition);
            }
        }
    } else {
        displayStatusMessage('Sign in to upload images');
    }
}

function uploadImageToDrive(file, position) {
    const metadata = { name: file.name, mimeType: file.type };
    const reader = new FileReader();

    reader.onload = e => {
        const base64Data = btoa(
            new Uint8Array(e.target.result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        gapi.client.request({
            path: 'https://www.googleapis.com/upload/drive/v3/files',
            method: 'POST',
            params: { uploadType: 'multipart' },
            headers: { 'Content-Type': 'multipart/related; boundary=foo_bar_baz' },
            body:
                '--foo_bar_baz\r\n' +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) + '\r\n' +
                '--foo_bar_baz\r\n' +
                'Content-Type: ' + file.type + '\r\n' +
                'Content-Transfer-Encoding: base64\r\n\r\n' +
                base64Data + '\r\n' +
                '--foo_bar_baz--'
        }).then(res => {
            const fileId = res.result.id;
            return gapi.client.drive.permissions.create({
                fileId,
                resource: { role: 'reader', type: 'anyone' }
            }).then(() => {
                const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
                insertImageIntoDoc(imageUrl, position);
            });
        }).catch(err => {
            displayStatusMessage('Upload error');
            console.error(err);
        });
    };

    reader.readAsArrayBuffer(file);
}

function insertImageIntoDoc(imageUrl, position) {
    if (!currentDocumentId) return;

    // 1. Insert image into Google Doc at specified position
    gapi.client.docs.documents.batchUpdate({
        documentId: currentDocumentId,
        requests: [{
            insertInlineImage: {
                location: { index: position + 1 },
                uri: imageUrl,
                objectSize: {
                    height: { magnitude: 200, unit: 'PT' },
                    width: { magnitude: 300, unit: 'PT' }
                }
            }
        }]
    }).then(() => {
        displayStatusMessage('Image added to doc');

        // Instead of inserting actual <img> tag in DOM editor, just put placeholder text
        const placeholder = document.createTextNode(`\n[Image: ${imageUrl}]\n`);
        editorElement.appendChild(placeholder);

    }).catch(err => {
        displayStatusMessage('Insert image failed');
        console.error(err);
    });
}


//=============================================================================
// UTILITY FUNCTIONS
//=============================================================================

function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => saveDocumentToGoogleDocs(), 2000);
}

function displayStatusMessage(msg) {
    statusMessageElement.textContent = msg;
    statusMessageElement.classList.add('visible');
    setTimeout(() => statusMessageElement.classList.remove('visible'), 2000);
}

function loadGoogleApiAndInitialize() {
    gapi.load('client', initializeGoogleApiClient);
}

window.onload = loadGoogleApiAndInitialize;
