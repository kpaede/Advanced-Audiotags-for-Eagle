'use strict';

// Deliberately keeps each original container and unknown payload. No audio decoding.
const { createHash } = require('crypto');
const EMPTY = Buffer.alloc(0);
const rules = require('./tag-rules');
const LABELS = { TIT2: 'Title', TT2: 'Title', TPE1: 'Artist', TP1: 'Artist', TPE2: 'Album artist',
  TALB: 'Album', TAL: 'Album', TRCK: 'Track', TRK: 'Track', TPOS: 'Disc', TCON: 'Genre', TCO: 'Genre',
  TDRC: 'Date', TYER: 'Year', TYE: 'Year', COMM: 'Comment', COM: 'Comment', USLT: 'Lyrics',
  ULT: 'Lyrics', APIC: 'Cover', PIC: 'Cover', TXXX: 'User-defined text', TXX: 'User-defined text',
  WXXX: 'User-defined URL', WXX: 'User-defined URL', TCOP: 'Copyright', TCOM: 'Composer', TBPM: 'BPM',
  TPE3: 'Conductor', TPE4: 'Remixer', TSRC: 'ISRC', TENC: 'Encoded by', TSSE: 'Encoding software / settings',
  TPUB: 'Publisher', TEXT: 'Lyricist', TKEY: 'Initial key', TLAN: 'Language', TLEN: 'Length',
  TSOA: 'Album sort order', TSOP: 'Artist sort order', TSOT: 'Title sort order', TOWN: 'File owner',
  TDRL: 'Release date', TDOR: 'Original release date', TORY: 'Original release year', TMOO: 'Mood' };
