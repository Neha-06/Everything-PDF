/*
 * Edit tools — rotate, watermark, page numbers, crop, add text, redact, scan.
 */
import { el, clear } from '../lib/util.js';
import { loadPdfLib } from '../lib/pdf-lib.js';
import { openDocument, renderPage } from '../lib/pdfjs.js';
import { cropPage, hexToRgb, tidyName } from './common.js';

const MM_TO_PT = 72 / 25.4;

/* ----------------------------------------------------------- Rotate PDF */

export const rotatePdf = {
  id: 'rotate-pdf',
  name: 'Rotate PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Turn the pages of a PDF clockwise, counter-clockwise or upside down.',
  icon: 'rotate-cw',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Rotate PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — every page is turned by the same amount',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const angleButtons = [90, 180, 270].map((angle) =>
      el('button', {
        type: 'button',
        class: angle === 90 ? 'is-active' : '',
        text: `${angle}°`,
        onclick: () => {
          angleButtons.forEach((b) => b.classList.remove('is-active'));
          angleButtons.find((b) => b.textContent === `${angle}°`)?.classList.add('is-active');
        },
      })
    );

    const scopeButtons = [
      { value: 'all', label: 'All pages' },
      { value: 'odd', label: 'Odd pages' },
      { value: 'even', label: 'Even pages' },
    ].map((o) =>
      el('button', {
        type: 'button',
        class: o.value === 'all' ? 'is-active' : '',
        text: o.label,
        onclick: () => {
          scopeButtons.forEach((b) => b.classList.remove('is-active'));
          scopeButtons.find((b) => b.textContent === o.label)?.classList.add('is-active');
        },
      })
    );

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Rotate PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Rotation' }),
          el('div', { class: 'segmented' }, angleButtons),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Apply to' }),
          el('div', { class: 'segmented' }, scopeButtons),
        ]),
      ]),
      read: () => ({
        angle: [90, 180, 270][angleButtons.findIndex((b) => b.classList.contains('is-active'))],
        scope: ['all', 'odd', 'even'][
          scopeButtons.findIndex((b) => b.classList.contains('is-active'))
        ],
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });

    let count = 0;
    doc.getPages().forEach((page, i) => {
      const number = i + 1;
      const applies =
        ctx.options.scope === 'all' ||
        (ctx.options.scope === 'odd' && number % 2 === 1) ||
        (ctx.options.scope === 'even' && number % 2 === 0);
      if (!applies) return;
      const current = page.getRotation().angle;
      page.setRotation(lib.degrees((current + ctx.options.angle) % 360));
      count += 1;
    });

    ctx.progress(0.9, 'Writing document…');
    const result = await doc.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-rotated.pdf`,
      title: 'Pages rotated',
      description: `${count} page${count > 1 ? 's' : ''} turned by ${ctx.options.angle}°.`,
      stats: [
        { label: 'Pages rotated', value: String(count), good: true },
        { label: 'Angle', value: `${ctx.options.angle}°` },
      ],
    };
  },
};

/* --------------------------------------------------------- Watermark PDF */

const POSITIONS = [
  { value: 'tl', label: 'Top left' },
  { value: 'tc', label: 'Top centre' },
  { value: 'tr', label: 'Top right' },
  { value: 'ml', label: 'Middle left' },
  { value: 'mc', label: 'Middle centre' },
  { value: 'mr', label: 'Middle right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'bc', label: 'Bottom centre' },
  { value: 'br', label: 'Bottom right' },
];

function place(x, y, width, height, boxWidth, boxHeight, position, margin) {
  let left = margin;
  let bottom = margin;
  if (position.includes('c')) left = (boxWidth - width) / 2;
  if (position.endsWith('r')) left = boxWidth - width - margin;
  if (position.startsWith('m')) bottom = (boxHeight - height) / 2;
  if (position.startsWith('t')) bottom = boxHeight - height - margin;
  return { x: left, y: bottom };
}

export const watermarkPdf = {
  id: 'watermark-pdf',
  name: 'Watermark PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Stamp a text watermark over every page of a document.',
  icon: 'layers',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Add watermark',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — the watermark is added to every page',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const text = el('input', { class: 'input', type: 'text', value: 'CONFIDENTIAL' });
    const position = el(
      'select',
      { class: 'select' },
      POSITIONS.map((p) => el('option', { value: p.value, text: p.label }))
    );
    position.value = 'mc';
    const size = el('input', { class: 'input', type: 'number', value: '48', min: '8', max: '200' });
    const opacity = el('input', { class: 'range', type: 'range', min: '5', max: '100', value: '25' });
    const opacityOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '25' });
    opacity.addEventListener('input', () => (opacityOut.textContent = opacity.value));
    const rotation = el('input', { class: 'range', type: 'range', min: '-90', max: '90', value: '0' });
    const rotationOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '0' });
    rotation.addEventListener('input', () => (rotationOut.textContent = rotation.value));
    const color = el('input', { class: 'color', type: 'color', value: '#d73337' });

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Watermark PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Watermark text' }),
          text,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Position' }),
          position,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Font size' }),
          size,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Opacity '), opacityOut]),
          opacity,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Rotation '), rotationOut]),
          rotation,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Colour' }),
          color,
        ]),
      ]),
      read: () => ({
        text: text.value,
        position: position.value,
        size: Number(size.value) || 48,
        opacity: Number(opacity.value) / 100,
        rotation: Number(rotation.value) || 0,
        color: color.value,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const text = ctx.options.text.trim();
    if (!text) throw new Error('Type the text you want to use as a watermark.');

    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    const [r, g, b] = hexToRgb(ctx.options.color);

    doc.getPages().forEach((page, i) => {
      ctx.progress((i / doc.getPageCount()) * 0.9, `Stamping page ${i + 1}…`);
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, ctx.options.size);
      const spot = place(
        0,
        0,
        textWidth,
        ctx.options.size,
        width,
        height,
        ctx.options.position,
        28
      );
      page.drawText(text, {
        x: spot.x,
        y: spot.y,
        size: ctx.options.size,
        font,
        color: lib.rgb(r, g, b),
        opacity: ctx.options.opacity,
        rotate: lib.degrees(ctx.options.rotation),
      });
    });

    ctx.progress(0.95, 'Writing document…');
    const result = await doc.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-watermarked.pdf`,
      title: 'Watermark added',
      description: `“${text}” was stamped on ${doc.getPageCount()} page${doc.getPageCount() > 1 ? 's' : ''}.`,
      stats: [
        { label: 'Pages', value: String(doc.getPageCount()), good: true },
        { label: 'Opacity', value: `${Math.round(ctx.options.opacity * 100)}%` },
      ],
    };
  },
};

