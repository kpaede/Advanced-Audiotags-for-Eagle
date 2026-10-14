'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs').promises,path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const backend=require('../lib/audio-backend'),codec=require('../lib/tag-codec');
const data=process.env.TAGLIB_TEST_DATA,ffmpeg=process.env.FFMPEG_PATH;
for(const name of ['mac-399.ape','mac-399-tagged.ape','mac-399-id3v2.ape','click.mpc','empty10ms.dsf','empty10ms.dff'])test(`upstream ${name}: custom rename and encoded audio preservation`,{skip:!data},async t=>{
 const file=path.join(data,name),ext=name.split('.').pop(),doc=await backend.read(await fs.readFile(file),ext);
 const field=codec.add(doc,'REFERENCE_TEST','Value 日本');codec.rename(doc,field,'RENAMED_REFERENCE');const out=await backend.serialize(doc),actual=await backend.read(out,ext);
 assert.equal(doc.audioHash,actual.audioHash);assert.ok(actual.sections[0].entries.some(e=>e.key==='RENAMED_REFERENCE'));
 assert.ok(doc.technical.codec&&!/^unknown$/i.test(doc.technical.codec));assert.ok(doc.technical.sampleRate>0);assert.ok(doc.technical.numberOfChannels>0);
 if(ext==='dsf'){assert.equal(doc.technical.bitsPerSample,1);assert.equal(doc.technical.lossless,true);}
 if(ffmpeg){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-reference-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const target=path.join(dir,'edited.'+ext);await fs.writeFile(target,out);const md5=file=>execFileSync(ffmpeg,['-v','error','-i',file,'-f','md5','-'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.equal(md5(file),md5(target));}
});
test('Shorten writer limitation is explicit',{skip:!data},async()=>{const doc=await backend.read(await fs.readFile(path.join(data,'2sec-silence.shn')),'shn');assert.match(doc.sections[0].locked,/inspection only/);assert.throws(()=>codec.add(doc,'CUSTOM','value'),/inspection only/);});
