/*
 * PDF manipulation library.
 *
 * We use the @pdfme/pdf-lib fork of pdf-lib: identical API to pdf-lib v1.17.1
 * but with encryption-aware loading (`ignoreEncryption` / `password`), which
 * powers the Unlock PDF tool.
 *
 * Loaded as a classic script so the app keeps working without a bundler.
 */
const SOURCE = new URL('../../vendor/pdf-lib.min.js', import.meta.url).href;

let pending = null;

export async function loadPdfLib() {
  if (globalThis.PDFLib) return globalThis.PDFLib;
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SOURCE;
      script.async = true;
      script.onload = () =>
        globalThis.PDFLib
          ? resolve(globalThis.PDFLib)
          : reject(new Error('PDF library loaded but did not register'));
      script.onerror = () => reject(new Error('Could not load the bundled PDF library'));
      document.head.append(script);
    });
  }
  return pending;
}

/** Convenience wrapper: load the lib and hand back a ready PDFDocument. */
export async function createDoc(options) {
  const lib = await loadPdfLib();
  return lib.PDFDocument.create(options);
}

/**
 * Load a PDF, tolerating encryption.
 * Returns { doc, encrypted } where `doc` is null when a password is required.
 */
export async function loadPdf(bytes, { password } = {}) {
  const lib = await loadPdfLib();
  const opts = { ignoreEncryption: true };
  if (password !== undefined) opts.password = password;
  const doc = await lib.PDFDocument.load(bytes, opts);
  return { doc, encrypted: !!doc.isEncrypted, lib };
}
