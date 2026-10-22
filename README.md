# PDF Tools

A complete, **fully client-side** PDF toolkit.
Every file is processed by JavaScript **inside your browser tab**. Nothing is
uploaded, there is no backend, no account and no watermark.

---

## Quick start

The project is a plain static site — no build step, no bundler, no `npm`.
Everything it needs (libraries, fonts, PDF.js CMaps and the OCR model) ships in
the repository, so it also runs with no internet connection.

```powershell
# From the project folder
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

The script prints the address it is serving, for example
<http://localhost:4173/>. Open that address.

Starting the server cannot fail:

* if the preferred port is busy it walks forward until it finds a free one;
* if Windows has reserved a port it skips it;
* if the app is already being served it reports that address and exits;
* `HttpListener` is used when available, with a raw-socket fallback on the same
  port (`serve-tcp.ps1` runs that socket server standalone).

```powershell
# Custom starting port / document root
powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080 -Root .
```

Both servers send `Cache-Control: no-store` so edits show up immediately.

Any other static server works too:

```bash
python -m http.server 4173     # or: npx serve .
```

> The app uses ES modules and hash routing (`#/`, `#/tool/<id>`), so it needs
> to be served over `http://` — opening `index.html` from the file system will
> fail on the module imports.

---

## The tools

### Organize
| Tool | What it does |
| --- | --- |
| Merge PDF | Combine several PDF documents into one file, in the order you choose. |
| Split PDF | Break one PDF into several documents by page range, interval or one-by-one. |
| Organize PDF | Rotate, delete and re-order the pages of a document. |
| Remove pages | Delete the pages you select and keep the rest of the document. |
| Extract pages | Pull the pages you need out of a document into a brand new PDF. |
| Repair PDF | Rebuild a broken or damaged PDF so that it opens again. |

### Optimize
| Tool | What it does |
| --- | --- |
| Compress PDF | Shrink a PDF without ever making it bigger — images are re-encoded, text stays crisp. |
| OCR PDF | Recognise the text in scanned pages and make the PDF searchable. |

### Convert
| Tool | What it does |
| --- | --- |
| PDF to JPG | Turn every page of a PDF into a high quality JPG image. |
| JPG to PDF | Combine JPG, PNG and WEBP images into a single PDF document. |
| PDF to Word | Extract the text of a PDF into an editable Word document. |
| Word to PDF | Turn a Word document into a PDF that looks the same everywhere. |
| PDF to Excel | Pull the tables and rows of a PDF into a spreadsheet. |
| Excel to PDF | Print a spreadsheet to PDF, one page per sheet section. |
| PDF to PowerPoint | Turn each page of a PDF into a slide of a PowerPoint deck. |
| PowerPoint to PDF | Convert a PowerPoint deck into a PDF document. |
| HTML to PDF | Save a web page or HTML file as a printable PDF. |
| PDF to PDF/A | Convert a PDF into the archival PDF/A-2b format. |
| PDF to Markdown | Convert the text of a PDF into clean Markdown. |

### Edit
| Tool | What it does |
| --- | --- |
| Rotate PDF | Turn the pages of a PDF clockwise, counter-clockwise or upside down. |
| Watermark PDF | Stamp a text watermark over every page of a document. |
| Add page numbers | Number the pages of a document in the position you choose. |
| Crop PDF | Cut away the empty margins around the content of a document. |
| Edit PDF | Add text to the pages of a document and save the changes. |
| Redact PDF | Black out sensitive parts of a page — the content is really removed. |
| Scan to PDF | Turn photos of documents into a clean, straightened PDF. |

### Security
| Tool | What it does |
| --- | --- |
| Unlock PDF | Remove the password from a protected PDF and save an unrestricted copy. |
| Protect PDF | Add a password and decide what people are allowed to do with the file. |
| Sign PDF | Add a handwritten or typed signature to a page of your document. |
| Compare PDF | Put two documents side by side and highlight every difference. |

---

## Project layout

