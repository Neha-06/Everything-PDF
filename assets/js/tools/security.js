/*
 * Security tools — unlock, protect, sign and compare.
 */
import { el, clear, switchField } from '../lib/util.js';
import { loadPdfLib } from '../lib/pdf-lib.js';
import { openDocument, renderPage } from '../lib/pdfjs.js';
import { encryptPdf } from '../lib/pdf-crypto.js';
import { tidyName, PAGE_SIZES } from './common.js';

/* --------------------------------------------------------------- helpers */

function canvasToJpeg(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the page image.'))),
      'image/jpeg',
      quality
    );
  });
}

/** Cut the transparent border away from a signature drawing. */
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(
    canvas,
    minX,
    minY,
    out.width,
    out.height,
    0,
    0,
    out.width,
    out.height
  );
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = url;
  });
}

/* ------------------------------------------------------------ Unlock PDF */

export const unlockPdf = {
  id: 'unlock-pdf',
  name: 'Unlock PDF',
  group: 'security',
  tag: 'Security',
  desc: 'Remove the password from a protected PDF and save an unrestricted copy.',
  icon: 'unlock',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Unlock PDF',
  dropTitle: 'Drop a protected PDF here',
  dropHint: 'or click to browse — you will be asked for the document password',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const password = el('input', {
      class: 'input',
      type: 'password',
      placeholder: 'Document password',
      autocomplete: 'off',
    });

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Unlock PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'The password is used to decrypt the file locally — it is never sent anywhere.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Password' }),
          password,
          el('div', {
            class: 'field__hint',
            text: 'Leave empty if the document only restricts printing or copying.',
          }),
        ]),
      ]),
      read: () => ({ password: password.value }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const file = ctx.files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());

    ctx.progress(0.25, 'Decrypting document…');
    let doc;
    try {
      doc = await lib.PDFDocument.load(bytes, { password: ctx.options.password || undefined });
    } catch (err) {
      if (/password/i.test(err?.message || '')) {
        throw new Error('That password is not correct — please check it and try again.');
      }
      throw new Error('This document could not be decrypted.');
    }

    ctx.progress(0.7, 'Writing unlocked copy…');
    const out = await doc.save({ useObjectStreams: false });

    if (doc.isEncrypted) {
      throw new Error('The document is still encrypted — the password was probably wrong.');
    }

    return {
      blob: new Blob([out], { type: 'application/pdf' }),
      filename: `${tidyName(file.name)}-unlocked.pdf`,
      title: 'PDF unlocked',
      description: 'The password was removed and the document can now be opened freely.',
      stats: [
        { label: 'Pages', value: String(doc.getPageCount()), good: true },
        { label: 'Password', value: 'Removed', good: true },
      ],
    };
  },
};

/* ----------------------------------------------------------- Protect PDF */

