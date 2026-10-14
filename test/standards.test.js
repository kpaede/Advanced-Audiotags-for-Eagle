'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const codec=require('../lib/tag-codec'),rules=require('../lib/tag-rules');
const audio=Buffer.from([255,251,144,0,33,44]);
function fresh(){return codec.parse(audio,'mp3');}
test('arbitrary custom names become TXXX descriptions and can be renamed',()=>{
 const doc=fresh(),e=codec.add(doc,'Recording session','Room A');assert.equal(e.key,'TXXX');assert.equal(e.description,'Recording session');
 codec.rename(doc,e,'Microphone');const out=codec.parse(codec.serialize(doc),'mp3');assert.equal(out.sections[0].entries[0].description,'Microphone');assert.equal(out.sections[0].entries[0].value,'Room A');assert.equal(out.audioHash,doc.audioHash);
});
test('new ID3 frame identities are unique and rename collisions leave data intact',()=>{
 const doc=fresh(),a=codec.add(doc,'First custom','a'),b=codec.add(doc,'Second custom','b');
 assert.throws(()=>codec.rename(doc,b,'First custom'),/same identity/);assert.equal(b.description,'Second custom');
 codec.add(doc,'TITLE','Title');assert.throws(()=>codec.add(doc,'TIT2','Duplicate'),/same identity/);
 assert.throws(()=>codec.rename(doc,a,'bad\0name'),/NUL/);assert.equal(doc.sections[0].entries.length,3);
});
test('friendly standard names resolve to the correct ID3 version',()=>{
 for(const [v,id] of [[2,'TYE'],[3,'TYER'],[4,'TDRC']])assert.equal(rules.resolveField('DATE',v).key,id);
 assert.throws(()=>rules.resolveField('TDRC',3),/not a standard text frame/);
 assert.equal(rules.resolveField('Mood description',3).key,'TXXX');
});
test('comments use language plus description identity',()=>{
 const doc=fresh(),e=codec.add(doc,'COMMENT','One');assert.equal(e.language,'eng');
 assert.throws(()=>codec.add(doc,'COMM','Two'),/same identity/);
 codec.setDescription(doc,e,'Liner notes','deu');assert.throws(()=>codec.setDescription(doc,e,'Liner notes','de'),/three-letter/);
 const second=codec.add(doc,'COMMENT','Two');assert.throws(()=>codec.setDescription(doc,second,'Liner notes','deu'),/same identity/);
});
test('Vorbis and APE names follow container rules',()=>{
 for(const good of ['ARTIST','Custom Field','}'])rules.validateVorbisName(good);
 for(const bad of ['A=B','é','~',''])assert.throws(()=>rules.validateVorbisName(bad));
 for(const bad of ['A','ID3','OggS','A=B'])assert.throws(()=>rules.validateAPEName(bad));
 rules.validateAPEName('Recording session');
});
test('ID3v2.4 text value separators survive edits without silent splitting',()=>{
 const doc=fresh(),e=codec.add(doc,'ARTIST','One\0Two\0');const out=codec.parse(codec.serialize(doc),'mp3');assert.equal(out.sections[0].entries[0].value,'One\0Two\0');
 codec.set(e,'Another\0Artist');assert.equal(codec.parse(codec.serialize(doc),'mp3').sections[0].entries[0].value,'Another\0Artist');
});
