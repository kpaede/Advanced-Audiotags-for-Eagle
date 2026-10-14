'use strict';
// Run parsing and WebAssembly in a Node worker. The inspector keeps its strict
// Content Security Policy, and expensive metadata work does not block its UI.
const {Worker}=require('worker_threads');
const path=require('path');
let worker,nextID=0;
const pending=new Map();
function buffers(value,seen=new WeakMap()){
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return seen.get(value);
 if(value instanceof Uint8Array){const out=Buffer.from(value.buffer,value.byteOffset,value.byteLength);seen.set(value,out);return out;}
 if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)return value;
 const out=Array.isArray(value)?[]:{};seen.set(value,out);for(const key of Object.keys(value))Object.defineProperty(out,key,{value:buffers(value[key],seen),writable:true,enumerable:true,configurable:true});return out;
}
function fail(error){for(const p of pending.values())p.reject(error);pending.clear();worker=undefined;}
function request(method,args){
 if(!worker){worker=new Worker(path.join(__dirname,'backend-worker.js'));const current=worker;worker.on('message',message=>{const call=pending.get(message.id);if(!call)return;pending.delete(message.id);if(message.error)call.reject(new Error(message.error));else call.resolve(buffers(message.result));if(!pending.size)worker?.unref();});worker.on('error',error=>{if(worker===current)fail(error);});worker.on('exit',code=>{if(worker!==current)return;if(pending.size)fail(new Error('The metadata worker exited before completing the request ('+code+').'));worker=undefined;});worker.unref();}
 const id=++nextID;worker.ref();return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{worker.postMessage({id,method,args});}catch(error){pending.delete(id);if(!pending.size)worker.unref();reject(error);}});
}
module.exports={read:(bytes,ext)=>request('read',[bytes,ext]),serialize:doc=>request('serialize',[doc]),buffers};
