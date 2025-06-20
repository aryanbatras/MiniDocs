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
const DISCOVERY_DOCS = [
  'https://docs.googleapis.com/$discovery/rest?version=v1',
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
];
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

    // Add event listeners for repositioning images within the editor
    editorElement.addEventListener('dragover', handleDragOver, false);
    editorElement.addEventListener('drop', handleImageDrop, false);

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
     * Handle dragover event for image repositioning
     * @param {Event} e - The dragover event
     */
    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Get the element being dragged over
        const target = e.target;

        // Only show drop indicator if we're dragging over text nodes or other elements
        // but not over the dragging image itself
        if (!target.classList || !target.classList.contains('dragging')) {
            // Find the closest valid drop target
            const dropTarget = getDropTarget(e.clientY);

            // Remove any existing drop-target class
            const currentDropTarget = editorElement.querySelector('.drop-target');
            if (currentDropTarget) {
                currentDropTarget.classList.remove('drop-target');
            }

            // Add drop-target class to the new target
            if (dropTarget) {
                dropTarget.classList.add('drop-target');
            }
        }
    }

    /**
     * Find the closest valid drop target based on mouse position
     * @param {number} y - The mouse Y position
     * @returns {Element|null} - The drop target element or null
     */
    function getDropTarget(y) {
        // Get all potential drop targets (text nodes, images, etc.)
        const children = Array.from(editorElement.childNodes);

        // Find the element closest to the mouse position
        for (const child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const rect = child.getBoundingClientRect();
                const middle = rect.top + rect.height / 2;

                // If mouse is above the middle of this element, return it
                if (y < middle) {
                    return child;
                }
            }
        }

        // If no suitable target found, return the last child
        return children.length > 0 ? children[children.length - 1] : null;
    }

    /**
     * Handle drop event for image repositioning
     * @param {Event} e - The drop event
     */
    function handleImageDrop(e) {
        // Only handle if we're dropping an image from within the editor
        if (e.dataTransfer.getData('text/plain') === 'image-being-dragged') {
            e.preventDefault();

            // Find the dragged image
            const draggedImage = editorElement.querySelector('.dragging');
            if (!draggedImage) return;

            // Remove any drop-target class
            const dropTarget = editorElement.querySelector('.drop-target');
            if (dropTarget) {
                dropTarget.classList.remove('drop-target');
            }

            // Get the drop position
            const dropPosition = getDropPosition(e.clientY);

            // Move the image to the new position
            if (dropPosition) {
                editorElement.insertBefore(draggedImage, dropPosition);
            } else {
                // If no position found, append to the end
                editorElement.appendChild(draggedImage);
            }

            // Schedule auto-save
            scheduleAutoSave();

            // Show status message
            displayStatusMessage('Image repositioned');
        }
    }

    /**
     * Get the element to insert before based on mouse position
     * @param {number} y - The mouse Y position
     * @returns {Node|null} - The node to insert before or null to append at the end
     */
    function getDropPosition(y) {
        const children = Array.from(editorElement.childNodes);

        for (const child of children) {
            // Skip the dragged element itself
            if (child.classList && child.classList.contains('dragging')) {
                continue;
            }

            const rect = child.getBoundingClientRect();
            const middle = rect.top + rect.height / 2;

            // If mouse is above the middle of this element, insert before it
            if (y < middle) {
                return child;
            }
        }

        // If no suitable position found, return null (append to end)
        return null;
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
        // Clear the editor first
        editorElement.innerHTML = '';

        // Extract content from the document
        const gdocument = response.result;

        if (gdocument.body && gdocument.body.content) {
            // Process each structural element
            gdocument.body.content.forEach(item => {
                if (item.paragraph && item.paragraph.elements) {
                    let paragraphText = '';

                    // Process each element in the paragraph
                    item.paragraph.elements.forEach(element => {
                        if (element.textRun && element.textRun.content) {
                            // Text content
                            paragraphText += element.textRun.content;
                        } else if (element.inlineObjectElement && element.inlineObjectElement.inlineObjectId) {
                            // Image content
                            const objectId = element.inlineObjectElement.inlineObjectId;
                            const inlineObject = gdocument.inlineObjects[objectId];

                            if (inlineObject && inlineObject.inlineObjectProperties && 
                                inlineObject.inlineObjectProperties.embeddedObject && 
                                inlineObject.inlineObjectProperties.embeddedObject.imageProperties) {

                                // Extract image source URL
                                const imageUrl = inlineObject.inlineObjectProperties.embeddedObject.imageProperties.contentUri;

                                // If it's a Google Drive image, extract the file ID
                                let fileId = null;
                                const driveMatch = imageUrl.match(/id=([^&]+)/);
                                if (driveMatch && driveMatch[1]) {
                                    fileId = driveMatch[1];
                                }

                                if (fileId) {
                                    // If we have text content, add it first
                                    if (paragraphText.trim()) {
                                        const textNode = gdocument.createTextNode(paragraphText);
                                        editorElement.appendChild(textNode);
                                        paragraphText = '';
                                    }

                                    // Create and add the image
                                    const img = gdocument.createElement('img');
                                    img.src = `https://drive.google.com/uc?export=view&id=${fileId}`;
                                    img.className = 'editor-image';
                                    img.dataset.fileId = fileId;
                                    img.style.maxWidth = '300px';
                                    img.style.maxHeight = '200px';
                                    img.style.cursor = 'pointer';

                                    // Add click event to handle image deletion
                                    img.addEventListener('click', function(e) {
                                        if (confirm('Do you want to delete this image?')) {
                                            e.target.remove();
                                            scheduleAutoSave();
                                            displayStatusMessage('Image deleted');
                                        }
                                    });

                                    editorElement.appendChild(img);
                                }
                            }
                        }
                    });

                    // Add any remaining text
                    if (paragraphText) {
                        const textNode = gdocument.createTextNode(paragraphText);
                        editorElement.appendChild(textNode);

                        // Add a line break after paragraphs
                        if (!paragraphText.endsWith('\n')) {
                            editorElement.appendChild(gdocument.createElement('br'));
                        }
                    }
                }
            });
        }

        displayStatusMessage('Document loaded');
    }).catch(error => {
        displayStatusMessage('Error loading document: ' + (error.result?.error?.message || error.message));
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
 * and re-inserts images
 */
function saveDocumentToGoogleDocs() {
    if (!currentDocumentId || !isUserAuthenticated) return;

    // Extract text content and collect images
    let editorContent = '';
    const images = [];
    let currentPosition = 0;

    // Process all nodes in the editor
    Array.from(editorElement.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            // Text node
            editorContent += node.textContent;
            currentPosition += node.textContent.length;
        } else if (node.nodeName === 'IMG' && node.dataset.fileId) {
            // Image node - add a placeholder and record the image position
            editorContent += '\n\n';
            images.push({
                fileId: node.dataset.fileId,
                position: currentPosition
            });
            currentPosition += 2; // Account for the two newlines
        } else if (node.nodeName === 'BR') {
            // Line break
            editorContent += '\n';
            currentPosition += 1;
        } else {
            // Other nodes - get their text content
            editorContent += node.textContent;
            currentPosition += node.textContent.length;
        }
    });

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
        // If there are images, insert them one by one
        if (images.length > 0) {
            const imageRequests = images.map(img => {
                return gapi.client.docs.documents.batchUpdate({
                    documentId: currentDocumentId,
                    requests: [{
                        insertInlineImage: {
                            location: {
                                index: img.position + 1 // +1 to account for the initial paragraph marker
                            },
                            uri: `https://drive.google.com/uc?export=view&id=${img.fileId}`,
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
                    }]
                });
            });

            // Execute all image insertion requests
            return Promise.all(imageRequests);
        }
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

            // Make the file accessible to anyone with the link (reader permission)
            return gapi.client.drive.permissions.create({
                fileId: fileId,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            }).then(function() {
                // Use the Drive file ID directly for Google Docs
                const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
                // Insert the image into the Google Doc
                insertImageIntoDoc(imageUrl, cursorPosition);

                // Also display the image in the editor
                displayImageInEditor(fileId, cursorPosition);

                displayStatusMessage('Image uploaded successfully');
            });
        }).catch(function(error) {
            displayStatusMessage('Error uploading image: ' + error.message);
            console.error('Error uploading image:', error);
        });
    };
}

