/*
 * Organize tools — merge, split, reorder, remove, extract, repair.
 */
import { el } from '../lib/util.js';
import { loadPdfLib } from '../lib/pdf-lib.js';
import { zipFiles } from '../lib/zip.js';
import { buildPageGrid } from './page-grid.js';
import { parsePageRanges, tidyName } from './common.js';

async function loadDoc(file, lib, { ignoreEncryption = true } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return lib.PDFDocument.load(bytes, { ignoreEncryption });
}

/** Copy the given (0-based) page indices of `src` into a brand new document. */
async function extractPagesInto(src, indices, lib) {
  const out = await lib.PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((page) => out.addPage(page));
  try {
    const title = src.getTitle();
    if (title) out.setTitle(title);
    const author = src.getAuthor();
    if (author) out.setAuthor(author);
  } catch {
    /* metadata is optional */
  }
  out.setProducer('PDF Tools');
  out.setCreator('PDF Tools');
  return out;
}

/* ------------------------------------------------------------ Merge PDF */

export const mergePdf = {
  id: 'merge-pdf',
  name: 'Merge PDF',
  group: 'organize',
  tag: 'Organize',
  desc: 'Combine several PDF documents into one file, in the order you choose.',
  icon: 'layers',
  accept: '.pdf,application/pdf',
  multiple: true,
  actionLabel: 'Merge PDF',
  dropTitle: 'Drop your PDF files here',
  dropHint: 'or click to browse — add two or more documents and they will be merged top to bottom',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Merge PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'Documents are combined in the order shown. Use the arrow buttons in the file list to move one up or down.',
        }),
      ]),
      read: () => ({}),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    if (ctx.files.length < 2) throw new Error('Add at least two PDF files to merge.');

    const out = await lib.PDFDocument.create();
    let pages = 0;

    for (let i = 0; i < ctx.files.length; i++) {
      ctx.progress(i / ctx.files.length, `Adding file ${i + 1} of ${ctx.files.length}…`);
      const src = await loadDoc(ctx.files[i], lib);
      const indices = src.getPageIndices();
      const copied = await out.copyPages(src, indices);
      copied.forEach((page) => out.addPage(page));
      pages += indices.length;
    }

    ctx.progress(0.95, 'Writing document…');
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-merged.pdf`,
      title: 'PDFs merged',
      description: `${ctx.files.length} documents were combined into a single file.`,
      stats: [
        { label: 'Documents', value: String(ctx.files.length) },
        { label: 'Pages', value: String(pages), good: true },
      ],
    };
  },
};

/* ------------------------------------------------------------ Split PDF */

export const splitPdf = {
  id: 'split-pdf',
  name: 'Split PDF',
  group: 'organize',
  tag: 'Organize',
  desc: 'Break one PDF into several documents by page range, interval or one-by-one.',
  icon: 'scissors',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Split PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — the document will be split into separate files',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const total = ctx.entries[0]?.info?.pages || 0;

    const modeButtons = ['Ranges', 'Every N pages', 'Single pages'].map((label, i) =>
      el('button', {
        type: 'button',
        class: i === 0 ? 'is-active' : '',
        text: label,
        onclick: () => {
          modeButtons.forEach((b) => b.classList.remove('is-active'));
          modeButtons[i].classList.add('is-active');
          rangeWrap.style.display = i === 0 ? '' : 'none';
          everyWrap.style.display = i === 1 ? '' : 'none';
          singleWrap.style.display = i === 2 ? '' : 'none';
        },
      })
    );

    const rangeInput = el('input', {
      class: 'input',
      type: 'text',
      value: total ? `1-${Math.min(10, total)}` : '1-10',
      placeholder: '1-3, 5, 8-12',
    });
    const rangeWrap = el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Page ranges' }),
      rangeInput,
      el('div', {
        class: 'field__hint',
        text: 'Each range becomes its own PDF. Example: 1-3, 4-8, 9-',
      }),
    ]);

    const everyInput = el('input', { class: 'input', type: 'number', value: '1', min: '1' });
    const everyWrap = el('div', { class: 'field', style: { display: 'none' } }, [
      el('label', { class: 'field__label', text: 'Pages per file' }),
      everyInput,
      el('div', { class: 'field__hint', text: 'Every N pages becomes a separate document.' }),
    ]);

    const singleWrap = el('div', { class: 'field', style: { display: 'none' } }, [
      el('div', {
        class: 'card__hint',
        text: 'Every page is exported as its own single-page PDF.',
      }),
    ]);

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Split PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Split mode' }),
          el('div', { class: 'segmented' }, modeButtons),
        ]),
        rangeWrap,
        everyWrap,
        singleWrap,
      ]),
      read: () => ({
        mode: modeButtons.findIndex((b) => b.classList.contains('is-active')),
        ranges: rangeInput.value,
        every: Math.max(1, Number(everyInput.value) || 1),
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const file = ctx.files[0];
    const src = await loadDoc(file, lib);
    const total = src.getPageCount();

    let groups = [];
    if (ctx.options.mode === 0) {
      const parsed = parsePageRanges(ctx.options.ranges, total);
      if (!parsed.length) throw new Error('Enter at least one valid page range.');
      groups = groupConsecutive(parsed);
    } else if (ctx.options.mode === 1) {
      const size = ctx.options.every;
      for (let i = 0; i < total; i += size) {
        groups.push(Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k));
      }
    } else {
      groups = Array.from({ length: total }, (_, i) => [i]);
    }

    ctx.progress(0.1, 'Splitting pages…');
    const base = tidyName(file.name);
    const entries = [];

    for (let g = 0; g < groups.length; g++) {
      ctx.progress(0.1 + (0.8 * g) / groups.length, `Building part ${g + 1} of ${groups.length}…`);
      const out = await lib.PDFDocument.create();
      const copied = await out.copyPages(src, groups[g]);
      copied.forEach((page) => out.addPage(page));
      const bytes = await out.save({ useObjectStreams: false });
      const label = groups[g]
        .map((i) => i + 1)
        .join('-');
      entries.push({ name: `${base}-part-${String(g + 1).padStart(2, '0')}-p${label}.pdf`, data: bytes });
    }

    ctx.progress(0.95, 'Packing archive…');
    const blob =
      entries.length === 1
        ? new Blob([entries[0].data], { type: 'application/pdf' })
        : await zipFiles(entries, { name: `${base}-split.zip` });

    return {
      blob,
      filename: entries.length === 1 ? entries[0].name : `${base}-split.zip`,
      title: 'PDF split',
      description: `${groups.length} document${groups.length > 1 ? 's' : ''} created from ${total} pages.`,
      stats: [
        { label: 'Output files', value: String(groups.length), good: true },
        { label: 'Source pages', value: String(total) },
      ],
    };
  },
};

/** Group a sorted list of page indices into consecutive runs. */
function groupConsecutive(indices) {
  const groups = [];
  let current = [];
  let previous = null;
  for (const index of indices) {
    if (previous !== null && index !== previous + 1) {
      groups.push(current);
      current = [];
    }
    current.push(index);
    previous = index;
  }
  if (current.length) groups.push(current);
  return groups;
}

/* ---------------------------------------------------------- Organize PDF */

export const organizePdf = {
  id: 'organize-pdf',
  name: 'Organize PDF',
  group: 'organize',
  tag: 'Organize',
  desc: 'Rotate, delete and re-order the pages of a document.',
  icon: 'grip-vertical',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Save changes',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — drag pages to re-order them',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const grid = await buildPageGrid(ctx.files[0], { mode: 'reorder' });
    return {
      node: grid.node,
      placement: 'main',
      read: () => grid.read(),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const src = await loadDoc(ctx.files[0], lib);
    const order = ctx.options.order || [];
    if (!order.length) throw new Error('Every page was removed — keep at least one page.');

    const out = await lib.PDFDocument.create();
    const copied = await out.copyPages(src, order);
    copied.forEach((page, i) => {
      const rotation = ctx.options.rotations?.[order[i]] || 0;
      if (rotation) page.setRotation(lib.degrees(rotation));
      out.addPage(page);
    });

    ctx.progress(0.9, 'Writing document…');
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-organized.pdf`,
      title: 'Document organised',
      description: `${order.length} page${order.length > 1 ? 's' : ''} saved in the new order.`,
      stats: [
        { label: 'Pages kept', value: String(order.length), good: true },
        { label: 'Pages removed', value: String(src.getPageCount() - order.length) },
      ],
    };
  },
};

