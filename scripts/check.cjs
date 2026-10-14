'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
for(const dir of ['lib','inspector','scripts','test'])for(const file of fs.readdirSync(path.join(root,dir)))if(/\.(?:js|cjs|mjs)$/.test(file))execFileSync(process.execPath,['--check',path.join(root,dir,file)],{stdio:'inherit'});
const manifest=require('../manifest.json'),pkg=require('../package.json'),{EXTENSIONS}=require('../lib/formats');
assert.equal(manifest.version,pkg.version);assert.deepEqual(Object.keys(manifest.preview)[0].split(','),EXTENSIONS);
console.log('Source syntax, manifest formats and release versions agree.');