```
index.html                  # entry point: fonts, stylesheet links, module script
serve.ps1                   # static file server (auto port, HttpListener → socket fallback)
serve-tcp.ps1               # raw-socket server entry point (delegates to serve.ps1)
assets/
  fonts/
    fonts.css               # @font-face rules, all URLs local
    font-*.woff2            # self-hosted Geist + Geist Mono subsets
  vendor/                   # self-hosted libraries — no CDN at runtime
    pdf-lib.min.js          # @pdfme/pdf-lib UMD build
    pdf.min.mjs             # pdf.js ESM build
    pdf.worker.min.mjs      # pdf.js worker
    pdfjs/cmaps/            # pdf.js CMaps (CJK text)
    pdfjs/standard_fonts/   # pdf.js standard font data
    jszip.min.js            # JSZip UMD build
    pptxgen.bundle.js       # PptxGenJS UMD build (JSZip bundled)
    html2canvas.min.js      # html2canvas UMD build
    tesseract.min.js        # Tesseract.js API
    tesseract/              # OCR worker, LSTM cores and the English model
  css/
    theme.css               # design tokens (light + dark) extracted from the reference site
    app.css                 # component kit: buttons, cards, fields, panels, tool grid…
  js/
    app.js                  # hash router, header, home page, tool pages, theme toggle
    lib/
      util.js               # DOM helpers, file helpers, toasts, modals, number formatting
      icons.js              # inline SVG icon set
      pdf-lib.js            # lazy loader for @pdfme/pdf-lib
      pdfjs.js              # PDF.js wrapper: local worker, CMaps and standard font paths
      zip.js                # JSZip loader, minimal .docx/.xlsx writers and readers
      pdf-crypto.js         # PDF Standard Security Handler (RC4) encrypt/decrypt
    ui/
      shell.js              # shared workspace: dropzone → options → run → result
    tools/
      index.js              # tool registry (TOOLS, GROUPS, lookup + search helpers)
      common.js             # shared PDF operations (page ranges, text layout, cropping…)
      page-grid.js          # selectable / reorderable page grid
      organize.js           # 6 organize tools
      optimize.js           # compress + OCR
      convert.js            # 11 conversion tools
      edit.js               # 7 editing tools
      security.js           # 4 security tools
tests/
  harness.js                # in-browser end-to-end harness for all 30 tools
  compress.js               # focused checks for the Compress PDF tool
```

---

## Architecture

### Routing

There is no router library. `assets/js/app.js` parses `location.hash`:

* `#/` → the home page (hero, search, category chips, tool grid, features)
* `#/tool/<id>` → a tool page
* anything else → a "tool not found" card

`hashchange` re-renders the view, so back/forward works as expected.

### Search

The home page filters the tool grid as you type. Matching is done against the
tool name, description, category **and a list of extra keywords** kept in
`assets/js/tools/index.js`, so typing "encrypt" finds *Protect PDF*,
"black out" finds *Redact PDF* and "shrink" finds *Compress PDF*.

### The tool contract

Every tool is a plain object registered in `assets/js/tools/index.js`:

```js
{
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
  dropHint: 'or click to browse — …',
  validate: (file) => /\.pdf$/i.test(file.name),

  async options(ctx) {
    return {
      node: el('div', {}, [ /* the options panel */ ]),
      placement: 'side',            // or 'main' for wide panels (page grids, canvases)
      read: () => ({ /* the values the user picked */ }),
    };
  },

  async run(ctx) {
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: 'result.pdf',
      title: 'Done!',
      description: 'A short summary shown in the result card.',
      stats: [{ label: 'Pages', value: '3', good: true }],
    };
  },
}
```

`assets/js/ui/shell.js` owns the shared workspace and calls exactly these three
members, so a new tool only has to provide the panel and the work. Adding a
tool means appending one object to the relevant array in
`assets/js/tools/*.js` — the grid, the dropdown, the search and the chip
filters all read from the registry automatically.

### Theme

`assets/css/theme.css` holds the design tokens (colours, radius, shadows) for
both light and dark mode, plus the reference site's body gradient:

```css
background:
  radial-gradient(circle at 50% -10%, var(--primary), transparent 34rem),
  linear-gradient(135deg, var(--card), transparent 42%);
```

Dark mode is a `.dark` class on `<html>`. The choice is stored in
`localStorage` under `pdf-tools-theme` and applied by a small inline script in
`index.html` **before the first paint**, so there is no flash of the wrong
theme.

---

## Compression

`Compress PDF` never hands back a file that is larger than the one it was
given. Instead of always rasterising the pages, it builds up to three
candidates and keeps the smallest one:

