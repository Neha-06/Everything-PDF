/*
 * Optimize tools — compress and OCR.
 */
import { el } from '../lib/util.js';
import { loadPdfLib } from '../lib/pdf-lib.js';
import { openDocument, pdfjs, renderPage } from '../lib/pdfjs.js';
import { tidyName } from './common.js';

/** Grayscale copy of a canvas. */
function toGray(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.05)';
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the page image.'))),
      'image/jpeg',
      quality
    );
  });
}

/* ---------------------------------------------------------- Compress PDF */

const LEVELS = {
  extreme: { label: 'Extreme', scale: 0.55, quality: 0.4 },
  strong: { label: 'Strong', scale: 0.8, quality: 0.58 },
  balanced: { label: 'Balanced', scale: 1.15, quality: 0.74 },
  light: { label: 'Light', scale: 1.6, quality: 0.88 },
};

/* -------------------------------------------------------- compression */

/**
 * Operator codes that paint a bitmap onto a page.
 * Looked up by name so we never depend on the numeric values of a build.
 */
let imageOps = null;
function imageOpCodes() {
  if (imageOps) return imageOps;
  const codes = new Set();
  const ops = pdfjs && pdfjs.OPS;
  if (ops) {
    for (const key of [
      'paintImageXObject',
      'paintInlineImageXObject',
      'paintImageMaskXObject',
      'paintJpegXObject',
    ]) {
      if (typeof ops[key] === 'number') codes.add(ops[key]);
    }
  }
  imageOps = codes;
  return codes;
}

/**
 * Does this page paint any bitmap?
 * When the answer cannot be determined we say "yes", so no content is ever lost.
 */
async function pageHasImages(doc, pageNumber) {
  try {
    const page = await doc.getPage(pageNumber);
    const ops = await page.getOperatorList();
    const codes = imageOpCodes();
    if (!codes.size) return true;
    return ops.fnArray.some((fn) => codes.has(fn));
  } catch {
    return true;
  }
}

/**
 * Rewrite the file with object streams — no quality loss at all:
 * the text stays selectable and the vector graphics stay sharp.
 */
async function losslessBytes(doc) {
  return doc.save({ useObjectStreams: true });
}

/**
 * Re-encode only the pages that actually contain images.
 * Vector-only pages are copied over untouched, so text never turns into pixels.
 *
 * @returns {Promise<{bytes: Uint8Array, rasterised: number, pages: number} | null>}
 */
async function rasterBytes(data, lib, level, grayscale, onProgress) {
  let view = null;
  try {
    view = await openDocument(data.slice(0));
  } catch {
    return null; // encrypted or damaged — the lossless pass still works
  }

  const src = await lib.PDFDocument.load(data, { ignoreEncryption: true });
  const out = await lib.PDFDocument.create();
  let rasterised = 0;
  const pages = view.numPages;

  try {
    for (let i = 0; i < pages; i++) {
      onProgress(i / pages, `Page ${i + 1} of ${pages}…`);
      const page = await view.getPage(i + 1);

      if (!(await pageHasImages(view, i + 1))) {
        try {
          const [copied] = await out.copyPages(src, [i]);
          out.addPage(copied);
          continue;
        } catch {
          /* could not copy the page — fall through and rasterise it */
        }
      }

      rasterised += 1;
      const canvas = await renderPage(page, { scale: level.scale });
      const processed = grayscale ? toGray(canvas) : canvas;
      const blob = await canvasToJpeg(processed, level.quality);
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));

      const unit = page.getViewport({ scale: 1 });
      const pdfPage = out.addPage([unit.width, unit.height]);
      pdfPage.drawImage(jpg, { x: 0, y: 0, width: unit.width, height: unit.height });
    }
  } finally {
    await view.destroy();
  }

  if (!rasterised) return null; // nothing to re-encode — the lossless pass is better
  return { bytes: await out.save({ useObjectStreams: true }), rasterised, pages };
}

/**
 * Compress one file by building every plausible result and keeping the smallest.
 * The original bytes always take part in the race, so the output can never
 * be larger than the input.
 */
