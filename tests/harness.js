/*
 * End-to-end harness for every tool in the registry.
 *
 * It builds sample files in memory, drives each tool through the same
 * contract the UI shell uses (options() → read() → run()) and reports what
 * came out. Run it from the browser console on the dev server:
 *
 *   import('/tests/harness.js').then((m) => m.runAll());
 *   // window.__harness is updated while it runs
 */
import { TOOLS } from '../assets/js/tools/index.js';
import { el } from '../assets/js/lib/util.js';
import { loadPdfLib } from '../assets/js/lib/pdf-lib.js';
import { openDocument } from '../assets/js/lib/pdfjs.js';
import { buildDocx, buildXlsx, loadJSZip } from '../assets/js/lib/zip.js';

/* ------------------------------------------------------------- utilities */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function asFile(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  return new File([blob], name, { type: blob.type });
}

async function pageCount(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openDocument(bytes);
    const count = doc.numPages;
    await doc.destroy();
    return count;
  } catch {
    return 0;
  }
}

function makeEntries(files) {
  return files.map((file) => ({ file, name: file.name, size: file.size, info: null, thumb: null }));
}

/* -------------------------------------------------------------- fixtures */

async function makeTextPdf(pages, { title = 'Sample document' } = {}) {
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${title} — page ${i + 1}`, {
      x: 56,
      y: 760,
      size: 18,
      font,
      color: lib.rgb(0.03, 0.07, 0.11),
    });
    page.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', {
      x: 56,
      y: 720,
      size: 11,
      font,
      color: lib.rgb(0.3, 0.35, 0.4),
    });
  }
  doc.setTitle(title);
  const bytes = await doc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: 'application/pdf' });
}

async function makeImageBlob(type = 'image/jpeg') {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f3f6f9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0072a3';
  ctx.fillRect(40, 40, 240, 120);
  ctx.fillStyle = '#09121c';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Scanned page', 40, 220);
  ctx.font = '18px sans-serif';
  ctx.fillText('The quick brown fox jumps over the lazy dog.', 40, 260);
  ctx.fillText('Pack my box with five dozen liquor jugs.', 40, 292);
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
}

async function makePptx() {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  const slide = (title, body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
  zip.folder('ppt').file(
    'presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
</p:presentation>`
  );
  zip.folder('ppt/_rels').file(
    'presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
  );
  zip.folder('ppt/slides').file('slide1.xml', slide('Quarterly report', 'Revenue grew by twelve percent.'));
  zip.folder('ppt/slides').file('slide2.xml', slide('Next quarter', 'We plan to hire three engineers.'));
  return zip.generateAsync({ type: 'blob' });
}

/* ---------------------------------------------------------------- driver */

const host = el('div', {
  style: {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1200px',
    height: '900px',
    overflow: 'auto',
    zIndex: '99999',
    background: '#fff',
    opacity: '0.01',
    pointerEvents: 'none',
  },
});

function mount(node) {
  host.append(node);
  return node;
}

function sniff(blob) {
  return blob.slice(0, 5).arrayBuffer().then((buf) => {
    const head = new Uint8Array(buf);
    return {
      pdf: String.fromCharCode(...head) === '%PDF-',
      zip: head[0] === 0x50 && head[1] === 0x4b,
      jpg: head[0] === 0xff && head[1] === 0xd8,
      png: head[0] === 0x89 && head[1] === 0x50,
    };
  });
}

async function runTool(tool, files, setup) {
  const entries = makeEntries(files);
  for (const entry of entries) {
    const pages = await pageCount(entry.file);
    entry.info = pages ? { pages } : { detail: `${entry.size} B` };
  }

  const ctx = {
    files,
    entries,
    progress: () => {},
    toast: () => {},
    host: null,
  };

  const started = performance.now();
  try {
    const panel = tool.options ? await tool.options(ctx) : {};
    if (panel?.node) mount(panel.node);
    await wait(40);
    if (setup) await setup(panel, ctx);

    const options = panel?.read ? panel.read() : {};
    const result = await tool.run({ ...ctx, options });

    const issues = [];
    if (!result || !(result.blob instanceof Blob)) issues.push('no blob');
    else if (!result.blob.size) issues.push('empty blob');
    if (!result.filename) issues.push('no filename');
    if (!result.title) issues.push('no title');

    if (result?.blob instanceof Blob && result.blob.size) {
      const magic = await sniff(result.blob);
      const name = String(result.filename || '').toLowerCase();
      const textExt = /\.(md|txt|csv|json|html?|xml)$/.test(name);
      const known = magic.pdf || magic.zip || magic.jpg || magic.png || textExt;
      if (!known) issues.push('unknown file signature');
      if (name.endsWith('.pdf') && !magic.pdf) issues.push('.pdf name but not PDF data');
      if (name.endsWith('.zip') && !magic.zip) issues.push('.zip name but not ZIP data');
      if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
        if (!magic.jpg && !magic.zip) issues.push('.jpg name but not JPEG data');
      }
      if (name.endsWith('.docx') || name.endsWith('.xlsx') || name.endsWith('.pptx')) {
        if (!magic.zip) issues.push('OOXML name but not ZIP data');
      }
    }

    return {
      id: tool.id,
      ok: issues.length === 0,
      issues,
      filename: result?.filename,
      bytes: result?.blob?.size ?? 0,
      stats: result?.stats?.map((s) => `${s.label}: ${s.value}`),
      ms: Math.round(performance.now() - started),
      blob: result?.blob,
    };
  } catch (err) {
    return {
      id: tool.id,
      ok: false,
      issues: [`threw: ${err?.message || err}`],
      ms: Math.round(performance.now() - started),
      blob: null,
    };
  } finally {
    host.innerHTML = '';
  }
}

