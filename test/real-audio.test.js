'use strict';
// Optional interoperability checks using independently encoded audio and FFprobe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const codec = require('../lib/tag-codec');
const ffmpeg = process.env.FFMPEG_PATH, ffprobe = process.env.FFPROBE_PATH;
const skip = !ffmpeg || !ffprobe;
const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
for (const ext of ['mp3', 'flac', 'ac3']) test(`real ${ext}: edited tags are interoperable and decoded audio is identical`, { skip }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audiotags-real-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.' + ext), target = path.join(dir, 'edited.' + ext);
  const args = ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', { mp3: 'libmp3lame', flac: 'flac', ac3: 'ac3' }[ext]];
  if (ext !== 'ac3') args.push('-metadata', 'title=Original', '-metadata', 'artist=Test Artist', '-metadata', 'X_CUSTOM=Initial');
  args.push(source); run(ffmpeg, args);
  const doc = codec.parse(await fs.readFile(source), ext);
  const title = doc.sections.flatMap(x => x.entries).find(e => e.key === 'TIT2' || e.key.toUpperCase() === 'TITLE');
  if (title) codec.set(title, 'Grüße 日本'); else codec.add(doc, 'TIT2', 'Grüße 日本');
  codec.add(doc, ext === 'flac' ? 'MY_CUSTOM_FIELD' : 'TXXX', 'arbitrary metadata');
  await fs.writeFile(target, codec.serialize(doc));
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', target]));
  const tags = { ...probe.format.tags, ...probe.streams[0].tags };
  if (ext !== 'ac3') assert.equal(tags.title || tags.TITLE, 'Grüße 日本');
  // Raw AC3 demuxers may ignore tags. Still require playback and exact decoded PCM.
  const decode = file => run(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', '-']);
  assert.equal(decode(target), decode(source));
});
