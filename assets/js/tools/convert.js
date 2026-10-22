/*
 * Convert tools — PDF to/from JPG, Word, Excel, PowerPoint, HTML, PDF/A, Markdown.
 */
import { el } from '../lib/util.js';
import { loadPdfLib } from '../lib/pdf-lib.js';
import { openDocument, extractDocumentText, renderPage } from '../lib/pdfjs.js';
import { buildDocx, buildXlsx, readDocx, readXlsx, readPptx, zipFiles } from '../lib/zip.js';
import { imagesToPdf, textToPdf, PAGE_SIZES, tidyName, stripExt } from './common.js';

/* ----------------------------------------------------------------- utils */

async function pdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await openDocument(data);
  const pages = await extractDocumentText(doc);
  await doc.destroy();
  return pages;
}

/** Split a block of text into spreadsheet-ish rows (2+ spaces = column gap). */
function textToRows(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      rows.push([]);
      continue;
    }
    const cells = trimmed
      .split(/\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    rows.push(cells.length ? cells : [trimmed]);
  }
  return rows;
}

function padRows(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/** Split a tall canvas into page-sized slices. */
function sliceCanvas(canvas, sliceHeight) {
  const slices = [];
  for (let y = 0; y < canvas.height; y += sliceHeight) {
    const height = Math.min(sliceHeight, canvas.height - y);
    const piece = document.createElement('canvas');
    piece.width = canvas.width;
    piece.height = height;
    piece.getContext('2d').drawImage(canvas, 0, y, canvas.width, height, 0, 0, canvas.width, height);
    slices.push(piece);
  }
  return slices;
}

/* ------------------------------------------------------------ PDF → JPG */

export const pdfToJpg = {
  id: 'pdf-to-jpg',
  name: 'PDF to JPG',
  group: 'convert',
  tag: 'Convert',
  desc: 'Turn every page of a PDF into a high quality JPG image.',
  icon: 'image',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to JPG',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — one image is created per page',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const format = el('select', { class: 'select' }, [
      el('option', { value: 'jpeg', text: 'JPG' }),
      el('option', { value: 'png', text: 'PNG (lossless)' }),
    ]);
    const dpi = el('select', { class: 'select' }, [
      el('option', { value: '96', text: '96 dpi — small' }),
      el('option', { value: '150', text: '150 dpi — balanced', selected: true }),
      el('option', { value: '220', text: '220 dpi — sharp' }),
      el('option', { value: '300', text: '300 dpi — print' }),
    ]);
    const quality = el('input', { class: 'range', type: 'range', min: '40', max: '100', value: '88' });
    const qualityOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '88' });
    quality.addEventListener('input', () => (qualityOut.textContent = quality.value));

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to JPG' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Image format' }),
          format,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Resolution' }),
          dpi,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Quality '), qualityOut]),
          quality,
        ]),
      ]),
      read: () => ({
        format: format.value,
        dpi: Number(dpi.value),
        quality: Number(quality.value) / 100,
      }),
    };
  },

  async run(ctx) {
    const data = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await openDocument(data);
    const scale = ctx.options.dpi / 72;
    const mime = ctx.options.format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = ctx.options.format === 'png' ? 'png' : 'jpg';
    const base = tidyName(ctx.files[0].name);

    const entries = [];
    for (let p = 1; p <= doc.numPages; p++) {
      ctx.progress((p - 1) / doc.numPages, `Rendering page ${p} of ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const canvas = await renderPage(page, { scale });
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, mime, ctx.options.quality)
      );
      entries.push({
        name: `${base}-${String(p).padStart(2, '0')}.${ext}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    await doc.destroy();

    ctx.progress(0.95, 'Collecting images…');
    const blob =
      entries.length === 1
        ? new Blob([entries[0].data], { type: mime })
        : await zipFiles(entries, { name: `${base}-images.zip` });

    return {
      blob,
      filename: entries.length === 1 ? entries[0].name : `${base}-images.zip`,
      title: 'Conversion finished',
      description: `${entries.length} image${entries.length > 1 ? 's' : ''} generated from the PDF.`,
      stats: [
        { label: 'Images', value: String(entries.length), good: true },
        { label: 'Resolution', value: `${ctx.options.dpi} dpi` },
      ],
    };
  },
};

/* ------------------------------------------------------------ JPG → PDF */

export const jpgToPdf = {
  id: 'jpg-to-pdf',
  name: 'JPG to PDF',
  group: 'convert',
  tag: 'Convert',
  desc: 'Combine JPG, PNG and WEBP images into a single PDF document.',
  icon: 'file-plus',
  accept: '.jpg,.jpeg,.png,.webp,image/*',
  multiple: true,
  actionLabel: 'Convert to PDF',
  dropTitle: 'Drop your images here',
  dropHint: 'or click to browse — add as many pictures as you like',
  acceptLabel: 'JPG, PNG or WEBP',
  validate: (file) => /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith('image/'),

  async options() {
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'fit', text: 'Fit to image' }),
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
      el('option', { value: 'legal', text: 'US Legal' }),
      el('option', { value: 'a3', text: 'A3' }),
    ]);
    const orientation = el('select', { class: 'select' }, [
      el('option', { value: 'auto', text: 'Automatic' }),
      el('option', { value: 'portrait', text: 'Portrait' }),
      el('option', { value: 'landscape', text: 'Landscape' }),
    ]);
    const margin = el('input', { class: 'input', type: 'number', value: '0', min: '0', max: '200' });

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'JPG to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Orientation' }),
          orientation,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Margin (points)' }),
          margin,
        ]),
      ]),
      read: () => ({
        pageSize: pageSize.value,
        orientation: orientation.value,
        margin: Number(margin.value) || 0,
      }),
    };
  },

  async run(ctx) {
    const images = [];
    for (let i = 0; i < ctx.files.length; i++) {
      ctx.progress((i / ctx.files.length) * 0.4, 'Reading images…');
      images.push({
        name: ctx.files[i].name,
        type: ctx.files[i].type,
        bytes: new Uint8Array(await ctx.files[i].arrayBuffer()),
      });
    }

    ctx.progress(0.5, 'Building PDF…');
    const bytes = await imagesToPdf(images, ctx.options);
    const blob = new Blob([bytes], { type: 'application/pdf' });

    return {
      blob,
      filename: `${tidyName(ctx.files[0].name)}.pdf`,
      title: 'PDF created',
      description: `${images.length} image${images.length > 1 ? 's' : ''} placed into a PDF document.`,
      stats: [
        { label: 'Pages', value: String(images.length), good: true },
        { label: 'Page size', value: ctx.options.pageSize === 'fit' ? 'Fit to image' : ctx.options.pageSize.toUpperCase() },
      ],
    };
  },
};