/* --------------------------------------------------------- Page numbers */

export const pageNumbers = {
  id: 'page-numbers',
  name: 'Add page numbers',
  group: 'edit',
  tag: 'Edit',
  desc: 'Number the pages of a document in the position you choose.',
  icon: 'page-number',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Add page numbers',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — numbers are added to every page',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const format = el('select', { class: 'select' }, [
      el('option', { value: 'n', text: '1' }),
      el('option', { value: 'page-n', text: 'Page 1', selected: true }),
      el('option', { value: 'n-of-m', text: '1 of 20' }),
      el('option', { value: 'n-m', text: '1 / 20' }),
    ]);
    const position = el(
      'select',
      { class: 'select' },
      POSITIONS.filter((p) => !p.value.startsWith('m')).map((p) =>
        el('option', { value: p.value, text: p.label })
      )
    );
    position.value = 'bc';
    const size = el('input', { class: 'input', type: 'number', value: '12', min: '6', max: '40' });
    const start = el('input', { class: 'input', type: 'number', value: '1', min: '0' });
    const skipFirst = el('input', { type: 'checkbox' });
    const color = el('input', { class: 'color', type: 'color', value: '#434e5b' });

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Add page numbers' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Format' }),
          format,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Position' }),
          position,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Font size' }),
          size,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Start counting at' }),
          start,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Skip the first page'),
              el('small', { text: 'Common for cover pages.' }),
            ]),
            el('span', { class: 'switch__track' }, [skipFirst]),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Colour' }),
          color,
        ]),
      ]),
      read: () => ({
        format: format.value,
        position: position.value,
        size: Number(size.value) || 12,
        start: Number(start.value) || 0,
        skipFirst: skipFirst.checked,
        color: color.value,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    const [r, g, b] = hexToRgb(ctx.options.color);
    const total = doc.getPageCount();

    doc.getPages().forEach((page, i) => {
      ctx.progress((i / total) * 0.9, `Numbering page ${i + 1}…`);
      if (ctx.options.skipFirst && i === 0) return;
      const number = i + 1 + ctx.options.start;
      const label =
        ctx.options.format === 'page-n'
          ? `Page ${number}`
          : ctx.options.format === 'n-of-m'
            ? `${number} of ${total + ctx.options.start}`
            : ctx.options.format === 'n-m'
              ? `${number} / ${total + ctx.options.start}`
              : String(number);

      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(label, ctx.options.size);
      const spot = place(0, 0, textWidth, ctx.options.size, width, height, ctx.options.position, 24);
      page.drawText(label, {
        x: spot.x,
        y: spot.y,
        size: ctx.options.size,
        font,
        color: lib.rgb(r, g, b),
      });
    });

    ctx.progress(0.95, 'Writing document…');
    const result = await doc.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-numbered.pdf`,
      title: 'Page numbers added',
      description: `${ctx.options.skipFirst ? total - 1 : total} pages were numbered.`,
      stats: [{ label: 'Pages', value: String(total), good: true }],
    };
  },
};

/* ------------------------------------------------------------- Crop PDF */

export const cropPdf = {
  id: 'crop-pdf',
  name: 'Crop PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Cut away the empty margins around the content of a document.',
  icon: 'crop',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Crop PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — set how much should be trimmed off each side',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const inputs = {};
    const make = (key, label) => {
      const input = el('input', { class: 'input', type: 'number', value: '0', min: '0', step: '1' });
      inputs[key] = input;
      return el('div', { class: 'field' }, [
        el('label', { class: 'field__label', text: label }),
        input,
      ]);
    };

    const presets = el('div', { class: 'segmented' }, [
      el('button', {
        type: 'button',
        text: 'None',
        onclick: () => Object.values(inputs).forEach((i) => (i.value = '0')),
      }),
      el('button', {
        type: 'button',
        text: '10 mm',
        onclick: () => Object.values(inputs).forEach((i) => (i.value = '10')),
      }),
      el('button', {
        type: 'button',
        text: '20 mm',
        onclick: () => Object.values(inputs).forEach((i) => (i.value = '20')),
      }),
    ]);

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Crop PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Trim every side' }),
          presets,
          el('div', { class: 'field__hint', text: 'Values are in millimetres.' }),
        ]),
        make('top', 'Top (mm)'),
        make('right', 'Right (mm)'),
        make('bottom', 'Bottom (mm)'),
        make('left', 'Left (mm)'),
      ]),
      read: () => ({
        top: Number(inputs.top.value) || 0,
        right: Number(inputs.right.value) || 0,
        bottom: Number(inputs.bottom.value) || 0,
        left: Number(inputs.left.value) || 0,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const { top, right, bottom, left } = ctx.options;
    if (!top && !right && !bottom && !left) {
      throw new Error('Set how much should be trimmed from at least one side.');
    }

    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const src = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });

    ctx.progress(0.3, 'Cropping pages…');
    const out = await lib.PDFDocument.create();

    for (let i = 0; i < src.getPageCount(); i++) {
      ctx.progress(0.3 + (0.6 * i) / src.getPageCount(), `Cropping page ${i + 1}…`);
      await cropPage(out, src, src.getPage(i), {
        top: top * MM_TO_PT,
        right: right * MM_TO_PT,
        bottom: bottom * MM_TO_PT,
        left: left * MM_TO_PT,
      });
    }

    ctx.progress(0.95, 'Writing document…');
    const result = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-cropped.pdf`,
      title: 'Pages cropped',
      description: `${src.getPageCount()} page${src.getPageCount() > 1 ? 's' : ''} trimmed.`,
      stats: [{ label: 'Pages', value: String(src.getPageCount()), good: true }],
    };
  },
};

