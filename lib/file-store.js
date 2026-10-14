'use strict';
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const backend = require('./backend-client');
const MAX_BYTES = 512 * 1024 * 1024;
const hash = b => createHash('sha256').update(b).digest('hex');
const backupPrefix = item => hash(Buffer.from(path.resolve(item.filePath))).slice(0, 24) + '-';
async function read(file) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_BYTES) throw new Error('Files larger than 512 MB cannot be edited in this version.');
  return fs.readFile(file);
}
async function load(item) {
  const bytes = await read(item.filePath);
  return { doc: await backend.read(bytes, item.ext), sourceHash: hash(bytes) };
}
async function assertCurrent(item, expected) {
  if (hash(await read(item.filePath)) !== expected) throw new Error('The file has changed externally. Reload it before saving.');
}
async function latestBackup(item, directory) {
  let files; try { files = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const names = files.filter(x => x.startsWith(backupPrefix(item)) && x.endsWith('.' + item.ext.toLowerCase())).sort();
  return names.length ? path.join(directory, names[names.length - 1]) : null;
}
async function replace(item, bytes, expected, directory) {
  if (typeof item.replaceFile !== 'function') throw new Error('This Eagle version does not support item.replaceFile(). Please update Eagle.');
  await assertCurrent(item, expected);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'advanced-audiotags-'));
  try {
    const prepared = path.join(temp, 'audio.' + item.ext.toLowerCase());
    await fs.writeFile(prepared, bytes, { flag: 'wx' });
    if (hash(await read(prepared)) !== hash(bytes)) throw new Error('Temporary file verification failed.');
    await fs.mkdir(directory, { recursive: true });
    const backup = path.join(directory, backupPrefix(item) + new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomBytes(3).toString('hex') + '.' + item.ext.toLowerCase());
    await fs.copyFile(item.filePath, backup, require('fs').constants.COPYFILE_EXCL);
    if (hash(await read(backup)) !== expected) throw new Error('The file changed while its backup was being created. Please reload.');
    await assertCurrent(item, expected);
    const success = await item.replaceFile(prepared);
    if (success === false) throw new Error('Eagle could not replace the file. The backup has been retained.');
    if (hash(await read(item.filePath)) !== hash(bytes)) throw new Error('Eagle did not confirm the saved file. Backup location: ' + backup);
    return { backup, ...(await load(item)) };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
async function save(item, doc, sourceHash, directory) { return replace(item, await backend.serialize(doc), sourceHash, directory); }
async function restore(item, doc, sourceHash, directory) {
  const backup = await latestBackup(item, directory);
  if (!backup) throw new Error('No backup exists for this file yet.');
  const bytes = await read(backup), parsed = await backend.read(bytes, item.ext);
  if (!parsed.audioHash || !doc.audioHash || parsed.audioHash !== doc.audioHash) throw new Error('The backup contains different audio data. Restore was aborted.');
  return replace(item, bytes, sourceHash, directory);
}
module.exports = { load, save, restore, latestBackup, hash, MAX_BYTES, configureBackend: backend.configure, closeBackend: backend.close };
