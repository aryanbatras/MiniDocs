# MiniDocs

A distraction-free, minimalist writing environment that saves directly to Google Docs.

## Features

- Dark mode interface
- Completely distraction-free writing environment
- No cursor blinking or visible cursor
- No scroll bars
- Clean, minimal design
- Auto-save functionality that saves directly to Google Docs
- Google authentication on first visit
- Same document used for saving across sessions

## Setup

1. Clone this repository
2. Create a project in the [Google Cloud Console](https://console.cloud.google.com/)
3. Enable the Google Docs API and Google Drive API
4. Create OAuth 2.0 credentials (Web application type)
5. Add your domain to the authorized JavaScript origins
6. Replace `YOUR_CLIENT_ID` and `YOUR_API_KEY` in `script.js` with your actual credentials
7. Open `index.html` in your browser

## Usage

1. Open the application in your browser
2. You'll be prompted to sign in with your Google account
3. After signing in, you'll see a blank page where you can start typing
4. Your content will be automatically saved to Google Docs as you type
5. The same document will be used across sessions unless you clear your browser's local storage
6. You can see the save status in the bottom right corner of the screen

## Notes

- This is a client-side only application with no server component
- Your content is automatically saved to your Google Docs account as you type
- Authentication is requested when you first visit the application
- The same document is used across sessions unless you clear your browser's local storage
- Each document is saved with the title "MiniDocs Document"
- You need to replace the placeholder API key and client ID with your own credentials
