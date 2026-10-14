'use strict';
const { createHash } = require('crypto');
function bound(b, p, n) { if (!Number.isSafeInteger(n) || n < 0 || p < 0 || p + n > b.length) throw new Error('Truncated audio container.'); }
function wide(b, p, le = true) { bound(b,p,8); const a=b.readUInt32LE(p),z=b.readUInt32LE(p+4); return le ? a+z*4294967296 : b.readUInt32BE(p)*4294967296+b.readUInt32BE(p+4); }
function trimTags(b) {
  let start=0,end=b.length;
  while(b.toString('latin1',start,start+3)==='ID3') { bound(b,start,10); const size=[...b.subarray(start+6,start+10)].reduce((n,x)=>n*128+(x&127),0); start+=10+size+(b[start+3]===4&&(b[start+5]&16)?10:0); bound(b,0,start); }
  for (;;) {
    if(end-start>=128&&b.toString('latin1',end-128,end-125)==='TAG') { end-=128; if(end-start>=227&&b.toString('latin1',end-227,end-223)==='TAG+')end-=227; }
    else if(end-start>=32&&b.toString('latin1',end-32,end-24)==='APETAGEX') { const p=end-32,n=b.readUInt32LE(p+12); if(n<32||n>end-start)throw new Error('Invalid APE size.'); end-=n; if(b.readUInt32LE(p+20)&0x80000000)end-=32; }
    else break;
  }
  bound(b,start,end-start); return b.subarray(start,end);
}
function oggParts(b) {
  const streams=new Map(),parts=[]; let p=0;
  while(p<b.length) {
    bound(b,p,27); if(b.toString('ascii',p,p+4)!=='OggS'||b[p+4]!==0)throw new Error('Invalid Ogg page.');
    const serial=b.readUInt32LE(p+14),count=b[p+26]; bound(b,p+27,count);
    let stream=streams.get(serial); if(!stream){stream={fragments:[],index:0,codec:''};streams.set(serial,stream);}
    let at=p+27+count;
    for(const n of b.subarray(p+27,p+27+count)) {
      bound(b,at,n); stream.fragments.push(b.subarray(at,at+n)); at+=n;
      if(n<255) {
        const packet=Buffer.concat(stream.fragments);stream.fragments=[];
        if(stream.index===0)stream.codec=packet.toString('ascii',0,8);
        const vorbis=packet[0]===3&&packet.toString('ascii',1,7)==='vorbis';
        const opus=packet.toString('ascii',0,8)==='OpusTags';
        const speex=stream.codec.startsWith('Speex')&&stream.index===1;
        const flac=stream.codec.startsWith('\x7fFLAC')&&stream.index>0&&packet[0]!==255;
        if(!vorbis&&!opus&&!speex&&!flac) { const size=Buffer.alloc(4);size.writeUInt32LE(packet.length);parts.push(size,packet); }
        stream.index++;
      }
    }
    p=at;
  }
  if([...streams.values()].some(s=>s.fragments.length))throw new Error('Incomplete Ogg packet.'); return parts;
}
function chunkParts(b, aiff=false) {
  const parts=[];bound(b,0,12);let p=12;
  const end=(aiff?b.readUInt32BE(4):b.readUInt32LE(4))+8;bound(b,0,end);
  while(p+8<=end) { const id=b.toString('latin1',p,p+4),n=aiff?b.readUInt32BE(p+4):b.readUInt32LE(p+4);bound(b,p+8,n);
    if((aiff?['COMM','SSND']:['fmt ','data','fact']).includes(id))parts.push(b.subarray(p,p+8+n));p+=8+n+(n%2);
  }
  return parts;
}
function mp4Parts(b) {
  const parts=[],config=[];
  function walk(start,end,depth=0) { if(depth>12)throw new Error('MP4 nesting is too deep.');let p=start;
    while(p+8<=end){let n=b.readUInt32BE(p),h=8;const id=b.toString('latin1',p+4,p+8);if(n===1){n=wide(b,p+8,false);h=16;}if(n===0)n=end-p;if(n<h||p+n>end)throw new Error('Invalid MP4 atom.');
      if(id==='mdat')parts.push(b.subarray(p+h,p+n));else if(['stsd','stts','stsz'].includes(id))config.push(b.subarray(p+h,p+n));
      else if(['moov','trak','mdia','minf','stbl'].includes(id))walk(p+h,p+n,depth+1);p+=n;
    }
  } walk(0,b.length);return [...parts,...config];
}
function ebmlParts(b) {
  function vint(p,id=false){bound(b,p,1);let width=1,mask=128;while(!(b[p]&mask)&&width<=8){mask>>=1;width++;}if(width>8)throw new Error('Invalid EBML length.');bound(b,p,width);let n=id?b[p]:b[p]&(mask-1),unknown=!id&&n===mask-1;for(let i=1;i<width;i++){n=n*256+b[p+i];unknown=unknown&&b[p+i]===255;}return {width,n,unknown};}
  const parts=[];function walk(start,end,depth=0){if(depth>2)return;let p=start;while(p<end){const id=vint(p,true),size=vint(p+id.width),data=p+id.width+size.width,next=size.unknown?end:data+size.n;if(next>end)throw new Error('Truncated EBML element.');if(id.n===0x1f43b675||id.n===0x1654ae6b)parts.push(b.subarray(data,next));else if(id.n===0x18538067)walk(data,next,depth+1);p=next;}}
  walk(0,b.length);return parts;
}
function payloadHash(buffer,ext) {
  const b=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer),parts=[];ext=ext.toLowerCase();
  if(b.toString('ascii',0,4)==='OggS')parts.push(...oggParts(b));
  else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE')parts.push(...chunkParts(b));
  else if(b.toString('ascii',0,4)==='FORM'&&['AIFF','AIFC'].includes(b.toString('ascii',8,12)))parts.push(...chunkParts(b,true));
  else if(b.toString('ascii',4,8)==='ftyp')parts.push(...mp4Parts(b));
  else if(b.subarray(0,4).equals(Buffer.from([0x30,0x26,0xb2,0x75]))) {
    let p=0;while(p+24<=b.length){const n=wide(b,p+16);bound(b,p,n);if(n<24)throw new Error('Invalid ASF object.');if(b.subarray(p,p+16).equals(Buffer.from('3626b2758e66cf11a6d900aa0062ce6c','hex')))parts.push(b.subarray(p+24,p+n));p+=n;}
  } else if(b.toString('ascii',0,4)==='DSD ') {
    let p=0;while(p+12<=b.length){const id=b.toString('ascii',p,p+4),n=wide(b,p+4);if(n<12)throw new Error('Invalid DSF chunk.');bound(b,p,n);if(['fmt ','data'].includes(id))parts.push(b.subarray(p+12,p+n));p+=n;if(id==='data')break;}
  } else if(b.toString('ascii',0,4)==='FRM8') {
    let p=16;const end=wide(b,4,false)+12;bound(b,0,end);while(p+12<=end){const id=b.toString('ascii',p,p+4),n=wide(b,p+4,false);bound(b,p+12,n);if(['PROP','DSD ','DST '].includes(id))parts.push(b.subarray(p+12,p+12+n));p+=12+n+(n%2);}
  } else if(b.toString('ascii',0,4)==='caff') {
    let p=8;while(p+12<=b.length){const id=b.toString('ascii',p,p+4),n=wide(b,p+4,false);bound(b,p+12,n);if(['desc','data'].includes(id))parts.push(b.subarray(p+12,p+12+n));p+=12+n;}
  } else if(b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))parts.push(...ebmlParts(b));
  else if(['ape','wv','mpc','mpp','mp+','tta','shn','aac','mp2','mp3','ac3','eac3','ec3'].includes(ext))parts.push(trimTags(b));
  if(!parts.length)return null;
  const hash=createHash('sha256');for(const part of parts)hash.update(part);return hash.digest('hex');
}
module.exports={payloadHash,oggParts,trimTags};
