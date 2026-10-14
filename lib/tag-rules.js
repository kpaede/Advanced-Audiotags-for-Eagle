'use strict';
const ID3_TEXT = {
  2: 'TAL TBP TCM TCO TCR TDA TDY TEN TFT TIM TKE TLA TLE TMT TOA TOF TOL TOR TOT TP1 TP2 TP3 TP4 TPA TPB TRC TRD TRK TSI TSS TT1 TT2 TT3 TXT TXX TYE',
  3: 'TALB TBPM TCOM TCON TCOP TDAT TDLY TENC TEXT TFLT TIME TIT1 TIT2 TIT3 TKEY TLAN TLEN TMED TOAL TOFN TOLY TOPE TORY TOWN TPE1 TPE2 TPE3 TPE4 TPOS TPUB TRCK TRDA TRSN TRSO TSIZ TSRC TSSE TXXX TYER',
  4: 'TALB TBPM TCOM TCON TCOP TDEN TDLY TDOR TDRC TDRL TDTG TENC TEXT TFLT TIPL TIT1 TIT2 TIT3 TKEY TLAN TLEN TMCL TMED TMOO TOAL TOFN TOLY TOPE TOWN TPE1 TPE2 TPE3 TPE4 TPOS TPRO TPUB TRCK TRSN TRSO TSOA TSOP TSOT TSRC TSSE TSST TXXX'
};
const COMMON = { TITLE: ['TT2','TIT2'], ARTIST: ['TP1','TPE1'], ALBUM: ['TAL','TALB'], ALBUMARTIST: ['TP2','TPE2'], TRACKNUMBER: ['TRK','TRCK'], DISCNUMBER: ['TPA','TPOS'], GENRE: ['TCO','TCON'], DATE: ['TYE','TYER','TDRC'], YEAR: ['TYE','TYER','TDRC'], COMMENT: ['COM','COMM'], LYRICS: ['ULT','USLT'], COMPOSER: ['TCM','TCOM'], BPM: ['TBP','TBPM'], ISRC: ['TRC','TSRC'], PUBLISHER: ['TPB','TPUB'], ENCODEDBY: ['TEN','TENC'], ENCODERSETTINGS: ['TSS','TSSE'] };
function isStandardText(key, version) { return ID3_TEXT[version]?.split(' ').includes(key); }
function resolveField(name, version, kind) {
  if (kind === 'hex') return { key: name.toUpperCase() };
  const lookup = name.toUpperCase().replace(/[ _-]/g, '');
  if (COMMON[lookup]) { const ids = COMMON[lookup]; return { key: ids[version === 2 ? 0 : version === 3 ? 1 : ids.length - 1] }; }
  const upper = name.toUpperCase();
  const valid = version === 2 ? /^[A-Z0-9]{3}$/ : /^[A-Z0-9]{4}$/;
  // Explicit frame IDs are a technical escape hatch; arbitrary names use TXXX/TXX.
  if (valid.test(name) && (name[0] === 'T' || name[0] === 'W' || ['COMM','COM','USLT','ULT','APIC','PIC'].includes(name))) {
    if (name[0] === 'T' && !isStandardText(name, version)) throw new Error(`${name} is not a standard text frame in ID3v2.${version}. Use a custom field name instead.`);
    return { key: upper };
  }
  if (!name || name.includes('\0')) throw new Error('A custom field name must be nonempty and cannot contain NUL.');
  return { key: version === 2 ? 'TXX' : 'TXXX', description: name };
}
function validateVorbisName(name) {
  if (!/^[\x20-\x3c\x3e-\x7d]+$/.test(name)) throw new Error('Vorbis names must be printable ASCII through 0x7D, excluding =.');
}
function validateAPEName(name) {
  if (!/^[\x20-\x7e]{2,255}$/.test(name) || name.includes('=') || /^(ID3|TAG|OggS|MP\+)$/i.test(name)) throw new Error('APE keys require 2–255 printable ASCII characters, excluding = and reserved keys.');
}
function identity(e) {
  if (['TXXX','TXX','WXXX','WXX'].includes(e.key) && e.description !== undefined) return `${e.key}:${e.description}`;
  if (['COMM','COM','USLT','ULT'].includes(e.key) && e.description !== undefined) return `${e.key}:${e.language}:${e.description}`;
  if (e.key.startsWith('T')) return e.key;
  return null;
}
function assertIdentity(section, candidate, ignore) {
  if (section.type === 'id3') {
    const id = identity(candidate);
    if (id && section.entries.some(e => e !== ignore && !e.deleted && identity(e) === id)) throw new Error('An ID3 frame with the same identity already exists. Edit it or use another custom name.');
  } else if (section.type === 'ape' && section.entries.some(e => e !== ignore && !e.deleted && e.key.toUpperCase() === candidate.key.toUpperCase())) throw new Error('An APE item with this key already exists (case-insensitive comparison).');
}
function canRename(section, e) {
  if (section.locked || e.readonly || e.deleted || e.editMode === 'hex') return false;
  return section.type === 'ape' || (section.type === 'flac' && e.mode === 'utf8') || (section.type === 'id3' && ['TXXX','TXX','WXXX','WXX'].includes(e.key) && e.mode.startsWith('id3-'));
}
module.exports = { ID3_TEXT, resolveField, validateVorbisName, validateAPEName, assertIdentity, canRename };
