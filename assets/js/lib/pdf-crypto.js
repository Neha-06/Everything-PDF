/*
 * PDF Standard Security Handler (revision 3, 128-bit RC4).
 *
 * pdf-lib cannot *write* encrypted PDFs, so "Protect PDF" is implemented here
 * directly against the PDF byte format. RC4 is a stream cipher, so ciphertext
 * has exactly the same length as plaintext — which keeps every stream's
 * /Length entry valid.
 *
 * Reading encrypted PDFs is handled by @pdfme/pdf-lib (`ignoreEncryption`).
 */

/* ------------------------------------------------------------------ MD5 */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  return k;
})();

export function md5(input) {
  const msg = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  const len = msg.length;
  const blocks = ((len + 8) >> 6) + 1;
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const bitLen = len * 8;
  view.setUint32(buf.length - 8, bitLen >>> 0, true);
  view.setUint32(buf.length - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return out;
}

/* ------------------------------------------------------------------ RC4 */

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/* -------------------------------------------------- security handler maths */

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password) {
  const raw = new TextEncoder().encode(password || '');
  const out = new Uint8Array(32);
  const n = Math.min(raw.length, 32);
  out.set(raw.subarray(0, n));
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function le32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value | 0, true);
  return out;
}

/**
 * Algorithm 4 — the /O value.
 *
 * The owner password is hashed (50 extra MD5 rounds for revision 3+) and the
 * resulting key encrypts the padded *user* password.  Each of the 19
 * follow-up rounds uses the original key exclusive-ORed with the round
 * counter — no further hashing.
 */
function computeO(ownerPassword, userPassword, R = 3, n = 16) {
  const ownerPad = padPassword(ownerPassword || userPassword);
  const userPad = padPassword(userPassword);
  let hash = md5(ownerPad);
  if (R >= 3) for (let i = 0; i < 50; i++) hash = md5(hash);
  const key = hash.subarray(0, n);
  let O = rc4(key, userPad);
  if (R >= 3) {
    for (let i = 1; i <= 19; i++) {
      const k = new Uint8Array(key.length);
      for (let j = 0; j < key.length; j++) k[j] = key[j] ^ i;
      O = rc4(k, O);
    }
  }
  return O;
}

/** Algorithm 2 — the file encryption key. */
function computeKey(userPassword, O, P, id, R = 3, n = 16) {
  let hash = md5(concat(padPassword(userPassword), O, le32(P), id));
  if (R >= 3) for (let i = 0; i < 50; i++) hash = md5(hash);
  return hash.subarray(0, n);
}

/**
 * Algorithm 5 — the /U value.
 *
 * The file encryption key (algorithm 2) encrypts MD5(PAD || ID[0]); the same
 * 19 exclusive-OR rounds as for /O are then applied.
 */
function computeU(userPassword, O, P, id, R = 3, n = 16) {
  let hash = md5(concat(padPassword(userPassword), O, le32(P), id));
  if (R >= 3) for (let i = 0; i < 50; i++) hash = md5(hash);
  const baseKey = hash.subarray(0, n);
  let U = rc4(baseKey, md5(concat(PAD, id)));
  for (let i = 1; i <= 19; i++) {
    const k = new Uint8Array(baseKey.length);
    for (let j = 0; j < baseKey.length; j++) k[j] = baseKey[j] ^ i;
    U = rc4(k, U);
  }
  // The trailing 16 bytes are arbitrary padding.
  return concat(U, PAD.subarray(0, 16));
}

/**
 * Algorithm 1 — the per-object key.
 *
 * The trailing "sAlT" bytes are only part of the key for the AES crypt
 * filters; plain RC4 (/V2, /CFM /V2) leaves them out.
 */
function objectKey(key, num, gen, useSalt = false) {
  const extra = new Uint8Array(9);
  extra[0] = num & 0xff;
  extra[1] = (num >> 8) & 0xff;
  extra[2] = (num >> 16) & 0xff;
  extra[3] = gen & 0xff;
  extra[4] = (gen >> 8) & 0xff;
  if (useSalt) {
    extra[5] = 0x73; // 's'
    extra[6] = 0x41; // 'A'
    extra[7] = 0x6c; // 'l'
    extra[8] = 0x54; // 'T'
  }
  const size = useSalt ? 9 : 5;
  const hash = md5(concat(key, extra.subarray(0, size)));
  return hash.subarray(0, Math.min(key.length + 5, 16));
}