function need(b, p, n) {
  if (!Number.isSafeInteger(n) || n < 0 || p < 0 || p + n > b.length) throw new Error('Damaged or truncated metadata.');
}
function sync(b, p = 0) {
  need(b, p, 4);
  if (b.subarray(p, p + 4).some(x => x & 128)) throw new Error('Invalid ID3 size.');
  return b[p] * 2097152 + b[p + 1] * 16384 + b[p + 2] * 128 + b[p + 3];
}
function putSync(n, size = 4) {
  if (n < 0 || n >= 2 ** (7 * size)) throw new Error('Tag is too large.');
  const b = Buffer.alloc(size); for (let i = size - 1; i >= 0; i--) { b[i] = n % 128; n = Math.floor(n / 128); } return b;
}
function u32(n, little = false) { const b = Buffer.alloc(4); little ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; }
function deUnsync(b) { const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 255 && b[i + 1] === 0) i++; } return Buffer.from(out); }
function unsync(b) { const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 255 && (i + 1 === b.length || b[i + 1] === 0 || b[i + 1] >= 224)) out.push(0); } return Buffer.from(out); }
function decode(b, enc) {
  if (enc === 0) return b.toString('latin1');
  if (enc === 3) return new TextDecoder('utf-8', { fatal: true }).decode(b);
  if (enc !== 1 && enc !== 2) throw new Error('Unsupported text encoding.');
  let big = enc === 2;
  if (b[0] === 255 && b[1] === 254) { b = b.subarray(2); big = false; }
  else if (b[0] === 254 && b[1] === 255) { b = b.subarray(2); big = true; }
  if (b.length % 2) throw new Error('Invalid UTF-16 text.');
  if (big) b = Buffer.from(b).swap16();
  return b.toString('utf16le');
}
function textBytes(s, enc) {
  if (enc === 0) {
    if (Array.from(s).some(c => c.codePointAt(0) > 255)) throw new Error('This field only supports Latin-1 characters.');
    return Buffer.from(s, 'latin1');
  }
  if (enc === 3) return Buffer.from(s, 'utf8');
  const b = Buffer.from(s, 'utf16le'); return enc === 2 ? b.swap16() : Buffer.concat([Buffer.from([255, 254]), b]);
}
function splitZero(b, enc) {
  const width = enc === 1 || enc === 2 ? 2 : 1;
  for (let p = 0; p + width <= b.length; p += width) {
    if (b[p] === 0 && (width === 1 || b[p + 1] === 0)) return [b.subarray(0, p), b.subarray(p + width)];
  }
  throw new Error('Missing text terminator.');
}
function stripZero(s) { return s.replace(/\0+$/, ''); }
function hexBytes(s) {
  if (!/^[\da-f\s]*$/i.test(s)) throw new Error('Hex fields accept only 0–9, A–F and whitespace.');
  s = s.replace(/\s/g, ''); if (s.length % 2) throw new Error('Each hex byte requires two digits.'); return Buffer.from(s, 'hex');
}
function crc32(b) { let crc = 0xffffffff; for (const x of b) { crc ^= x; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function entry(key, bytes, extra = {}) { return { key, label: LABELS[key] || key, bytes, mode: 'hex', value: bytes.toString('hex'), ...extra }; }
function id3Entry(key, bytes, flags, version) {
  const e = entry(key, bytes, { flags, version, readonly: !!(flags & (version === 3 ? 0x2000 : version === 4 ? 0x1000 : 0)) });
  // Compressed, encrypted, grouped or data-length-prefixed frames stay fully accessible as raw bytes.
  if (flags & (version === 3 ? 0xe0 : 0x4d)) { e.readonly = true; e.reason = 'Frame format flags require a specialized decoder; raw bytes are preserved.'; return e; }
  if (flags & ~(version === 3 ? 0xe0e0 : version === 4 ? 0x704f : 0)) { e.readonly = true; e.reason = 'Unknown frame flags; raw bytes are preserved.'; return e; }
  try {
    const encoded = key[0] === 'T' || ['COMM','COM','USLT','ULT','WXXX','WXX','APIC','PIC'].includes(key);
    if (encoded && (bytes[0] > (version === 4 ? 3 : 1))) throw new Error('Text encoding is invalid for this ID3 version.');
    if (key[0] === 'T' && key !== 'TXXX' && key !== 'TXX') {
      e.mode = 'id3-text'; e.value = decode(bytes.subarray(1), bytes[0]);
      if (version < 4) {
        if (/\0[^\0]/.test(e.value)) throw new Error('Legacy text has nonstandard data after its terminator.');
        e.value = stripZero(e.value);
      }
    } else if (['TXXX', 'TXX', 'WXXX', 'WXX', 'COMM', 'COM', 'USLT', 'ULT'].includes(key)) {
      const language = ['COMM', 'COM', 'USLT', 'ULT'].includes(key);
      const [description, value] = splitZero(bytes.subarray(language ? 4 : 1), bytes[0]);
      e.mode = key[0] === 'W' ? 'id3-url-description' : 'id3-description';
      e.description = decode(description, bytes[0]);
      e.language = language ? bytes.toString('ascii', 1, 4) : undefined;
      const inherited = bytes[0] === 1 && description[0] === 254 && description[1] === 255 && !(value[0] === 255 && value[1] === 254) ? 2 : bytes[0];
      e.value = decode(value, key[0] === 'W' ? 0 : inherited);
      if (version < 4 || key[0] === 'W') e.value = stripZero(e.value);
    } else if (key[0] === 'W') { e.mode = 'latin1'; e.value = stripZero(bytes.toString('latin1')); }
    else if (key === 'APIC' || key === 'PIC') {
      let p = 1;
      if (key === 'PIC') { e.mime = { PNG: 'image/png', JPG: 'image/jpeg' }[bytes.toString('ascii', p, p + 3)]; p += 3; }
      else { const end = bytes.indexOf(0, p); if (end < 0) throw new Error(); e.mime = bytes.toString('latin1', p, end); p = end + 1; }
      need(bytes, p, 1); e.pictureType = bytes[p++];
      const [description, image] = splitZero(bytes.subarray(p), bytes[0]);
      e.description = decode(description, bytes[0]); e.image = image;
    }
  } catch (error) { e.mode = 'hex'; e.value = bytes.toString('hex'); e.readonly = true; e.reason = error.message || 'Unsupported frame structure.'; }
  return e;
}
function payload(e) {
  if (!e.changed) return e.bytes;
  if (e.editMode === 'hex' || e.mode === 'hex') return hexBytes(e.value);
  if (e.mode === 'id3-text' || e.mode.startsWith('id3-')) {
    if (e.description?.includes('\0')) throw new Error('Descriptions cannot contain NUL.');
    if (e.value.includes('\0') && (e.version < 4 || e.language !== undefined || e.mode === 'id3-url-description')) throw new Error('NUL-separated values are not valid for this frame/version. Use ID3v2.4 text frames or the format-defined separator.');
    const enc = e.version === 4 ? 3 : 1;
    if (e.mode === 'id3-text') return Buffer.concat([Buffer.from([enc]), textBytes(e.value, enc)]);
    const language = e.language === undefined ? EMPTY : Buffer.from(e.language, 'ascii');
    if (e.language !== undefined && !/^[a-z]{3}$/.test(e.language)) throw new Error('Use a lowercase three-letter ISO 639-2 language code (for example, eng).');
    return Buffer.concat([Buffer.from([enc]), language, textBytes(e.description || '', enc), Buffer.alloc(enc === 1 ? 2 : 1), textBytes(e.value, e.mode === 'id3-url-description' ? 0 : enc)]);
  }
  if (e.mode === 'number') {
    if (!/^\d+$/.test(e.value) || Number(e.value) > 255) throw new Error('Value must be between 0 and 255.');
    return Buffer.from([Number(e.value)]);
  }
  return textBytes(e.value, e.mode === 'utf8' ? 3 : 0);
}
function changed(section) { return section.added || section.entries.some(e => e.changed || e.deleted || e.added); }

function parseID3(b, start) {
  need(b, start, 10); const version = b[start + 3], flags = b[start + 5], size = sync(b, start + 6);
  const footer = version === 4 && !!(flags & 16); const end = start + 10 + size + (footer ? 10 : 0); need(b, start, end - start);
  const section = { type: 'id3', name: `ID3v2.${version}`, version, flags, start, end, original: b.subarray(start, end), entries: [], ext: EMPTY };
  if (flags & ~(version === 2 ? 0xc0 : version === 3 ? 0xe0 : 0xf0)) section.locked = 'Unknown ID3 header flags: read-only.';
  if (![2, 3, 4].includes(version) || (version === 2 && flags & 64)) {
    section.locked = 'Unsupported ID3 version or compressed ID3v2.2 tag.';
    section.entries.push(entry('ID3-Container', b.subarray(start + 10, start + 10 + size), { readonly: true })); return section;
  }
  if (footer && (b.toString('ascii', end - 10, end - 7) !== '3DI' || !b.subarray(start + 3, start + 10).equals(b.subarray(end - 7, end)))) throw new Error('Invalid ID3 footer.');
  let body = b.subarray(start + 10, start + 10 + size), p = 0;
  if (version < 4 && flags & 128) body = deUnsync(body);
  if (flags & 64) {
    need(body, 0, 4); const n = version === 4 ? sync(body) : body.readUInt32BE(0) + 4; need(body, 0, n);
    section.ext = body.subarray(0, n); p = n;
    if (version === 4 && (n < 6 || body[4] !== 1 || body[5] & 16)) section.locked = 'ID3 tag with unsupported extended restrictions: read-only.';
    if (version === 3 && n !== 10 && n !== 14) section.locked = 'Unsupported extended ID3 header: read-only.';
  }
  const headerSize = version === 2 ? 6 : 10, keySize = version === 2 ? 3 : 4;
  while (p < body.length && body[p] !== 0) {
    need(body, p, headerSize); const key = body.toString('latin1', p, p + keySize);
    if (!(version === 2 ? /^[A-Z0-9]{3}$/ : /^[A-Z0-9]{4}$/).test(key)) throw new Error('Invalid ID3 frame ID.');
    const n = version === 2 ? body.readUIntBE(p + 3, 3) : version === 4 ? sync(body, p + 4) : body.readUInt32BE(p + 4);
    const frameFlags = version === 2 ? 0 : body.readUInt16BE(p + 8); need(body, p + headerSize, n);
    let data = body.subarray(p + headerSize, p + headerSize + n);
    if (version === 4 && ((flags & 128) || (frameFlags & 2))) data = deUnsync(data);
    section.entries.push(id3Entry(key, data, frameFlags, version)); p += headerSize + n;
  }
  if (body.subarray(p).some(x => x !== 0)) throw new Error('ID3 padding contains nonzero bytes.');
  return section;
}
function buildID3(s) {
  const frames = s.entries.filter(e => !e.deleted).map(e => {
    if (!(s.version === 2 ? /^[A-Z0-9]{3}$/ : /^[A-Z0-9]{4}$/).test(e.key)) throw new Error('Invalid ID3 frame ID.');
    let data = payload(e);
    if (data.length === 0) throw new Error('An ID3 frame body must contain at least one byte.');
    if (s.version === 4 && ((s.flags & 128) || (e.flags & 2))) data = unsync(data);
    const h = Buffer.alloc(s.version === 2 ? 6 : 10); h.write(e.key, 'ascii');
    if (s.version === 2) { if (data.length > 0xffffff) throw new Error('ID3v2.2 frame is too large.'); h.writeUIntBE(data.length, 3, 3); }
    else { (s.version === 4 ? putSync(data.length) : u32(data.length)).copy(h, 4); h.writeUInt16BE(e.flags || 0, 8); }
    return Buffer.concat([h, data]);
  });
  const footer = s.version === 4 && !!(s.flags & 16);
  const content = Buffer.concat([...frames, footer ? EMPTY : Buffer.alloc(256)]);
  const ext = Buffer.from(s.ext);
  if (ext.length && s.version === 3) {
    ext.writeUInt32BE(256, 6); if (ext.readUInt16BE(4) & 0x8000) { need(ext, 10, 4); ext.writeUInt32BE(crc32(Buffer.concat(frames)), 10); }
  } else if (ext.length && s.version === 4) {
    let p = 6; for (const bit of [64, 32, 16]) if (ext[5] & bit) {
      need(ext, p, 1); const n = ext[p++]; need(ext, p, n);
      if (bit === 32) { if (n !== 5) throw new Error('Invalid ID3 CRC.'); putSync(crc32(content), 5).copy(ext, p); } p += n;
    }
  }
  let body = Buffer.concat([ext, content]); if (s.version < 4 && s.flags & 128) body = unsync(body);
  const h = Buffer.concat([Buffer.from('ID3'), Buffer.from([s.version, s.original?.[4] || 0, s.flags || 0]), putSync(body.length)]);
  const f = footer ? Buffer.concat([Buffer.from('3DI'), h.subarray(3)]) : EMPTY;
  return Buffer.concat([h, body, f]);
}
function parseV1(b, start) {
  const entries = [], track = b[start + 125] === 0 && b[start + 126] !== 0;
  for (const [key, p, n] of [['Title', 3, 30], ['Artist', 33, 30], ['Album', 63, 30], ['Year', 93, 4], ['Comment', 97, track ? 28 : 30]]) {
    entries.push(entry(key, b.subarray(start + p, start + p + n), { mode: 'latin1', value: b.toString('latin1', start + p, start + p + n).replace(/[\0 ]+$/, ''), offset: p, length: n }));
  }
  if (track) entries.push(entry('Track', b.subarray(start + 126, start + 127), { mode: 'number', value: String(b[start + 126]), offset: 126, length: 1 }));
  entries.push(entry('Genre (ID)', b.subarray(start + 127, start + 128), { mode: 'number', value: String(b[start + 127]), offset: 127, length: 1 }));
  return { type: 'v1', name: track ? 'ID3v1.1' : 'ID3v1', start, end: start + 128, original: b.subarray(start, start + 128), entries };
}
function parseV1Plus(b, start) {
  const entries = [];
  for (const [key, p, n] of [['Title (extension)', 4, 60], ['Artist (extension)', 64, 60], ['Album (extension)', 124, 60], ['Genre (text)', 185, 30], ['Start time', 215, 6], ['End time', 221, 6]])
    entries.push(entry(key, b.subarray(start + p, start + p + n), { mode: 'latin1', value: b.toString('latin1', start + p, start + p + n).replace(/[\0 ]+$/, ''), offset: p, length: n }));
  entries.push(entry('Speed (ID)', b.subarray(start + 184, start + 185), { mode: 'number', value: String(b[start + 184]), offset: 184, length: 1 }));
  return { type: 'v1', name: 'ID3v1 Enhanced (TAG+)', start, end: start + 227, original: b.subarray(start, start + 227), entries };
}
function parseAPE(b, end) {
  const p = end - 32; need(b, p, 32); const version = b.readUInt32LE(p + 8), n = b.readUInt32LE(p + 12), count = b.readUInt32LE(p + 16), flags = b.readUInt32LE(p + 20);
  if (n < 32 || count > 100000 || n > end) throw new Error('Invalid APE tag.');
  const dataStart = end - n, hasHeader = !!(flags & 0x80000000), start = dataStart - (hasHeader ? 32 : 0); need(b, start, end - start);
  if (hasHeader && b.toString('ascii', start, start + 8) !== 'APETAGEX') throw new Error('Missing APE header.');
  const s = { type: 'ape', name: `APEv${version / 1000}`, version, flags, hasHeader, start, end, original: b.subarray(start, end), entries: [] };
  if (version !== 2000 && version !== 1000) s.locked = 'Unsupported APE version: read-only.';
  let at = dataStart;
  for (let i = 0; i < count; i++) {
    need(b.subarray(0, p), at, 8); const len = b.readUInt32LE(at), itemFlags = b.readUInt32LE(at + 4); at += 8;
    const zero = b.indexOf(0, at); if (zero < at || zero >= p) throw new Error('Invalid APE key.');
    const key = b.toString('ascii', at, zero); at = zero + 1; need(b.subarray(0, p), at, len);
    const bytes = b.subarray(at, at + len), type = (itemFlags >>> 1) & 3;
    s.entries.push(entry(key, bytes, { flags: itemFlags, mode: type === 0 || type === 2 ? 'utf8' : 'hex', value: type === 0 || type === 2 ? bytes.toString('utf8') : bytes.toString('hex'), readonly: !!(itemFlags & 1) })); at += len;
  }
  if (at !== p) throw new Error('Invalid APE size.'); return s;
}
function buildAPE(s) {
  const entries = s.entries.filter(e => !e.deleted);
  const data = Buffer.concat(entries.map(e => {
    rules.validateAPEName(e.key);
    const bytes = payload(e); return Buffer.concat([u32(bytes.length, true), u32(e.flags || 0, true), Buffer.from(e.key + '\0', 'ascii'), bytes]);
  }));
  const footer = Buffer.alloc(32); footer.write('APETAGEX'); footer.writeUInt32LE(s.version, 8); footer.writeUInt32LE(data.length + 32, 12); footer.writeUInt32LE(entries.length, 16); footer.writeUInt32LE(s.flags >>> 0, 20);
  const header = s.hasHeader ? Buffer.from(footer) : EMPTY; if (header.length) header.writeUInt32LE((s.flags | 0x20000000) >>> 0, 20);
  return Buffer.concat([header, data, footer]);
}
function parseVorbis(bytes) {
  let p = 0; need(bytes, p, 4); const vendorLength = bytes.readUInt32LE(p); p += 4; need(bytes, p, vendorLength);
  const vendor = bytes.subarray(p, p + vendorLength); p += vendorLength; need(bytes, p, 4); const count = bytes.readUInt32LE(p); p += 4;
  if (count > 100000) throw new Error('Too many Vorbis comments.');
  const entries = [];
  for (let i = 0; i < count; i++) {
    need(bytes, p, 4); const n = bytes.readUInt32LE(p); p += 4; need(bytes, p, n); const data = bytes.subarray(p, p + n), split = data.indexOf(61);
    if (split < 1) throw new Error('Invalid Vorbis comment.');
    const key = data.toString('latin1', 0, split); rules.validateVorbisName(key);
    entries.push(entry(key, data.subarray(split + 1), { mode: 'utf8', value: new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(split + 1)) })); p += n;
  }
  if (p !== bytes.length) throw new Error('Unexpected data in Vorbis comment block.'); return { vendor, entries };
}
function buildVorbis(s) {
  const entries = s.entries.filter(e => !e.deleted);
  return Buffer.concat([u32(s.vendor.length, true), s.vendor, u32(entries.length, true), ...entries.map(e => {
    rules.validateVorbisName(e.key);
    const bytes = Buffer.concat([Buffer.from(e.key + '=', 'ascii'), payload(e)]); return Buffer.concat([u32(bytes.length, true), bytes]);
  })]);
}
function picture(bytes) {
  let p = 4; need(bytes, 0, 8); const pictureType = bytes.readUInt32BE(0), mimeSize = bytes.readUInt32BE(p); p += 4; need(bytes, p, mimeSize);
  const mime = bytes.toString('ascii', p, p + mimeSize); p += mimeSize; need(bytes, p, 4); const descSize = bytes.readUInt32BE(p); p += 4; need(bytes, p, descSize);
  const description = bytes.toString('utf8', p, p + descSize); p += descSize; need(bytes, p, 20);
  const width = bytes.readUInt32BE(p), height = bytes.readUInt32BE(p + 4), n = bytes.readUInt32BE(p + 16); p += 20; need(bytes, p, n);
  if (p + n !== bytes.length) throw new Error('Invalid picture block.'); return { mime, description, pictureType, width, height, image: bytes.subarray(p, p + n) };
}
function parseFLAC(b, start) {
  if (b.toString('ascii', start, start + 4) !== 'fLaC') throw new Error('Not a native FLAC file.');
  const s = { type: 'flac', name: 'FLAC', start, blocks: [], entries: [] }; let p = start + 4, last = false;
  while (!last) {
    need(b, p, 4); const type = b[p] & 127, n = b.readUIntBE(p + 1, 3); last = !!(b[p] & 128); p += 4; need(b, p, n);
    const bytes = b.subarray(p, p + n); const block = { type, bytes, entries: [] };
    if (type === 4) Object.assign(block, parseVorbis(bytes));
    else {
      const key = ['STREAMINFO', 'PADDING', 'APPLICATION', 'SEEKTABLE', 'VORBIS_COMMENT', 'CUESHEET', 'PICTURE'][type] || `BLOCK_${type}`;
      const e = entry(key, bytes, { readonly: type === 0 || type === 1 || type === 3 });
      if (type === 6) Object.assign(e, picture(bytes)); block.entries.push(e);
    }
    s.blocks.push(block); p += n;
  }
  if (s.blocks[0]?.type !== 0 || s.blocks[0].bytes.length !== 34 || s.blocks.slice(1).some(x => x.type === 0)) throw new Error('Invalid FLAC STREAMINFO block.');
  if (s.blocks.filter(x => x.type === 4).length > 1) s.locked = 'Multiple FLAC Vorbis comment blocks are nonconforming: read-only.';
  s.end = p; s.original = b.subarray(start, p); s.entries = s.blocks.flatMap(x => x.entries); return s;
}
function buildFLAC(s) {
  const blocks = s.blocks.filter(x => x.type === 4 || !x.entries[0].deleted);
  return Buffer.concat([Buffer.from('fLaC'), ...blocks.map((x, i) => {
    const bytes = x.type === 4 ? (x.added || x.entries.some(e => e.changed || e.deleted || e.added) ? buildVorbis(x) : x.bytes) : payload(x.entries[0]);
    if (bytes.length > 0xffffff) throw new Error('FLAC block exceeds 16 MB.');
    const h = Buffer.alloc(4); h[0] = x.type | (i === blocks.length - 1 ? 128 : 0); h.writeUIntBE(bytes.length, 1, 3); return Buffer.concat([h, bytes]);
  })]);
}
function parse(b, ext) {
  if (!Buffer.isBuffer(b)) b = Buffer.from(b); ext = ext.toLowerCase().replace(/^\./, '');
  if (!['mp3', 'mp2', 'aac', 'flac', 'ac3', 'eac3', 'ec3'].includes(ext)) throw new Error('This binary codec handles MPEG audio, AAC, Dolby audio and FLAC. Use the audio backend for other containers.');
  const sections = []; let start = 0, end = b.length;
  while (b.toString('ascii', start, start + 3) === 'ID3') { const s = parseID3(b, start); sections.push(s); start = s.end; }
  if (ext === 'flac') { const s = parseFLAC(b, start); sections.push(s); start = s.end; }
  let again = true;
  while (again && end > start) {
    again = false;
    if (end - start >= 128 && b.toString('ascii', end - 128, end - 125) === 'TAG') {
      const s = parseV1(b, end - 128); sections.push(s); end = s.start; again = true;
      if (end - start >= 227 && b.toString('ascii', end - 227, end - 223) === 'TAG+') { const enhanced = parseV1Plus(b, end - 227); sections.push(enhanced); end = enhanced.start; }
    }
    else if (end - start >= 32 && b.toString('ascii', end - 32, end - 24) === 'APETAGEX') { const s = parseAPE(b, end); sections.push(s); end = s.start; again = true; }
    else if (end - start >= 20 && b.toString('ascii', end - 10, end - 7) === '3DI') {
      const size = sync(b, end - 4), at = end - size - 20; need(b, at, 10);
      if (b.toString('ascii', at, at + 3) !== 'ID3') throw new Error('Missing appended ID3 header.');
      const s = parseID3(b, at); if (s.end !== end) throw new Error('Invalid appended ID3 tag.'); sections.push(s); end = at; again = true;
    }
  }
  if (end < start) throw new Error('Overlapping metadata.');
  const audio = b.subarray(start, end);
  if (['ac3','eac3','ec3'].includes(ext) && !(audio[0] === 11 && audio[1] === 119)) throw new Error('Not a raw AC3 file (sync word 0B77 is missing).');
  if (['mp3','mp2','aac'].includes(ext) && !(audio[0] === 255 && (audio[1] & 0xe0) === 0xe0)) throw new Error('MP3 audio does not start with an MPEG sync word.');
  return { buffer: b, ext, sections: sections.sort((a, z) => a.start - z.start), audioStart: start, audioEnd: end, audioHash: createHash('sha256').update(audio).digest('hex') };
}
function serialize(doc) {
  const sections = [...doc.sections].sort((a, b) => a.start - b.start), parts = []; let p = 0;
  for (const s of sections) {
    parts.push(doc.buffer.subarray(p, s.start)); p = s.end;
    if (!changed(s)) { parts.push(s.original); continue; }
    if (s.locked) throw new Error(s.locked);
    for (const e of s.entries) if (!e.deleted && (e.added || e.renamed)) rules.assertIdentity(s, e, e);
    if (s.type === 'id3' && s.entries.some(e => e.mode === 'hex' && (e.flags & (s.version === 3 ? 0x8000 : 0x4000)))) throw new Error('An opaque frame must be discarded when this tag changes. Saving is blocked to avoid losing it.');
    if (s.entries.some(e => e.readonly && (e.changed || e.deleted))) throw new Error('A protected field was modified.');
    if (s.type === 'id3') parts.push(buildID3(s));
    else if (s.type === 'ape') parts.push(buildAPE(s));
    else if (s.type === 'flac') parts.push(buildFLAC(s));
    else if (s.type === 'v1') {
      const out = Buffer.from(s.original);
      for (const e of s.entries) {
        if (e.deleted) throw new Error('ID3v1 fields can be cleared, but cannot be removed.');
        if (!e.changed) continue; const data = payload(e); if (data.length > e.length) throw new Error(`${e.key}: maximum ${e.length} bytes in ID3v1.`);
        out.fill(0, e.offset, e.offset + e.length); data.copy(out, e.offset);
      } parts.push(out);
    }
  }
  parts.push(doc.buffer.subarray(p)); const out = Buffer.concat(parts), check = parse(out, doc.ext);
  if (check.audioHash !== doc.audioHash) throw new Error('Audio data changed. Saving was aborted.');
  // Check structural parsers for edited raw blocks too, before Eagle receives any replacement.
  return out;
}
function add(doc, key, value = '', kind = 'text', target) {
  if (doc.backend) return require('./audio-backend').add(doc, key, value);
  let s = target || doc.sections.find(x => x.type === (doc.ext === 'flac' ? 'flac' : doc.container?.kind === 'ogg' ? 'vorbis' : 'id3') && !x.locked);
  let created = false;
  if (!s) {
    s = { type: 'id3', name: 'ID3v2.4 (new)', version: 4, flags: 0, start: 0, end: 0, original: EMPTY, ext: EMPTY, entries: [], added: true };
    created = true;
  }
  if (s.locked) throw new Error(s.locked);
  let e;
  if (s.type === 'flac' || s.type === 'vorbis') {
    rules.validateVorbisName(key);
    e = entry(key, EMPTY, { mode: 'utf8', value });
  } else if (s.type === 'ape') {
    rules.validateAPEName(key);
    e = entry(key, EMPTY, { mode: kind === 'hex' ? 'hex' : 'utf8', value, flags: kind === 'hex' ? 2 : 0 });
  } else if (s.type === 'id3') {
    const field = rules.resolveField(key, s.version, kind); key = field.key;
    if (!(s.version === 2 ? /^[A-Z0-9]{3}$/ : /^[A-Z0-9]{4}$/).test(key)) throw new Error(`ID3v2.${s.version} requires a ${s.version === 2 ? 3 : 4}-character frame ID.`);
    e = id3Entry(key, Buffer.from([s.version === 4 ? 3 : 1]), 0, s.version);
    e.readonly = false;
    e.mode = kind === 'hex' ? 'hex' : key[0] === 'T' && !['TXXX','TXX'].includes(key) ? 'id3-text' : key[0] === 'W' && !['WXXX','WXX'].includes(key) ? 'latin1' : ['TXXX','TXX','COMM','COM','USLT','ULT','WXXX','WXX'].includes(key) ? (key[0] === 'W' ? 'id3-url-description' : 'id3-description') : 'hex';
    if (e.mode.startsWith('id3-') && e.mode !== 'id3-text') e.description = field.description || '';
    if (['COMM','COM','USLT','ULT'].includes(key)) e.language = 'eng';
    e.value = value;
  } else throw new Error('Fields cannot be added to this container.');
  e.added = true; e.changed = true;
  rules.assertIdentity(s, e);
  payload(e); // Validate before modifying the document.
  if (s.type === 'flac') {
    let block = s.blocks.find(x => x.type === 4);
    if (!block) { block = { type: 4, vendor: Buffer.from('Advanced Audiotags'), entries: [], added: true }; s.blocks.push(block); }
    block.entries.push(e);
  }
  if (created) doc.sections.unshift(s);
  s.entries.push(e); return e;
}
function rename(doc, e, name) {
  if (doc.backend) return require('./audio-backend').rename(doc, e, name);
  const s = doc.sections.find(s => s.entries.includes(e));
  if (!s || !rules.canRename(s, e)) throw new Error('This field name is fixed or read-only.');
  if (name.includes('\0')) throw new Error('Field names cannot contain NUL.');
  const candidate = { ...e };
  if (s.type === 'id3') candidate.description = name;
  else { if (s.type === 'ape') rules.validateAPEName(name); else rules.validateVorbisName(name); candidate.key = name; candidate.label = name; }
  rules.assertIdentity(s, candidate, e);
  Object.assign(e, candidate, { changed: true, renamed: true });
  return e;
}
function setDescription(doc, e, description, language = e.language) {
  const s = doc.sections.find(s => s.entries.includes(e));
  if (!s || s.locked || e.readonly || e.mode === 'hex' || e.editMode === 'hex') throw new Error('This description is read-only.');
  if (description.includes('\0')) throw new Error('Descriptions cannot contain NUL.');
  if (language !== undefined && !/^[a-z]{3}$/.test(language)) throw new Error('Use a lowercase three-letter ISO 639-2 language code.');
  const candidate = { ...e, description, language }; rules.assertIdentity(s, candidate, e);
  Object.assign(e, candidate, { changed: true, renamed: true });
}
function set(e, value, editMode) { if (e.readonly) throw new Error('Protected field.'); e.value = value; e.editMode = editMode; e.changed = true; }
function cover(e, bytes, mime, version = 4, dimensions = {}) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('Choose a PNG, JPEG or WebP cover.');
  if (e.readonly) throw new Error('Protected field.');
  if (e.taglibPicture) { Object.assign(e, {bytes, image:bytes, mime, value:bytes.toString('hex'), changed:true}); return; }
  if (e.key === 'PICTURE') {
    const m = Buffer.from(mime), desc = Buffer.from(e.description || '');
    e.bytes = Buffer.concat([u32(e.pictureType ?? 3), u32(m.length), m, u32(desc.length), desc,
      u32(dimensions.width || 0), u32(dimensions.height || 0), u32(24), u32(0), u32(bytes.length), bytes]);
  } else {
    const enc = version === 4 ? 3 : 1;
    if (e.key === 'PIC' && mime === 'image/webp') throw new Error('ID3v2.2 covers only support PNG or JPEG here.');
    e.bytes = Buffer.concat([Buffer.from([enc]), e.key === 'PIC' ? Buffer.from(mime === 'image/png' ? 'PNG' : 'JPG') : Buffer.from(mime + '\0'), Buffer.from([e.pictureType ?? 3]), textBytes(e.description || '', enc), Buffer.alloc(enc === 1 ? 2 : 1), bytes]);
  }
  e.value = e.bytes.toString('hex'); e.mode = 'hex'; e.editMode = 'hex'; e.changed = true; e.image = bytes; e.mime = mime;
}
function addCover(doc, bytes, mime, dimensions) {
  if (doc.backend) return require('./audio-backend').addCover(doc, bytes, mime);
  let s = doc.sections.find(x => x.type === (doc.ext === 'flac' ? 'flac' : 'id3') && !x.locked), e;
  if (s?.type === 'flac') {
    e = entry('PICTURE', EMPTY); s.blocks.push({ type: 6, entries: [e], bytes: EMPTY }); s.entries.push(e); e.added = true;
  } else { e = add(doc, s?.version === 2 ? 'PIC' : 'APIC', '', 'hex', s); s = doc.sections.find(x => x.entries.includes(e)); }
  cover(e, bytes, mime, s.version, dimensions); return e;
}
function helpers() { return { parseID3, buildID3, parseVorbis, buildVorbis, entry, changed, payload, need, parse, u32 }; }
module.exports = { parse, serialize, add, set, rename, setDescription,
  canRename: (s,e) => s.type === 'propertymap' ? !s.locked&&!e.standard&&!e.readonly&&!e.taglibPicture&&!e.deleted : rules.canRename(s,e),
  cover, addCover, payload, hexBytes, changed, LABELS };
