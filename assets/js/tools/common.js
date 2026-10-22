/* Helpers shared by the individual tool implementations. */
import { loadPdfLib } from '../lib/pdf-lib.js';

export async function pdfBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** Parse "1-3, 5, 8-" into a sorted list of 0-based page indices. */
export function parsePageRanges(text, total) {
  const out = [];
  const cleaned = String(text || '').trim();
  if (!cleaned) return out;
  for (const part of cleaned.split(/[,;\n]/)) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(\d*)\s*-\s*(\d*)$/.exec(token);
    if (range) {
      const from = range[1] ? Number(range[1]) : 1;
      const to = range[2] ? Number(range[2]) : total;
      for (let i = Math.max(1, from); i <= Math.min(total, to); i++) out.push(i - 1);
      continue;
    }
    const single = Number(token);
    if (Number.isFinite(single) && single >= 1 && single <= total) out.push(single - 1);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A4 / Letter / Legal page sizes in PDF points. */
export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
};

/** Wrap a plain string into lines that fit the given width. */
export function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Lay plain text blocks out onto PDF pages.
 * blocks: [{ type, text }]
 */
export async function textToPdf(blocks, { title = 'Document', pageSize = 'a4', fontSize = 11 } = {}) {
  const lib = await loadPdfLib();
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [w, h] = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
  const margin = 56;
  const maxWidth = w - margin * 2;
  const lineHeight = fontSize * 1.45;

  let page = doc.addPage([w, h]);
  let y = h - margin;

  const newPage = () => {
    page = doc.addPage([w, h]);
    y = h - margin;
  };

  for (const block of blocks) {
    const isHeading = /^(title|h1|h2|h3)$/.test(block.type || '');
    const size = block.type === 'title' ? fontSize * 2.2 : block.type === 'h1' ? fontSize * 1.7 : block.type === 'h2' ? fontSize * 1.35 : block.type === 'h3' ? fontSize * 1.15 : fontSize;
    const face = isHeading ? bold : font;
    const lines = wrapText(block.text, face, size, maxWidth);
    const gap = isHeading ? size * 0.7 : size * 0.35;
    for (const line of lines) {
      if (y - size < margin) newPage();
      y -= size;
      page.drawText(line, { x: margin, y, size, font: face, color: rgb(0.04, 0.07, 0.11) });
      y -= lineHeight - size;
    }
    y -= gap;
    if (y < margin) newPage();
  }

  doc.setTitle(title);
  doc.setProducer('PDF Tools');
  doc.setCreator('PDF Tools');
  return doc.save();
}

/** Build a PDF where every page is a full-bleed image. */
export async function imagesToPdf(
  images,
  { pageSize = 'fit', margin = 0, orientation = 'auto', quality = 0.9 } = {}
) {
  const lib = await loadPdfLib();
  const { PDFDocument } = lib;
  const doc = await PDFDocument.create();
  const [aw, ah] = PAGE_SIZES.a4;

  for (const image of images) {
    const bytes = image.bytes;
    const isJpeg = /\.jpe?g$/i.test(image.name || '') || image.type === 'image/jpeg';
    const embedded = isJpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);

    let width;
    let height;
    if (pageSize === 'fit') {
      width = embedded.width + margin * 2;
      height = embedded.height + margin * 2;
    } else {
      const [baseW, baseH] = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
      const landscape =
        orientation === 'landscape' ||
        (orientation === 'auto' && embedded.width > embedded.height);
      width = landscape ? baseH : baseW;
      height = landscape ? baseW : baseH;
    }

    const page = doc.addPage([width, height]);
    let drawWidth = width - margin * 2;
    let drawHeight = height - margin * 2;
    const ratio = embedded.width / embedded.height;
    if (drawWidth / drawHeight > ratio) drawWidth = drawHeight * ratio;
    else drawHeight = drawWidth / ratio;

    page.drawImage(embedded, {
      x: (width - drawWidth) / 2,
      y: (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  doc.setProducer('PDF Tools');
  doc.setCreator('PDF Tools');
  return doc.save();
}

/* ---------------------------------------------------------------- colours */

/** '#ff0000' → [1, 0, 0] (pdf-lib rgb components are 0..1). */
export function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16) || 0;
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/* --------------------------------------------------------------- cropping */

/**
 * Copy a page into `out` with its margins trimmed away.
 * The returned page is already part of `out`.
 */
export async function cropPage(out, srcDoc, srcPage, { left = 0, right = 0, top = 0, bottom = 0 }) {
  const box = srcPage.getMediaBox();
  const width = box.width - left - right;
  const height = box.height - top - bottom;
  if (width <= 1 || height <= 1) throw new Error('The crop is larger than the page.');

  try {
    const [embedded] = await out.embedPage(srcPage);
    const page = out.addPage([width, height]);
    page.drawPage(embedded, {
      x: -left,
      y: -bottom,
      width: box.width,
      height: box.height,
    });
    return page;
  } catch {
    // Fall back to a plain crop box if the page cannot be embedded.
    const index = srcDoc.getPages().indexOf(srcPage);
    const [copy] = await out.copyPages(srcDoc, [index]);
    copy.setCropBox(box.x + left, box.y + bottom, width, height);
    out.addPage(copy);
    return copy;
  }
}

/* --------------------------------------------------------------- files */

/** Common extension check. */
export function hasExt(name, exts) {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImage(file) {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  );
}

/** Strip the extension from a file name. */
export function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

/** Turn "Report.PDF" into "Report". */
export function tidyName(name) {
  return stripExt(name).replace(/[\\/:*?"<>|]/g, '').trim() || 'document';
}

/** A Blob from raw bytes. */
export function blobOf(bytes, type = 'application/pdf') {
  return new Blob([bytes], { type });
}

