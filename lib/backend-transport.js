'use strict';
// JSON IPC avoids Electron 22's V8 binary-serialization failure. Explicit
// references retain shared FLAC entries, buffers, cycles and BigInt values.
function encode(value){
 const nodes=[],seen=new Map();
 function visit(v){
  if(v===undefined)return{u:1};if(typeof v==='bigint')return{b:String(v)};
  if(typeof v==='number'&&!Number.isFinite(v))return{n:String(v)};
  if(v===null||typeof v!=='object')return v;
  if(seen.has(v))return{r:seen.get(v)};
  const id=nodes.length;seen.set(v,id);nodes.push(null);
  if(Buffer.isBuffer(v)||v instanceof Uint8Array)nodes[id]=['buffer',Buffer.from(v).toString('base64')];
  else if(v instanceof Date)nodes[id]=['date',v.toISOString()];
  else nodes[id]=[Array.isArray(v)?'array':'object',Object.keys(v).map(k=>[k,visit(v[k])])];
  return{r:id};
 }
 const root=visit(value);return{root,nodes};
}
function decode(message){
 const objects=message.nodes.map(([type,data])=>type==='buffer'?Buffer.from(data,'base64'):type==='date'?new Date(data):type==='array'?[]:{});
 function value(v){if(v===null||typeof v!=='object')return v;if('r'in v)return objects[v.r];if('b'in v)return BigInt(v.b);if('n'in v)return Number(v.n);return undefined;}
 message.nodes.forEach(([type,data],i)=>{if(type==='array'||type==='object')for(const [key,v]of data)Object.defineProperty(objects[i],key,{value:value(v),enumerable:true,configurable:true,writable:true});});
 return value(message.root);
}
module.exports={encode,decode};
