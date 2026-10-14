'use strict';
// Run with ELECTRON_RUN_AS_NODE=1 /Applications/Eagle.app/Contents/MacOS/Eagle scripts/eagle-runtime-smoke.cjs
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const backend=require('../lib/backend-client'),codec=require('../lib/tag-codec');
(async()=>{
 const fixtures=process.env.AUDIO_TEST_FIXTURES;
 if(!fixtures)throw new Error('Set AUDIO_TEST_FIXTURES to a directory containing sample.mp3, sample.flac, sample.ogg and other test files.');
 let count=0;
 for(const name of fs.readdirSync(fixtures).filter(n=>n.startsWith('sample.')&&!n.endsWith('.edited'))){
  const ext=name.split('.').pop();if(!require('../lib/formats').EXTENSIONS.includes(ext))continue;
  const doc=await backend.read(fs.readFileSync(path.join(fixtures,name)),ext);
  if(doc.sections.some(s=>s.locked)){console.log(name+': inspected, read-only');continue;}
  const field=codec.add(doc,'RUNTIME_TEST','Value 日本');codec.rename(doc,field,'RUNTIME_RENAMED');
  const updated=await backend.read(await backend.serialize(doc),ext);
  assert.equal(updated.audioHash,doc.audioHash);
  assert.ok(updated.sections.flatMap(s=>s.entries).some(e=>e.key==='RUNTIME_RENAMED'||e.description==='RUNTIME_RENAMED'));
  console.log(name+': read / rename / write / verify passed');count++;
 }
 assert.ok(count>0);console.log(`${count} writes verified in Node ${process.versions.node}, Electron ${process.versions.electron||'not embedded'}.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