export const protectPdf = {
  id: 'protect-pdf',
  name: 'Protect PDF',
  group: 'security',
  tag: 'Security',
  desc: 'Add a password and decide what people are allowed to do with the file.',
  icon: 'lock',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Protect PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — a password will be added to the document',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    const user = el('input', { class: 'input', type: 'password', placeholder: 'Password to open the file' });
    const owner = el('input', { class: 'input', type: 'password', placeholder: 'Owner password (optional)' });

    const toggles = [
      switchField('Allow printing', 'Readers can send the document to a printer.', true),
      switchField('Allow editing', 'Readers can change the contents of the document.', true),
      switchField('Allow copying', 'Readers can copy text, images and tables.', true),
      switchField('Allow annotations', 'Readers can add comments and fill in forms.', true),
      switchField('Allow extraction', 'Readers can extract the content for accessibility.', true),
      switchField('Allow assembly', 'Readers can insert, rotate or delete pages.', true),
      switchField('Allow high quality printing', 'Readers can print in full resolution.', true),
    ];

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Protect PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'The owner password always grants full access — keep a copy somewhere safe.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'User password' }),
          user,
          el('div', { class: 'field__hint', text: 'Needed to open the document.' }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Owner password' }),
          owner,
          el('div', { class: 'field__hint', text: 'Unlocks every restriction.' }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Permissions' }),
          el('div', {}, toggles.map((t) => t.wrap)),
        ]),
      ]),
      read: () => ({
        userPassword: user.value,
        ownerPassword: owner.value,
        permissions: {
          print: toggles[0].value,
          modify: toggles[1].value,
          copy: toggles[2].value,
          annotate: toggles[3].value,
          extract: toggles[4].value,
          assemble: toggles[5].value,
          highQuality: toggles[6].value,
        },
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const file = ctx.files[0];
    const userPassword = ctx.options.userPassword || '';
    const ownerPassword = ctx.options.ownerPassword || '';

    if (!userPassword && !ownerPassword) {
      throw new Error('Enter a password so the document can be protected.');
    }

    ctx.progress(0.2, 'Reading document…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let doc;
    try {
      doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: false });
    } catch {
      throw new Error('This document is already protected — unlock it first.');
    }

    ctx.progress(0.55, 'Preparing document…');
    const plain = await doc.save({ useObjectStreams: false });

    ctx.progress(0.8, 'Encrypting…');
    const encrypted = encryptPdf(plain, {
      userPassword,
      ownerPassword,
      permissions: ctx.options.permissions,
    });

    // Self-check: the result must open again with the password we just set.
    ctx.progress(0.93, 'Verifying the password…');
    let verified = false;
    try {
      const check = await lib.PDFDocument.load(encrypted, { password: userPassword || undefined });
      verified = check.getPageCount() === doc.getPageCount();
    } catch {
      verified = false;
    }
    if (!verified) throw new Error('The encryption could not be verified — the file was not produced.');

    return {
      blob: new Blob([encrypted], { type: 'application/pdf' }),
      filename: `${tidyName(file.name)}-protected.pdf`,
      title: 'PDF protected',
      description: userPassword
        ? 'A password is now required to open the document.'
        : 'The document can only be opened with the owner password.',
      stats: [
        { label: 'Pages', value: String(doc.getPageCount()) },
        { label: 'Encryption', value: '128-bit RC4', good: true },
        {
          label: 'Password',
          value: userPassword ? 'User + owner' : 'Owner only',
          good: true,
        },
      ],
    };
  },
};

/* -------------------------------------------------------------- Sign PDF */

