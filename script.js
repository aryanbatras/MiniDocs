/**
 * MiniDocs - A simple, distraction-free document editor with Google Docs integration
 * 
 * This script handles the core functionality of the MiniDocs application:
 * - Google API authentication
 * - Document creation, loading, and saving
 * - Auto-save functionality
 * - Status notifications
 */

//=============================================================================
// CONFIGURATION
//=============================================================================

// Google API configuration
const API_KEY = 'AIzaSyATBmW55Otr0eNRlO07wtkcg06ECfPCzcY'; // Replace with your actual API key
const CLIENT_ID = '422794837643-q153tedtes9n5sdg4557dv2c0asukqua.apps.googleusercontent.com'; // Replace with your actual client ID
const DISCOVERY_DOCS = ['https://docs.googleapis.com/$discovery/rest?version=v1'];
const SCOPES = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file';

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

// Authentication state
let isUserAuthenticated = false;
let googleTokenClient = null;
let userAccessToken = null;
let tokenRefreshTimeout = null;

// Document state
let currentDocumentId = null;
let autoSaveTimeout = null;

//=============================================================================
// AUTHENTICATION FUNCTIONS
//=============================================================================

/**
 * Initialize the Google API client
 * Sets up event listeners and prepares the application
 */
function initializeGoogleApiClient() {
    gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    }).then(() => {
        // Attach click handler to the login button
        googleLoginButton.addEventListener('click', authenticateWithGoogle);

        // Set up auto-save functionality
        editorElement.addEventListener('input', scheduleAutoSave);

        // Set up drag and drop functionality for images
        setupDragAndDropForImages();
    }).catch(error => {
        displayStatusMessage('Error initializing Google API: ' + error.details);
        console.error('Error initializing Google API:', error);
    });
}

/**
 * Set up drag and drop event listeners for images
 */
function setupDragAndDropForImages() {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        editorElement.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop area when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        editorElement.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        editorElement.addEventListener(eventName, unhighlight, false);
    });

    // Handle dropped files
    editorElement.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight() {
        editorElement.classList.add('highlight');
    }

    function unhighlight() {
        editorElement.classList.remove('highlight');
    }

    /**
     * Handle dropped files
     * @param {Event} e - The drop event
     */
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0 && isUserAuthenticated) {
            // Get the current cursor position or use the end of the document
            const selection = window.getSelection();
            let cursorPosition = 0;

            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const preCaretRange = range.cloneRange();
                preCaretRange.selectNodeContents(editorElement);
                preCaretRange.setEnd(range.endContainer, range.endOffset);
                cursorPosition = preCaretRange.toString().length;
            }

            // Process each dropped file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // Check if the file is an image
                if (file.type.match('image.*')) {
                    displayStatusMessage('Uploading image...');
                    uploadImageToDrive(file, cursorPosition);
                } else {
                    displayStatusMessage('Only image files are supported');
                }
            }
        } else if (!isUserAuthenticated) {
            displayStatusMessage('Please sign in to upload images');
        }
    }
}

/**
 * Set up Google Identity Services token client and initiate login flow
 */
function authenticateWithGoogle() {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.access_token) {
                userAccessToken = tokenResponse.access_token;
                gapi.client.setToken({ access_token: userAccessToken });
                isUserAuthenticated = true;
                updateUserInterface(true);
                displayStatusMessage("Successfully signed in");

                // Schedule token refresh after 1 hour
                scheduleTokenRefresh();
            } else {
                displayStatusMessage("Failed to get access token");
            }
        }
    });

    googleTokenClient.requestAccessToken();
}

/**
 * Schedule token refresh after 1 hour
 */
function scheduleTokenRefresh() {
    // Clear any existing timeout
    if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
    }

    // Set a new timeout for 1 hour (3600000 ms)
    tokenRefreshTimeout = setTimeout(() => {
        refreshToken();
    }, 3600000);
}

/**
 * Refresh the access token
 */
function refreshToken() {
    if (googleTokenClient && isUserAuthenticated) {
        displayStatusMessage("Refreshing token...");
        googleTokenClient.requestAccessToken();
        // The callback in authenticateWithGoogle will handle the new token
        // and schedule the next refresh
    }
}

