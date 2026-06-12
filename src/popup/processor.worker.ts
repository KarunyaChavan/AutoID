// Web Worker for processing uploaded files: OCR + lightweight extraction heuristics.
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

const initTesseract = async () => {
  if (tesseractWorker) return tesseractWorker;
  tesseractWorker = await createWorker({
    logger: (m: { status?: string; progress?: number }) => {
      // Forward progress messages to the main thread
      try { self.postMessage({ type: 'OCR_LOG', payload: m }); } catch (e) { /* ignore */ }
    },
  });
  return tesseractWorker;
};

self.addEventListener('message', async (ev) => {
  const msg = ev.data;
  if (msg?.type === 'PROCESS_FILES') {
    const files: File[] = msg.files || [];
    const worker = await initTesseract();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let text = '';
      try {
        if (file.type.startsWith('text/') || /\.txt$|\.json$/i.test(file.name)) {
          text = await file.text();
        } else if (file.type.startsWith('image/') || /\.png$|\.jpe?g$|\.bmp$|\.tiff$/i.test(file.name)) {
          // Use Tesseract to OCR images
          const url = URL.createObjectURL(file);
          try {
            const res = await worker.recognize(url);
            text = res?.data?.text || '';
          } catch (ocrErr) {
            text = `[OCR error: ${String(ocrErr)}]`;
          } finally {
            URL.revokeObjectURL(url);
          }
        } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          // PDF: try to extract text; if none (scanned PDF), render pages and OCR each page
          try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const pageTexts: string[] = [];
            for (let p = 1; p <= pdf.numPages; p++) {
              try {
                const page = await pdf.getPage(p);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((it: any) => it.str).join(' ');
                if (pageText && pageText.trim().length > 20) {
                  pageTexts.push(pageText);
                } else {
                  // render to OffscreenCanvas and OCR
                  const viewport = page.getViewport({ scale: 1.5 });
                  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    // @ts-ignore
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    const blob = await canvas.convertToBlob();
                    const url = URL.createObjectURL(blob);
                    try {
                      const res = await worker.recognize(url);
                      pageTexts.push(res?.data?.text || '');
                    } catch (ocrErr) {
                      pageTexts.push(`[OCR error on page ${p}: ${String(ocrErr)}]`);
                    } finally { URL.revokeObjectURL(url); }
                  }
                }
              } catch (pageErr) {
                pageTexts.push(`[PDF page error: ${String(pageErr)}]`);
              }
            }
            text = pageTexts.join('\n');
          } catch (pdfErr) {
            text = `[PDF parse error: ${String(pdfErr)}]`;
          }
        } else {
          try { text = await file.text(); } catch { text = '[Binary file — OCR pending]'; }
        }
      } catch (e) {
        text = `[Error reading file: ${String(e)}]`;
      }

      const extracted = extractCandidates(text);

      self.postMessage({
        type: 'FILE_RESULT',
        index: i,
        fileName: file.name,
        size: file.size,
        textSnippet: text.slice(0, 200),
        extracted,
      });
    }

    self.postMessage({ type: 'PROCESS_COMPLETE', count: files.length });
  }
});

const extractCandidates = (text: string) => {
  const t = text.replace(/\n/g, ' ');
  const out: Record<string, string | null> = {
    pan: null,
    aadhaar: null,
    email: null,
    phone: null,
    dob: null,
    name: null,
  };

  // PAN: 5 letters, 4 digits, 1 letter
  const panMatch = t.match(/[A-Z]{5}[0-9]{4}[A-Z]/i);
  if (panMatch) out.pan = panMatch[0];

  // Aadhaar: 12 digits in groups or continuous
  const aadhaarMatch = t.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
  if (aadhaarMatch) out.aadhaar = aadhaarMatch[0];

  // Email
  const emailMatch = t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) out.email = emailMatch[0];

  // Phone (simple)
  const phoneMatch = t.match(/\+?\d[\d\s-]{7,}\d/);
  if (phoneMatch) out.phone = phoneMatch[0];

  // DOB: look for common date formats
  const dobMatch = t.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
  if (dobMatch) out.dob = dobMatch[0];

  // Heuristic name: look for "Name:" or capitalized words near start
  const nameMatch = t.match(/Name[:\s]{1,3}([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/);
  if (nameMatch) out.name = nameMatch[1];

  return out;
};

export {};
