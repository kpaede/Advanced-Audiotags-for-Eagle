'use strict';
// Runs the actual inspector and codec in Chrome with mocked Eagle/file APIs.
// Uses Buffer's browser implementation from the locally installed Eagle app.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const eagleAsar = process.env.EAGLE_ASAR || '/Applications/Eagle.app/Contents/Resources/app.asar';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const archive = fs.readFileSync(eagleAsar);
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
const base = 8 + archive.readUInt32LE(4);
function asarFile(name) {
  let item = tree; for (const p of name.split('/')) item = item.files[p];
  const start = base + Number(item.offset); return archive.subarray(start, start + item.size).toString();
}
const sources = Object.fromEntries(['buffer', 'base64-js', 'ieee754', 'isarray'].map(p => [p, asarFile('node_modules/' + p + '/index.js')]));
sources['./tag-rules'] = fs.readFileSync(path.join(root, 'lib/tag-rules.js'), 'utf8');
sources.codec = fs.readFileSync(path.join(root, 'lib/tag-codec.js'), 'utf8');
let bundle = 'const factories = {}; const modules = {};\n';
for (const [name, source] of Object.entries(sources)) bundle += `factories[${JSON.stringify(name)}] = function(require,module,exports) {\n${source}\n};\n`;
bundle += `
function mockRequire(name) {
  if (name === 'crypto') return { createHash: () => ({ update() { return this; }, digest() { return 'UI-only-hash'; } }) };
  if (modules[name]) return modules[name].exports;
  if (!factories[name]) throw new Error('Unknown module: ' + name);
  const module = modules[name] = { exports: {} }; factories[name](mockRequire, module, module.exports); return module.exports;
}
window.Buffer = mockRequire('buffer').Buffer;
const codecAPI = mockRequire('codec');
const fixture = codecAPI.parse(Buffer.from([255,251,144,0,33,44]), 'mp3');
codecAPI.add(fixture, 'TIT2', 'Evening Light'); codecAPI.add(fixture, 'TPE1', 'Studio Nord');
const custom = codecAPI.add(fixture, 'TXXX', 'Session 2026'); custom.description = 'Session';
codecAPI.add(fixture, 'XABC', '0102ff00', 'hex');
for (const [key, value] of [['TALB', 'Le Noise'], ['TDRC', '2010'], ['TCON', 'Rock'], ['TCOM', ''], ['TPE3', ''], ['TPE2', ''], ['TRCK', '6/12'], ['TPOS', '1/1'], ['TCOP', '℗ Studio Nord'], ['TBPM', '96'], ['TSRC', 'DEABC2600012'], ['TENC', 'LAME 3.100']]) codecAPI.add(fixture, key, value);
for (const [description, value] of [['PUBLISHER', 'Reprise'], ['RELEASE TYPE', 'Normal'], ['RIPPING TOOL', 'EAC 1.6']]) { const field = codecAPI.add(fixture, 'TXXX', value); field.description = description; }
let sourceBytes = codecAPI.serialize(fixture); let saved = false;
const selected = { id: 'ui-fixture', name: 'Evening Light', ext: 'mp3', filePath: '/test/Evening Light.mp3' };
const storeAPI = {
  configureBackend: options => { window.backendExecutable = options.execPath; }, closeBackend: () => {},
  hash: b => b.toString('hex'),
  load: async () => ({ doc: codecAPI.parse(sourceBytes, 'mp3'), sourceHash: sourceBytes.toString('hex') }),
  latestBackup: async () => saved ? '/test/backup.mp3' : null,
  save: async (item, doc) => { sourceBytes = codecAPI.serialize(doc); saved = true; return { backup: '/test/backup.mp3', ...await storeAPI.load() }; }
};
window.require = name => name === 'fs' ? { promises: {} } : name === 'path' ? { join: (...p) => p.join('/'), resolve: s => s } : name.endsWith('tag-codec.js') ? codecAPI : name.endsWith('file-store.js') ? storeAPI : name.endsWith('formats.js') ? { EXTENSIONS: ['mp3','flac','ogg','wav'] } : mockRequire(name);
window.eagle = {
  app: { theme: 'Auto', getPath: async name => name === 'exe' ? '/test/Eagle' : '/test' },
  item: { getSelected: async () => [selected] },
  onPluginCreate: callback => setTimeout(() => { window.initialURLTheme = document.documentElement.dataset.theme; callback({ path: '/plugin' }).catch(e => { window.bootError = e.message; }); }, 0),
  onThemeChanged: callback => { window.changeTheme = callback; }, onPluginShow: () => {}, onLibraryChanged: () => {},
  dialog: { showMessageBox: async () => ({ response: 0 }) }
};
`;
const assertions = `
document.documentElement.style.width = '300px';
document.documentElement.style.height = '600px';
const pause = () => new Promise(r => setTimeout(r, 40));
function assert(condition, message) { if (!condition) throw new Error(message); }
function input(el, value) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
setTimeout(async () => {
  try {
    assert(!window.bootError, window.bootError); assert(window.backendExecutable === '/test/Eagle', 'Use Eagle application executable for the metadata process'); assert(document.querySelectorAll('.row').length === 19, 'Initial tag rows');
    assert(window.initialURLTheme === 'gray', 'Native resolved gray theme applied from inspector URL');
    assert(document.documentElement.dataset.theme === 'gray', 'Eagle Auto preference must not override the resolved gray inspector theme');
    assert(getComputedStyle(document.body).backgroundColor === 'rgb(61, 62, 66)', 'Native Eagle gray inspector surface');
    assert(getComputedStyle(document.querySelector('.row textarea')).fontSize === '12px', 'Native Eagle inspector font size');
    assert(document.querySelector('.row').getBoundingClientRect().height <= 22, 'Compact single-line rows');
    assert(document.getElementById('save').disabled, 'Save starts disabled');
    input(document.querySelector('textarea[aria-label="ID3v2.4: TIT2"]'), 'New title 日本');
    assert(!document.getElementById('save').disabled, 'Editing enables save');
    document.getElementById('reload').click(); await pause();
    assert(document.querySelector('textarea[aria-label="ID3v2.4: TIT2"]').value === 'New title 日本', 'Draft restored after reload');
    const customName = document.querySelector('input[aria-label="ID3v2.4: TXXX name"]');
    assert(customName.value === 'Session', 'Custom names have no fabricated angle brackets');
    customName.value = 'Recording session'; customName.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('reload').click(); await pause();
    assert(document.querySelector('input[aria-label="ID3v2.4: TXXX name"]').value === 'Recording session', 'Custom rename survives draft replay');
    input(document.getElementById('search'), 'XABC');
    assert(Array.from(document.querySelectorAll('.row')).filter(r => !r.hidden).length === 1, 'Search filters unknown tags');
    input(document.getElementById('search'), ''); document.getElementById('add').click();
    input(document.getElementById('new-key'), 'TXXX'); input(document.getElementById('new-value'), 'Second custom value');
    document.getElementById('confirm-add').click(); await pause();
    assert(document.querySelectorAll('.row').length === 20, 'Custom tag added');
    document.getElementById('reload').click(); await pause();
    assert(document.querySelectorAll('.row').length === 20, 'Added tag survives draft replay');
    document.querySelector('.row .cell-name').click(); document.getElementById('tools-toggle').click();
    Array.from(document.querySelectorAll('#field-tools button')).find(b => b.textContent === 'Remove').click();
    assert(document.querySelector('.removed'), 'Tag deletion visible');
    document.getElementById('undo').click(); await pause();
    assert(document.querySelectorAll('.row').length === 19, 'Discard resets added and deleted fields');
    document.getElementById('tools-toggle').click();
    document.getElementById('properties-tab').click(); assert(document.querySelectorAll('.property').length >= 5, 'Properties tab');
    document.getElementById('metadata-tab').click(); assert(document.querySelectorAll('.row').length === 19, 'Metadata tab');
    for (const [theme, expected] of [['light', 'rgb(249, 249, 249)'], ['LIGHTGRAY', 'rgb(222, 223, 225)'], ['dark', 'rgb(31, 32, 35)'], ['GRAY', 'rgb(61, 62, 66)'], ['blue', 'rgb(20, 29, 54)'], ['PURPLE', 'rgb(35, 27, 42)']]) {
      window.changeTheme(theme); assert(getComputedStyle(document.body).backgroundColor === expected, 'Native Eagle theme: ' + theme);
    }
    window.changeTheme({ name: 'Light' }); assert(getComputedStyle(document.body).color === 'rgb(44, 47, 50)', 'Theme object and Eagle text color');
    window.changeTheme('Auto'); assert(document.documentElement.dataset.theme === (matchMedia('(prefers-color-scheme: dark)').matches ? 'gray' : 'light'), 'Eagle Auto uses gray in dark appearance');
    input(document.querySelector('textarea[aria-label="ID3v2.4: TIT2"]'), 'Saved title');
    document.getElementById('save').click(); await pause();
    assert(document.getElementById('save').disabled, 'Save completes');
    assert(document.getElementById('status').textContent.startsWith('Saved'), 'Saved status');
    assert(!document.getElementById('restore').disabled, 'Backup restore becomes available');
    assert(document.body.scrollWidth <= document.body.clientWidth, 'Inspector fits a 300px sidebar');
    window.changeTheme(${JSON.stringify(process.env.UI_THEME || 'DARK')});
    document.body.dataset.testResult = 'PASS: compact editor, Eagle Auto/gray startup, theme changes, all six themes';
  } catch (error) { document.body.dataset.testResult = 'FAIL: ' + error.message; }
}, 200);
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'audiotags-ui-'));
try {
  let html = fs.readFileSync(path.join(root, 'inspector/index.html'), 'utf8');
  html = html.replace('href="style.css"', `href="${pathToFileURL(path.join(root, 'inspector/style.css')).href}"`);
  html = html.replace('src="../lib/eagle-theme.js"', `src="${pathToFileURL(path.join(root, 'lib/eagle-theme.js')).href}"`);
  html = html.replace('<script src="app.js"></script>', `<script src="bootstrap.js"></script><script src="${pathToFileURL(path.join(root, 'inspector/app.js')).href}"></script><script src="assertions.js"></script>`);
  fs.writeFileSync(path.join(temp, 'bootstrap.js'), bundle); fs.writeFileSync(path.join(temp, 'assertions.js'), assertions); fs.writeFileSync(path.join(temp, 'index.html'), html);
  const screenshot = path.join(temp, 'inspector.png');
  const result = execFileSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--user-data-dir=' + path.join(temp, 'profile'), '--window-size=300,600', '--virtual-time-budget=1500', '--screenshot=' + screenshot, '--dump-dom', pathToFileURL(path.join(temp, 'index.html')).href + '?theme=gray'], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const message = result.match(/data-test-result="([^"]*)"/)?.[1];
  if (!message || !message.startsWith('PASS:')) throw new Error(message || 'Browser did not complete UI checks');
  console.log(message);
  if (process.env.UI_SCREENSHOT) { fs.copyFileSync(screenshot, process.env.UI_SCREENSHOT); console.log('Screenshot: ' + process.env.UI_SCREENSHOT); }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
