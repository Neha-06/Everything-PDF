/* ZIP handling (JSZip) + shared OOXML writers. */
const JSZIP_SOURCE = new URL('../../vendor/jszip.min.js', import.meta.url).href;

let zipPending = null;

/** Load the bundled JSZip (UMD build) and hand back its global. */
export async function loadJSZip() {
  if (globalThis.JSZip) return globalThis.JSZip;
  if (!zipPending) {
    zipPending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_SOURCE;
      script.async = true;
      script.onload = () =>
        globalThis.JSZip
          ? resolve(globalThis.JSZip)
          : reject(new Error('The ZIP library loaded but did not register'));
      script.onerror = () => reject(new Error('Could not load the bundled ZIP library'));
      document.head.append(script);
    });
  }
  return zipPending;
}

async function newZip() {
  const JSZip = await loadJSZip();
  return new JSZip();
}

export async function zipFiles(entries, { name = 'archive.zip' } = {}) {
  const zip = await newZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.data);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/* --------------------------------------------------------------- OOXML */

const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${'${TARGET}'}"/>
</Relationships>`;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a minimal but valid .docx from a list of blocks.
 * blocks: { type: 'p' | 'h1' | 'h2' | 'h3' | 'li', text: string }
 */
export async function buildDocx(blocks, { title = 'Document' } = {}) {
  const zip = await newZip();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = RELS_ROOT.replace('${TARGET}', 'word/document.xml');

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;

  const body = blocks
    .map((block) => {
      const text = esc(block.text ?? '');
      if (!text) return '<w:p/>';
      switch (block.type) {
        case 'title':
          return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
        case 'h1':
          return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
        case 'h2':
          return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
        case 'h3':
          return `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
        case 'li':
          return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t xml:space="preserve">• ${text}</w:t></w:r></w:p>`;
        default:
          return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
      }
    })
    .join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(
    title
  )}</dc:title><dc:creator>PDF Tools</dc:creator><cp:lastModifiedBy>PDF Tools</cp:lastModifiedBy><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/" xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${now}</dcterms:created></cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PDF Tools</Application></Properties>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('word/document.xml', document);
  zip.file('word/_rels/document.xml.rels', docRels);
  zip.file('word/styles.xml', styles);
  zip.file('docProps/core.xml', core);
  zip.file('docProps/app.xml', app);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Build a minimal .xlsx workbook.
 * sheets: [{ name, rows: string[][] }]
 */
export async function buildXlsx(sheets, { title = 'Sheet1' } = {}) {
  const zip = await newZip();

  const sheetOverrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${sheetOverrides}
</Types>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', RELS_ROOT.replace('${TARGET}', 'xl/workbook.xml'));

  const sheetEntries = sheets
    .map((s, i) => `<sheet name="${esc(s.name || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`
  );

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        i + 1
      }.xml"/>`
  )
  .join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  zip.file('xl/_rels/workbook.xml.rels', wbRels);

  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
  );

  const colName = (n) => {
    let s = '';
    n += 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  sheets.forEach((sheet, i) => {
    const rows = (sheet.rows || []).map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (value === null || value === undefined || value === '') return '';
          const isNumber = typeof value === 'number' && Number.isFinite(value);
          if (isNumber) return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    });
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
    );
  });

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(
      title
    )}</dc:title><dc:creator>PDF Tools</dc:creator><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/" xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${now}</dcterms:created></cp:coreProperties>`
  );

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/* ------------------------------------------------------- OOXML readers */

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function textOf(node) {
  return Array.from(node.getElementsByTagName('w:t'))
    .map((n) => n.textContent)
    .join('');
}

/** Read a .docx and return an array of blocks. */
export async function readDocx(data) {
  const zip = await (await loadJSZip()).loadAsync(data);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Not a valid Word document.');
  const xml = parseXml(await entry.async('string'));

  const blocks = [];
  const body = xml.getElementsByTagName('w:body')[0];
  if (!body) return blocks;

  const walk = (node) => {
    for (const child of node.children) {
      const tag = child.localName;
      if (tag === 'p') {
        const text = textOf(child);
        const styleNode = child.getElementsByTagName('w:pStyle')[0];
        const style = styleNode ? (styleNode.getAttribute('w:val') || '') : '';
        const headingMatch = /heading\s*([1-6])/i.exec(style);
        if (text.trim()) {
          if (/^title$/i.test(style)) blocks.push({ type: 'title', text });
          else if (headingMatch) blocks.push({ type: `h${headingMatch[1]}`, text });
          else blocks.push({ type: 'p', text });
        }
      } else if (tag === 'tbl') {
        for (const row of Array.from(child.getElementsByTagName('w:tr'))) {
          const cells = Array.from(row.getElementsByTagName('w:tc')).map((c) => textOf(c).trim());
          if (cells.some(Boolean)) blocks.push({ type: 'p', text: cells.join('  |  ') });
        }
      }
    }
  };
  walk(body);
  return blocks;
}

/** Read an .xlsx and return sheets of rows. */
export async function readXlsx(data) {
  const zip = await (await loadJSZip()).loadAsync(data);
  const shared = [];
  const sharedEntry = zip.file('xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = parseXml(await sharedEntry.async('string'));
    for (const si of Array.from(xml.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
    }
  }

  const sheetFiles = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  sheetFiles.sort(
    (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])
  );

  const sheets = [];
  for (const path of sheetFiles) {
    const xml = parseXml(await zip.file(path).async('string'));
    const rows = [];
    for (const row of Array.from(xml.getElementsByTagName('row'))) {
      const cells = [];
      for (const cell of Array.from(row.getElementsByTagName('c'))) {
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = Array.from(cell.getElementsByTagName('t')).map((t) => t.textContent).join('');
        } else {
          const v = cell.getElementsByTagName('v')[0];
          if (v) {
            value = type === 's' ? shared[Number(v.textContent)] ?? '' : v.textContent;
          }
        }
        cells.push(value);
      }
      if (cells.length) rows.push(cells);
    }
    sheets.push({ name: path.match(/sheet(\d+)\.xml/)[1], rows });
  }
  return sheets;
}

/** Read a .pptx and return slides of text blocks. */
export async function readPptx(data) {
  const zip = await (await loadJSZip()).loadAsync(data);
  const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  slideFiles.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const slides = [];
  for (const path of slideFiles) {
    const xml = parseXml(await zip.file(path).async('string'));
    const texts = [];
    for (const p of Array.from(xml.getElementsByTagName('a:p'))) {
      const text = Array.from(p.getElementsByTagName('a:t'))
        .map((t) => t.textContent)
        .join('');
      if (text.trim()) texts.push(text);
    }
    slides.push({ blocks: texts.map((t) => ({ type: 'p', text: t })) });
  }
  return slides;
}