const SIGN_POSITIONS = [
  { value: 'tl', label: 'Top left' },
  { value: 'tc', label: 'Top centre' },
  { value: 'tr', label: 'Top right' },
  { value: 'cl', label: 'Middle left' },
  { value: 'cc', label: 'Centre' },
  { value: 'cr', label: 'Middle right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'bc', label: 'Bottom centre' },
  { value: 'br', label: 'Bottom right' },
];

const SIGN_MODES = [
  { value: 'type', label: 'Type' },
  { value: 'draw', label: 'Draw' },
  { value: 'upload', label: 'Upload' },
];

export const signPdf = {
  id: 'sign-pdf',
  name: 'Sign PDF',
  group: 'security',
  tag: 'Security',
  desc: 'Add a handwritten or typed signature to a page of your document.',
  icon: 'pen-tool',
  accept: '.pdf,application/pdf',
  multiple: false,
  actionLabel: 'Sign PDF',
  dropTitle: 'Drop a PDF here',
  dropHint: 'or click to browse — then type, draw or upload your signature',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options(ctx) {
    const total = ctx.entries[0]?.info?.pages || 1;

    const modeButtons = SIGN_MODES.map((mode, i) =>
      el('button', {
        type: 'button',
        class: i === 0 ? 'is-active' : '',
        text: mode.label,
        onclick: () => {
          modeButtons.forEach((b) => b.classList.remove('is-active'));
          modeButtons[i].classList.add('is-active');
          typeWrap.style.display = i === 0 ? '' : 'none';
          drawWrap.style.display = i === 1 ? '' : 'none';
          uploadWrap.style.display = i === 2 ? '' : 'none';
        },
      })
    );

    const typed = el('input', { class: 'input', type: 'text', placeholder: 'Your name' });
    const typedColor = el('input', { class: 'color', type: 'color', value: '#12233a' });
    const typeWrap = el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Signature text' }),
      typed,
      el('div', { style: { marginTop: '10px' } }, [
        el('label', { class: 'field__label', text: 'Ink colour' }),
        typedColor,
      ]),
    ]);

    const pad = el('canvas', { class: 'sigpad__canvas', width: 420, height: 150 });
    const padCtx = pad.getContext('2d');
    let drawing = false;
    let dirty = false;

    const clearPad = () => {
      padCtx.clearRect(0, 0, pad.width, pad.height);
      dirty = false;
    };

    const point = (event) => {
      const rect = pad.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * pad.width,
        y: ((event.clientY - rect.top) / rect.height) * pad.height,
      };
    };

    pad.addEventListener('pointerdown', (event) => {
      drawing = true;
      dirty = true;
      pad.setPointerCapture(event.pointerId);
      const p = point(event);
      padCtx.beginPath();
      padCtx.moveTo(p.x, p.y);
    });
    pad.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      const p = point(event);
      padCtx.strokeStyle = '#12233a';
      padCtx.lineWidth = 3;
      padCtx.lineCap = 'round';
      padCtx.lineJoin = 'round';
      padCtx.lineTo(p.x, p.y);
      padCtx.stroke();
    });
    const stop = () => {
      drawing = false;
    };
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointerleave', stop);
    pad.addEventListener('pointercancel', stop);

    const drawWrap = el('div', { class: 'field', style: { display: 'none' } }, [
      el('label', { class: 'field__label', text: 'Draw your signature' }),
      el('div', { class: 'sigpad' }, [
        pad,
        el('button', {
          type: 'button',
          class: 'btn btn--outline btn--sm',
          style: { position: 'absolute', top: '10px', right: '10px' },
          onclick: () => clearPad(),
        }, [el('span', { text: 'Clear' })]),
      ]),
    ]);

    const uploadInput = el('input', { type: 'file', accept: 'image/*', class: 'sigpad__file' });
    const uploadPreview = el('div', { class: 'sigpad__preview' });
    let uploadedImage = null;
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      try {
        uploadedImage = await loadImage(url);
        clear(uploadPreview);
        uploadPreview.append(el('img', { src: url, alt: 'Signature preview' }));
      } catch {
        uploadedImage = null;
        uploadPreview.textContent = 'That image could not be read.';
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    const uploadWrap = el('div', { class: 'field', style: { display: 'none' } }, [
      el('label', { class: 'field__label', text: 'Signature image' }),
      uploadInput,
      uploadPreview,
    ]);

    const page = el('input', { class: 'input', type: 'number', value: '1', min: '1', max: String(total) });
    const position = el(
      'select',
      { class: 'select' },
      SIGN_POSITIONS.map((p) => el('option', { value: p.value, text: p.label }))
    );
    position.value = 'br';
    const width = el('input', { class: 'range', type: 'range', min: '10', max: '60', value: '28' });
    const widthOut = el('span', { class: 'mono', style: { fontSize: '0.8125rem' }, text: '28%' });
    width.addEventListener('input', () => (widthOut.textContent = `${width.value}%`));

    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Sign PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'Type your name, draw it with the mouse, or upload a picture of your signature.',
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Signature' }),
          el('div', { class: 'segmented' }, modeButtons),
        ]),
        typeWrap,
        drawWrap,
        uploadWrap,
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Page' }),
          page,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Position' }),
          position,
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [document.createTextNode('Width '), widthOut]),
          width,
        ]),
      ]),
      read: () => ({
        mode: SIGN_MODES[modeButtons.findIndex((b) => b.classList.contains('is-active'))].value,
        typed: typed.value,
        typedColor: typedColor.value,
        drawn: dirty ? trimCanvas(pad) : null,
        uploaded: uploadedImage,
        page: Number(page.value) || 1,
        position: position.value,
        width: Number(width.value) / 100,
      }),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    const file = ctx.files[0];

    let signatureCanvas = null;
    if (ctx.options.mode === 'type') {
      const text = (ctx.options.typed || '').trim();
      if (!text) throw new Error('Type the name that should appear as your signature.');
      const canvas = document.createElement('canvas');
      const ctx2 = canvas.getContext('2d');
      const fontSize = 120;
      const font = 'italic 120px "Segoe Script", "Bradley Hand", "Brush Script MT", cursive';
      ctx2.font = font;
      const metrics = ctx2.measureText(text);
      canvas.width = Math.max(80, Math.ceil(metrics.width) + 40);
      canvas.height = 180;
      const ctx3 = canvas.getContext('2d');
      ctx3.font = font;
      ctx3.fillStyle = ctx.options.typedColor || '#12233a';
      ctx3.textBaseline = 'middle';
      ctx3.fillText(text, 20, canvas.height / 2);
      signatureCanvas = trimCanvas(canvas);
    } else if (ctx.options.mode === 'draw') {
      if (!ctx.options.drawn) throw new Error('Draw your signature in the box first.');
      signatureCanvas = ctx.options.drawn;
    } else {
      if (!ctx.options.uploaded) throw new Error('Choose an image of your signature.');
      const image = ctx.options.uploaded;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      signatureCanvas = trimCanvas(canvas);
    }

    ctx.progress(0.3, 'Preparing signature…');
    const blob = await new Promise((resolve, reject) =>
      signatureCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not read the signature.'))),
        'image/png'
      )
    );
    const signatureBytes = new Uint8Array(await blob.arrayBuffer());

    ctx.progress(0.5, 'Signing document…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const pageIndex = Math.min(Math.max(1, ctx.options.page), pageCount) - 1;
    const page = doc.getPages()[pageIndex];

    const signature = await doc.embedPng(signatureBytes);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const targetWidth = pageWidth * ctx.options.width;
    const scale = targetWidth / signature.width;
    const targetHeight = signature.height * scale;

    const margin = 28;
    let x = margin;
    let y = margin;
    const code = ctx.options.position;
    if (code.endsWith('c')) x = (pageWidth - targetWidth) / 2;
    if (code.endsWith('r')) x = pageWidth - targetWidth - margin;
    if (code.startsWith('m')) y = (pageHeight - targetHeight) / 2;
    if (code.startsWith('b')) y = pageHeight - targetHeight - margin;

    page.drawImage(signature, { x, y, width: targetWidth, height: targetHeight });

    ctx.progress(0.9, 'Writing document…');
    const out = await doc.save({ useObjectStreams: false });

    return {
      blob: new Blob([out], { type: 'application/pdf' }),
      filename: `${tidyName(file.name)}-signed.pdf`,
      title: 'Document signed',
      description: `The signature was placed on page ${pageIndex + 1}.`,
      stats: [
        { label: 'Pages', value: String(pageCount) },
        { label: 'Signed page', value: String(pageIndex + 1), good: true },
      ],
    };
  },
};