/* ---------------------------------------------------------- Remove pages */

export const removePages = {
  id: 'remove-pages',
  name: 'Remove pages',
  group: 'organize',
  tag: 'Organize',
  desc: 'Delete the pages you select and keep the rest of the document.',
  icon: 'file-minus',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Remove pages',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — then tick the pages you want to delete',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const grid = await buildPageGrid(ctx.files[0], { mode: 'select', selected: [] });
    return {
      node: grid.node,
      placement: 'main',
      read: () => grid.read(),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const src = await loadDoc(ctx.files[0], lib);
    const removed = ctx.options.selected || [];
    if (!removed.length) throw new Error('Select at least one page to remove.');

    const keep = src.getPageIndices().filter((i) => !removed.includes(i));
    if (!keep.length) throw new Error('You cannot remove every page of the document.');

    ctx.progress(0.5, 'Rebuilding document…');
    const out = await extractPagesInto(src, keep, lib);
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-cleaned.pdf`,
      title: 'Pages removed',
      description: `${removed.length} page${removed.length > 1 ? 's' : ''} deleted from the document.`,
      stats: [
        { label: 'Removed', value: String(removed.length) },
        { label: 'Remaining', value: String(keep.length), good: true },
      ],
    };
  },
};

/* --------------------------------------------------------- Extract pages */

export const extractPages = {
  id: 'extract-pages',
  name: 'Extract pages',
  group: 'organize',
  tag: 'Organize',
  desc: 'Pull the pages you need out of a document into a brand new PDF.',
  icon: 'file-search',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Extract pages',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — then choose the pages to extract',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const grid = await buildPageGrid(ctx.files[0], { mode: 'select' });
    return {
      node: grid.node,
      placement: 'main',
      read: () => grid.read(),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const src = await loadDoc(ctx.files[0], lib);
    const picked = (ctx.options.selected || []).sort((a, b) => a - b);
    if (!picked.length) throw new Error('Select at least one page to extract.');

    ctx.progress(0.5, 'Extracting pages…');
    const out = await extractPagesInto(src, picked, lib);
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-extracted.pdf`,
      title: 'Pages extracted',
      description: `${picked.length} page${picked.length > 1 ? 's' : ''} saved to a new document.`,
      stats: [
        { label: 'Extracted', value: String(picked.length), good: true },
        { label: 'Source pages', value: String(src.getPageCount()) },
      ],
    };
  },
};