| Candidate | What it does |
| --- | --- |
| `original` | The file exactly as it came in — the safety net. |
| `lossless` | The file rewritten with object streams. No quality loss, text stays selectable, vectors stay sharp. |
| `raster` | Only the pages that actually contain a bitmap are re-encoded as JPEG at the chosen level; every other page is copied over as vectors. |

Which pages contain an image is decided with PDF.js: the page's operator list
is inspected for the `paintImageXObject` / `paintInlineImageXObject` /
`paintImageMaskXObject` operators (looked up by name, never by number). If the
check cannot be made the page is treated as an image page, so no content is
ever dropped.

The result card reports what actually happened — *Before*, *After*, *Saved* and
the *Method* (`Lossless`, `Re-encoded`, `Mixed` or `Unchanged`).

---

## Third-party dependencies

Every library is **vendored** under `assets/vendor/` and loaded from the same
origin — no CDN, no network lookup, nothing to install. The app therefore keeps
working offline and is unaffected by CDN outages.

| Library | Version | Used for | Bundled as |
| --- | --- | --- | --- |
| [@pdfme/pdf-lib](https://github.com/pdfme/pdf-lib) | 1.18.4 | Reading and writing PDF structure | `assets/vendor/pdf-lib.min.js` |
| [pdfjs-dist](https://mozilla.github.io/pdf.js/) | 4.6.82 | Rendering pages, extracting text | `pdf.min.mjs`, `pdf.worker.min.mjs`, `pdfjs/cmaps/`, `pdfjs/standard_fonts/` |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | Reading/writing `.docx`, `.xlsx`, `.pptx`, `.zip` | `assets/vendor/jszip.min.js` |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | 3.12.0 | Building PowerPoint decks | `assets/vendor/pptxgen.bundle.js` |
| [html2canvas](https://html2canvas.hertzen.com/) | 1.4.1 | Rendering HTML to PDF | `assets/vendor/html2canvas.min.js` |
| [Tesseract.js](https://tesseract.projectnaptha.com/) | 5.1.1 | OCR | `tesseract.min.js` + `tesseract/` (worker, LSTM cores, `eng` model) |
| Geist / Geist Mono | — | Typography | `assets/fonts/` (SIL OFL 1.1) |

The English OCR model (`eng.traineddata.gz`, 2.9 MB) ships with the app, so OCR
works with no network access as well.

### PDF encryption

`assets/js/lib/pdf-crypto.js` implements the PDF Standard Security Handler
(V2 / R3, 128-bit RC4) directly, so the app can add and remove document
passwords without an extra dependency. RC4 is used rather than AES because it
preserves the byte length of every encrypted stream, which keeps the `/Length`
entries of the original file valid.

---

## Testing

`tests/harness.js` exercises every tool in the browser using the same
`options() → read() → run()` contract the UI uses. It builds sample PDFs,
images, `.docx`, `.xlsx` and `.pptx` files in memory, drives each tool and
checks that a non-empty file with the right signature comes out.

With the server running:

```js
// in the browser console at the address printed by serve.ps1
import('/tests/harness.js').then((m) => m.runAll());
```

`window.__harness` is updated while the run is in progress and contains the
per-tool result:

```js
{
  done: true,
  results: [
    { id: 'merge-pdf', ok: true, filename: 'report-merged.pdf', bytes: 3803, ms: 47, stats: [...] },
    ...
  ]
}
```

All 30 tools currently pass.

`tests/compress.js` covers the Compress PDF tool on its own — it makes sure a
vector-only PDF never grows and keeps its selectable text, that an image-heavy
PDF really shrinks, and that the reported numbers match the files on disk:

```js
import('/tests/compress.js').then((m) => m.run());
```

---

## Privacy

* No file ever leaves the browser — there is no upload endpoint.
* No network request is made at all: every library, font, PDF.js data file and
  the OCR language model is served from this repository.
* Passwords are used to derive keys locally and are never stored.

---

## Notes and licence

* Third-party libraries keep their own licences (MIT / Apache-2.0). `pdf-lib`
  is MIT, `pdf.js` is Apache-2.0, JSZip is MIT, PptxGenJS is MIT,
  html2canvas is MIT and Tesseract.js is Apache-2.0.
* The code in this repository is provided as-is, without warranty of any kind.
