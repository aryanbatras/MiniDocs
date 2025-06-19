// Google API configuration
const API_KEY = 'AIzaSyATBmW55Otr0eNRlO07wtkcg06ECfPCzcY'; // Replace with your actual API key
const CLIENT_ID = '422794837643-q153tedtes9n5sdg4557dv2c0asukqua.apps.googleusercontent.com'; // Replace with your actual client ID
const DISCOVERY_DOCS = ['https://docs.googleapis.com/$discovery/rest?version=v1'];
const SCOPES = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';

// DOM elements
const editor = document.getElementById('editor');
const loginOverlay = document.getElementById('login-overlay');
const googleLoginBtn = document.getElementById('google-login-btn');
const statusMessage = document.getElementById('status-message');

// Document state
let isAuthenticated = false;
let currentDocId = null;
let debounceTimeout = null;
let tokenClient = null;
let accessToken = null;

// Initialize the Google API client
function initClient() {
    gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    }).then(() => {
        // Attach click handler to the login button
        googleLoginBtn.addEventListener('click', initTokenClientAndLogin);

        // Set up auto-save functionality
        editor.addEventListener('input', debounceAutoSave);
    }).catch(error => {
        showStatus('Error initializing Google API: ' + error.details);
        console.error('Error initializing Google API:', error);
    });
}

// Setup Google Identity Services token client and login
function initTokenClientAndLogin() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                gapi.client.setToken({ access_token: accessToken });
                isAuthenticated = true;
                updateSigninStatus(true);
                showStatus("Signed in");
            } else {
                showStatus("Failed to get access token");
            }
        }
    });

    tokenClient.requestAccessToken();
}

// Update UI based on authentication status
function updateSigninStatus(isSignedIn) {
    isAuthenticated = isSignedIn;

    if (isSignedIn) {
        // Hide login overlay
        loginOverlay.classList.add('hidden');

        // Check if we have a document or need to create one
        checkForExistingDoc();
    } else {
        // Show login overlay
        loginOverlay.classList.remove('hidden');
    }
}

// This function is no longer needed as we're using initTokenClientAndLogin directly

// Check for existing document or create a new one
function checkForExistingDoc() {
    // Try to get the document ID from localStorage
    const savedDocId = localStorage.getItem('miniDocsDocId');

    if (savedDocId) {
        currentDocId = savedDocId;
        loadDocument(currentDocId);
    } else {
        createNewDocument();
    }
}

// Create a new Google Doc
function createNewDocument() {
    gapi.client.docs.documents.create({
        title: 'MiniDocs Document'
    }).then(response => {
        currentDocId = response.result.documentId;
        localStorage.setItem('miniDocsDocId', currentDocId);
        showStatus('New document created');
    }).catch(error => {
        showStatus('Error creating document: ' + error.result.error.message);
        console.error('Error creating document:', error);
    });
}

// Load content from Google Doc
function loadDocument(docId) {
    gapi.client.docs.documents.get({
        documentId: docId
    }).then(response => {
        // Extract text content from the document
        const doc = response.result;
        let content = '';

        if (doc.body && doc.body.content) {
            doc.body.content.forEach(item => {
                if (item.paragraph && item.paragraph.elements) {
                    item.paragraph.elements.forEach(element => {
                        if (element.textRun && element.textRun.content) {
                            content += element.textRun.content;
                        }
                    });
                }
            });
        }

        // Update editor with content
        editor.innerHTML = content;
        showStatus('Document loaded');
    }).catch(error => {
        showStatus('Error loading document: ' + error.result.error.message);
        console.error('Error loading document:', error);
    });
}

// Save content to Google Doc
function saveToGoogleDocs() {
    if (!currentDocId || !isAuthenticated) return;

    const content = editor.innerHTML;

    // Create a batch update request
    const requests = [{
        replaceAllContent: {
            text: content
        }
    }];

    gapi.client.docs.documents.batchUpdate({
        documentId: currentDocId,
        requests: requests
    }).then(() => {
        showStatus('Document saved');
    }).catch(error => {
        showStatus('Error saving document: ' + error.result.error.message);
        console.error('Error saving document:', error);
    });
}

// Debounce auto-save to prevent too many API calls
function debounceAutoSave() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        saveToGoogleDocs();
    }, 2000); // Save after 2 seconds of inactivity
}

// Show status message
function showStatus(message) {
    statusMessage.textContent = message;
    statusMessage.classList.add('visible');

    setTimeout(() => {
        statusMessage.classList.remove('visible');
    }, 3000);
}

// Load the Google API client
function loadGoogleApi() {
    gapi.load('client', initClient);
}

// Initialize when the page loads
window.onload = loadGoogleApi;