/* ----------------------------------------------------------- Repair PDF */

export const repairPdf = {
  id: 'repair-pdf',
  name: 'Repair PDF',
  group: 'organize',
  tag: 'Organize',
  desc: 'Rebuild a broken or damaged PDF so that it opens again.',
  icon: 'wrench',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Repair PDF',
  dropTitle: 'Drop a damaged PDF here',
  dropHint: 'or click to browse — the file will be rebuilt from scratch',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Repair PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'Every page is copied into a freshly generated document, which repairs broken cross-reference tables and page trees.',
        }),
      ]),
      read: () => ({}),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const file = ctx.files[0];

    ctx.progress(0.2, 'Reading document…');
    let src;
    try {
      src = await loadDoc(file, lib);
    } catch (err) {
      throw new Error(
        'This file could not be parsed at all. It may be truncated or not a PDF.'
      );
    }

    ctx.progress(0.6, 'Rebuilding page tree…');
    const out = await lib.PDFDocument.create();
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    copied.forEach((page) => out.addPage(page));
    try {
      const title = src.getTitle();
      if (title) out.setTitle(title);
      const author = src.getAuthor();
      if (author) out.setAuthor(author);
      const subject = src.getSubject();
      if (subject) out.setSubject(subject);
    } catch {
      /* ignore */
    }
    out.setProducer('PDF Tools');
    out.setCreator('PDF Tools');

    ctx.progress(0.9, 'Writing document…');
    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(file.name)}-repaired.pdf`,
      title: 'PDF repaired',
      description: 'The document was rebuilt and now opens in any PDF reader.',
      stats: [
        { label: 'Pages recovered', value: String(indices.length), good: true },
        { label: 'Status', value: 'Healthy' },
      ],
    };
  },
};

export const organizeTools = [
  mergePdf,
  splitPdf,
  organizePdf,
  removePages,
  extractPages,
  repairPdf,
];
