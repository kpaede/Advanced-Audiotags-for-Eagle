'use strict';
const fs=require('fs').promises;
const path=require('path');
const codec=require('./tag-codec');
const asf=require('./asf-tags');
const rules=require('./tag-rules');
const properties=require('./audio-properties');
const {payloadHash}=require('./media-hash');
const {LEGACY,EXTENSIONS,ALIASES}=require('./formats');
const vendor=require('../vendor/taglib.cjs');
let instance;
function taglib(){return instance||(instance=fs.readFile(path.join(__dirname,'../vendor/taglib.wasm')).then(vendor.initialize));}
const standard=new Set('TITLE ARTIST ALBUM ALBUMARTIST DATE YEAR TRACKNUMBER TRACKTOTAL DISCNUMBER DISCTOTAL GENRE COMMENT LYRICS COMPOSER COPYRIGHT BPM ISRC PUBLISHER ENCODEDBY ENCODERSETTINGS'.split(' '));
function mappedEntry(key,value,index){return{key,label:key,mode:'utf8',value,bytes:Buffer.from(value),originalKey:key,originalIndex:index,standard:standard.has(key.toUpperCase())};}
async function read(bytes,ext){
 ext=ext.toLowerCase().replace(/^\./,'');if(!EXTENSIONS.includes(ext))throw new Error('Unsupported audio extension: '+ext);
 ext=ALIASES[ext]||ext;
 let doc,file,tagProps,parsed,wires={},pictures=[];
 try{
  if(LEGACY.includes(ext))doc=codec.parse(bytes,ext);
  if(!LEGACY.includes(ext)){
   try{file=await(await taglib()).open(new Uint8Array(bytes),{partial:false});tagProps=file.audioProperties();if(!doc){wires=vendor.getWireProperties(file);pictures=file.getPictures();}}
   catch(error){tagProps=undefined;}
  }
  try{parsed=await properties.inspect(bytes,ext,tagProps);}catch(error){parsed={format:{},native:{},quality:{warnings:[{message:error.message}]}};}
  if(!doc){
   const reportedFormat=file?.getFormat();
   const format=(reportedFormat&&reportedFormat!=='unknown'?reportedFormat:parsed.format.container)||ext.toUpperCase();
   if(!file&&!parsed.format.codec)throw new Error('No supported audio stream was found in this file.');
   let audioHash;try{audioHash=payloadHash(bytes,ext);}catch{audioHash=null;}
   const entries=Object.entries(wires).flatMap(([key,values])=>values.map((value,index)=>mappedEntry(key,value,index)));
   pictures.forEach((p,index)=>entries.push({key:'PICTURE',label:'Cover '+(index+1),mode:'hex',value:Buffer.from(p.data).toString('hex'),bytes:Buffer.from(p.data),image:Buffer.from(p.data),mime:p.mimeType,description:p.description||'',pictureType:p.type,pictureIndex:index,taglibPicture:true}));
   const section={type:'propertymap',format,vorbis:bytes.toString('ascii',0,4)==='OggS',name:format+' metadata',entries};
   if(ext==='shn')section.locked='Shorten is available for inspection only; the bundled writer cannot save it.';
   if(!file)section.locked='This container is available for inspection only; the bundled writer does not support it.';
   if(!audioHash)section.locked='Audio payload boundaries are not available for this container. Viewing and export are supported; writing is disabled.';
   doc={buffer:bytes,ext,audioHash,sections:[section],backend:'taglib',wireProperties:wires,pictures};
   if(['wma','asf'].includes(ext)){doc.asf=asf.parse(bytes);section.entries=doc.asf.entries;doc.backend='asf';section.format='ASF';section.name='ASF attributes';}
   if(!file)for(const [container,records] of Object.entries(parsed.native||{}))for(const record of records)section.entries.push({key:record.id,label:record.id,value:typeof record.value==='string'?record.value:JSON.stringify(record.value),bytes:Buffer.alloc(0),mode:'utf8',readonly:true,reason:section.locked});
  }
  doc.canAddCover=!doc.backend||(['OGG','MP4'].includes(doc.sections[0].format));
  doc.technical=parsed.format;
  if(!doc.technical.codec && tagProps && !doc.technical.sampleRate) doc.technical = {
    container:tagProps.containerFormat, codec:tagProps.codec==='unknown'?ext.toUpperCase():tagProps.codec, lossless:['tta','ape','wv','shn','dsf','dff'].includes(ext)?true:tagProps.isLossless,
    sampleRate:tagProps.sampleRate, numberOfChannels:tagProps.channels,
    duration:(tagProps.durationMs ?? tagProps.duration*1000)/1000,
    bitrate:tagProps.bitrate*1000, bitsPerSample:tagProps.isLossless ? tagProps.bitsPerSample : undefined,
    bitrateMode:tagProps.bitrateMode || (tagProps.isLossless ? 'Variable (lossless)' : undefined)
  };
  if(tagProps&&(!doc.technical.bitrateMode)&&tagProps.bitrateMode)doc.technical.bitrateMode=tagProps.bitrateMode;
  doc.warnings=(parsed.quality?.warnings||[]).map(w=>w.message||String(w));
  doc.nativeTags=parsed.native||{};
  return doc;
 }finally{if(file)file.dispose();}
}
async function serialize(doc){
 if(!doc.backend)return codec.serialize(doc);
 if(doc.backend==='asf'){if(!codec.changed(doc.sections[0]))return doc.buffer;if(doc.sections[0].locked)throw new Error(doc.sections[0].locked);if(doc.asf.entries.some(e=>e.readonly&&(e.changed||e.deleted)))throw new Error('A protected ASF attribute was modified.');const out=asf.serialize(doc.buffer,doc.asf);if(payloadHash(out,doc.ext)!==doc.audioHash)throw new Error('ASF audio payload verification failed.');return out;}
 const section=doc.sections[0];if(!codec.changed(section))return doc.buffer;
 if(section.locked)throw new Error(section.locked);
 const map=Object.create(null);
 for(const e of section.entries){
  if(e.deleted||e.taglibPicture)continue;
  if(e.readonly&&e.changed)throw new Error('A protected field was modified.');
  const values=e.value.split('\0');map[e.key]=(map[e.key]||[]).concat(values);
 }
 const file=await(await taglib()).open(new Uint8Array(doc.buffer),{partial:false});let out;
 try{
  vendor.setWireProperties(file,map);
  if(section.entries.some(e=>e.taglibPicture&&(e.changed||e.deleted||e.added))){file.setPictures(section.entries.filter(e=>e.taglibPicture&&!e.deleted).map(e=>({data:new Uint8Array(e.image),mimeType:e.mime,type:e.pictureType??'FrontCover',description:e.description||''})));}
  if(!file.save())throw new Error('TagLib could not save this container.');out=Buffer.from(file.getFileBuffer());
 }finally{file.dispose();}
 const updated=await read(out,doc.ext);
 if(!doc.audioHash||updated.audioHash!==doc.audioHash)throw new Error('Audio payload verification failed. The original file was not replaced.');
 const wantedPictures=section.entries.filter(e=>e.taglibPicture&&!e.deleted);
 if(wantedPictures.length!==updated.pictures.length||wantedPictures.some((e,i)=>!e.image.equals(Buffer.from(updated.pictures[i].data))||e.mime!==updated.pictures[i].mimeType))throw new Error('This container did not preserve the requested cover images. Saving was aborted.');
 const actual=updated.wireProperties;
 for(const key of new Set([...Object.keys(doc.wireProperties),...Object.keys(map)])){
  const expected=map[key]||[],found=actual[key]||actual[Object.keys(actual).find(k=>k.toUpperCase()===key.toUpperCase())]||[];
  if(JSON.stringify(found)!==JSON.stringify(expected))throw new Error(`This container did not preserve the requested values for ${key}. Saving was aborted.`);
 }
 return out;
}
function validateMappedName(s,name){
 if(!name||name.includes('\0'))throw new Error('Field names must be nonempty and cannot contain NUL.');
 if(s.vorbis||['OGG','OPUS','SPX','FLAC'].includes(s.format))rules.validateVorbisName(name);
 else if(['APE','WV','MPC'].includes(s.format))rules.validateAPEName(name);
}
function add(doc,name,value){if(doc.backend==='asf')return asf.add(doc.asf,name,value);const s=doc.sections[0];if(s.locked)throw new Error(s.locked);validateMappedName(s,name);const e=mappedEntry(name,value,0);e.changed=true;e.added=true;s.entries.push(e);return e;}
function rename(doc,e,name){const s=doc.sections[0];if(s.locked||e.readonly||e.standard||e.taglibPicture)throw new Error('This field name is fixed or read-only.');validateMappedName(s,name);
 if(s.entries.some(x=>x!==e&&!x.deleted&&x.key.toUpperCase()===name.toUpperCase()&&x.key!==e.key))throw new Error('A field with this name already exists.');
 const old=e.key;for(const entry of s.entries)if(!entry.taglibPicture&&entry.key===old){entry.key=name;entry.label=name;entry.changed=true;}return e;}
function addCover(doc,bytes,mime){if(!doc.canAddCover)throw new Error('Adding cover images is not supported by this container writer. Existing images are preserved.');if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Unsupported cover image type.');if(doc.sections[0].format==='MP4'&&mime==='image/webp')throw new Error('MP4 cover art requires PNG or JPEG.');const s=doc.sections[0];if(s.locked)throw new Error(s.locked);const e={key:'PICTURE',label:'Cover',mode:'hex',bytes,value:bytes.toString('hex'),image:bytes,mime,pictureType:'FrontCover',description:'',taglibPicture:true,changed:true,added:true};s.entries.push(e);return e;}
module.exports={read,serialize,add,rename,addCover,taglib};