/* ---------------------------------------------------------- permissions */

export function permissionValue(flags = {}) {
  let p = 0;
  // Bit positions follow Table 22 of the PDF specification.  Bit position N
  // maps to the value 2^(N-1):
  //   3 print · 4 modify · 5 copy · 6 annotate · 7 fill in forms ·
  //   8 extract for accessibility · 9 assemble · 10 print high quality.
  // Bits 1-2 are reserved (0) and bits 11-32 are reserved (1), which is
  // the mask 0xFFFFFC00.
  if (flags.print !== false) p |= 1 << 2; // 4
  if (flags.modify !== false) p |= 1 << 3; // 8
  if (flags.copy !== false) p |= 1 << 4; // 16
  if (flags.annotate !== false) p |= 1 << 5; // 32
  if (flags.fill !== false) p |= 1 << 6; // 64
  if (flags.extract !== false) p |= 1 << 7; // 128
  if (flags.assemble !== false) p |= 1 << 8; // 256
  if (flags.highQuality !== false) p |= 1 << 9; // 512
  p |= 0xfffffc00;
  return p | 0; // signed 32-bit
}

/* ------------------------------------------------------- byte-level parser */

const decoder = new TextDecoder('latin1');

function toLatin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function isWs(ch) {
  return ch === ' ' || ch === '\r' || ch === '\n' || ch === '\t' || ch === '\f' || ch === '\0';
}

function skipLiteralString(src, i) {
  let depth = 1;
  let j = i + 1;
  while (j < src.length && depth > 0) {
    const ch = src[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

function readDictBlock(src, pos) {
  let i = pos;
  if (src[i] !== '<' || src[i + 1] !== '<') return null;
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === '(') {
      j = skipLiteralString(src, j) - 1;
      continue;
    }
    if (ch === '<' && src[j + 1] === '<') {
      depth++;
      j++;
      continue;
    }
    if (ch === '>' && src[j + 1] === '>') {
      depth--;
      j++;
      if (depth === 0) break;
    }
  }
  // `j` points at the last ">" of the closing ">>" — the span has to include it.
  const end = Math.min(j + 1, src.length);
  return { start: i, end, text: src.slice(i, end) };
}

function parseXref(src, offset) {
  let p = offset;
  while (p < src.length && isWs(src[p])) p++;
  if (!src.startsWith('xref', p)) return null;
  p += 4;
  const entries = new Map();
  for (;;) {
    while (p < src.length && isWs(src[p])) p++;
    if (src.startsWith('trailer', p)) {
      p += 7;
      while (p < src.length && isWs(src[p])) p++;
      break;
    }
    const m = /^(\d+)\s+(\d+)/.exec(src.slice(p, p + 40));
    if (!m) break;
    const start = Number(m[1]);
    const count = Number(m[2]);
    p += m[0].length;
    while (p < src.length && isWs(src[p])) p++;
    for (let i = 0; i < count; i++) {
      const em = /^(\d{10})\s(\d{5})\s([nf])/.exec(src.slice(p, p + 20));
      if (em && em[3] === 'n') entries.set(start + i, Number(em[1]));
      p += 20;
    }
  }
  return { entries, trailerPos: p };
}

function parseObjectAt(src, off) {
  const head = /^(\d+)\s+(\d+)\s+obj\b/.exec(src.slice(off, off + 64));
  if (!head) return null;
  const num = Number(head[1]);
  const gen = Number(head[2]);
  let p = off + head[0].length;
  while (p < src.length && isWs(src[p])) p++;

  const dict = readDictBlock(src, p);
  if (!dict) {
    // A plain object such as an indirect /Length value.
    const eo = src.indexOf('endobj', p);
    const end = eo >= 0 ? eo : src.length;
    return {
      num,
      gen,
      dict: { start: p, end, text: src.slice(p, end) },
      streamStart: -1,
      streamEnd: -1,
      streamLength: null,
      contentEnd: end,
      offset: off,
    };
  }

  let streamStart = -1;
  let streamEnd = -1;
  let contentEnd = dict.end;
  let streamLength = null;

  const sm = /^\s*stream(\r\n|\n|\r)/.exec(src.slice(dict.end, dict.end + 16));
  if (sm) {
    streamStart = dict.end + sm[0].length;
    const lenMatch = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict.text);
    if (lenMatch && !lenMatch[2]) streamLength = Number(lenMatch[1]);
    streamEnd = streamStart + (streamLength ?? 0);
    const es = src.indexOf('endstream', streamEnd);
    contentEnd = es >= 0 ? es : streamEnd;
    if (streamLength === null) {
      // The length is unknown — fall back to the bytes before "endstream".
      let end = contentEnd;
      while (end > streamStart && isWs(src[end - 1])) end--;
      streamEnd = end;
      contentEnd = end;
    }
  } else {
    const eo = src.indexOf('endobj', dict.end);
    contentEnd = eo >= 0 ? eo : src.length;
  }

  return { num, gen, dict, streamStart, streamEnd, streamLength, contentEnd, offset: off };
}

