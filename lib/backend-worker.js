'use strict';
const {parentPort}=require('worker_threads');
const backend=require('./audio-backend');
const {buffers}=require('./backend-client');
let queue=Promise.resolve();
parentPort.on('message',message=>{
 queue=queue.then(async()=>{
  try{
   if(!['read','serialize'].includes(message.method))throw new Error('Unknown metadata operation.');
   const result=await backend[message.method](...buffers(message.args));parentPort.postMessage({id:message.id,result});
  }catch(error){parentPort.postMessage({id:message.id,error:error.message||String(error)});}
 });
});