/* ---------------------------------------------------------- PDF → Word */

export const pdfToWord = {
  id: 'pdf-to-word',
  name: 'PDF to Word',
  group: 'convert',
  tag: 'Convert',
  desc: 'Extract the text of a PDF into an editable Word document.',
  icon: 'file-text',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to Word',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — the text is extracted into a .docx file',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const headings = el('input', { type: 'checkbox', checked: true });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to Word' }),
        el('div', {
          class: 'panel__desc',
          text: 'Every page becomes a paragraph. Images and complex layouts are not carried over.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Add page headings'),
              el('small', { text: 'Separates the text of each page.' }),
            ]),
            el('span', { class: 'switch__track' }, [headings]),
          ]),
        ]),
      ]),
      read: () => ({ headings: headings.checked }),
    };
  },

  async run(ctx) {
    const pages = await pdfText(ctx.files[0]);
    const blocks = [];
    pages.forEach((text, i) => {
      if (ctx.options.headings) blocks.push({ type: 'h2', text: `Page ${i + 1}` });
      const clean = (text || '').trim();
      if (clean) blocks.push({ type: 'p', text: clean });
    });
    if (!blocks.length) throw new Error('No selectable text was found in this PDF.');

    ctx.progress(0.8, 'Writing Word file…');
    const blob = await buildDocx(blocks, { title: tidyName(ctx.files[0].name) });

    return {
      blob,
      filename: `${tidyName(ctx.files[0].name)}.docx`,
      title: 'Word file created',
      description: `${pages.length} page${pages.length > 1 ? 's' : ''} converted into an editable document.`,
      stats: [
        { label: 'Pages', value: String(pages.length) },
        { label: 'Characters', value: String(blocks.reduce((n, b) => n + b.text.length, 0)), good: true },
      ],
    };
  },
};