async function compressFile(data, lib, level, grayscale, onProgress) {
  const candidates = [{ strategy: 'original', bytes: data, rasterised: 0 }];
  let pages = 0;

  try {
    const doc = await lib.PDFDocument.load(data, { ignoreEncryption: true });
    pages = doc.getPageCount();
    candidates.push({
      strategy: 'lossless',
      bytes: await losslessBytes(doc),
      rasterised: 0,
    });
  } catch {
    /* damaged file — the original stays in the race */
  }

  try {
    const raster = await rasterBytes(data, lib, level, grayscale, onProgress);
    if (raster) {
      candidates.push({
        strategy: 'raster',
        bytes: raster.bytes,
        rasterised: raster.rasterised,
      });
      if (!pages) pages = raster.pages;
    }
  } catch {
    /* rendering is best effort — the lossless pass still works */
  }

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.bytes.length < best.bytes.length) best = candidate;
  }
  return { best, pages };
}

export const compressPdf = {
  id: 'compress-pdf',
  name: 'Compress PDF',
  group: 'optimize',
  tag: 'Optimize',
  desc: 'Shrink a PDF without ever making it bigger — images are re-encoded, text stays crisp.',
  icon: 'zap',
  accept: '.pdf,application/pdf',
  multiple: true,
  actionLabel: 'Compress PDF',
  dropTitle: 'Drop your PDFs here',
  dropHint: 'or click to browse — bigger reductions need lower image quality',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    let selected = 'balanced';
    const levelButtons = [];

    for (const [key, meta] of Object.entries(LEVELS)) {
      const button = el('button', {
        type: 'button',
        class: key === selected ? 'is-active' : '',
        text: meta.label,
      });
      button.addEventListener('click', () => {
        selected = key;
        levelButtons.forEach((b) => b.classList.toggle('is-active', b === button));
      });
      levelButtons.push(button);
    }

    const grayInput = el('input', { type: 'checkbox' });

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Compress PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Compression level' }),
          el('div', { class: 'segmented' }, levelButtons),
          el('div', {
            class: 'field__hint',
            text: 'Extreme gives the smallest file, Light keeps the sharpest text. Pages without images are never rasterised.',
          }),
        ]),
        el('div', { class: 'field' }, [
          el('div', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Convert to grayscale'),
              el('small', { text: 'Removes colour from image pages — usually a big saving.' }),
            ]),
            el('label', { class: 'switch__track' }),
            grayInput,
          ]),
        ]),
      ]),
      read: () => ({
        level: selected,
        grayscale: grayInput.checked,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const raw = ctx.options.level;
    const key =
      typeof raw === 'number' ? Object.keys(LEVELS)[raw] : raw;
    const level = LEVELS[key] || LEVELS.balanced;
    const grayscale = Boolean(ctx.options.grayscale);
    const total = ctx.files.length;

    const outputs = [];
    let originalTotal = 0;
    let newTotal = 0;
    let rasterisedPages = 0;
    let totalPages = 0;
    let losslessFiles = 0;
    let untouchedFiles = 0;

    for (let f = 0; f < total; f++) {
      const file = ctx.files[f];
      const base = f / total;
      ctx.progress(base, `Compressing ${file.name}…`);

      const data = new Uint8Array(await file.arrayBuffer());
      const { best, pages } = await compressFile(data, lib, level, grayscale, (ratio, label) =>
        ctx.progress(base + (0.9 * ratio) / total, label)
      );

      originalTotal += data.length;
      newTotal += best.bytes.length;
      rasterisedPages += best.rasterised;
      totalPages += pages;
      if (best.strategy === 'lossless') losslessFiles += 1;
      if (best.strategy === 'original') untouchedFiles += 1;
      outputs.push({ name: `${tidyName(file.name)}-compressed.pdf`, data: best.bytes });
    }

    ctx.progress(0.95, 'Writing file…');
    const blob =
      outputs.length === 1
        ? new Blob([outputs[0].data], { type: 'application/pdf' })
        : await (await import('../lib/zip.js')).zipFiles(outputs, { name: 'compressed-pdfs.zip' });

    const saved = originalTotal > 0 ? 1 - newTotal / originalTotal : 0;
    const pct = Math.round(saved * 100);
    const good = saved > 0.02;

    let method = 'Unchanged';
    if (rasterisedPages > 0 && losslessFiles > 0) method = 'Mixed';
    else if (rasterisedPages > 0) method = 'Re-encoded';
    else if (losslessFiles > 0) method = 'Lossless';

    let description;
    if (untouchedFiles === total) {
      description =
        'This PDF was already stored in the most compact way possible — re-encoding the pages would only make it bigger.';
    } else if (rasterisedPages > 0) {
      const kept = Math.max(0, totalPages - rasterisedPages);
      const keptText = kept
        ? `, ${kept} page${kept === 1 ? '' : 's'} kept as vectors`
        : '';
      description = good
        ? `${pct}% smaller — ${rasterisedPages} image page${rasterisedPages === 1 ? '' : 's'} re-encoded${keptText}.`
        : 'The image pages were re-encoded, but the file stayed about the same size.';
      if (grayscale) description += ' Colour was removed from the image pages.';
    } else {
      description = good
        ? `${pct}% smaller — the document was rewritten losslessly, so the text stays selectable and the vectors stay sharp.`
        : 'This document was already well optimised — it was rewritten losslessly for about the same size.';
    }

    return {
      blob,
      filename: outputs.length === 1 ? outputs[0].name : 'compressed-pdfs.zip',
      title: 'PDF compressed',
      description,
      stats: [
        { label: 'Before', value: formatSize(originalTotal) },
        { label: 'After', value: formatSize(newTotal), good },
        { label: 'Saved', value: `${pct}%`, good },
        { label: 'Method', value: method },
      ],
    };
  },
};

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/* -------------------------------------------------------------- OCR PDF */

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let tesseractPending = null;