/* --------------------------------------------------- string (de)obfuscation */

function literalToBytes(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    i++;
    const next = raw[i];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
        oct += raw[++i];
      }
      out.push(parseInt(oct, 8) & 0xff);
      continue;
    }
    switch (next) {
      case 'n': out.push(10); break;
      case 'r': out.push(13); break;
      case 't': out.push(9); break;
      case 'b': out.push(8); break;
      case 'f': out.push(12); break;
      default: out.push(next.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function bytesToLiteral(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x28) out += '\\(';
    else if (b === 0x29) out += '\\)';
    else if (b === 0x5c) out += '\\\\';
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * Encrypt every literal and hex string inside a dictionary block.
 *
 * The dictionary markers `<<` and `>>` have to be consumed as a pair: a
 * single `<` always starts a hex string, so `<<` must never be mistaken for
 * the beginning of one.
 */
function encryptDictStrings(src, start, end, key) {
  let out = '';
  let i = start;
  while (i < end) {
    const ch = src[i];

    if (ch === '(') {
      const stop = skipLiteralString(src, i);
      const raw = src.slice(i + 1, stop - 1);
      const bytes = literalToBytes(raw);
      out += '(' + bytesToLiteral(rc4(key, bytes)) + ')';
      i = stop;
      continue;
    }

    // A dictionary opener — copy both characters and carry on.
    if (ch === '<' && src[i + 1] === '<') {
      out += '<<';
      i += 2;
      continue;
    }

    // A dictionary closer.
    if (ch === '>' && src[i + 1] === '>') {
      out += '>>';
      i += 2;
      continue;
    }

    // Everything else that starts with a single "<" is a hex string.
    if (ch === '<') {
      const close = src.indexOf('>', i);
      if (close === -1 || close >= end) {
        out += src.slice(i, end);
        break;
      }
      const bytes = hexToBytes(src.slice(i + 1, close));
      out += '<' + bytesToHex(rc4(key, bytes)) + '>';
      i = close + 1;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/* --------------------------------------------------------------- encrypt */

/**
 * Encrypt a PDF.
 * @param {Uint8Array} bytes  a plain (unencrypted) PDF
 * @param {{userPassword?:string, ownerPassword?:string, permissions?:object}} options
 * @returns {Uint8Array}
 */
export function encryptPdf(bytes, options = {}) {
  const { userPassword = '', ownerPassword = '', permissions = {} } = options;
  const R = 3;
  const V = 2;
  const n = 16;

  const src = decoder.decode(bytes);
  const startxrefMatch = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(src) || /startxref\s+(\d+)/.exec(src);
  if (!startxrefMatch) throw new Error('Could not locate the PDF cross-reference table.');
  const xrefOffset = Number(startxrefMatch[1]);

  const xref = parseXref(src, xrefOffset);
  if (!xref) throw new Error('Unsupported PDF structure (no classic cross-reference table).');

  const trailer = readDictBlock(src, xref.trailerPos);
  if (!trailer) throw new Error('Unsupported PDF structure (no trailer dictionary).');
  const trailerText = trailer.text;
  const rootMatch = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailerText);
  if (!rootMatch) throw new Error('Unsupported PDF structure (no document catalog).');
  const rootNum = Number(rootMatch[1]);
  const infoMatch = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(trailerText);

  // Resolve indirect /Length references before encrypting.
  const parsed = new Map();
  for (const [num, off] of xref.entries) {
    const obj = parseObjectAt(src, off);
    if (!obj) {
      throw new Error(
        'This document uses a PDF structure that cannot be protected — try re-saving it first.'
      );
    }
    parsed.set(num, obj);
  }
  for (const obj of parsed.values()) {
    const m = /\/Length\s+(\d+)\s+\d+\s+R/.exec(obj.dict.text);
    if (!m) continue;
    const target = parsed.get(Number(m[1]));
    if (!target) continue;
    const numMatch = /(\d+)/.exec(target.dict.text);
    if (!numMatch) continue;
    obj.streamLength = Number(numMatch[1]);
    obj.streamEnd = obj.streamStart + obj.streamLength;
  }

  const id = new Uint8Array(16);
  crypto.getRandomValues(id);

  const P = permissionValue(permissions);
  const O = computeO(ownerPassword, userPassword, R, n);
  const U = computeU(userPassword, O, P, id, R, n);
  const fileKey = computeKey(userPassword, O, P, id, R, n);

  const encryptNum = Math.max(...parsed.keys()) + 1;

  const outParts = [];
  let length = 0;
  const push = (chunk) => {
    const bytesChunk = typeof chunk === 'string' ? toLatin1(chunk) : chunk;
    outParts.push(bytesChunk);
    length += bytesChunk.length;
  };

  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

  const offsets = new Map();
  const order = [...parsed.keys()].sort((a, b) => a - b);

  for (const num of order) {
    const obj = parsed.get(num);
    if (num === encryptNum) continue;
    const key = objectKey(fileKey, num, obj.gen);
    offsets.set(num, length);

    push(`${num} ${obj.gen} obj\n`);

    const dictOut = encryptDictStrings(src, obj.dict.start, obj.dict.end, key);
    push(dictOut);
    push('\n');

    if (obj.streamStart >= 0) {
      const len = obj.streamLength ?? obj.streamEnd - obj.streamStart;
      const data = bytes.subarray(obj.streamStart, obj.streamStart + len);
      push('stream\n');
      push(rc4(key, data));
      push('\nendstream\n');
    }
    push('endobj\n');
  }

  // The /Encrypt dictionary itself is never encrypted.
  offsets.set(encryptNum, length);
  push(`${encryptNum} 0 obj\n`);
  push(
    `<< /Filter /Standard /V ${V} /R ${R} /Length 128 /P ${P} ` +
      `/O <${bytesToHex(O)}> /U <${bytesToHex(U)}> ` +
      `/CF << /StdCF << /CFM /V2 /AuthEvent /DocOpen /Length 16 >> >> ` +
      `/StmF /StdCF /StrF /StdCF >>\nendobj\n`
  );

  const xrefStart = length;
  const maxNum = encryptNum;
  let table = `xref\n0 ${maxNum + 1}\n`;
  // Every entry must be exactly 20 bytes: 10 digits, SP, 5 digits, SP,
  // keyword, SP, LF — byte-identical to what pdf-lib writes.
  table += `0000000000 65535 f \n`;
  for (let num = 1; num <= maxNum; num++) {
    if (offsets.has(num)) {
      table += `${String(offsets.get(num)).padStart(10, '0')} 00000 n \n`;
    } else {
      table += `0000000000 65535 f \n`;
    }
  }
  push(table);

  const idHex = bytesToHex(id);
  let trailerOut = `trailer\n<< /Size ${maxNum + 1} /Root ${rootNum} 0 R `;
  if (infoMatch) trailerOut += `/Info ${Number(infoMatch[1])} 0 R `;
  trailerOut += `/ID [<${idHex}> <${idHex}>] /Encrypt ${encryptNum} 0 R >>\n`;
  push(trailerOut);
  push(`startxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let off = 0;
  for (const part of outParts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
