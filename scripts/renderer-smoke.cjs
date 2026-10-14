'use strict';
// Exercise the actual inspector/file store in a real Electron renderer. Eagle's
// executable runs the backend subprocess; only the Eagle selection API is mocked.
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const runtime=process.env.ELECTRON_TEST_PATH,fixtures=process.env.AUDIO_TEST_FIXTURES;
if(!runtime||!fixtures)throw new Error('Set ELECTRON_TEST_PATH and AUDIO_TEST_FIXTURES.');
const root=path.resolve(process.env.PLUGIN_TEST_ROOT||path.join(__dirname,'..')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'audiotags-renderer-'));
const options={root,temp,fixtures,execPath:process.env.EAGLE_EXEC_PATH||'/Applications/Eagle.app/Contents/MacOS/Eagle'};
fs.writeFileSync(path.join(temp,'options.json'),JSON.stringify(options));
fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'audiotags-renderer-test',main:'main.cjs'}));
fs.writeFileSync(path.join(temp,'main.cjs'),`
const {app,BrowserWindow,ipcMain}=require('electron'),path=require('path');
const options=require('./options.json');let win;
app.whenReady().then(()=>{win=new BrowserWindow({show:false,width:360,height:700,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,preload:path.join(__dirname,'preload.cjs')}});win.loadFile(path.join(options.root,'inspector/index.html'),{query:{theme:'gray'}});});
ipcMain.on('result',(_,result)=>{console.log(JSON.stringify(result));app.exit(result.ok?0:1);});
setTimeout(()=>{console.error('Renderer test timed out');app.exit(1);},30000).unref();
`);
fs.writeFileSync(path.join(temp,'preload.cjs'),`
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{ipcRenderer}=require('electron');
const options=require('./options.json');let selected,onShow;let workerError;
try{const w=new(require('worker_threads').Worker)('0',{eval:true});w.terminate();workerError='Worker construction available in test runtime';}catch(e){workerError=e.message;}
window.eagle={app:{theme:'GRAY',getPath:async name=>name==='exe'?options.execPath:options.temp},item:{getSelected:async()=>selected?[selected]:[]},onPluginCreate:cb=>setTimeout(()=>cb({path:options.root}),0),onPluginShow:cb=>{onShow=cb;},onThemeChanged:()=>{},onLibraryChanged:()=>{},dialog:{showMessageBox:async()=>({response:0})}};
const pause=()=>new Promise(r=>setTimeout(r,30));
async function until(test){for(let i=0;i<400;i++){if(test())return;await pause();}throw new Error('UI timeout: '+document.getElementById('status')?.textContent);}
function input(el,value){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
window.addEventListener('DOMContentLoaded',async()=>{try{
 await until(()=>onShow&&document.getElementById('status').textContent==='No supported audio file selected.');
 const backend=require(path.join(options.root,'lib/backend-client'));let count=0;
 for(const ext of ['flac','ogg','m4a']){
  const filePath=path.join(options.temp,'sample.'+ext);fs.copyFileSync(path.join(options.fixtures,'sample.'+ext),filePath);
  selected={id:'renderer-'+ext,name:'sample',ext,filePath,replaceFile:async source=>{await fs.promises.copyFile(source,filePath);return true;}};onShow();
  await until(()=>document.getElementById('filename').textContent==='sample.'+ext&&document.querySelectorAll('.row').length>0&&!document.getElementById('reload').disabled);
  const original=await backend.read(fs.readFileSync(filePath),ext);
  document.getElementById('tools-toggle').click();document.getElementById('add').click();input(document.getElementById('new-key'),'RENDERER_TEST');input(document.getElementById('new-value'),'Value 日本');document.getElementById('confirm-add').click();
  await until(()=>Array.from(document.querySelectorAll('.name-editor')).some(el=>el.value==='RENDERER_TEST'));
  const name=Array.from(document.querySelectorAll('.name-editor')).find(el=>el.value==='RENDERER_TEST');name.value='RENDERER_RENAMED';name.dispatchEvent(new Event('change',{bubbles:true}));
  assert.equal(document.getElementById('save').disabled,false);document.getElementById('save').click();
  await until(()=>document.getElementById('status').textContent.startsWith('Saved'));
  const actual=await backend.read(fs.readFileSync(filePath),ext),field=actual.sections.flatMap(s=>s.entries).find(e=>e.key==='RENDERER_RENAMED');assert.equal(field?.value,'Value 日本');assert.equal(actual.audioHash,original.audioHash);count++;
 }
 backend.close();ipcRenderer.send('result',{ok:true,renderer:process.type,electron:process.versions.electron,workerError,verifiedUIWrites:count});
}catch(error){ipcRenderer.send('result',{ok:false,error:error.message,stack:error.stack,workerError});}});
`);
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const output=execFileSync(runtime,[temp,'--disable-gpu','--user-data-dir='+path.join(temp,'profile')],{encoding:'utf8',env,timeout:40000,stdio:['ignore','pipe','pipe']});
 const line=output.split('\n').find(s=>s.startsWith('{"ok":'));if(!line)throw new Error('Renderer produced no result.');const result=JSON.parse(line);if(!result.ok)throw new Error(result.error);console.log(JSON.stringify(result));
}catch(error){if(error.stdout)process.stderr.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);throw error;}
finally{fs.rmSync(temp,{recursive:true,force:true});}
