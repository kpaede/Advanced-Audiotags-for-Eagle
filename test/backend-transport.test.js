'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encode,decode}=require('../lib/backend-transport');
const roundtrip=value=>decode(JSON.parse(JSON.stringify(encode(value))));
test('JSON transport preserves buffers, shared metadata entries and cycles',()=>{
 const field={key:'CUSTOM',bytes:Buffer.from([0,255,32]),value:'Value 日本'};
 const doc={sections:[{entries:[field],blocks:[{entries:[field]}]}]};doc.self=doc;
 const actual=roundtrip(doc);assert.equal(actual.self,actual);assert.equal(actual.sections[0].entries[0],actual.sections[0].blocks[0].entries[0]);assert.deepEqual(actual.sections[0].entries[0].bytes,field.bytes);
 actual.sections[0].entries[0].value='Renamed';assert.equal(actual.sections[0].blocks[0].entries[0].value,'Renamed');
});
test('JSON transport retains BigInt, undefined and non-finite values',()=>{
 const value={samples:28224n,missing:undefined,nan:NaN,infinity:Infinity,negative:-Infinity,date:new Date('2026-01-01T00:00:00Z')};assert.deepEqual(roundtrip(value),value);
});
test('metadata keys cannot change transport object prototypes',()=>{
 const value=Object.defineProperty({},'__proto__',{value:'literal field',enumerable:true});const out=roundtrip(value);assert.equal(Object.getPrototypeOf(out),Object.prototype);assert.equal(out.__proto__,'literal field');
});
