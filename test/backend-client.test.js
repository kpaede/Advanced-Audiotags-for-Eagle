'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('module');
const audio=Buffer.from([255,251,144,0,33,44]);
test('backend works when the renderer cannot create Worker threads',async()=>{
 const load=Module._load;let client;
 Module._load=function(name,...args){if(name==='worker_threads')throw new Error('The V8 platform used by this instance of Node does not support creating Workers');return load.call(this,name,...args);};
 try{
  client=require('../lib/backend-client');client.configure({execPath:process.execPath});
  const doc=await client.read(audio,'mp3');const codec=require('../lib/tag-codec');codec.add(doc,'TITLE','Saved via subprocess');
  const out=await client.serialize(doc);assert.equal(codec.parse(out,'mp3').sections[0].entries[0].value,'Saved via subprocess');
 }finally{Module._load=load;client?.close();}
});
test('a failed request does not prevent the next request',async()=>{
 const client=require('../lib/backend-client');try{
  await assert.rejects(client.read(audio,'unsupported'),/Unsupported audio extension/);
  const docs=await Promise.all([client.read(audio,'mp3'),client.read(audio,'mp3')]);assert.equal(docs.length,2);assert.ok(docs.every(d=>Buffer.isBuffer(d.buffer)));
 }finally{client.close();}
});
