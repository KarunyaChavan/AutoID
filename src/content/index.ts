import { detectAndAutofill } from './formDetector';

const ext = (globalThis as any).chrome;
ext.runtime.onMessage.addListener((
  request: { type: string },
  _sender: any,
  sendResponse: (response: any) => void
) => {
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