function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!tesseractPending) {
    tesseractPending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_CDN;
      script.async = true;
      script.onload = () =>
        globalThis.Tesseract
          ? resolve(globalThis.Tesseract)
          : reject(new Error('The OCR engine did not start.'));
      script.onerror = () => reject(new Error('Could not download the OCR engine.'));
      document.head.append(script);
    });
  }
  return tesseractPending;
}

export const ocrPdf = {
  id: 'ocr-pdf',
  name: 'OCR PDF',
  group: 'optimize',
  tag: 'Optimize',
  desc: 'Recognise the text in scanned pages and make the PDF searchable.',
  icon: 'scan',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Run OCR',
  dropTitle: 'Drop a scanned PDF here',
  dropHint: 'or click to browse — the pages are read with OCR and become searchable',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const pages = ctx.entries[0]?.info?.pages || '?';
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'OCR PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'The OCR engine runs locally in your browser — no page is ever uploaded. Scanned pages become searchable and selectable.',
        }),
        el('div', { class: 'note' }, [
          el('span', { text: `${pages} page${pages === 1 ? '' : 's'} to read. The first run downloads the English language model.` }),
        ]),
      ]),
      read: () => ({}),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const Tesseract = await loadTesseract();

    const data = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await openDocument(data);
    const out = await lib.PDFDocument.create();
    const font = await out.embedFont(lib.StandardFonts.Helvetica);

    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (message) => {
        if (message.status && typeof message.progress === 'number') {
          ctx.progress(
            Math.min(0.9, message.progress * 0.9),
            `${message.status} ${Math.round(message.progress * 100)}%`
          );
        }
      },
    });

    let words = 0;

    try {
      for (let p = 1; p <= doc.numPages; p++) {
        ctx.progress((p - 1) / doc.numPages, `Reading page ${p} of ${doc.numPages}…`);
        const page = await doc.getPage(p);
        const canvas = await renderPage(page, { scale: 2 });
        const blob = await canvasToJpeg(canvas, 0.92);
        const { data: result } = await worker.recognize(blob);

        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const unit = page.getViewport({ scale: 1 });
        const pdfPage = out.addPage([unit.width, unit.height]);
        pdfPage.drawImage(jpg, { x: 0, y: 0, width: unit.width, height: unit.height });

        const scale = 2;
        for (const word of result.words || []) {
          const text = (word.text || '').trim();
          if (!text) continue;
          const box = word.bbox;
          const size = Math.max(4, (box.y1 - box.y0) / scale);
          const x = box.x0 / scale;
          const y = unit.height - box.y1 / scale;
          if (x < 0 || y < 0) continue;
          pdfPage.drawText(text, {
            x,
            y,
            size,
            font,
            color: lib.rgb(0, 0, 0),
            opacity: 0,
          });
          words += 1;
        }
      }
    } finally {
      await worker.terminate();
      await doc.destroy();
    }

    ctx.progress(0.95, 'Writing searchable PDF…');
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-ocr.pdf`,
      title: 'OCR finished',
      description: 'The document is now searchable — use Ctrl+F in any PDF reader.',
      stats: [
        { label: 'Pages', value: String(doc.numPages) },
        { label: 'Words found', value: String(words), good: true },
      ],
    };
  },
};

export const optimizeTools = [compressPdf, ocrPdf];