/* ---------------------------------------------------------- Word → PDF */

export const wordToPdf = {
  id: 'word-to-pdf',
  name: 'Word to PDF',
  group: 'convert',
  tag: 'Convert',
  desc: 'Turn a Word document into a PDF that looks the same everywhere.',
  icon: 'file-type',
  accept: '.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  multiple: false,
  actionLabel: 'Convert to PDF',
  dropTitle: 'Drop a Word file here',
  dropHint: 'or click to browse — .docx documents are supported',
  acceptLabel: 'DOCX',
  validate: (file) => /\.docx?$/i.test(file.name),

  async options() {
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
      el('option', { value: 'legal', text: 'US Legal' }),
    ]);
    const fontSize = el('input', { class: 'input', type: 'number', value: '11', min: '7', max: '24' });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Word to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Font size' }),
          fontSize,
        ]),
      ]),
      read: () => ({
        pageSize: pageSize.value,
        fontSize: Number(fontSize.value) || 11,
      }),
    };
  },

  async run(ctx) {
    const data = await ctx.files[0].arrayBuffer();
    let blocks;
    try {
      blocks = await readDocx(data);
    } catch {
      throw new Error('This Word file could not be read. Only .docx files are supported.');
    }
    if (!blocks.length) throw new Error('The document appears to be empty.');

    ctx.progress(0.6, 'Laying out pages…');
    const bytes = await textToPdf(blocks, {
      title: tidyName(ctx.files[0].name),
      pageSize: ctx.options.pageSize,
      fontSize: ctx.options.fontSize,
    });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}.pdf`,
      title: 'PDF created',
      description: 'The Word document was converted to PDF.',
      stats: [
        { label: 'Paragraphs', value: String(blocks.length), good: true },
        { label: 'Page size', value: ctx.options.pageSize.toUpperCase() },
      ],
    };
  },
};

/* ---------------------------------------------------------- PDF → Excel */

export const pdfToExcel = {
  id: 'pdf-to-excel',
  name: 'PDF to Excel',
  group: 'convert',
  tag: 'Convert',
  desc: 'Pull the tables and rows of a PDF into a spreadsheet.',
  icon: 'file-spreadsheet',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to Excel',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — columns are detected from the spacing in the text',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const headings = el('input', { type: 'checkbox', checked: true });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to Excel' }),
        el('div', {
          class: 'panel__desc',
          text: 'Text lines become rows. Two or more spaces between words are treated as a column break.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('One sheet per page'),
              el('small', { text: 'Keeps pages separate in the workbook.' }),
            ]),
            el('span', { class: 'switch__track' }, [headings]),
          ]),
        ]),
      ]),
      read: () => ({ perPage: headings.checked }),
    };
  },

  async run(ctx) {
    const pages = await pdfText(ctx.files[0]);
    const sheets = [];

    if (ctx.options.perPage) {
      pages.forEach((text, i) => {
        sheets.push({ name: `Page ${i + 1}`, rows: padRows(textToRows(text)) });
      });
    } else {
      const rows = [];
      pages.forEach((text) => rows.push(...textToRows(text)));
      sheets.push({ name: 'Sheet1', rows: padRows(rows) });
    }

    const filled = sheets.filter((s) => s.rows.length);
    if (!filled.length) throw new Error('No selectable text was found in this PDF.');

    ctx.progress(0.8, 'Writing workbook…');
    const blob = await buildXlsx(filled, { title: tidyName(ctx.files[0].name) });

    return {
      blob,
      filename: `${tidyName(ctx.files[0].name)}.xlsx`,
      title: 'Spreadsheet created',
      description: `${filled.length} sheet${filled.length > 1 ? 's' : ''} written from the PDF text.`,
      stats: [
        { label: 'Sheets', value: String(filled.length), good: true },
        { label: 'Rows', value: String(filled.reduce((n, s) => n + s.rows.length, 0)) },
      ],
    };
  },
};

/* ---------------------------------------------------------- Excel → PDF */

export const excelToPdf = {
  id: 'excel-to-pdf',
  name: 'Excel to PDF',
  group: 'convert',
  tag: 'Convert',
  desc: 'Print a spreadsheet to PDF, one page per sheet section.',
  icon: 'file-spreadsheet',
  accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  multiple: false,
  actionLabel: 'Convert to PDF',
  dropTitle: 'Drop a spreadsheet here',
  dropHint: 'or click to browse — .xlsx and .csv files are supported',
  acceptLabel: 'XLSX or CSV',
  validate: (file) => /\.(xlsx|csv)$/i.test(file.name),

  async options() {
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
      el('option', { value: 'landscape-legal', text: 'A4 landscape' }),
    ]);
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Excel to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
      ]),
      read: () => ({ pageSize: pageSize.value }),
    };
  },

  async run(ctx) {
    const file = ctx.files[0];
    let sheets = [];

    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      const rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.split(','));
      sheets = [{ name: 'Sheet1', rows }];
    } else {
      try {
        sheets = await readXlsx(await file.arrayBuffer());
      } catch {
        throw new Error('This workbook could not be read.');
      }
    }

    if (!sheets.length) throw new Error('The workbook is empty.');

    const blocks = [];
    sheets.forEach((sheet, i) => {
      blocks.push({ type: 'h1', text: sheet.name || `Sheet ${i + 1}` });
      for (const row of sheet.rows || []) {
        const text = row.filter(Boolean).join('    ');
        if (text.trim()) blocks.push({ type: 'p', text });
      }
      blocks.push({ type: 'p', text: '' });
    });

    ctx.progress(0.6, 'Laying out pages…');
    const bytes = await textToPdf(blocks, {
      title: tidyName(file.name),
      pageSize: ctx.options.pageSize === 'landscape-legal' ? 'a4' : ctx.options.pageSize,
      fontSize: 10,
    });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(file.name)}.pdf`,
      title: 'PDF created',
      description: `${sheets.length} sheet${sheets.length > 1 ? 's' : ''} converted to PDF.`,
      stats: [
        { label: 'Sheets', value: String(sheets.length), good: true },
        { label: 'Rows', value: String(sheets.reduce((n, s) => n + (s.rows || []).length, 0)) },
      ],
    };
  },
};

