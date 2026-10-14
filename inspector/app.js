'use strict';
// Eagle supplies Node.js and the eagle API to this inspector.
const fs = require('fs').promises;
const path = require('path');
const { resolveTheme } = window.eagleTheme;
let codec, store, supportedExtensions, pluginPath, backupDir, item, doc, sourceHash, busy = false, loading = false, draftActions = [], timer;
let selectionPending = false, emptySelectionShown = false;
let selectedEntry, selectedSection, activeTab = 'metadata';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const inspectorTheme = new URLSearchParams(window.location.search).get('theme');
let requestedTheme;
function applyTheme(theme, initialTheme) {
  requestedTheme = theme;
  const resolved = resolveTheme(theme, { initialTheme, previousTheme: document.documentElement.dataset.theme, systemDark: systemTheme.matches });
  document.documentElement.dataset.theme = resolved;
  document.body.setAttribute('theme', resolved);
}
// Eagle's inspector URL already contains its current theme before plugin-create arrives.
applyTheme(typeof eagle !== 'undefined' ? eagle.app.theme : undefined, inspectorTheme);
systemTheme.addEventListener('change', () => applyTheme(requestedTheme));
function status(message, error = false) { $('status').textContent = message; $('status').title = message; $('status').dataset.error = String(error); }
function report(error) { console.error(error); status(error.message || String(error), true); }
function dirty() { return !!doc?.sections.some(codec.changed); }
function buttons() {
  const ready = !!doc && !busy && !loading;
  $('save').disabled = !ready || !dirty(); $('undo').disabled = !ready || !dirty();
  const writable = ready && (!doc.sections.length || doc.sections.some(s => !s.locked));
  $('add').disabled = !writable; $('add-cover').disabled = !writable || doc?.canAddCover === false; $('reload').disabled = busy || loading;
  $('confirm-add').disabled = !ready;
}
function reference(e) { const s = doc.sections.findIndex(s => s.entries.includes(e)); return [s, doc.sections[s].entries.indexOf(e)]; }
function draftKey() { return 'advanced-audiotags:' + store.hash(Buffer.from(item.filePath)); }
function stash(action) {
  if (action) {
    const previous = draftActions[draftActions.length - 1];
    if (action.type === 'edit' && previous?.type === 'edit' && JSON.stringify(previous.ref) === JSON.stringify(action.ref)) draftActions[draftActions.length - 1] = action;
    else draftActions.push(action);
  }
  try { localStorage.setItem(draftKey(), JSON.stringify({ sourceHash, actions: draftActions })); }
  catch { status('The draft could not be cached. Save before switching files.', true); }
  buttons();
}
function clearDraft() { localStorage.removeItem(draftKey()); draftActions = []; }
function replay(actions) {
  for (const a of actions) {
    if (a.type === 'add') codec.add(doc, a.key, a.value, a.kind, a.section === null ? undefined : doc.sections[a.section]);
    else if (a.type === 'add-cover') codec.addCover(doc, Buffer.from(a.bytes, 'base64'), a.mime, a.dimensions);
    else {
      const e = doc.sections[a.ref[0]]?.entries[a.ref[1]]; if (!e) throw new Error('Draft field is missing.');
      if (a.type === 'edit') { codec.set(e, a.value, a.editMode); }
      else if (a.type === 'rename') codec.rename(doc, e, a.name);
      else if (a.type === 'description') codec.setDescription(doc, e, a.description, a.language);
      else if (a.type === 'delete') e.deleted = a.deleted;
      else if (a.type === 'cover') codec.cover(e, Buffer.from(a.bytes, 'base64'), a.mime, doc.sections[a.ref[0]].version, a.dimensions);
    }
  }
}
function edit(e, value, editMode) {
  codec.set(e, value, editMode);
  status('Unsaved changes');
  stash({ type: 'edit', ref: reference(e), value, editMode, description: e.description, language: e.language });
}
async function exportBytes(e, section) {
  const bytes = codec.payload(e);
  const result = await eagle.dialog.showSaveDialog({ title: 'Export tag data', defaultPath: e.key.replace(/[^\w-]/g, '_') + '.bin' });
  if (!result.canceled && result.filePath) {
    if (path.resolve(result.filePath) === path.resolve(item.filePath)) throw new Error('Choose a different file from the audio file.');
    await fs.writeFile(result.filePath, bytes); status(`${section.name}: ${e.key} exported`);
  }
}
async function chooseCover() {
  const result = await eagle.dialog.showOpenDialog({ title: 'Choose cover', properties: ['openFile'], filters: [{ name: 'Cover', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled || !result.filePaths.length) return null;
  const file = result.filePaths[0], size = (await fs.stat(file)).size;
  if (size > 16 * 1024 * 1024) throw new Error('Cover images must not exceed 16 MB.');
  const bytes = await fs.readFile(file);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new Error('Unsupported image file.');
  const image = new Image(); const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The cover image could not be opened.')); image.src = url; });
    return { bytes, mime, dimensions: { width: image.naturalWidth, height: image.naturalHeight } };
  } finally { URL.revokeObjectURL(url); }
}
function safe(task) { return async () => { try { await task(); } catch (error) { report(error); } }; }
async function stable(task) {
  if (busy || loading) return;
  busy = true; buttons(); render();
  try { return await task(); } finally { busy = false; render(); }
}
function toggleTools(open = $('tools-menu').hidden) {
  $('tools-menu').hidden = !open;
  $('tools-toggle').setAttribute('aria-expanded', String(open));
  $('tools-toggle').textContent = open ? 'Tools ▴' : 'Tools ▾';
}
function selectEntry(e, s, openTools = false) {
  selectedEntry = e; selectedSection = s;
  for (const row of $('tags').querySelectorAll('.row')) row.classList.toggle('selected', row.dataset.ref === reference(e).join(':'));
  renderFieldTools();
  if (openTools) toggleTools(true);
}
function renderFieldTools() {
  const panel = $('field-tools'); panel.replaceChildren();
  const e = selectedEntry, s = selectedSection;
  if (!e || !s || !doc?.sections.some(group => group.entries.includes(e))) {
    panel.append(node('p', 'Select a field for more actions.', 'hint')); return;
  }
  const readonly = e.readonly || s.locked || busy;
  const raw = e.editMode === 'hex' || e.mode === 'hex';
  panel.append(node('p', `${s.name} · ${e.key}${e.description ? ' · ' + e.description : ''}`, 'field-title'));
  const actions = node('div', undefined, 'toolbar');
  const action = (text, callback, disabled = false) => { const button = node('button', text); button.disabled = !!disabled; button.onclick = callback; actions.append(button); return button; };
  if (e.deleted) {
    action('Restore', () => { e.deleted = false; stash({ type: 'delete', ref: reference(e), deleted: false }); render(); }, readonly);
    panel.append(actions); return;
  }
  if (s.type !== 'propertymap' && !raw && !e.changed) action('Edit hex', () => { e.value = e.bytes.toString('hex'); e.editMode = 'hex'; toggleTools(true); render(); }, readonly);
  if (raw && e.mode !== 'hex' && !e.changed) action('Show text', () => { e.editMode = undefined; e.value = e._textValue; render(); }, busy);
  action('Export', safe(() => stable(() => exportBytes(e, s))), busy);
  if (s.type !== 'v1' && e.asfContent === undefined) action('Remove', () => { e.deleted = true; stash({ type: 'delete', ref: reference(e), deleted: true }); status('Unsaved changes'); render(); }, readonly);
  panel.append(actions);
  if (e.description !== undefined && e.mode.startsWith('id3-') && !raw && !['TXXX','TXX','WXXX','WXX'].includes(e.key)) {
    const description = node('input'); description.value = e.description; description.disabled = !!readonly; description.setAttribute('aria-label', `${e.key}: Description`);
    description.onchange = safe(() => { codec.setDescription(doc, e, description.value); stash({type:'description',ref:reference(e),description:e.description,language:e.language}); status('Unsaved changes'); });
    panel.append(node('label', 'Description', 'extra-label'), description);
    if (e.language !== undefined) {
      const language = node('input'); language.value = e.language; language.maxLength = 3; language.disabled = !!readonly; language.setAttribute('aria-label', `${e.key}: Language`);
      language.onchange = safe(() => { codec.setDescription(doc, e, e.description, language.value); stash({type:'description',ref:reference(e),description:e.description,language:e.language}); status('Unsaved changes'); });
      panel.append(node('label', 'Language (eng / deu)', 'extra-label'), language);
    }
  }
  if (e.image && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(e.mime)) {
    const image = node('img', undefined, 'cover'); image.alt = e.description || 'Embedded cover'; image.src = 'data:' + e.mime + ';base64,' + e.image.toString('base64'); panel.append(image);
    const replace = node('button', 'Replace cover'); replace.disabled = !!readonly;
    replace.onclick = safe(() => stable(async () => { const cover = await chooseCover(); if (!cover) return; codec.cover(e, cover.bytes, cover.mime, s.version, cover.dimensions); stash({ type: 'cover', ref: reference(e), ...cover, bytes: cover.bytes.toString('base64') }); status('Unsaved changes'); })); panel.append(replace);
  }
  if (raw) {
    const detail = node('div', undefined, 'field-editor');
    const editor = node('textarea'); const large = e.value.length > 32768;
    editor.className = 'hex'; editor.rows = 4; editor.value = large ? '' : e.value; editor.readOnly = !!readonly || large; editor.spellcheck = false;
    editor.setAttribute('aria-label', `${s.name}: ${e.key} (full hex data)`);
    editor.placeholder = large ? `${e.bytes.length.toLocaleString('en-US')} bytes – open hex data or export` : '';
    editor.oninput = () => { edit(e, editor.value, 'hex'); const inline = $('tags').querySelector(`[data-ref="${reference(e).join(':')}"] textarea`); if (inline && e.value.length <= 512 && !e.image) inline.value = e.value; };
    detail.append(editor);
    if (large) { const expand = node('button', 'Open hex data'); expand.onclick = () => { editor.value = e.value; editor.readOnly = !!readonly; expand.remove(); }; detail.append(expand); }
    detail.append(node('p', 'Hex payload. Edits must match the field format.', 'hint')); panel.append(detail);
  }
  if (readonly) panel.append(node('p', s.locked || e.reason || (e.readonly ? 'Protected field · read-only' : 'Saving …'), 'hint'));
  if (!raw && e.value.includes('\0')) panel.append(node('p', '␀ separates multiple values in this field.', 'hint'));
}
function fieldName(e) {
  if (['TXXX', 'TXX', 'WXXX', 'WXX'].includes(e.key) && e.description) return e.description;
  return e.label || e.key;
}
function renameEntry(e, name) {
  codec.rename(doc, e, name);
  stash({ type: 'rename', ref: reference(e), name });
  status('Unsaved changes');
}
function renderEntry(e, s) {
  const row = node('div', undefined, 'row' + (e.deleted ? ' removed' : '') + (e === selectedEntry ? ' selected' : ''));
  row.dataset.ref = reference(e).join(':');
  row.dataset.search = [s.name, e.key, e.label, e.description, e.mode === 'hex' ? '' : e.value].filter(Boolean).join(' ').toLowerCase();
  const name = node('div', undefined, 'cell-name');
  name.title = `${e.key} · ${s.name}${e.description ? ' · ' + e.description : ''}`;
  if (codec.canRename(s, e) && !busy) {
    const input = node('input'); input.className = 'name-editor'; input.value = ['TXXX','TXX','WXXX','WXX'].includes(e.key) ? e.description : e.key;
    input.placeholder = e.label; input.setAttribute('aria-label', `${s.name}: ${e.key} name`);
    input.onfocus = () => selectEntry(e, s);
    const commit = () => { try { const current = ['TXXX','TXX','WXXX','WXX'].includes(e.key) ? e.description : e.key; if (input.value !== current) renameEntry(e, input.value); row.dataset.search = [s.name,e.key,e.description,e.value].filter(Boolean).join(' ').toLowerCase(); renderFieldTools(); } catch (error) { input.value = ['TXXX','TXX','WXXX','WXX'].includes(e.key) ? e.description : e.key; report(error); } };
    input.onchange = commit; input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); input.blur(); } };
    name.append(input);
  } else { name.textContent = fieldName(e); name.tabIndex = 0; }
  const cell = node('div', undefined, 'cell-value'); row.append(name, cell);
  row.onclick = () => { if (selectedEntry !== e) selectEntry(e, s); };
  row.oncontextmenu = event => { event.preventDefault(); selectEntry(e, s, true); };
  name.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); selectEntry(e, s, true); } };
  name.onfocus = () => selectEntry(e, s);
  const readonly = e.readonly || s.locked || busy;
  if (e.deleted) {
    const restore = node('button', 'Restore'); restore.disabled = !!readonly;
    restore.onclick = event => { event.stopPropagation(); e.deleted = false; stash({ type: 'delete', ref: reference(e), deleted: false }); render(); }; cell.append(restore); return row;
  }
  const raw = e.editMode === 'hex' || e.mode === 'hex';
  const summary = raw && (e.image || e.value.length > 512);
  const editor = node('textarea'); editor.rows = 1;
  editor.className = (raw ? 'hex ' : '') + (e.value.includes('\n') ? 'multiline' : '');
  editor.value = summary ? `${e.image ? e.mime + ' · ' : ''}${(e.value.replace(/\s/g, '').length / 2).toLocaleString('en-US')} Bytes` : raw ? e.value : e.value.replace(/\0/g, '␀');
  editor.title = summary ? 'Right-click for cover and hex actions' : editor.value;
  editor.readOnly = !!readonly || !!summary; editor.spellcheck = !raw;
  editor.setAttribute('aria-label', `${s.name}: ${e.key}${raw ? ' (Hex)' : ''}`);
  editor.onfocus = () => selectEntry(e, s);
  editor.ondblclick = () => { if (summary) selectEntry(e, s, true); };
  editor.oninput = () => {
    edit(e, raw ? editor.value : editor.value.replace(/␀/g, '\0'), raw ? 'hex' : undefined);
    row.dataset.search = [s.name, e.key, e.label, e.description, raw ? '' : e.value].filter(Boolean).join(' ').toLowerCase();
  };
  cell.append(editor); return row;
}
function property(name, value) {
  const row = node('div', undefined, 'property'); const cell = node('div', String(value), 'cell-value'); cell.title = String(value);
  row.dataset.search = `${name} ${value}`.toLowerCase(); row.append(node('div', name, 'cell-name'), cell); $('tags').append(row);
}
function renderProperties() {
  const t = doc.technical || {};
  const number = value => Number.isFinite(value) && value > 0 ? value.toLocaleString('en-US', {maximumFractionDigits:2}) : 'Unknown';
  property('File name', item.name + '.' + item.ext);
  property('Container', t.container || item.ext.toUpperCase());
  property('Codec / encoding', t.codec || 'Unknown');
  property('Codec profile', t.codecProfile || 'Not reported');
  property('Compression', t.lossless === true ? (/^PCM|^IEEE/.test(t.codec||'') ? 'Uncompressed PCM' : 'Lossless') : t.lossless === false ? 'Lossy' : 'Unknown');
  property('Bitrate', Number.isFinite(t.bitrate) && t.bitrate > 0 ? number(t.bitrate/1000) + ' kb/s' : 'Unknown');
  if(t.bitrateSource)property('Bitrate source', t.bitrateSource);
  property('Bitrate mode', t.bitrateMode || 'Not reliably signalled by this codec/container');
  property('Sample rate', Number.isFinite(t.sampleRate) && t.sampleRate > 0 ? number(t.sampleRate) + ' Hz' : 'Unknown');
  property('Channels', t.numberOfChannels || 'Unknown');
  if(t.channelLayout) property('Channel layout', t.channelLayout);
  property(t.codec?.startsWith('DSD') ? 'DSD sample precision' : 'PCM bit depth', t.bitsPerSample ? number(t.bitsPerSample) + ' bit' : t.lossless === false ? 'Not defined for lossy compressed audio' : 'Unknown');
  if(Number.isFinite(t.duration)) { const duration = Math.max(0,t.duration); property('Duration', `${Math.floor(duration/60)}:${(duration%60).toFixed(3).padStart(6,'0')} (${number(duration)} s)`); }
  if(t.numberOfSamples) property('Samples', number(t.numberOfSamples));
  if(t.tool) property('Encoder', t.tool);
  property('File size', doc.buffer.length.toLocaleString('en-US') + ' bytes');
  property('Tag containers', doc.sections.map(s => s.name).join(', ') || 'None');
  property('Tag fields', doc.sections.reduce((n, s) => n + s.entries.filter(e => !e.deleted).length, 0));
  for (const s of doc.sections) if (s.type === 'flac') for (const b of s.blocks.filter(b => b.type === 4)) property('Vorbis vendor', b.vendor.toString('utf8'));
  property('Location', item.filePath);
  // Include the parser's native records so unmodeled metadata remains inspectable.
  for (const [container, records] of Object.entries(doc.nativeTags || {})) {
    const details = node('details', undefined, 'native-records'); details.append(node('summary', `Native ${container} records (${records.length})`));
    const pre = node('pre'); pre.textContent = JSON.stringify(records, (key,value) => {
      if(typeof value==='bigint')return value.toString();
      if (value && (value.type === 'Buffer' || value instanceof Uint8Array)) return `[binary data: ${value.length || value.data?.length || 0} bytes]`;
      return value;
    }, 2); details.append(pre); $('tags').append(details);
  }
  if(doc.warnings?.length) { const details = node('details', undefined, 'native-records'); details.append(node('summary', 'Parser notes'), node('pre', doc.warnings.join('\n'))); $('tags').append(details); }
}
function render() {
  if (!doc) { renderFieldTools(); buttons(); return; }
  if (selectedEntry && !doc.sections.some(s => s.entries.includes(selectedEntry))) { selectedEntry = undefined; selectedSection = undefined; }
  $('tags').replaceChildren();
  $('format').textContent = item.ext.toUpperCase(); $('filename').textContent = item.name + '.' + item.ext; $('filename').title = item.filePath;
  const heading = node('div', undefined, 'table-head'); heading.append(node('span', 'Name'), node('span', 'Value')); $('tags').append(heading);
  $('metadata-tab').setAttribute('aria-selected', String(activeTab === 'metadata')); $('properties-tab').setAttribute('aria-selected', String(activeTab === 'properties'));
  if (activeTab === 'properties') renderProperties();
  else {
    if (!doc.sections.length) $('tags').append(node('p', 'No tags. Use Tools → + Tag to add a field.', 'empty'));
    for (const s of doc.sections) {
      const group = node('details', undefined, 'group' + (doc.sections.length === 1 ? ' single' : '')); group.open = true;
      group.append(node('summary', `${s.name} · ${s.entries.filter(e => !e.deleted).length} fields`));
      if(s.locked)group.append(node('p',s.locked,'hint'));
      for (const e of s.entries) { if (e._textValue === undefined && e.mode !== 'hex') e._textValue = e.value; group.append(renderEntry(e, s)); }
      if (!s.entries.length) group.append(node('p', 'No fields present.', 'hint')); $('tags').append(group);
    }
  }
  renderFieldTools(); applySearch(); buttons();
}
function applySearch() {
  const query = $('search').value.trim().toLowerCase();
  for (const row of $('tags').querySelectorAll('.row, .property')) row.hidden = !row.dataset.search.includes(query);
  for (const group of $('tags').querySelectorAll('.group')) group.hidden = !!query && !Array.from(group.querySelectorAll('.row')).some(row => !row.hidden);
}
async function loadItem(selected, discard = false) {
  loading = true; selectedEntry = undefined; selectedSection = undefined; buttons(); $('add-form').hidden = true;
  try {
    if (discard && item) clearDraft();
    item = selected; doc = undefined; draftActions = []; $('tags').replaceChildren(node('p', 'Loading metadata …', 'empty')); status('Loading …');
    if (!item || !supportedExtensions.includes(item.ext.toLowerCase())) {
      $('format').textContent = '—'; $('filename').textContent = 'Select an audio file'; $('restore').disabled = true;
      $('tags').replaceChildren(node('p', 'Select exactly one supported audio file.', 'empty'));
      status('No supported audio file selected.'); return;
    }
    $('filename').textContent = item.name + '.' + item.ext; $('format').textContent = item.ext.toUpperCase();
    ({ doc, sourceHash } = await store.load(item));
    let recovered = false;
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (draft?.sourceHash === sourceHash) { replay(draft.actions); draftActions = draft.actions; recovered = dirty(); }
      else if (draft) localStorage.removeItem(draftKey());
    } catch { localStorage.removeItem(draftKey()); ({ doc, sourceHash } = await store.load(item)); status('The draft could not be restored.', true); }
    $('restore').disabled = !(await store.latestBackup(item, backupDir));
    status(recovered ? 'Unsaved draft restored' : `${doc.sections.reduce((n, s) => n + s.entries.length, 0)} fields · ${item.ext === 'ac3' ? 'ID3 / APE in AC3' : 'read locally'}`);
  } catch (error) { doc = undefined; $('tags').replaceChildren(node('p', error.message, 'empty')); report(error); }
  finally { loading = false; render(); }
}
async function save() {
  if (!doc || busy || !dirty()) return;
  busy = true; buttons(); render(); status('Backing up and saving …');
  try {
    const result = await store.save(item, doc, sourceHash, backupDir);
    clearDraft(); doc = result.doc; sourceHash = result.sourceHash; $('restore').disabled = false;
    status('Saved · audio unchanged · backup created');
  } catch (error) { report(error); throw error; }
  finally { busy = false; render(); }
}
async function selection() {
  if (busy || loading || selectionPending || !store) return;
  selectionPending = true;
  try {
    const selected = await eagle.item.getSelected(), next = selected.length === 1 ? selected[0] : undefined;
    if (next && next.id === item?.id && next.filePath === item?.filePath) return;
    if (!next && !item && emptySelectionShown) return;
    emptySelectionShown = !next;
    // Inspector instances can be recreated by Eagle on selection. Drafts are stored on each edit.
    await loadItem(next);
  } finally { selectionPending = false; }
}
function addForm() {
  toggleTools(false);
  const select = $('container'); select.replaceChildren();
  doc.sections.forEach((s, i) => { if (['id3', 'ape', 'flac', 'propertymap'].includes(s.type) && !s.locked) { const o = node('option', s.name); o.value = String(i); select.append(o); } });
  if (!select.options.length) { const o = node('option', 'ID3v2.4 (new)'); o.value = 'new'; select.append(o); }
  select.onchange = suggestions; suggestions(); $('add-form').hidden = false; $('new-key').focus();
}
function suggestions() {
  const s = doc.sections[Number($('container').value)];
  const keys = s?.type === 'flac' || s?.type === 'ape' || s?.type === 'propertymap' ? ['TITLE', 'ARTIST', 'ALBUM', 'ALBUMARTIST', 'DATE', 'TRACKNUMBER', 'DISCNUMBER', 'GENRE', 'COMMENT', 'LYRICS', 'BPM', 'ISRC'] : s?.version === 2 ? ['TT2', 'TP1', 'TAL', 'TRK', 'TYE', 'TCO', 'COM', 'ULT', 'TXX'] : ['TITLE', 'ARTIST', 'ALBUM', 'ALBUMARTIST', 'TRACKNUMBER', 'DISCNUMBER', 'DATE', 'GENRE', 'COMMENT', 'LYRICS', 'My custom field'];
  $('suggestions').replaceChildren(...keys.map(key => { const o = node('option'); o.value = key; return o; }));
  $('new-key').placeholder = keys[0]; $('new-kind').disabled = s?.type === 'flac' || s?.type === 'propertymap';
  if (s?.type === 'flac' || s?.type === 'propertymap') $('new-kind').value = 'text';
}
function wire() {
  $('search').oninput = applySearch;
  $('tools-toggle').onclick = () => toggleTools();
  $('metadata-tab').onclick = () => { activeTab = 'metadata'; render(); };
  $('properties-tab').onclick = () => { activeTab = 'properties'; render(); };
  $('save').onclick = safe(save);
  $('reload').onclick = safe(() => loadItem(item));
  $('undo').onclick = safe(() => loadItem(item, true));
  $('add').onclick = addForm; $('cancel-add').onclick = () => { $('add-form').hidden = true; };
  $('confirm-add').onclick = safe(() => {
    const key = $('new-key').value.trim(), value = $('new-value').value, kind = $('new-kind').value, selected = $('container').value;
    if (!key) throw new Error('Enter a field name.');
    const index = selected === 'new' ? null : Number(selected);
    const added = codec.add(doc, key, value, kind, index === null ? undefined : doc.sections[index]);
    selectedEntry = added; selectedSection = doc.sections.find(s => s.entries.includes(added)); activeTab = 'metadata';
    stash({ type: 'add', key, value, kind, section: index });
    $('add-form').hidden = true; $('new-key').value = ''; $('new-value').value = ''; status('Unsaved changes'); render();
  });
  $('add-cover').onclick = safe(() => stable(async () => { const cover = await chooseCover(); if (!cover) return; const added = codec.addCover(doc, cover.bytes, cover.mime, cover.dimensions); selectedEntry = added; selectedSection = doc.sections.find(s => s.entries.includes(added)); activeTab = 'metadata'; stash({ type: 'add-cover', ...cover, bytes: cover.bytes.toString('base64') }); status('Unsaved changes'); }));
  $('restore').onclick = safe(() => stable(async () => {
    if (!doc) return;
    const answer = await eagle.dialog.showMessageBox({ type: 'question', title: 'Restore backup', message: 'Restore the latest backup of this file?', detail: 'The current file will also be backed up. Unsaved changes will be discarded.', buttons: ['Cancel', 'Restore'] });
    if (answer.response !== 1) return;
    const result = await store.restore(item, doc, sourceHash, backupDir); clearDraft(); doc = result.doc; sourceHash = result.sourceHash; status('Backup restored · previous file backed up');
  }));
  $('backup-folder').onclick = safe(async () => { await fs.mkdir(backupDir, { recursive: true }); await eagle.shell.openPath(backupDir); });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); safe(save)(); } });
}
if (typeof eagle === 'undefined') {
  status('Open this plugin in Eagle’s right-hand Inspector.', true);
  $('tags').replaceChildren(node('p', 'Eagle 4 is required. See README.md for installation and usage.', 'empty'));
} else {
  eagle.onPluginCreate(async plugin => {
    try {
      pluginPath = plugin.path; backupDir = path.join(await eagle.app.getPath('userData'), 'Advanced Audiotags Backups');
      supportedExtensions = require(path.join(pluginPath, 'lib', 'formats.js')).EXTENSIONS;
      codec = require(path.join(pluginPath, 'lib', 'tag-codec.js')); store = require(path.join(pluginPath, 'lib', 'file-store.js'));
      store.configureBackend({execPath: await eagle.app.getPath('exe')});
      applyTheme(await eagle.app.theme, inspectorTheme); wire(); await selection();
      timer = setInterval(() => { selection().catch(report); }, 1000);
    } catch (error) { report(error); }
  });
  eagle.onThemeChanged(theme => applyTheme(theme));
  eagle.onPluginShow(() => { selection().catch(report); });
  eagle.onLibraryChanged(() => { selection().catch(report); });
  window.addEventListener('unload', () => { clearInterval(timer); store?.closeBackend(); });
}
