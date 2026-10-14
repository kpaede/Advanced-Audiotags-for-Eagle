'use strict';
const backend=require('./audio-backend');
const {encode,decode}=require('./backend-transport');
let queue=Promise.resolve();
process.on('message',message=>{
 queue=queue.then(async()=>{
  try{
   if(!['read','serialize'].includes(message.method))throw new Error('Unknown metadata operation.');
   const result=await backend[message.method](...decode(message.args));
   if(process.connected)process.send({id:message.id,result:encode(result)});
  }catch(error){if(process.connected)process.send({id:message.id,error:error.message||String(error)});}
 });
});
// Inspector reloads must not leave an orphaned background process.
process.on('disconnect',()=>process.exit(0));
