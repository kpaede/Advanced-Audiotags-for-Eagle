'use strict';
// Preserve ASF header objects and attribute types; edit Unicode attributes directly.
const HEADER='3026b2758e66cf11a6d900aa0062ce6c';
const CONTENT='3326b2758e66cf11a6d900aa0062ce6c';
const EXTENDED='40a4d0d207e3d21197f000a0c95ea850';
const FILE='a1dcab8c47a9cf118ee400c00c205365';
const names=['TITLE','ARTIST','COPYRIGHT','COMMENT','RATING'];
const aliases={ALBUM:'WM/AlbumTitle',ALBUMARTIST:'WM/AlbumArtist',DATE:'WM/Year',YEAR:'WM/Year',TRACKNUMBER:'WM/TrackNumber',DISCNUMBER:'WM/PartOfSet',GENRE:'WM/Genre',COMPOSER:'WM/Composer',LYRICS:'WM/Lyrics',ENCODEDBY:'WM/EncodedBy'};
const standardNames=new Set([...Object.values(aliases),'WM/EncodingTime','WM/EncodingSettings','WM/Picture','WM/SharedUserRating']);
function need(b,p,n){if(n<0||p<0||p+n>b.length)throw new Error('Truncated ASF metadata.');}
function size(b,p){need(b,p,8);const n=Number(b.readBigUInt64LE(p));if(!Number.isSafeInteger(n))throw new Error('ASF object is too large.');return n;}
function u16(n){if(n>65535)throw new Error('ASF attribute exceeds 65535 bytes.');const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function text(b){if(b.length%2)throw new Error('Invalid ASF Unicode length.');return b.toString('utf16le').replace(/\0$/,'');}
function encoded(value){if(value.includes('\0'))throw new Error('ASF Unicode fields cannot contain NUL.');return Buffer.from(value+'\0','utf16le');}
function object(guid,payload){const h=Buffer.alloc(24);Buffer.from(guid,'hex').copy(h);h.writeBigUInt64LE(BigInt(24+payload.length),16);return Buffer.concat([h,payload]);}
function entry(key,bytes,extra={}){return{key,label:key,bytes,mode:'utf8',value:text(bytes),...extra};}
function parse(b){
 need(b,0,30);if(b.subarray(0,16).toString('hex')!==HEADER)throw new Error('Not an ASF container.');
 const end=size(b,16),count=b.readUInt32LE(24);need(b,0,end);const objects=[],entries=[];let p=30,hasExtended=false;
 for(let i=0;i<count;i++){
  need(b,p,24);const n=size(b,p+16);if(n<24||p+n>end)throw new Error('Invalid ASF header object.');
  const guid=b.subarray(p,p+16).toString('hex'),raw=b.subarray(p,p+n),index=objects.length;objects.push({guid,raw});
  if(guid===CONTENT){need(raw,24,10);let at=34;for(let j=0;j<5;j++){const length=raw.readUInt16LE(24+j*2);need(raw,at,length);entries.push(entry(names[j],raw.subarray(at,at+length),{asfObject:index,asfContent:j,standard:true}));at+=length;}}
  if(guid===EXTENDED){if(hasExtended)throw new Error('Multiple ASF extended-content objects are unsupported.');hasExtended=true;need(raw,24,2);let at=26;const total=raw.readUInt16LE(24);
   for(let j=0;j<total;j++){need(raw,at,2);const kl=raw.readUInt16LE(at);at+=2;need(raw,at,kl+4);const key=text(raw.subarray(at,at+kl));at+=kl;const type=raw.readUInt16LE(at),length=raw.readUInt16LE(at+2);at+=4;need(raw,at,length);const bytes=raw.subarray(at,at+length);
    const e=type===0?entry(key,bytes):{key,label:key,bytes,mode:'hex',value:bytes.toString('hex'),readonly:true,reason:'Typed or binary ASF attribute; preserved unchanged.'};
    Object.assign(e,{asfObject:index,asfType:type,standard:standardNames.has(key)});entries.push(e);at+=length;
   }
  }
  p+=n;
 }
 if(p!==end)throw new Error('Unexpected bytes in ASF header.');
 return{objects,end,entries};
}
function add(state,name,value){name=aliases[name.toUpperCase()]||name;if(!name||name.includes('\0'))throw new Error('ASF names must be nonempty and cannot contain NUL.');encoded(value);const e=entry(name,encoded(value),{asfType:0,changed:true,added:true,standard:standardNames.has(name)});state.entries.push(e);return e;}
function serialize(b,state){
 const objects=state.objects.map((o,index)=>{
  const fields=state.entries.filter(e=>e.asfObject===index&&!e.deleted);
  if(o.guid===CONTENT){if(fields.every(e=>!e.changed&&!e.deleted)&&!state.entries.some(e=>e.asfObject===index&&e.deleted))return Buffer.from(o.raw);const values=names.map((name,j)=>{const e=fields.find(e=>e.asfContent===j);return e?e.changed?encoded(e.value):e.bytes:Buffer.alloc(0);});return object(CONTENT,Buffer.concat([...values.map(v=>u16(v.length)),...values]));}
  if(o.guid===EXTENDED){if(!state.entries.some(e=>e.asfObject===index&&(e.changed||e.deleted))&&!state.entries.some(e=>e.added))return Buffer.from(o.raw);const all=fields.concat(state.entries.filter(e=>e.added));return extended(all);}
  return Buffer.from(o.raw);
 });
 if(!state.objects.some(o=>o.guid===EXTENDED)&&state.entries.some(e=>e.added))objects.push(extended(state.entries.filter(e=>e.added&&!e.deleted)));
 const header=Buffer.from(b.subarray(0,30)),end=30+objects.reduce((n,o)=>n+o.length,0),total=b.length-state.end+end;
 header.writeBigUInt64LE(BigInt(end),16);header.writeUInt32LE(objects.length,24);
 for(const o of objects)if(o.subarray(0,16).toString('hex')===FILE){need(o,40,8);o.writeBigUInt64LE(BigInt(total),40);}
 const out=Buffer.concat([header,...objects,b.subarray(state.end)]);parse(out);return out;
}
function extended(fields){fields=fields.filter(e=>!e.deleted);return object(EXTENDED,Buffer.concat([u16(fields.length),...fields.map(e=>{const key=encoded(e.key),value=e.changed?encoded(e.value):e.bytes;return Buffer.concat([u16(key.length),key,u16(e.asfType||0),u16(value.length),value]);})]));}
module.exports={parse,serialize,add};
