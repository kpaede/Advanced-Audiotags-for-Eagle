'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const store = require('../lib/file-store');
const codec = require('../lib/tag-codec');
const audio = Buffer.from([255, 251, 144, 0, 33, 44]);
async function fixture(t, replacement) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiotags-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'sample.mp3'); await fs.writeFile(filePath, audio);
  const item = { id: 'test', name: 'sample', ext: 'mp3', filePath, replaceFile: replacement || (async source => { await fs.copyFile(source, filePath); return true; }) };
  return { item, directory: path.join(root, 'backups') };
}
test('save creates exact backup, replaces through Eagle and restore is reversible', async t => {
  const { item, directory } = await fixture(t); const loaded = await store.load(item); codec.add(loaded.doc, 'TIT2', 'Saved');
  const saved = await store.save(item, loaded.doc, loaded.sourceHash, directory);
  assert.deepEqual(await fs.readFile(saved.backup), audio); assert.equal(saved.doc.sections[0].entries[0].value, 'Saved');
  const edited = await fs.readFile(item.filePath);
  const restored = await store.restore(item, saved.doc, saved.sourceHash, directory);
  assert.deepEqual(await fs.readFile(item.filePath), audio); assert.deepEqual(await fs.readFile(restored.backup), edited);
  const redone = await store.restore(item, restored.doc, restored.sourceHash, directory);
  assert.equal(redone.doc.sections[0].entries[0].value, 'Saved');
});
test('concurrent file changes prevent replacement and no backup is made', async t => {
  let calls = 0; const { item, directory } = await fixture(t, async () => { calls++; return true; });
  const loaded = await store.load(item); codec.add(loaded.doc, 'TIT2', 'new');
  await fs.appendFile(item.filePath, Buffer.from([99]));
  await assert.rejects(store.save(item, loaded.doc, loaded.sourceHash, directory), /changed externally/); assert.equal(calls, 0);
  assert.equal(await store.latestBackup(item, directory), null);
});
test('Eagle replacement failure keeps original and recoverable backup', async t => {
  const { item, directory } = await fixture(t, async () => false); const loaded = await store.load(item); codec.add(loaded.doc, 'TIT2', 'new');
  await assert.rejects(store.save(item, loaded.doc, loaded.sourceHash, directory), /could not replace/);
  assert.deepEqual(await fs.readFile(item.filePath), audio); assert.deepEqual(await fs.readFile(await store.latestBackup(item, directory)), audio);
});
test('invalid metadata never reaches Eagle replacement', async t => {
  let calls = 0; const { item, directory } = await fixture(t, async () => { calls++; return true; }); const loaded = await store.load(item);
  const field=codec.add(loaded.doc, 'XABC', '00', 'hex'); codec.set(field,'invalid hex','hex');
  await assert.rejects(store.save(item, loaded.doc, loaded.sourceHash, directory), /Hex fields/); assert.equal(calls, 0);
});
test('older Eagle without replaceFile fails before writing', async t => {
  const { item, directory } = await fixture(t); delete item.replaceFile;
  const loaded = await store.load(item); codec.add(loaded.doc, 'TIT2', 'new');
  await assert.rejects(store.save(item, loaded.doc, loaded.sourceHash, directory), /update Eagle/);
  assert.equal(await store.latestBackup(item, directory), null);
});