/**
 * Display an image in the editor at the specified position
 * 
 * @param {string} fileId - The Google Drive file ID of the image
 * @param {number} cursorPosition - The position in the editor to insert the image
 */
function displayImageInEditor(fileId, cursorPosition) {
    // Create an image element
    const img = document.createElement('img');
    img.src = `https://drive.google.com/uc?export=view&id=${fileId}`;
    img.className = 'editor-image';
    img.dataset.fileId = fileId;
    img.style.maxWidth = '300px';
    img.style.maxHeight = '200px';
    img.style.cursor = 'move'; // Change cursor to indicate draggable
    img.draggable = true; // Make the image draggable

    // Add click event to handle image deletion
    img.addEventListener('click', function(e) {
        if (confirm('Do you want to delete this image?')) {
            // Remove the image from the editor
            e.target.remove();

            // Save the document to reflect the change
            scheduleAutoSave();

            displayStatusMessage('Image deleted');
        }
    });

    // Add drag start event
    img.addEventListener('dragstart', function(e) {
        // Store the dragged element ID
        e.dataTransfer.setData('text/plain', 'image-being-dragged');
        // Add a class to style the image while dragging
        this.classList.add('dragging');
        // Set effectAllowed to move to indicate we're moving the element
        e.dataTransfer.effectAllowed = 'move';
    });

    // Add drag end event
    img.addEventListener('dragend', function() {
        // Remove the dragging class
        this.classList.remove('dragging');
        // Schedule auto-save after drag operation
        scheduleAutoSave();
    });

    // Insert the image at the cursor position
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.insertNode(img);

        // Move cursor after the image
        range.setStartAfter(img);
        range.setEndAfter(img);
        selection.removeAllRanges();
        selection.addRange(range);
    } else {
        // If no selection, append to the end
        editorElement.appendChild(img);
    }
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