/**
 * Update the user interface based on authentication status
 * 
 * @param {boolean} isSignedIn - Whether the user is signed in
 */
function updateUserInterface(isSignedIn) {
    isUserAuthenticated = isSignedIn;

    if (isSignedIn) {
        // Hide login overlay when user is authenticated
        loginOverlayElement.classList.add('hidden');

        // Check if we have a document or need to create one
        loadExistingOrCreateNewDocument();
    } else {
        // Show login overlay when user is not authenticated
        loginOverlayElement.classList.remove('hidden');
    }
}

//=============================================================================
// DOCUMENT MANAGEMENT FUNCTIONS
//=============================================================================

/**
 * Check for an existing document or create a new one
 * Tries to load a document ID from localStorage, or creates a new document if none exists
 */
function loadExistingOrCreateNewDocument() {
    // Try to get the document ID from localStorage
    const savedDocumentId = localStorage.getItem('miniDocsDocId');

    if (savedDocumentId) {
        currentDocumentId = savedDocumentId;
        loadDocumentContent(currentDocumentId);
    } else {
        createNewGoogleDocument();
    }
}

/**
 * Create a new Google Doc with default title
 */
function createNewGoogleDocument() {
    gapi.client.docs.documents.create({
        title: 'MiniDocs Document'
    }).then(response => {
        currentDocumentId = response.result.documentId;
        localStorage.setItem('miniDocsDocId', currentDocumentId);
        displayStatusMessage('New document created');
    }).catch(error => {
        displayStatusMessage('Error creating document: ' + error.result.error.message);
        console.error('Error creating document:', error);
    });
}

/**
 * Load content from a Google Doc and display it in the editor
 * 
 * @param {string} documentId - The ID of the Google Doc to load
 */
function loadDocumentContent(documentId) {
    gapi.client.docs.documents.get({
        documentId: documentId
    }).then(response => {
        // Extract text content from the document
        const document = response.result;
        let documentContent = '';

        if (document.body && document.body.content) {
            document.body.content.forEach(item => {
                if (item.paragraph && item.paragraph.elements) {
                    item.paragraph.elements.forEach(element => {
                        if (element.textRun && element.textRun.content) {
                            documentContent += element.textRun.content;
                        }
                    });
                }
            });
        }

        // Update editor with content
        editorElement.innerText = documentContent;
        displayStatusMessage('Document loaded');
    }).catch(error => {
        displayStatusMessage('Error loading document: ' + error.result.error.message);
        console.error('Error loading document:', error);
    });
}

/**
 * Get the length of a Google Doc
 * 
 * @param {Object} document - The Google Doc object
 * @returns {number} - The length of the document
 */
function getDocumentLength(document) {
    let lastIndex = 1;
    if (document.body && document.body.content) {
        const lastElement = document.body.content[document.body.content.length - 1];
        if (lastElement.endIndex !== undefined) {
            lastIndex = lastElement.endIndex;
        }
    }
    return lastIndex;
}

/**
 * Save the current editor content to Google Docs
 * Replaces the entire document content with the current editor content
 */
function saveDocumentToGoogleDocs() {
    if (!currentDocumentId || !isUserAuthenticated) return;

    const editorContent = editorElement.innerText;

    gapi.client.docs.documents.get({
        documentId: currentDocumentId
    }).then(response => {
        const document = response.result;

        // Get actual max endIndex
        const lastElement = document.body.content[document.body.content.length - 1];
        const maxEndIndex = (lastElement?.endIndex ?? 1) - 1;

        // Create batch update request to replace document content
        const updateRequests = [
            {
                deleteContentRange: {
                    range: {
                        startIndex: 1,
                        endIndex: maxEndIndex // avoid deleting final newline
                    }
                }
            },
            {
                insertText: {
                    location: {
                        index: 1
                    },
                    text: editorContent
                }
            }
        ];

        return gapi.client.docs.documents.batchUpdate({
            documentId: currentDocumentId,
            requests: updateRequests
        });
    }).then(() => {
        displayStatusMessage('Document saved');
    }).catch(error => {
        displayStatusMessage('Error saving document: ' + (error.result?.error?.message || error.message));
        console.error('Error saving document:', error);
    });
}