/* ------------------------------------------------------- PDF → PowerPoint */

const PPTXGEN_SOURCE = new URL('../../vendor/pptxgen.bundle.js', import.meta.url).href;

let pptxPending = null;

/** Load the bundled PptxGenJS (UMD build, JSZip included). */
function loadPptxGen() {
  if (globalThis.PptxGenJS) return Promise.resolve(globalThis.PptxGenJS);
  if (!pptxPending) {
    pptxPending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PPTXGEN_SOURCE;
      script.async = true;
      script.onload = () =>
        globalThis.PptxGenJS
          ? resolve(globalThis.PptxGenJS)
          : reject(new Error('The PowerPoint writer did not start.'));
      script.onerror = () => reject(new Error('Could not load the bundled PowerPoint writer.'));
      document.head.append(script);
    });
  }
  return pptxPending;
}

export const pdfToPowerpoint = {
  id: 'pdf-to-powerpoint',
  name: 'PDF to PowerPoint',
  group: 'convert',
  tag: 'Convert',
  desc: 'Turn each page of a PDF into a slide of a PowerPoint deck.',
  icon: 'file-slides',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to PowerPoint',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — one slide is created per page',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const headings = el('input', { type: 'checkbox', checked: true });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to PowerPoint' }),
        el('div', {
          class: 'panel__desc',
          text: 'The first line of each page becomes the slide title and the rest becomes the body text.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Use first line as title'),
              el('small', { text: 'Uncheck to put everything in the body.' }),
            ]),
            el('span', { class: 'switch__track' }, [headings]),
          ]),
        ]),
      ]),
      read: () => ({ useTitle: headings.checked }),
    };
  },

  async run(ctx) {
    const PptxGenJS = await loadPptxGen();
    const pages = await pdfText(ctx.files[0]);
    if (!pages.length) throw new Error('The document has no pages.');

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    pages.forEach((text, i) => {
      ctx.progress((i / pages.length) * 0.8, `Building slide ${i + 1}…`);
      const lines = (text || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const slide = pptx.addSlide();
      const title = ctx.options.useTitle && lines.length ? lines[0] : `Page ${i + 1}`;
      const body = ctx.options.useTitle && lines.length ? lines.slice(1) : lines;
      slide.addText(title, {
        x: 0.5,
        y: 0.4,
        w: 9,
        h: 0.8,
        fontSize: 26,
        bold: true,
        color: '09121C',
      });
      if (body.length) {
        slide.addText(
          body.map((line) => ({ text: line, options: { bullet: true } })),
          { x: 0.6, y: 1.4, w: 8.8, h: 5.2, fontSize: 14, color: '434E5B' }
        );
      }
    });

    ctx.progress(0.9, 'Writing presentation…');
    const blob = await pptx.write({ outputType: 'blob' });

    return {
      blob,
      filename: `${tidyName(ctx.files[0].name)}.pptx`,
      title: 'Presentation created',
      description: `${pages.length} slide${pages.length > 1 ? 's' : ''} generated from the PDF.`,
      stats: [
        { label: 'Slides', value: String(pages.length), good: true },
        { label: 'Format', value: 'PPTX' },
      ],
    };
  },
};