/* ------------------------------------------------------------ test cases */

function setValue(node, selector, value) {
  const target = node.querySelector(selector);
  if (!target) return false;
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function setByLabel(node, labelText, value) {
  const label = Array.from(node.querySelectorAll('label')).find((l) =>
    l.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())
  );
  if (!label) return false;
  const field = label.parentElement;
  const input = field && field.querySelector('input, textarea, select');
  if (!input) return false;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function buildFixtures() {
  const pdf3 = await makeTextPdf(3, { title: 'Quarterly report' });
  const pdf2 = await makeTextPdf(2, { title: 'Quarterly report revised' });
  const pdfText = await makeTextPdf(1, { title: 'Plain notes' });

  const docx = await buildDocx(
    [
      { type: 'h1', text: 'Meeting notes' },
      { type: 'p', text: 'The team agreed to ship the new release next Friday.' },
      { type: 'p', text: 'Action items: write the release notes and update the changelog.' },
    ],
    { title: 'Meeting notes' }
  );

  const xlsx = await buildXlsx(
    [
      {
        name: 'Sales',
        rows: [
          ['Region', 'Revenue'],
          ['North', '1200'],
          ['South', '980'],
          ['East', '1430'],
        ],
      },
    ],
    { title: 'Sales' }
  );

  const pptx = await makePptx();
  const jpg = await makeImageBlob('image/jpeg');
  const png = await makeImageBlob('image/png');
  const html = asFile(
    'page.html',
    new Blob(
      [
        '<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title></head>' +
          '<body style="font-family:sans-serif"><h1>Invoice #2024</h1>' +
          '<p>Thanks for your business.</p><table border="1" cellpadding="6">' +
          '<tr><th>Item</th><th>Amount</th></tr><tr><td>Design</td><td>400</td></tr></table></body></html>',
      ],
      { type: 'text/html' }
    ),
    'text/html'
  );

  return {
    fPdf3: asFile('report.pdf', pdf3, 'application/pdf'),
    fPdf2: asFile('report-v2.pdf', pdf2, 'application/pdf'),
    fPdfText: asFile('notes.pdf', pdfText, 'application/pdf'),
    fDocx: asFile('notes.docx', docx),
    fXlsx: asFile('sales.xlsx', xlsx),
    fPptx: asFile('deck.pptx', pptx),
    fJpg: asFile('photo.jpg', jpg, 'image/jpeg'),
    fPng: asFile('scan.png', png, 'image/png'),
    fHtml: html,
  };
}

function buildCases(fx) {
  return [
    /* ---------------------------------------------------------- organize */
    { id: 'merge-pdf', files: () => [fx.fPdf3, fx.fPdf2] },
    {
      id: 'split-pdf',
      files: () => [fx.fPdf3],
      setup: (panel) => setValue(panel.node, 'input[type=text]', '1-2'),
    },
    { id: 'organize-pdf', files: () => [fx.fPdf3] },
    {
      id: 'remove-pages',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        const cards = panel.node.querySelectorAll('.pagecard');
        if (cards[1]) cards[1].click();
      },
    },
    {
      id: 'extract-pages',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        const cards = panel.node.querySelectorAll('.pagecard');
        if (cards[0]) cards[0].click();
        if (cards[2]) cards[2].click();
      },
    },
    { id: 'repair-pdf', files: () => [fx.fPdf3] },

    /* ---------------------------------------------------------- optimize */
    { id: 'compress-pdf', files: () => [fx.fPdf3] },
    { id: 'ocr-pdf', files: () => [fx.fPdfText] },

    /* ----------------------------------------------------------- convert */
    { id: 'pdf-to-jpg', files: () => [fx.fPdf3] },
    { id: 'jpg-to-pdf', files: () => [fx.fJpg, fx.fPng] },
    { id: 'pdf-to-word', files: () => [fx.fPdfText] },
    { id: 'word-to-pdf', files: () => [fx.fDocx] },
    { id: 'pdf-to-excel', files: () => [fx.fPdfText] },
    { id: 'excel-to-pdf', files: () => [fx.fXlsx] },
    { id: 'pdf-to-powerpoint', files: () => [fx.fPdfText] },
    { id: 'powerpoint-to-pdf', files: () => [fx.fPptx] },
    { id: 'html-to-pdf', files: () => [fx.fHtml] },
    {
      id: 'pdf-to-pdfa',
      files: () => [fx.fPdfText],
      setup: (panel) => {
        setByLabel(panel.node, 'Title', 'Archival copy');
        setByLabel(panel.node, 'Author', 'Ada Lovelace');
        setByLabel(panel.node, 'Subject', 'Quarterly numbers');
        setByLabel(panel.node, 'Keywords', 'finance, quarterly, report');
      },
    },
    { id: 'pdf-to-markdown', files: () => [fx.fPdfText] },

    /* --------------------------------------------------------------- edit */
    { id: 'rotate-pdf', files: () => [fx.fPdf3] },
    { id: 'watermark-pdf', files: () => [fx.fPdf3] },
    { id: 'page-numbers', files: () => [fx.fPdf3] },
    {
      id: 'crop-pdf',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        for (const input of panel.node.querySelectorAll('input[type=number]')) {
          if (input.value === '0') input.value = '10';
        }
      },
    },
    {
      id: 'edit-pdf',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        const area = panel.node.querySelector('textarea');
        if (area) area.value = 'Approved by the board';
      },
    },
    {
      id: 'redact-pdf',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        const canvas = panel.node.querySelector('canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const fire = (type, x, y) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + x,
              clientY: rect.top + y,
              pointerId: 1,
            })
          );
        fire('pointerdown', 20, 20);
        fire('pointerup', 140, 120);
      },
    },
    { id: 'scan-pdf', files: () => [fx.fJpg, fx.fPng] },

    /* ----------------------------------------------------------- security */
    {
      id: 'sign-pdf',
      files: () => [fx.fPdf3],
      setup: (panel) => {
        const typed = panel.node.querySelector('input[type=text]');
        if (typed) typed.value = 'Ada Lovelace';
      },
    },
    { id: 'compare-pdf', files: () => [fx.fPdf3, fx.fPdf2] },
    {
      id: 'protect-pdf',
      files: () => [fx.fPdfText],
      setup: (panel) => {
        const passwords = panel.node.querySelectorAll('input[type=password]');
        if (passwords[0]) passwords[0].value = 'user-secret';
        if (passwords[1]) passwords[1].value = 'owner-secret';
        const switches = panel.node.querySelectorAll('.switch input[type=checkbox]');
        // printing (0) and copying (2) off, everything else on
        for (const index of [0, 2]) {
          const box = switches[index];
          if (!box) continue;
          box.checked = false;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
    },
    {
      id: 'unlock-pdf',
      files: (ctx) => {
        const blob = ctx.protectedBlob;
        return blob ? [asFile('protected.pdf', blob, 'application/pdf')] : [];
      },
      setup: (panel) => setValue(panel.node, 'input[type=password]', 'user-secret'),
    },
  ];
}

