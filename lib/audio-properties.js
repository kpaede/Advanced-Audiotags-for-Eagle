'use strict';
const metadata = require('../vendor/metadata.cjs');
const mpeg=require('./mpeg-properties');
const { oggParts, trimTags } = require('./media-hash');
function readBits(b, offset, count) { let value=0;for(let i=0;i<count;i++){if(offset+i>=b.length*8)throw new Error('Truncated codec header.');value=value*2+((b[(offset+i)>>3]>>(7-((offset+i)&7)))&1);}return value; }
function ac3Properties(buffer) {
  const b=trimTags(buffer),rates=new Set();let p=0,samples=0,frames=0,first;
  const bitrates=[32,40,48,56,64,80,96,112,128,160,192,224,256,320,384,448,512,576,640];
  const words441=[69,87,104,121,139,174,208,243,278,348,417,487,557,696,835,975,1114,1253,1393];
  while(p+7<=b.length&&b[p]===11&&b[p+1]===119) {
    const bsid=b[p+5]>>3;let rate,size,bitrate,mode,lfe,blocks=6;
    if(bsid<=10){const fs=b[p+4]>>6,code=b[p+4]&63,index=code>>1,shift=Math.max(0,bsid-8);if(fs>2||index>=bitrates.length)break;
      rate=[48000,44100,32000][fs]/2**shift;bitrate=bitrates[index]*1000/2**shift;
      size=fs===0?bitrates[index]*4:fs===2?bitrates[index]*6:(words441[index]+(code&1))*2;
      mode=b[p+6]>>5;let cursor=(p+6)*8+3;if((mode&1)&&mode!==1)cursor+=2;if(mode&4)cursor+=2;if(mode===2)cursor+=2;lfe=readBits(b,cursor,1);
    }else if(bsid<=16){const fs=b[p+4]>>6;size=((((b[p+2]&7)<<8)|b[p+3])+1)*2;
      if(fs===3)rate=[24000,22050,16000][(b[p+4]>>4)&3];else{rate=[48000,44100,32000][fs];blocks=[1,2,3,6][(b[p+4]>>4)&3];}
      mode=(b[p+4]>>1)&7;lfe=b[p+4]&1;bitrate=size*8*rate/(blocks*256);
    }else break;
    if(!rate||p+size>b.length)break;
    if(!first)first={codec:bsid>10?'E-AC-3':'AC-3',container:'Raw Dolby audio',sampleRate:rate,numberOfChannels:[2,1,2,3,3,4,4,5][mode]+lfe,channelLayout:['Dual mono','Mono','Stereo','3/0','2/1','3/1','2/2','3/2'][mode]+(lfe?' + LFE':''),lossless:false,codecProfile:'Bitstream ID '+bsid};
    if(first.sampleRate!==rate)throw new Error('Changing AC3 sample rate is not supported.');
    rates.add(Math.round(bitrate/1000));samples+=blocks*256;frames++;p+=size;
  }
  if(!first||!frames)throw new Error('No complete AC3/E-AC3 frames found.');
  return {...first,duration:samples/first.sampleRate,bitrate:p*8/(samples/first.sampleRate),bitrateMode:rates.size===1?'CBR':'VBR',numberOfSamples:samples,frames,scanComplete:p===b.length};
}
function aacSpecificConfig(b) {
  let result;
  function descriptors(start,end,depth=0){if(depth>5)return;let p=start;while(p+2<=end){const tag=b[p++];let n=0,x,count=0;do{if(p>=end||count++===4)return;x=b[p++];n=n*128+(x&127);}while(x&128);if(p+n>end)return;
    if(tag===5&&n>=2){let bit=p*8;const type=readBits(b,bit,5);bit+=5;if(type===31)bit+=6;let frequency=readBits(b,bit,4);bit+=4;
      let rate;if(frequency===15){rate=readBits(b,bit,24);bit+=24;}else rate=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][frequency];
      const channels=readBits(b,bit,4);result={sampleRate:rate,channels:[null,1,2,3,4,5,6,8][channels],audioObjectType:type};return;
    }
    if(tag===3&&n>=3){let at=p+3,flags=b[p+2];if(flags&128)at+=2;if(flags&64)at+=1+b[at];if(flags&32)at+=2;descriptors(at,p+n,depth+1);}
    else if(tag===4&&n>=13)descriptors(p+13,p+n,depth+1);p+=n;
  }}
  function atoms(start,end,depth=0){if(depth>12)return;let p=start;while(p+8<=end){let n=b.readUInt32BE(p),h=8;const id=b.toString('latin1',p+4,p+8);if(n===1){if(p+16>end)return;n=b.readUInt32BE(p+8)*4294967296+b.readUInt32BE(p+12);h=16;}if(n===0)n=end-p;if(n<h||p+n>end)return;
    if(['moov','trak','mdia','minf','stbl','wave'].includes(id))atoms(p+h,p+n,depth+1);
    else if(id==='stsd'&&n>=16){let at=p+16;while(at+36<=p+n){const length=b.readUInt32BE(at),kind=b.toString('latin1',at+4,at+8);if(length<36||at+length>p+n)break;if(['mp4a','enca'].includes(kind)){const version=b.readUInt16BE(at+16);atoms(at+(version===1?52:version===2?72:36),at+length,depth+1);}at+=length;}}
    else if(id==='esds')descriptors(p+h+4,p+n);p+=n;
  }}
  atoms(0,b.length);return result;
}
async function inspect(buffer,ext,taglibProperties) {
  if(['ac3','eac3','ec3'].includes(ext))return {format:ac3Properties(buffer),native:{},quality:{warnings:[]}};
  if(['ape','mpc','wv','tta','shn'].includes(ext)&&buffer.toString('ascii',0,3)==='ID3'){const n=[...buffer.subarray(6,10)].reduce((v,x)=>v*128+(x&127),0);const end=10+n+(buffer[3]===4&&(buffer[5]&16)?10:0);if(end<buffer.length)buffer=buffer.subarray(end);}
  const result=await metadata.parseBuffer(new Uint8Array(buffer),{path:'audio.'+ext,size:buffer.length},{duration:true,skipCovers:true});
  const format=result.format;
  if(typeof format.numberOfSamples==='bigint')format.numberOfSamples=Number(format.numberOfSamples);
  if(format.container==='DSF')format.codec='DSD (not compressed)';
  if(format.container?.startsWith('Musepack'))format.codec='Musepack '+format.container.split(', ')[1];
  if(ext==='shn'){format.codec='Shorten';format.lossless=true;}
  if(format.lossless === undefined && taglibProperties) format.lossless = taglibProperties.isLossless;
  if(format.container === 'WavPack') format.codec = 'WavPack';
  if(format.codec === 'Opus') {
    const audio = format.trackInfo?.find(t => t.type === 2);
    if(audio?.bitrate) format.bitrate = audio.bitrate;
  }
  if(/AAC/i.test(format.codec||'')&&buffer.toString('ascii',4,8)==='ftyp'){
    const config=aacSpecificConfig(buffer);if(config?.channels)format.numberOfChannels=config.channels;
    if(config?.sampleRate&&config.audioObjectType!==5&&config.audioObjectType!==29)format.sampleRate=config.sampleRate;
  }
  const reported=ext==='aac'?undefined:taglibProperties?.bitrateMode;
  if(reported)format.bitrateMode=reported;
  else if(/CBR|VBR|ABR/.test(format.codecProfile||''))format.bitrateMode=format.codecProfile.match(/CBR|VBR|ABR/)[0];
  else if(format.lossless)format.bitrateMode=/^PCM|^IEEE|^DSD/i.test(format.codec||'')?(format.codec.startsWith('DSD')?'CBR (DSD)':'CBR (PCM)'):'Variable (lossless)';
  if(['mp3','mp2'].includes(ext)){const frameInfo=mpeg.inspect(buffer);if(frameInfo)Object.assign(format,frameInfo);}
  if(!(format.bitrate>0)&&taglibProperties?.bitrate>0){format.bitrate=taglibProperties.bitrate*1000;format.bitrateSource='Container audio properties';}
  if(!(format.bitrate>0)&&format.duration>0){
    if(buffer.toString('ascii',0,4)==='OggS'&&format.codec==='FLAC'){const packets=oggParts(buffer);let size=0;for(let i=1;i<packets.length;i+=2)if(packets[i][0]===255)size+=packets[i].length;if(size){format.bitrate=size*8/format.duration;format.bitrateSource='Encoded FLAC packets / duration';}}
    else {format.bitrate=buffer.length*8/format.duration;format.bitrateSource='Estimated from file size / duration (includes container and metadata overhead)';}
  }
  // Sample precision in a lossy container is not the original recording's PCM bit depth.
  if(format.lossless===false)delete format.bitsPerSample;
  return result;
}
module.exports={inspect,ac3Properties,aacSpecificConfig};