/* ------------------------------------------------------------- Edit PDF */

export const editPdf = {
  id: 'edit-pdf',
  name: 'Edit PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Add text to the pages of a document and save the changes.',
  icon: 'pen-tool',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Save changes',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — then type the text you want to add',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const total = ctx.entries[0]?.info?.pages || 1;
    const text = el('textarea', { class: 'textarea', rows: '3', placeholder: 'Type here…' });
    const page = el('input', { class: 'input', type: 'number', value: '1', min: '1', max: String(total) });
    const size = el('input', { class: 'input', type: 'number', value: '18', min: '6', max: '96' });
    const color = el('input', { class: 'color', type: 'color', value: '#09121c' });
    const all = el('input', { type: 'checkbox' });
    const position = el(
      'select',
      { class: 'select' },
      POSITIONS.map((p) => el('option', { value: p.value, text: p.label }))
    );
    position.value = 'bl';

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Edit PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Text' }),
          text,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page' }),
          page,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Position' }),
          position,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Font size' }),
          size,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Colour' }),
          color,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Add to every page'),
              el('small', { text: 'Otherwise only the selected page is changed.' }),
            ]),
            el('span', { class: 'switch__track' }, [all]),
          ]),
        ]),
      ]),
      read: () => ({
        text: text.value,
        page: Number(page.value) || 1,
        position: position.value,
        size: Number(size.value) || 18,
        color: color.value,
        all: all.checked,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const value = ctx.options.text.trim();
    if (!value) throw new Error('Type the text you want to add to the document.');

    const bytes = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    const [r, g, b] = hexToRgb(ctx.options.color);

    const pages = doc.getPages();
    const targets = ctx.options.all
      ? pages
      : [pages[Math.min(Math.max(ctx.options.page - 1, 0), pages.length - 1)]];

    targets.forEach((page) => {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(value, ctx.options.size);
      const spot = place(0, 0, textWidth, ctx.options.size, width, height, ctx.options.position, 30);
      page.drawText(value, {
        x: spot.x,
        y: spot.y,
        size: ctx.options.size,
        font,
        color: lib.rgb(r, g, b),
      });
    });

    ctx.progress(0.95, 'Writing document…');
    const result = await doc.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-edited.pdf`,
      title: 'Document edited',
      description: `Text added to ${targets.length} page${targets.length > 1 ? 's' : ''}.`,
      stats: [{ label: 'Pages changed', value: String(targets.length), good: true }],
    };
  },
};

/* ----------------------------------------------------------- Redact PDF */

export const redactPdf = {
  id: 'redact-pdf',
  name: 'Redact PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Black out sensitive parts of a page — the content is really removed.',
  icon: 'eye-off',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Redact PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — drag over the text you want to hide',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const data = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await openDocument(data);

    const canvas = el('canvas', {
      style: {
        width: '100%',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        background: '#fff',
        cursor: 'crosshair',
        touchAction: 'none',
      },
    });
    const label = el('div', { class: 'card__hint' });
    const pager = el('div', { class: 'segmented' });

    const boxes = new Map(); // pageIndex -> [{x, y, w, h}] normalised
    let current = 0;
    let renderTask = null;
    let drawSeq = 0;

    const draw = async () => {
      const seq = ++drawSeq;
      const index = current;

      // PDF.js refuses to render twice into the same canvas at once, so any
      // render still in flight has to be cancelled before the canvas is reset.
      if (renderTask) {
        const previous = renderTask;
        renderTask = null;
        try {
          previous.cancel();
        } catch {
          /* the task had already finished */
        }
        try {
          await previous.promise;
        } catch {
          /* cancelled */
        }
      }
      if (seq !== drawSeq) return;

      const page = await doc.getPage(index + 1);
      if (seq !== drawSeq) return;

      const viewport = page.getViewport({ scale: 1.4 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const task = page.render({ canvasContext: context, viewport, canvas });
      renderTask = task;
      try {
        await task.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') throw err;
        return;
      } finally {
        if (renderTask === task) renderTask = null;
      }
      if (seq !== drawSeq) return;

      const list = boxes.get(index) || [];
      context.fillStyle = 'rgba(0,0,0,0.75)';
      list.forEach((b) => {
        context.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
      });
    };

    const setPage = (index) => {
      current = Math.min(Math.max(index, 0), doc.numPages - 1);
      Array.from(pager.children).forEach((b, i) =>
        b.classList.toggle('is-active', i === current)
      );
      label.textContent = `Page ${current + 1} of ${doc.numPages}`;
      draw();
    };

    for (let i = 0; i < Math.min(doc.numPages, 12); i++) {
      pager.append(
        el('button', {
          type: 'button',
          text: String(i + 1),
          onclick: () => setPage(i),
        })
      );
    }
    if (doc.numPages > 12) {
      pager.append(el('button', { type: 'button', text: '…', disabled: true }));
    }

    let dragStart = null;
    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect();
      dragStart = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!dragStart) return;
      const rect = canvas.getBoundingClientRect();
      const endX = (event.clientX - rect.left) / rect.width;
      const endY = (event.clientY - rect.top) / rect.height;
      const box = {
        x: Math.min(dragStart.x, endX),
        y: Math.min(dragStart.y, endY),
        w: Math.abs(endX - dragStart.x),
        h: Math.abs(endY - dragStart.y),
      };
      dragStart = null;
      if (box.w < 0.005 || box.h < 0.005) return;
      const list = boxes.get(current) || [];
      list.push(box);
      boxes.set(current, list);
      draw();
    });

    const node = el('div', { class: 'card card--pad' }, [
      el('div', { class: 'card__title', text: 'Mark the areas to redact' }),
      el('div', { class: 'card__hint', style: { marginTop: '4px', marginBottom: '12px' }, text: 'Drag with the mouse over anything that should be blacked out.' }),
      pager,
      el('div', { style: { marginTop: '12px' } }, [canvas]),
      label,
    ]);

    setPage(0);

    return {
      node,
      placement: 'main',
      read: () => ({
        boxes: Object.fromEntries([...boxes.entries()].map(([k, v]) => [String(k), v])),
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const raw = ctx.options.boxes || {};
    const pageMap = Object.entries(raw).map(([index, list]) => [Number(index), list || []]);
    const total = pageMap.reduce((n, [, list]) => n + list.length, 0);
    if (!total) throw new Error('Drag over at least one area that should be redacted.');

    const data = new Uint8Array(await ctx.files[0].arrayBuffer());
    const doc = await openDocument(data);
    const out = await lib.PDFDocument.create();

    for (let p = 1; p <= doc.numPages; p++) {
      ctx.progress((p - 1) / doc.numPages, `Redacting page ${p} of ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const canvas = await renderPage(page, { scale: 2 });
      const context = canvas.getContext('2d');
      const list = pageMap.find(([index]) => index === p - 1)?.[1] || [];
      context.fillStyle = '#000000';
      list.forEach((b) => {
        context.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
      });

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const unit = page.getViewport({ scale: 1 });
      const pdfPage = out.addPage([unit.width, unit.height]);
      pdfPage.drawImage(jpg, { x: 0, y: 0, width: unit.width, height: unit.height });
    }

    await doc.destroy();
    ctx.progress(0.95, 'Writing document…');
    const result = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-redacted.pdf`,
      title: 'Content redacted',
      description: `${total} area${total > 1 ? 's' : ''} were removed from the document.`,
      stats: [
        { label: 'Redactions', value: String(total), good: true },
        { label: 'Method', value: 'Flattened' },
      ],
    };
  },
};

/* ------------------------------------------------------------- Scan PDF */

export const scanPdf = {
  id: 'scan-pdf',
  name: 'Scan to PDF',
  group: 'edit',
  tag: 'Edit',
  desc: 'Turn photos of documents into a clean, straightened PDF.',
  icon: 'camera',
  accept: '.jpg,.jpeg,.png,.webp,image/*',
  multiple: true,
  actionLabel: 'Create PDF',
  dropTitle: 'Drop your photos here',
  dropHint: 'or click to browse — take pictures of a document and turn them into a PDF',
  acceptLabel: 'JPG, PNG or WEBP',
  validate: (file) => /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith('image/'),

  async options() {
    const grayscale = el('input', { type: 'checkbox', checked: true });
    const pageSize = el('select', { class: 'select' }, [
      el('option', { value: 'a4', text: 'A4', selected: true }),
      el('option', { value: 'letter', text: 'US Letter' }),
      el('option', { value: 'fit', text: 'Fit to photo' }),
    ]);
    const margin = el('input', { class: 'input', type: 'number', value: '12', min: '0', max: '120' });
    const brightness = el('input', { class: 'range', type: 'range', min: '70', max: '130', value: '100' });
    const brightnessOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '100' });
    brightness.addEventListener('input', () => (brightnessOut.textContent = brightness.value));
    const contrast = el('input', { class: 'range', type: 'range', min: '70', max: '180', value: '115' });
    const contrastOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '115' });
    contrast.addEventListener('input', () => (contrastOut.textContent = contrast.value));

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Scan to PDF' }),
        el('div', { class: 'field' }, [
          el('label', { class: 'switch' }, [
            el('div', { class: 'switch__text' }, [
              document.createTextNode('Grayscale'),
              el('small', { text: 'Much smaller files for text documents.' }),
            ]),
            el('span', { class: 'switch__track' }, [grayscale]),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page size' }),
          pageSize,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Margin (mm)' }),
          margin,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Brightness '), brightnessOut]),
          brightness,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Contrast '), contrastOut]),
          contrast,
        ]),
      ]),
      read: () => ({
        grayscale: grayscale.checked,
        pageSize: pageSize.value,
        margin: Number(margin.value) || 0,
        brightness: Number(brightness.value) / 100,
        contrast: Number(contrast.value) / 100,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.create();
    const marginPt = ctx.options.margin * MM_TO_PT;

    for (let i = 0; i < ctx.files.length; i++) {
      ctx.progress((i / ctx.files.length) * 0.9, `Processing photo ${i + 1}…`);
      const bytes = new Uint8Array(await ctx.files[i].arrayBuffer());
      const type = ctx.files[i].type || 'image/jpeg';

      const blob = new Blob([bytes], { type });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const filters = [];
      if (ctx.options.grayscale) filters.push('grayscale(1)');
      filters.push(`brightness(${ctx.options.brightness})`);
      filters.push(`contrast(${ctx.options.contrast})`);
      context.filter = filters.join(' ');
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      const jpg = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));

      let pageWidth;
      let pageHeight;
      if (ctx.options.pageSize === 'fit') {
        pageWidth = jpg.width + marginPt * 2;
        pageHeight = jpg.height + marginPt * 2;
      } else {
        const [aw, ah] = ctx.options.pageSize === 'letter' ? [612, 792] : [595.28, 841.89];
        const landscape = jpg.width > jpg.height;
        pageWidth = landscape ? ah : aw;
        pageHeight = landscape ? aw : ah;
      }

      const page = out.addPage([pageWidth, pageHeight]);
      const availableWidth = pageWidth - marginPt * 2;
      const availableHeight = pageHeight - marginPt * 2;
      let drawWidth = availableWidth;
      let drawHeight = availableHeight;
      const ratio = jpg.width / jpg.height;
      if (drawWidth / drawHeight > ratio) drawWidth = drawHeight * ratio;
      else drawHeight = drawWidth / ratio;

      page.drawImage(jpg, {
        x: (pageWidth - drawWidth) / 2,
        y: (pageHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }

    ctx.progress(0.95, 'Writing document…');
    const result = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(ctx.files[0].name)}-scan.pdf`,
      title: 'Scan created',
      description: `${ctx.files.length} photo${ctx.files.length > 1 ? 's' : ''} turned into a PDF document.`,
      stats: [
        { label: 'Pages', value: String(ctx.files.length), good: true },
        { label: 'Mode', value: ctx.options.grayscale ? 'Grayscale' : 'Colour' },
      ],
    };
  },
};

export const editTools = [rotatePdf, watermarkPdf, pageNumbers, cropPdf, editPdf, redactPdf, scanPdf];