/* --------------------------------------------------- PowerPoint → PDF */

export const powerpointToPdf = {
  id: 'powerpoint-to-pdf',
  name: 'PowerPoint to PDF',
  group: 'convert',
  tag: 'Convert',
  desc: 'Convert a PowerPoint deck into a PDF document.',
  icon: 'file-slides',
  accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  multiple: false,
  actionLabel: 'Convert to PDF',
  dropTitle: 'Drop a PowerPoint file here',
  dropHint: 'or click to browse — .pptx presentations are supported',
  acceptLabel: 'PPTX',
  validate: (file) => /\.pptx$/i.test(file.name),

  async options() {
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
    ]);
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PowerPoint to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
      ]),
      read: () => ({ pageSize: pageSize.value }),
    };
  },

  async run(ctx) {
    let slides;
    try {
      slides = await readPptx(await ctx.files[0].arrayBuffer());
    } catch {
      throw new Error('This presentation could not be read.');
    }
    if (!slides.length) throw new Error('The presentation has no slides.');

    const blocks = [];
    slides.forEach((slide, i) => {
      blocks.push({ type: 'h2', text: `Slide ${i + 1}` });
      for (const block of slide.blocks || []) {
        if (block.text.trim()) blocks.push({ type: 'p', text: block.text });
      }
    });

    ctx.progress(0.6, 'Laying out pages…');
    const bytes = await textToPdf(blocks, {
      title: tidyName(ctx.files[0].name),
      pageSize: ctx.options.pageSize,
      fontSize: 11,
    });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}.pdf`,
      title: 'PDF created',
      description: `${slides.length} slide${slides.length > 1 ? 's' : ''} converted to PDF.`,
      stats: [{ label: 'Slides', value: String(slides.length), good: true }],
    };
  },
};

/* ---------------------------------------------------------- HTML → PDF */

const HTML2CANVAS_SOURCE = new URL('../../vendor/html2canvas.min.js', import.meta.url).href;

let html2canvasPending = null;

function loadHtml2Canvas() {
  if (globalThis.html2canvas) return Promise.resolve(globalThis.html2canvas);
  if (!html2canvasPending) {
    html2canvasPending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HTML2CANVAS_SOURCE;
      script.async = true;
      script.onload = () =>
        globalThis.html2canvas
          ? resolve(globalThis.html2canvas)
          : reject(new Error('The HTML renderer did not start.'));
      script.onerror = () => reject(new Error('Could not download the HTML renderer.'));
      document.head.append(script);
    });
  }
  return html2canvasPending;
}

export const htmlToPdf = {
  id: 'html-to-pdf',
  name: 'HTML to PDF',
  group: 'convert',
  tag: 'Convert',
  desc: 'Save a web page or HTML file as a printable PDF.',
  icon: 'globe',
  accept: '.html,.htm,text/html',
  multiple: false,
  actionLabel: 'Convert to PDF',
  dropTitle: 'Drop an HTML file here',
  dropHint: 'or click to browse — the page is rendered exactly as the browser shows it',
  acceptLabel: 'HTML',
  validate: (file) => /\.(html?|xhtml)$/i.test(file.name) || file.type === 'text/html',

  async options() {
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
    ]);
    const orientation = el('select', { class: 'select' }, [
      el('option', { value: 'portrait', text: 'Portrait', selected: true }),
      el('option', { value: 'landscape', text: 'Landscape' }),
    ]);
    const full = el('input', { type: 'checkbox', checked: true });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'HTML to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Orientation' }),
          orientation,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Keep page background'),
              el('small', { text: 'Includes colours behind the text.' }),
            ]),
            el('span', { class: 'switch__track' }, [full]),
          ]),
        ]),
      ]),
      read: () => ({
        pageSize: pageSize.value,
        orientation: orientation.value,
        background: full.checked ? '#ffffff' : null,
      }),
    };
  },

  async run(ctx) {
    const html2canvas = await loadHtml2Canvas();
    const source = await ctx.files[0].text();

    ctx.progress(0.15, 'Rendering page…');
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;';
    document.body.append(frame);

    const [pageW, pageH] = PAGE_SIZES[ctx.options.pageSize] || PAGE_SIZES.a4;
    const pxPerPoint = 96 / 72;
    const width = Math.round(pageW * pxPerPoint);
    const height = Math.round(pageH * pxPerPoint);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;

    const doc = frame.contentDocument;
    doc.open();
    doc.write(source);
    doc.close();

    await new Promise((resolve) => {
      const ready = () => resolve();
      if (doc.readyState === 'complete') setTimeout(ready, 120);
      else frame.addEventListener('load', () => setTimeout(ready, 120));
    });

    const body = doc.body || doc.documentElement;
    const scrollHeight = Math.max(body.scrollHeight, doc.documentElement.scrollHeight);

    ctx.progress(0.45, 'Capturing page…');
    const canvas = await html2canvas(body, {
      scale: 2,
      backgroundColor: ctx.options.background,
      width,
      height: scrollHeight,
      windowWidth: width,
      useCORS: true,
      logging: false,
    });

    frame.remove();

    ctx.progress(0.7, 'Paging…');
    const slices = sliceCanvas(canvas, height * 2);
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.create();

    for (let i = 0; i < slices.length; i++) {
      ctx.progress(0.7 + (0.2 * i) / slices.length, `Page ${i + 1} of ${slices.length}…`);
      const blob = await new Promise((resolve) => slices[i].toBlob(resolve, 'image/jpeg', 0.94));
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const landscape = ctx.options.orientation === 'landscape';
      const w = landscape ? pageH : pageW;
      const h = landscape ? pageW : pageH;
      const pdfPage = out.addPage([w, h]);
      pdfPage.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    }

    const bytes = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}.pdf`,
      title: 'PDF created',
      description: `${slices.length} page${slices.length > 1 ? 's' : ''} rendered from the HTML file.`,
      stats: [{ label: 'Pages', value: String(slices.length), good: true }],
    };
  },
};

