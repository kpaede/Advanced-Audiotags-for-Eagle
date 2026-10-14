'use strict';
const {trimTags}=require('./media-hash');
// Inspect frame rates rather than treating average bitrate as a CBR/VBR flag.
function inspect(buffer){
 const b=trimTags(buffer);let p=0,frames=0,total=0,samples=0,sampleRate,declared;const rates=new Set();
 while(p+4<=b.length){const a=b[p+1],c=b[p+2],d=b[p+3];if(b[p]!==255||(a&224)!==224)break;
  const version=(a>>3)&3,layer=(a>>1)&3,index=c>>4,frequency=(c>>2)&3;if(version===1||!layer||!index||index===15||frequency===3)break;
  const v1=version===3,rate=[44100,48000,32000][frequency]/(v1?1:version===2?2:4);
  const tables=v1?{3:[32,64,96,128,160,192,224,256,288,320,352,384,416,448],2:[32,48,56,64,80,96,112,128,160,192,224,256,320,384],1:[32,40,48,56,64,80,96,112,128,160,192,224,256,320]}:{3:[32,48,56,64,80,96,112,128,144,160,176,192,224,256],2:[8,16,24,32,40,48,56,64,80,96,112,128,144,160],1:[8,16,24,32,40,48,56,64,80,96,112,128,144,160]};
  const kbps=tables[layer][index-1],padding=(c>>1)&1,n=layer===3?Math.floor(12000*kbps/rate+padding)*4:Math.floor((layer===1&&!v1?72000:144000)*kbps/rate)+padding;
  if(p+n>b.length)break;if(sampleRate&&sampleRate!==rate)return null;sampleRate=rate;
  let header=false;
  if(frames===0&&layer===1){const side=v1?((d>>6)===3?17:32):((d>>6)===3?9:17),at=p+4+((a&1)?0:2)+side,kind=b.toString('ascii',at,at+4);
   if(kind==='Xing'||kind==='Info'){declared=kind==='Info'?'CBR':'VBR';header=true;
    const flags=b.readUInt32BE(at+4);let next=at+8;if(flags&1)next+=4;if(flags&2)next+=4;if(flags&4)next+=100;if(flags&8)next+=4;
    if(next+10<=p+n&&b.toString('ascii',next,next+4)==='LAME'){const method=b[next+9]&15;if(method===1||method===8)declared='CBR';else if(method===2||method===9)declared='ABR';else if(method>=3&&method<=6)declared='VBR';}
   }else if(b.toString('ascii',p+36,p+40)==='VBRI'){declared='VBR';header=true;}
  }
  if(!header){rates.add(kbps);total+=n;samples+=layer===3?384:layer===1&&!v1?576:1152;}
  frames++;p+=n;
 }
 if(frames<2||p!==b.length||!samples)return null;
 return{bitrateMode:declared||(rates.size===1?'CBR':'VBR'),bitrate:total*8/(samples/sampleRate),bitrateSource:'MPEG audio frames',mpegFrames:frames};
}
module.exports={inspect};
