/*
 * PDF.js wrapper — page rasterisation + text extraction.
 */
import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';

export { pdfjs };

export class PasswordRequiredError extends Error {
  constructor() {
    super('This PDF is password protected.');
    this.name = 'PasswordRequiredError';
    this.needsPassword = true;
  }
}

/**
 * Open a PDF with PDF.js.
 * @param {ArrayBuffer|Uint8Array} data
 */
export async function openDocument(data, { password } = {}) {
  const params = { data: data instanceof Uint8Array ? data : new Uint8Array(data) };
  if (password !== undefined) params.password = password;
  try {
    return await pdfjs.getDocument(params).promise;
  } catch (err) {
    if (err && (err.name === 'PasswordException' || err.code === 1 || err.code === 2)) {
      throw new PasswordRequiredError();
    }
    throw err;
  }
}

/** Render one page into a canvas at the requested scale. */
export async function renderPage(page, { scale = 1.5, canvas } = {}) {
  const viewport = page.getViewport({ scale });
  const target = canvas || document.createElement('canvas');
  target.width = Math.max(1, Math.floor(viewport.width));
  target.height = Math.max(1, Math.floor(viewport.height));
  const context = target.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target.width, target.height);
  await page.render({ canvasContext: context, viewport, canvas: target }).promise;
  return target;
}

/** Render a page and return a JPEG blob. */
export async function renderPageToBlob(page, { scale = 1.5, quality = 0.92, type = 'image/jpeg' } = {}) {
  const canvas = await renderPage(page, { scale });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Render a page and return a data URL. */
export async function renderPageToDataUrl(page, { scale = 0.4, type = 'image/jpeg', quality = 0.8 } = {}) {
  const canvas = await renderPage(page, { scale });
  return canvas.toDataURL(type, quality);
}

/** Extract the text content of a page, preserving line breaks. */
export async function extractPageText(page) {
  const content = await page.getTextContent();
  let text = '';
  let lastY = null;
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform ? Math.round(item.transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n';
    else if (text && !text.endsWith('\n') && !text.endsWith(' ')) text += ' ';
    text += item.str;
    if (y !== null) lastY = y;
  }
  return text;
}

/** Extract text for every page of a document. */
export async function extractDocumentText(doc) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push(await extractPageText(page));
  }
  return pages;
}

/** Produce a small preview thumbnail for a PDF file. */
export async function thumbnailFor(data, { scale = 0.28 } = {}) {
  try {
    const doc = await openDocument(data);
    const page = await doc.getPage(1);
    const canvas = await renderPage(page, { scale });
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}