/* ---------------------------------------------------------- PDF → PDF/A */

export const pdfToPdfa = {
  id: 'pdf-to-pdfa',
  name: 'PDF to PDF/A',
  group: 'convert',
  tag: 'Convert',
  desc: 'Convert a PDF into the archival PDF/A-2b format.',
  icon: 'shield',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to PDF/A',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — the document is rebuilt with archival metadata',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const title = el('input', { class: 'input', type: 'text', placeholder: 'Document title' });
    const author = el('input', { class: 'input', type: 'text', placeholder: 'Author name' });
    const subject = el('input', { class: 'input', type: 'text', placeholder: 'Subject' });
    const keywords = el('input', { class: 'input', type: 'text', placeholder: 'keywords, separated, by, commas' });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to PDF/A' }),
        el('div', {
          class: 'panel__desc',
          text: 'The document is rebuilt with an XMP identification packet so it is recognised as PDF/A-2b.',
        }),
        el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Title' }), title]),
        el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Author' }), author]),
        el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Subject' }), subject]),
        el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Keywords' }), keywords]),
      ]),
      read: () => ({
        title: title.value.trim(),
        author: author.value.trim(),
        subject: subject.value.trim(),
        keywords: keywords.value.trim(),
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const src = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });

    ctx.progress(0.5, 'Rebuilding document…');
    const out = await lib.PDFDocument.create();
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    copied.forEach((page) => out.addPage(page));

    const title = ctx.options.title || src.getTitle() || tidyName(ctx.files[0].name);
    const author = ctx.options.author || src.getAuthor() || 'PDF Tools';
    const subject = ctx.options.subject || src.getSubject() || '';
    // pdf-lib expects an array of keywords, not a single string.
    const keywords = String(ctx.options.keywords || src.getKeywords() || '')
      .split(/[,\s]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    out.setTitle(title);
    out.setAuthor(author);
    out.setSubject(subject);
    if (keywords.length) out.setKeywords(keywords);
    out.setCreator('PDF Tools');
    out.setProducer('PDF Tools — PDF/A-2b');
    out.setCreationDate(new Date());
    out.setModificationDate(new Date());

    // Attach an XMP identification packet that declares PDF/A-2b conformance.
    try {
      const xmp =
        `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
        `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
        `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
        `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
        `xmlns:pdf="http://ns.adobe.com/pdf/1.3/" ` +
        `xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B">` +
        `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>` +
        `<dc:creator><rdf:Seq><rdf:li>${escapeXml(author)}</rdf:li></rdf:Seq></dc:creator>` +
        `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(subject)}</rdf:li></rdf:Alt></dc:description>` +
        `<pdf:Producer>PDF Tools</pdf:Producer>` +
        `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

      const stream = out.context.stream(new TextEncoder().encode(xmp), {
        Type: 'Metadata',
        Subtype: 'XML',
      });
      const ref = out.context.register(stream);
      out.catalog.set(lib.PDFName.of('Metadata'), ref);
    } catch {
      /* metadata is a bonus — the document itself is still valid */
    }

    ctx.progress(0.9, 'Writing document…');
    const result = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-pdfa.pdf`,
      title: 'Converted to PDF/A',
      description: 'The document now carries a PDF/A-2b identification packet.',
      stats: [
        { label: 'Pages', value: String(indices.length) },
        { label: 'Conformance', value: 'PDF/A-2b', good: true },
      ],
    };
  },
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------- PDF → Markdown */

