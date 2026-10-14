'use strict';
// Eagle's renderer V8 platform cannot create Node worker_threads. Run the
// metadata backend in Eagle's standalone Node mode instead of the renderer.
const {fork}=require('child_process');
const path=require('path');
const {encode,decode}=require('./backend-transport');
let child,execPath=process.execPath,nextID=0,idleTimer;
const pending=new Map();
function release(current){
 if(child!==current||pending.size)return;
 current.unref();current.channel?.unref();
 clearTimeout(idleTimer);idleTimer=setTimeout(()=>close(),30000);idleTimer.unref();
}
function fail(current,error){
 if(child!==current)return;
 child=undefined;clearTimeout(idleTimer);
 for(const call of pending.values())call.reject(error);pending.clear();
 if(current.connected)current.disconnect();current.kill();
}
function start(){
 const current=fork(path.join(__dirname,'backend-process.js'),[],{
  execPath,execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},
  serialization:'json',stdio:['ignore','ignore','inherit','ipc'],windowsHide:true
 });
 child=current;
 current.on('message',message=>{
  if(child!==current)return;const call=pending.get(message.id);if(!call)return;
  pending.delete(message.id);
  if(message.error)call.reject(new Error(message.error));else call.resolve(decode(message.result));
  release(current);
 });
 current.on('error',error=>fail(current,new Error('The audio metadata process could not start: '+error.message)));
 current.on('exit',(code,signal)=>fail(current,new Error(`The audio metadata process exited before completing the request (${signal||code}).`)));
 current.on('disconnect',()=>fail(current,new Error('The audio metadata process disconnected. Reload the file to retry.')));
 return current;
}
function request(method,args){
 return new Promise((resolve,reject)=>{
  let current;
  try{
   clearTimeout(idleTimer);current=child||start();current.ref();current.channel?.ref();
   const id=++nextID;pending.set(id,{resolve,reject});
   current.send({id,method,args:encode(args)},error=>{if(error)fail(current,error);});
  }catch(error){if(current)fail(current,error);reject(error);}
 });
}
function configure(options){
 if(!options?.execPath||!path.isAbsolute(options.execPath))throw new Error('Eagle did not provide a valid executable path.');
 if(options.execPath===execPath)return;
 if(pending.size)throw new Error('Cannot change the audio runtime while a request is active.');
 close();execPath=options.execPath;
}
function close(){
 const current=child;if(!current)return;
 fail(current,new Error('The audio metadata process was closed.'));
}
module.exports={read:(bytes,ext)=>request('read',[bytes,ext]),serialize:doc=>request('serialize',[doc]),configure,close};
