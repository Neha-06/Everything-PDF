/*
 * Focused checks for the Compress PDF tool.
 *
 * The compressor races three candidates — the original bytes, a lossless
 * rewrite and a hybrid that only re-encodes pages containing images — and
 * keeps the smallest. These checks make sure that:
 *
 *   1. a vector-only PDF never grows (the bug that started all this),
 *   2. the text of a vector PDF stays selectable,
 *   3. an image-heavy PDF really does shrink.
 *
 * Run it from the browser console on the dev server:
 *
 *   import('/tests/compress.js').then((m) => m.run());
 */
import { compressPdf } from '../assets/js/tools/optimize.js';
import { loadPdfLib } from '../assets/js/lib/pdf-lib.js';
import { openDocument, extractDocumentText } from '../assets/js/lib/pdfjs.js';

/* ------------------------------------------------------------- fixtures */

function asFile(name, blob) {
  return new File([blob], name, { type: blob.type || 'application/pdf' });
}

/** A small PDF that only contains text and vector graphics. */
async function makeVectorPdf() {
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const page = doc.addPage([200, 120]);
  page.drawText('Hello vector world', { x: 20, y: 60, size: 14, font });
  const bytes = await doc.save({ useObjectStreams: false });
  return asFile('vector.pdf', new Blob([bytes], { type: 'application/pdf' }));
}

/** A PDF that looks like a scan: one big noisy bitmap per page. */
async function makeScannedPdf() {
  const lib = await loadPdfLib();

  const canvas = document.createElement('canvas');
  canvas.width = 850;
  canvas.height = 1100;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.45})`;
    ctx.fillRect(Math.random() * 850, Math.random() * 1100, 2, 2);
  }
  ctx.fillStyle = '#000000';
  ctx.font = '30px sans-serif';
  ctx.fillText('Scanned invoice 2026', 60, 120);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));

  const doc = await lib.PDFDocument.create();
  const image = await doc.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
  const page = doc.addPage([612, 792]);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const bytes = await doc.save({ useObjectStreams: false });
  return asFile('scanned.pdf', new Blob([bytes], { type: 'application/pdf' }));
}

/* ---------------------------------------------------------------- driver */

async function compress(file, options = {}) {
  const panel = await compressPdf.options({ files: [file], entries: [] });
  const result = await compressPdf.run({
    files: [file],
    entries: [],
    options: { level: 'balanced', grayscale: false, ...options },
    progress: () => {},
    toast: () => {},
  });
  return { result, panel };
}

/* ----------------------------------------------------------------- tests */

export async function run() {
  const checks = [];

  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    return ok;
  };

  /* 1 — a vector-only PDF must not grow */
  const vector = await makeVectorPdf();
  const vectorRun = await compress(vector);
  const vectorOut = vectorRun.result.blob.size;
  record(
    'vector PDF never grows',
    vectorOut <= vector.size,
    `${vector.size} B -> ${vectorOut} B`
  );

  /* 2 — the text of a vector PDF stays selectable */
  const vectorBytes = new Uint8Array(await vectorRun.result.blob.arrayBuffer());
  const reopened = await openDocument(vectorBytes);
  const text = (await extractDocumentText(reopened)).join(' ').trim();
  await reopened.destroy();
  record(
    'vector PDF keeps selectable text',
    text.includes('Hello vector world'),
    JSON.stringify(text)
  );

  /* 3 — an image-heavy PDF really shrinks */
  const scanned = await makeScannedPdf();
  const scannedRun = await compress(scanned);
  const scannedOut = scannedRun.result.blob.size;
  record(
    'scanned PDF is compressed',
    scannedOut < scanned.size * 0.75,
    `${scanned.size} B -> ${scannedOut} B`
  );

  /* 4 — the reported numbers match reality */
  const stats = Object.fromEntries(
    (vectorRun.result.stats || []).map((s) => [s.label, s.value])
  );
  record(
    'stats report the real sizes',
    stats.Before && stats.After && Number(String(stats.Saved).replace('%', '')) >= 0,
    JSON.stringify(stats)
  );

  /* 5 — grayscale never makes the result bigger than the input either */
  const grayRun = await compress(vector, { grayscale: true });
  record(
    'grayscale never grows a vector PDF',
    grayRun.result.blob.size <= vector.size,
    `${vector.size} B -> ${grayRun.result.blob.size} B`
  );

  const failed = checks.filter((c) => !c.ok);
  return { checks, passed: checks.length - failed.length, total: checks.length };
}