//=============================================================================
// IMAGE HANDLING FUNCTIONS
//=============================================================================

/**
 * Upload an image file to Google Drive
 * 
 * @param {File} file - The image file to upload
 * @param {number} cursorPosition - The position in the document to insert the image
 */
function uploadImageToDrive(file, cursorPosition) {
    const metadata = {
        name: file.name,
        mimeType: file.type
    };

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = function(e) {
        const base64Data = btoa(
            new Uint8Array(e.target.result)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        // Upload the image to Google Drive
        gapi.client.request({
            path: 'https://www.googleapis.com/upload/drive/v3/files',
            method: 'POST',
            params: {
                uploadType: 'multipart'
            },
            headers: {
                'Content-Type': 'multipart/related; boundary=boundary'
            },
            body: '--boundary\r\n' +
                  'Content-Type: application/json\r\n\r\n' +
                  JSON.stringify(metadata) + '\r\n' +
                  '--boundary\r\n' +
                  'Content-Type: ' + file.type + '\r\n' +
                  'Content-Transfer-Encoding: base64\r\n\r\n' +
                  base64Data + '\r\n' +
                  '--boundary--'
        }).then(function(response) {
            const fileId = response.result.id;
            // Make the file publicly accessible
            gapi.client.drive.permissions.create({
                fileId: fileId,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            }).then(function() {
                // Get the file's web content link
                gapi.client.drive.files.get({
                    fileId: fileId,
                    fields: 'webContentLink'
                }).then(function(response) {
                    const imageUrl = response.result.webContentLink;
                    // Insert the image into the Google Doc
                    insertImageIntoDoc(imageUrl, cursorPosition);
                    displayStatusMessage('Image uploaded successfully');
                }).catch(function(error) {
                    displayStatusMessage('Error getting image URL: ' + error.message);
                    console.error('Error getting image URL:', error);
                });
            }).catch(function(error) {
                displayStatusMessage('Error setting permissions: ' + error.message);
                console.error('Error setting permissions:', error);
            });
        }).catch(function(error) {
            displayStatusMessage('Error uploading image: ' + error.message);
            console.error('Error uploading image:', error);
        });
    };
}

/**
 * Insert an image into the Google Doc at the specified position
 * 
 * @param {string} imageUrl - The URL of the image to insert
 * @param {number} cursorPosition - The position in the document to insert the image
 */
function insertImageIntoDoc(imageUrl, cursorPosition) {
    if (!currentDocumentId || !isUserAuthenticated) return;

    // Create a batch update request to insert the image
    const requests = [
        {
            insertInlineImage: {
                location: {
                    index: cursorPosition + 1 // +1 to account for the initial paragraph marker
                },
                uri: imageUrl,
                objectSize: {
                    height: {
                        magnitude: 200,
                        unit: 'PT'
                    },
                    width: {
                        magnitude: 300,
                        unit: 'PT'
                    }
                }
            }
        }
    ];

    gapi.client.docs.documents.batchUpdate({
        documentId: currentDocumentId,
        requests: requests
    }).then(() => {
        // Reload the document content to show the inserted image
        loadDocumentContent(currentDocumentId);
    }).catch(error => {
        displayStatusMessage('Error inserting image: ' + (error.result?.error?.message || error.message));
        console.error('Error inserting image:', error);
    });
}

//=============================================================================
// UTILITY FUNCTIONS
//=============================================================================

/**
 * Schedule auto-save with debounce to prevent too many API calls
 * Waits for user to stop typing before saving
 */
function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        saveDocumentToGoogleDocs();
    }, 2500); // Save after 2 seconds of inactivity
}

/**
 * Display a temporary status message to the user
 * 
 * @param {string} message - The message to display
 */
function displayStatusMessage(message) {
    statusMessageElement.textContent = message;
    statusMessageElement.classList.add('visible');

    setTimeout(() => {
        statusMessageElement.classList.remove('visible');
    }, 1000);
}

/**
 * Load the Google API client and initialize the application
 */
function loadGoogleApiAndInitialize() {
    gapi.load('client', initializeGoogleApiClient);
}

// Initialize the application when the page loads
window.onload = loadGoogleApiAndInitialize;