/* ------------------------------------------------------------------ main */

export async function runAll() {
  document.body.append(host);
  const state = { done: false, results: [], error: null, current: null };
  window.__harness = state;

  try {
    const fx = await buildFixtures();
    const cases = buildCases(fx);
    const byId = new Map(TOOLS.map((t) => [t.id, t]));
    const runCtx = { protectedBlob: null };

    for (const testCase of cases) {
      const tool = byId.get(testCase.id);
      if (!tool) {
        state.results.push({ id: testCase.id, ok: false, issues: ['tool missing from registry'] });
        continue;
      }

      state.current = testCase.id;
      window.__harness = { ...state, results: state.results.slice() };

      const files = testCase.files(runCtx);
      const result = await runTool(tool, files, testCase.setup);
      if (testCase.id === 'protect-pdf') runCtx.protectedBlob = result.blob;
      state.results.push(result);
    }

    /* Any tool without an explicit case still gets reported. */
    const covered = new Set(cases.map((c) => c.id));
    for (const tool of TOOLS) {
      if (covered.has(tool.id)) continue;
      state.results.push({ id: tool.id, ok: false, issues: ['no test case defined'] });
    }
  } catch (err) {
    state.error = err?.message || String(err);
  } finally {
    state.done = true;
    state.current = null;
    state.results.sort((a, b) => a.id.localeCompare(b.id));
    window.__harness = state;
    host.remove();
  }

  return state;
}

export default { runAll };
