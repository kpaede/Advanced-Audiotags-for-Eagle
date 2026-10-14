'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../lib/tag-codec');
const audio = Buffer.from([255, 251, 144, 0, 2, 3, 255, 0, 255, 224, 99]);
const ac3 = Buffer.from([11, 119, 5, 0, 12, 33, 44]);
const sync = n => Buffer.from([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
const int = (n, le = false) => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; };
function frame(key, bytes, version = 4, flags = 0) {
  const h = Buffer.alloc(version === 2 ? 6 : 10); h.write(key);
  if (version === 2) h.writeUIntBE(bytes.length, 3, 3);
  else { (version === 4 ? sync(bytes.length) : int(bytes.length)).copy(h, 4); h.writeUInt16BE(flags, 8); }
  return Buffer.concat([h, bytes]);
}
function tag(frames, version = 4, flags = 0, ext = Buffer.alloc(0)) {
  const body = Buffer.concat([ext, ...frames]), h = Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, flags]), sync(body.length)]);
  return Buffer.concat([h, body, flags & 16 && version === 4 ? Buffer.concat([Buffer.from('3DI'), h.subarray(3)]) : Buffer.alloc(0)]);
}
function block(type, bytes, last = false) { const b = Buffer.alloc(4); b[0] = type | (last ? 128 : 0); b.writeUIntBE(bytes.length, 1, 3); return Buffer.concat([b, bytes]); }
function vorbis(comments, vendor = 'Test vendor') {
  const v = Buffer.from(vendor); return Buffer.concat([int(v.length, true), v, int(comments.length, true), ...comments.map(c => { const b = Buffer.from(c); return Buffer.concat([int(b.length, true), b]); })]);
}
function flac(comments) { return Buffer.concat([Buffer.from('fLaC'), block(0, Buffer.alloc(34)), block(4, vorbis(comments), true), audio]); }
function ape(items, header = true) {
  const data = Buffer.concat(items.map(([key, value, flags = 0]) => { const b = Buffer.from(value); return Buffer.concat([int(b.length, true), int(flags, true), Buffer.from(key + '\0'), b]); }));
  const f = Buffer.concat([Buffer.from('APETAGEX'), int(2000, true), int(data.length + 32, true), int(items.length, true), int(header ? 0x80000000 : 0, true), Buffer.alloc(8)]);
  const h = Buffer.from(f); h.writeUInt32LE(0xa0000000, 20); return Buffer.concat([header ? h : Buffer.alloc(0), data, f]);
}
for (const version of [2, 3, 4]) test(`ID3v2.${version}: Unicode editing preserves unknown frames and audio`, () => {
  const title = version === 2 ? 'TT2' : 'TIT2', unknown = version === 2 ? 'XYZ' : 'XABC';
  const raw = Buffer.from([255, 0, 255, 224, 44, 1]), source = Buffer.concat([tag([frame(title, Buffer.from([0, 79, 108, 100]), version), frame(unknown, raw, version)], version), audio]);
  const doc = codec.parse(source, 'mp3'); assert.deepEqual(codec.serialize(doc), source);
  codec.set(doc.sections[0].entries[0], 'Grüße 日本 🎵');
  const updated = codec.parse(codec.serialize(doc), 'mp3'); assert.equal(updated.sections[0].entries[0].value, 'Grüße 日本 🎵');
  assert.deepEqual(updated.sections[0].entries[1].bytes, raw); assert.equal(updated.audioHash, doc.audioHash);
});
test('duplicate ID3 frames, TXXX, COMM, USLT and URLs survive independently', () => {
  const text = (desc, value, lang = '') => Buffer.concat([Buffer.from([3]), Buffer.from(lang + desc + '\0' + value)]);
  const doc = codec.parse(Buffer.concat([tag([
    frame('TXXX', text('custom', 'one')), frame('TXXX', text('custom', 'two')),
    frame('COMM', text('description', 'comment', 'eng')), frame('USLT', text('', 'lyrics\nline', 'deu')),
    frame('WXXX', text('site', 'https://example.org')), frame('TPE1', Buffer.from('\x03A\0B'))
  ]), audio]), 'mp3');
  assert.equal(doc.sections[0].entries.length, 6);
  const e = doc.sections[0].entries[2]; e.description = 'neu'; e.language = 'deu'; codec.set(e, 'Neuer Comment');
  const next = codec.parse(codec.serialize(doc), 'mp3');
  assert.equal(next.sections[0].entries[0].value, 'one'); assert.equal(next.sections[0].entries[1].value, 'two');
  assert.equal(next.sections[0].entries[2].value, 'Neuer Comment'); assert.equal(next.sections[0].entries[2].description, 'neu');
  assert.equal(next.sections[0].entries[5].value, 'A\0B');
});
test('ID3v2.3 global unsynchronisation preserves binary bytes on rewrite', () => {
  const raw = Buffer.from([255, 224, 255, 0]), logical = frame('XABC', raw, 3);
  const expanded = Buffer.from([...logical.subarray(0, 10), 255, 0, 224, 255, 0, 0]);
  const source = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 128]), sync(expanded.length), expanded, audio]);
  const doc = codec.parse(source, 'mp3'); assert.deepEqual(doc.sections[0].entries[0].bytes, raw);
  codec.add(doc, 'TIT2', 'unsync test'); const result = codec.parse(codec.serialize(doc), 'mp3');
  assert.deepEqual(result.sections[0].entries[0].bytes, raw);
});
test('ID3v2.4 frame unsynchronisation and trailing footer are preserved', () => {
  const leading = tag([frame('XABC', Buffer.from([255, 0, 224]), 4, 2)]);
  const trailing = tag([frame('TIT2', Buffer.from('\x03trailing'))], 4, 16);
  const doc = codec.parse(Buffer.concat([leading, audio, trailing]), 'mp3');
  assert.equal(doc.sections.length, 2); assert.deepEqual(doc.sections[0].entries[0].bytes, Buffer.from([255, 224]));
  codec.set(doc.sections[1].entries[0], 'new trailing'); codec.add(doc, 'TPE1', 'artist');
  const result = codec.parse(codec.serialize(doc), 'mp3'); assert.equal(result.sections[1].entries[0].value, 'new trailing');
});
test('ID3v2.4 extended CRC header can be rewritten', () => {
  const ext = Buffer.from([0, 0, 0, 12, 1, 32, 5, 0, 0, 0, 0, 0]);
  const doc = codec.parse(Buffer.concat([tag([frame('TIT2', Buffer.from('\x03old'))], 4, 64, ext), audio]), 'mp3');
  codec.set(doc.sections[0].entries[0], 'new'); const next = codec.parse(codec.serialize(doc), 'mp3');
  assert.notDeepEqual(next.sections[0].ext, ext); assert.equal(next.sections[0].entries[0].value, 'new');
});
test('ID3 extended restrictions are visible and fail closed for writes', () => {
  const ext = Buffer.from([0, 0, 0, 8, 1, 16, 1, 0]);
  const source = Buffer.concat([tag([frame('TIT2', Buffer.from('\x03old'))], 4, 64, ext), audio]);
  const doc = codec.parse(source, 'mp3'); assert.ok(doc.sections[0].locked); assert.deepEqual(codec.serialize(doc), source);
  codec.set(doc.sections[0].entries[0], 'new'); assert.throws(() => codec.serialize(doc), /restrictions/);
});
test('FLAC: custom, duplicate, Unicode and multiline comments, vendor retained', () => {
  const source = flac(['ARTIST=One', 'ARTIST=Two', 'X_CUSTOM=Original', 'LYRICS=One\nTwo']);
  const doc = codec.parse(source, 'flac'); assert.deepEqual(codec.serialize(doc), source);
  const s = doc.sections[0]; codec.set(s.entries.find(e => e.key === 'X_CUSTOM'), 'Änderung 日本');
  codec.add(doc, 'arbitrary_field', 'custom value');
  const next = codec.parse(codec.serialize(doc), 'flac');
  assert.deepEqual(next.sections[0].entries.filter(e => e.key === 'ARTIST').map(e => e.value), ['One', 'Two']);
  assert.equal(next.sections[0].blocks[1].vendor.toString(), 'Test vendor'); assert.equal(next.audioHash, doc.audioHash);
  assert.equal(next.sections[0].entries.find(e => e.key === 'X_CUSTOM').value, 'Änderung 日本');
});
test('FLAC without comments accepts a new comment block', () => {
  const source = Buffer.concat([Buffer.from('fLaC'), block(0, Buffer.alloc(34), true), audio]);
  const doc = codec.parse(source, 'flac'); codec.add(doc, 'TITLE', 'new');
  assert.equal(codec.parse(codec.serialize(doc), 'flac').sections[0].entries[1].value, 'new');
});
test('FLAC raw application edits preserve streaminfo, seektable and audio', () => {
  const source = Buffer.concat([Buffer.from('fLaC'), block(0, Buffer.alloc(34)), block(2, Buffer.from('abcdDATA')), block(3, Buffer.alloc(18), true), audio]);
  const doc = codec.parse(source, 'flac'); codec.set(doc.sections[0].entries[1], Buffer.from('abcdNEW').toString('hex'), 'hex');
  assert.equal(codec.parse(codec.serialize(doc), 'flac').sections[0].entries[1].bytes.toString(), 'abcdNEW');
  assert.throws(() => codec.set(doc.sections[0].entries[0], '00'), /Protected/);
});
test('covers can be added and replaced in all ID3 versions and FLAC', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  for (const ext of ['mp3', 'flac']) for (const version of ext === 'mp3' ? [2, 3, 4] : [4]) {
    const doc = codec.parse(ext === 'flac' ? flac([]) : Buffer.concat([tag([], version), audio]), ext);
    const e = codec.addCover(doc, png, 'image/png', { width: 3, height: 5 });
    codec.cover(e, png, 'image/png', version, { width: 3, height: 5 });
    const next = codec.parse(codec.serialize(doc), ext), image = next.sections.flatMap(x => x.entries).find(e => e.image);
    assert.deepEqual(image.image, png); assert.equal(image.mime, 'image/png');
  }
});
test('ID3v1.1 remains separate and enforces length and Latin-1', () => {
  const v1 = Buffer.alloc(128); v1.write('TAG'); v1.write('Old', 3); v1[125] = 0; v1[126] = 7; v1[127] = 17;
  const doc = codec.parse(Buffer.concat([audio, v1]), 'mp3');
  codec.set(doc.sections[0].entries[0], 'Grüße'); const out = codec.serialize(doc); assert.equal(codec.parse(out, 'mp3').sections[0].entries[0].value, 'Grüße');
  codec.set(doc.sections[0].entries[0], 'x'.repeat(31)); assert.throws(() => codec.serialize(doc), /maximum/);
  codec.set(doc.sections[0].entries[0], '日本'); assert.throws(() => codec.serialize(doc), /Latin-1/);
});
for (const header of [false, true]) test(`APEv2 with header=${header}: duplicate and binary values survive`, () => {
  const source = Buffer.concat([ac3, ape([['Artist', 'A\0B'], ['Artist', 'C'], ['Custom', Buffer.from([1, 2, 255]), 2]], header)]);
  const doc = codec.parse(source, 'ac3'); assert.deepEqual(codec.serialize(doc), source);
  codec.set(doc.sections[0].entries[0], '日本\0D');
  const next = codec.parse(codec.serialize(doc), 'ac3'); assert.equal(next.sections[0].entries[0].value, '日本\0D');
  assert.deepEqual(next.sections[0].entries[2].bytes, Buffer.from([1, 2, 255])); assert.equal(next.audioHash, doc.audioHash);
});
test('AC3 no tags: new ID3 text and custom fields retain the stream', () => {
  const doc = codec.parse(ac3, 'ac3'); codec.add(doc, 'TIT2', 'AC3'); codec.add(doc, 'TXXX', 'custom');
  const next = codec.parse(codec.serialize(doc), 'ac3'); assert.equal(next.sections[0].entries[1].value, 'custom'); assert.equal(next.audioHash, doc.audioHash);
});
test('editing an unknown frame as Hex, deletion and invalid input', () => {
  const doc = codec.parse(Buffer.concat([tag([frame('XABC', Buffer.from([1, 2])), frame('TIT2', Buffer.from('\x03old'))]), audio]), 'mp3');
  codec.set(doc.sections[0].entries[0], 'ff 00 aa', 'hex'); doc.sections[0].entries[1].deleted = true;
  const next = codec.parse(codec.serialize(doc), 'mp3'); assert.equal(next.sections[0].entries.length, 1); assert.equal(next.sections[0].entries[0].bytes.toString('hex'), 'ff00aa');
  codec.set(doc.sections[0].entries[0], 'f'); assert.throws(() => codec.serialize(doc), /two digits/);
  codec.set(doc.sections[0].entries[0], 'xx'); assert.throws(() => codec.serialize(doc), /Hex fields/);
});
test('malformed containers are rejected before saving', () => {
  assert.throws(() => codec.parse(Buffer.concat([Buffer.from('ID3\x04\0\0'), sync(100), audio]), 'mp3'), /truncated/);
  assert.throws(() => codec.parse(Buffer.from('not AC3'), 'ac3'), /sync word/);
  assert.throws(() => codec.parse(Buffer.concat([Buffer.from('fLaC'), block(0, Buffer.alloc(1), true)]), 'flac'), /STREAMINFO/);
  assert.throws(() => codec.parse(Buffer.concat([tag([frame('TIT2', Buffer.from('\x03text'))]), audio]), 'wav'), /binary codec/);
});
test('unchanged containers remain byte-identical when another container is edited', () => {
  const prefix = tag([frame('TIT2', Buffer.from('\x03title'))]), suffix = ape([['Title', 'other']]);
  const doc = codec.parse(Buffer.concat([prefix, audio, suffix]), 'mp3'); codec.set(doc.sections[0].entries[0], 'edited');
  const result = codec.serialize(doc); assert.deepEqual(result.subarray(result.length - suffix.length), suffix);
});
test('enhanced ID3v1 TAG+ fields are exposed and editable', () => {
  const enhanced = Buffer.alloc(227); enhanced.write('TAG+'); enhanced.write('Long title extension', 4); enhanced[184] = 3; enhanced.write('Rock', 185);
  const v1 = Buffer.alloc(128); v1.write('TAG');
  const doc = codec.parse(Buffer.concat([audio, enhanced, v1]), 'mp3'); assert.equal(doc.sections.length, 2);
  codec.set(doc.sections[0].entries[3], 'Jazz'); const next = codec.parse(codec.serialize(doc), 'mp3');
  assert.equal(next.sections[0].entries[3].value, 'Jazz'); assert.equal(next.audioHash, doc.audioHash);
});