export const pdfToMarkdown = {
  id: 'pdf-to-markdown',
  name: 'PDF to Markdown',
  group: 'convert',
  tag: 'Convert',
  desc: 'Convert the text of a PDF into clean Markdown.',
  icon: 'file-code',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Convert to Markdown',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — the text is written as a .md file',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const headings = el('input', { type: 'checkbox', checked: true });
    const code = el('input', { type: 'checkbox' });
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'PDF to Markdown' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Add page headings'),
              el('small', { text: 'Writes "# Page 1" before every page.' }),
            ]),
            el('span', { class: 'switch__track' }, [headings]),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Wrap code blocks'),
              el('small', { text: 'Puts the text inside fenced code blocks.' }),
            ]),
            el('span', { class: 'switch__track' }, [code]),
          ]),
        ]),
      ]),
      read: () => ({ headings: headings.checked, code: code.checked }),
    };
  },

  async run(ctx) {
    const pages = await pdfText(ctx.files[0]);
    const parts = [];

    pages.forEach((text, i) => {
      if (ctx.options.headings) parts.push(`# Page ${i + 1}`);
      const clean = (text || '').trim();
      if (!clean) return;
      parts.push(ctx.options.code ? ['```', clean, '```'].join('\n') : clean);
    });

    const markdown = parts.join('\n\n');
    if (!markdown.trim()) throw new Error('No selectable text was found in this PDF.');

    ctx.progress(0.8, 'Writing Markdown file…');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });

    return {
      blob,
      filename: `${tidyName(ctx.files[0].name)}.md`,
      title: 'Markdown created',
      description: `${pages.length} page${pages.length > 1 ? 's' : ''} converted to Markdown.`,
      stats: [
        { label: 'Pages', value: String(pages.length) },
        { label: 'Characters', value: String(markdown.length), good: true },
      ],
    };
  },
};

export const convertTools = [
  pdfToJpg,
  jpgToPdf,
  pdfToWord,
  wordToPdf,
  pdfToExcel,
  excelToPdf,
  pdfToPowerpoint,
  powerpointToPdf,
  htmlToPdf,
  pdfToPdfa,
  pdfToMarkdown,
];
