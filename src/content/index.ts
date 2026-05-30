import { detectAndAutofill } from './formDetector';

// Listen for messages from the extension popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'AUTOFILL_FORM') {
    detectAndAutofill().then(filledCount => {
      console.log(`[IdentityCopilot] Successfully auto-filled ${filledCount} fields.`);
      sendResponse({ success: true, filledCount });
    });
    // Return true to indicate we wish to send a response asynchronously
    return true;
  }
});

console.log('[IdentityCopilot] Content script loaded and listening for events.');
