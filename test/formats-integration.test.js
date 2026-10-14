'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs').promises,os=require('os'),path=require('path');
const {execFileSync}=require('child_process');
const backend=require('../lib/audio-backend'),codec=require('../lib/tag-codec');
const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH;
const run=(exe,args)=>execFileSync(exe,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const cases=[
 ['mp3','libmp3lame','mp3'],['mp2','mp2','mp2'],['flac','flac','flac'],['ogg','libvorbis','ogg'],['opus','libopus','opus'],['spx','libspeex','ogg'],['oga','flac','ogg'],
 ['wav','pcm_s24le','wav'],['aiff','pcm_s24be','aiff'],['m4a','aac','ipod'],['alac.m4a','alac','ipod'],['wma','wmav2','asf'],['wv','wavpack','wv'],['tta','tta','tta'],
 ['aac','aac','adts'],['ac3','ac3','ac3'],['eac3','eac3','eac3'],['mka','libopus','matroska'],['webm','libopus','webm']
];
for(const [extension,encoder,muxer] of cases)test(`${extension}: custom rename, independent metadata read and decoded PCM preservation`,{skip:!ffmpeg||!ffprobe},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-format-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source.'+extension),target=path.join(dir,'edited.'+extension),ext=extension.split('.').pop();
 run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.25','-c:a',encoder,'-f',muxer,source]);
 const doc=await backend.read(await fs.readFile(source),ext);assert.equal(doc.sections.some(s=>s.locked),false);
 if(ext==='wma'){const custom=codec.add(doc,'WM/CustomNote','Custom namespace');codec.rename(doc,custom,'RENAMED_ASF_NOTE');}
 const e=codec.add(doc,'RECORDING_SESSION','Room A 日本');codec.rename(doc,e,'MICROPHONE');
 const out=await backend.serialize(doc);await fs.writeFile(target,out);
 const actual=await backend.read(out,ext),field=actual.sections.flatMap(s=>s.entries).find(e=>e.key==='MICROPHONE'||e.description==='MICROPHONE');assert.equal(field?.value,'Room A 日本');
 if(ext==='wma')assert.equal(actual.sections[0].entries.find(e=>e.key==='RENAMED_ASF_NOTE')?.value,'Custom namespace');
 const parsed=JSON.parse(run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',target]));assert.ok(parsed.streams.some(s=>s.codec_type==='audio'));
 // A second decoder verifies that headers, packets, ordering and decoded samples still agree.
 const md5=f=>run(ffmpeg,['-v','error','-i',f,'-map','0:a:0','-f','md5','-']);assert.equal(md5(target),md5(source));
 assert.equal(doc.technical.numberOfChannels,1);assert.ok(doc.technical.sampleRate>0);assert.ok(doc.technical.bitrate>0);assert.ok(doc.technical.duration>0);
 if(['wav','aiff'].includes(ext))assert.equal(doc.technical.bitsPerSample,24);
 if(encoder==='aac')assert.equal(doc.technical.bitsPerSample,undefined);
 // Remove the newly renamed custom field and verify the container again.
 field.deleted=true;const removed=await backend.read(await backend.serialize(actual),ext);assert.ok(!removed.sections.flatMap(s=>s.entries).some(e=>e.key==='MICROPHONE'||e.description==='MICROPHONE'));
});
test('CAF is inspectable and explicitly read-only with this writer',{skip:!ffmpeg},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-caf-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const source=path.join(dir,'audio.caf');
 run(ffmpeg,['-v','error','-f','lavfi','-i','sine=duration=0.2','-c:a','pcm_s24le',source]);
 const doc=await backend.read(await fs.readFile(source),'caf');assert.ok(doc.sections[0].locked);assert.equal(doc.technical.bitsPerSample,24);assert.throws(()=>codec.add(doc,'CUSTOM','value'),/inspection only/);
});
test('MP3 bitrate mode distinguishes CBR and VBR',{skip:!ffmpeg},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-bitrate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const [mode,options] of [['CBR',['-b:a','128k']],['VBR',['-q:a','2']]]){
  const source=path.join(dir,mode+'.mp3');run(ffmpeg,['-v','error','-f','lavfi','-i','sine=duration=1','-c:a','libmp3lame',...options,source]);const doc=await backend.read(await fs.readFile(source),'mp3');assert.equal(doc.technical.bitrateMode,mode);
 }
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yfN0AAAAASUVORK5CYII=','base64');
for(const [ext,encoder,muxer] of [['mp3','libmp3lame','mp3'],['flac','flac','flac'],['ogg','libvorbis','ogg'],['m4a','aac','ipod']])test(`${ext}: supported cover writer stores the exact image`,{skip:!ffmpeg},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-cover-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const source=path.join(dir,'audio.'+ext);
 run(ffmpeg,['-v','error','-f','lavfi','-i','sine=duration=0.2','-c:a',encoder,'-f',muxer,source]);const doc=await backend.read(await fs.readFile(source),ext);
 codec.addCover(doc,png,'image/png',{width:1,height:1});const out=await backend.read(await backend.serialize(doc),ext),pic=out.sections.flatMap(s=>s.entries).find(e=>e.image);assert.ok(pic.image.equals(png));assert.equal(pic.pictureType,doc.backend?'FrontCover':3);
});
test('Dolby 5.1 channels and sample rate come from the frame header',{skip:!ffmpeg},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audiotags-surround-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const ext of ['ac3','eac3']){const source=path.join(dir,'surround.'+ext);run(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=sample_rate=48000:channel_layout=5.1','-t','0.2','-c:a',ext,'-b:a','448k',source]);const doc=await backend.read(await fs.readFile(source),ext);assert.equal(doc.technical.numberOfChannels,6);assert.equal(doc.technical.sampleRate,48000);assert.equal(doc.technical.bitrateMode,'CBR');}
});