/* ----------------------------------------------------------- Compare PDF */

function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return {
      added: a.join('\n') === b.join('\n') ? [] : ['(documents differ)'],
      removed: [],
    };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = [];
  const removed = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(a[i]);
      i++;
    } else {
      added.push(b[j]);
      j++;
    }
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { added, removed };
}

export const comparePdf = {
  id: 'compare-pdf',
  name: 'Compare PDF',
  group: 'security',
  tag: 'Security',
  desc: 'Put two documents side by side and highlight every difference.',
  icon: 'compare',
  accept: '.pdf,application/pdf',
  multiple: true,
  actionLabel: 'Compare documents',
  dropTitle: 'Drop two PDFs here',
  dropHint: 'or click to browse — add the original first, then the changed version',
  acceptLabel: 'PDF',
  validate: (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',

  async options() {
    return {
      node: el('div', {}, [
        el('div', { class: 'panel__title', text: 'Compare PDF' }),
        el('div', {
          class: 'panel__desc',
          text: 'The first file is the original and the second one is the changed version. Pages that differ are marked in red.',
        }),
        el('div', { class: 'note' }, [
          el('span', { text: 'Exactly two documents are needed — remove one to swap the order.' }),
        ]),
      ]),
      read: () => ({}),
    };
  },

  async run(ctx) {
    const lib = await loadPdfLib();
    if (ctx.files.length !== 2) {
      throw new Error('Add exactly two PDF files to compare.');
    }

    const [fileA, fileB] = ctx.files;
    ctx.progress(0.1, 'Reading both documents…');
    const [bytesA, bytesB] = await Promise.all([
      fileA.arrayBuffer().then((b) => new Uint8Array(b)),
      fileB.arrayBuffer().then((b) => new Uint8Array(b)),
    ]);
    const [docA, docB] = await Promise.all([openDocument(bytesA), openDocument(bytesB)]);

    const pageCount = Math.max(docA.numPages, docB.numPages);
    const textA = [];
    const textB = [];
    for (let i = 1; i <= docA.numPages; i++) {
      const page = await docA.getPage(i);
      const content = await page.getTextContent();
      textA.push(content.items.map((it) => it.str || '').join(' ').trim());
    }
    for (let i = 1; i <= docB.numPages; i++) {
      const page = await docB.getPage(i);
      const content = await page.getTextContent();
      textB.push(content.items.map((it) => it.str || '').join(' ').trim());
    }

    const differing = [];
    for (let i = 0; i < pageCount; i++) {
      const a = textA[i] ?? '';
      const b = textB[i] ?? '';
      if (a !== b) differing.push(i + 1);
    }

    const lineDiff = diffLines(
      textA.join('\n').split('\n').filter((l) => l.trim()),
      textB.join('\n').split('\n').filter((l) => l.trim())
    );

    ctx.progress(0.35, 'Building the report…');
    const out = await lib.PDFDocument.create();
    const font = await out.embedFont(lib.StandardFonts.Helvetica);
    const bold = await out.embedFont(lib.StandardFonts.HelveticaBold);
    const [pw, ph] = PAGE_SIZES.a4;

    /* ---- summary page ---- */
    const summary = out.addPage([pw, ph]);
    const ink = lib.rgb(0.03, 0.07, 0.11);
    const muted = lib.rgb(0.26, 0.31, 0.36);
    const red = lib.rgb(0.84, 0.2, 0.22);

    summary.drawText('PDF comparison report', { x: 56, y: ph - 76, size: 24, font: bold, color: ink });
    summary.drawText(fileA.name, { x: 56, y: ph - 104, size: 11, font, color: muted });
    summary.drawText(fileB.name, { x: 56, y: ph - 120, size: 11, font, color: muted });

    let y = ph - 168;
    const stat = (label, value, isBad) => {
      summary.drawText(label, { x: 56, y, size: 10, font, color: muted });
      summary.drawText(String(value), {
        x: 250,
        y: y - 2,
        size: 13,
        font: bold,
        color: isBad ? red : ink,
      });
      y -= 24;
    };
    stat('Pages in the original', docA.numPages);
    stat('Pages in the changed file', docB.numPages);
    stat('Pages that differ', differing.length, differing.length > 0);
    stat('Lines only in the original', lineDiff.removed.length, lineDiff.removed.length > 0);
    stat('Lines only in the changed file', lineDiff.added.length, lineDiff.added.length > 0);

    y -= 12;
    summary.drawText('Text differences', { x: 56, y, size: 13, font: bold, color: ink });
    y -= 22;

    const lines = [
      ...lineDiff.removed.slice(0, 24).map((l) => ['-', l]),
      ...lineDiff.added.slice(0, 24).map((l) => ['+', l]),
    ];
    if (!lines.length) {
      summary.drawText('The two documents contain exactly the same text.', {
        x: 56,
        y,
        size: 10.5,
        font,
        color: muted,
      });
    }
    for (const [marker, text] of lines) {
      if (y < 70) break;
      summary.drawText(marker, {
        x: 56,
        y,
        size: 10.5,
        font: bold,
        color: marker === '+' ? lib.rgb(0.1, 0.55, 0.3) : red,
      });
      summary.drawText(text.slice(0, 96), { x: 72, y, size: 10.5, font, color: ink });
      y -= 16;
    }

    /* ---- side-by-side pages ---- */
    const [lw, lh] = [841.89, 595.28];
    const boxWidth = 350;
    const boxHeight = 470;
    let compared = 0;

    for (let i = 0; i < pageCount && compared < 120; i++) {
      ctx.progress(0.4 + (0.5 * i) / pageCount, `Rendering page ${i + 1} of ${pageCount}…`);
      const isDifferent = differing.includes(i + 1);
      const sheet = out.addPage([lw, lh]);

      sheet.drawText(
        `Page ${i + 1} of ${pageCount} — ${isDifferent ? 'different' : 'identical'}`,
        { x: 40, y: lh - 46, size: 12, font: bold, color: isDifferent ? red : ink }
      );
      sheet.drawText(fileA.name, { x: 40, y: lh - 64, size: 9, font, color: muted });
      sheet.drawText(fileB.name, { x: 460, y: lh - 64, size: 9, font, color: muted });

      const sides = [
        { doc: docA, index: i, x: 40 },
        { doc: docB, index: i, x: 460 },
      ];

      for (const side of sides) {
        if (side.index >= side.doc.numPages) {
          sheet.drawRectangle({
            x: side.x,
            y: 70,
            width: boxWidth,
            height: boxHeight,
            borderColor: lib.rgb(0.8, 0.82, 0.85),
            borderWidth: 1,
          });
          sheet.drawText('No page', { x: side.x + 150, y: 300, size: 11, font, color: muted });
          continue;
        }
        const page = await side.doc.getPage(side.index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(boxWidth / viewport.width, boxHeight / viewport.height);
        const canvas = await renderPage(page, { scale });
        const jpeg = await canvasToJpeg(canvas, 0.8);
        const embedded = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        const px = side.x + (boxWidth - w) / 2;
        const py = 70 + (boxHeight - h) / 2;
        sheet.drawImage(embedded, { x: px, y: py, width: w, height: h });
        sheet.drawRectangle({
          x: side.x,
          y: 70,
          width: boxWidth,
          height: boxHeight,
          borderColor: isDifferent ? red : lib.rgb(0.8, 0.82, 0.85),
          borderWidth: isDifferent ? 1.6 : 1,
        });
      }
      compared += 1;
    }

    await docA.destroy();
    await docB.destroy();

    ctx.progress(0.95, 'Writing report…');
    const result = await out.save({ useObjectStreams: false });

    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      filename: `${tidyName(fileA.name)}-comparison.pdf`,
      title: 'Comparison ready',
      description: differing.length
        ? `${differing.length} page${differing.length > 1 ? 's' : ''} differ between the two documents.`
        : 'The two documents look identical.',
      stats: [
        { label: 'Pages compared', value: String(pageCount), good: true },
        { label: 'Differences', value: String(differing.length), good: differing.length === 0 },
        { label: 'Changed lines', value: String(lineDiff.added.length + lineDiff.removed.length) },
      ],
    };
  },
};

export const securityTools = [unlockPdf, protectPdf, signPdf, comparePdf];
