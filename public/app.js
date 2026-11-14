import { ThemeManager } from './js/core/themeManager.js';
import { buildSentenceReadQueue, computeBurstinessStats, computeWordDiffHtml, escapeHtml, findFlags } from './js/core/textUtils.js';
import { Editor } from './js/editor.js';
import { Player } from './js/player.js';
import { Dictation } from './js/dictation.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const api = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  },
};

const theme = new ThemeManager('system');
theme.applyTheme();

const state = {
  config: null,
  docs: [],
  doc: null,
  dirty: false,
  saving: false,
  lastSnapshotAt: 0,
  pendingAi: false,
  spokeLast: false,
};

const editor = new Editor($('#paper'));
const player = new Player({
  getVoice: () => $('#voiceSelect').value || state.config?.voiceId,
  getRate: () => Number($('#rateSelect').value) || 1,
});
const dictation = new Dictation();

// ---------- Toasts ----------

function toast(message, kind = '') {
  if (!message) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3800);
}

// ---------- Config ----------

async function loadConfig() {
  state.config = await api.get('/api/config');
  theme.applyTheme(state.config.themePreference || 'system');
  fillVoiceSelect($('#voiceSelect'), state.config.voiceId);
  fillVoiceSelect($('#setVoice'), state.config.voiceId);
  $('#rateSelect').value = String(state.config.rate || 1);
  if (!$('#rateSelect').value) $('#rateSelect').value = '1';
  $('#showFlags').checked = state.config.showFlags !== false;
  editor.setFlagsEnabled($('#showFlags').checked);
}

function fillVoiceSelect(select, selected) {
  const groups = [
    ['Free voices', state.config.voices.filter((v) => v.provider === 'neural')],
    [state.config.hasApiKey ? 'Gemini voices' : 'Gemini voices (need an API key)', state.config.voices.filter((v) => v.provider === 'gemini')],
  ];
  select.innerHTML = groups
    .map(([label, voices]) => `<optgroup label="${escapeHtml(label)}">${voices.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}, ${escapeHtml(v.detail.replace(/^Gemini, /, ''))}</option>`).join('')}</optgroup>`)
    .join('');
  select.value = selected;
}

function saveConfig(patch) {
  Object.assign(state.config, patch);
  return api.post('/api/config', patch).then((c) => { state.config = c; return c; }).catch((e) => toast(e.message, 'error'));
}

// ---------- Views ----------

function showLibrary() {
  if (state.doc) flushSave();
  player.stop();
  dictation.stop();
  $('#editorView').hidden = true;
  $('#libraryView').hidden = false;
  document.title = 'Cadence';
  state.doc = null;
  loadLibrary();
}

function showEditor() {
  $('#libraryView').hidden = true;
  $('#editorView').hidden = false;
}

// ---------- Library ----------

async function loadLibrary() {
  const { documents } = await api.get('/api/documents');
  state.docs = documents;
  renderLibrary();
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderLibrary() {
  const q = $('#librarySearch').value.trim().toLowerCase();
  const docs = state.docs.filter((d) => !q || d.title.toLowerCase().includes(q));
  const last = state.docs.find((d) => d.id === state.config.lastOpenedDocId) || state.docs[0];

  $('#resumeBlock').hidden = !last;
  if (last) {
    $('#resumeTitle').textContent = last.title;
    const bm = last.bookmark;
    $('#resumeSnippet').textContent = bm.snippet ? `Paragraph ${bm.paraIndex + 1}: ${bm.snippet}${bm.snippet.length >= 140 ? '…' : ''}` : 'Beginning of the document';
    $('#resumeOpenBtn').onclick = () => openDocument(last.id, { atBookmark: true });
    $('#resumePlayBtn').onclick = () => openDocument(last.id, { atBookmark: true, play: true });
  }

  $('#libraryEmpty').hidden = state.docs.length > 0;
  $('#docList').innerHTML = docs
    .map(
      (d) => `
    <li class="doc-row" data-id="${d.id}" tabindex="0">
      <div>
        <h3>${escapeHtml(d.title)}</h3>
        <p class="excerpt">${escapeHtml(d.excerpt || 'Empty document')}</p>
      </div>
      <div class="meta">${d.wordCount.toLocaleString('en-CA')} words<br>${relativeTime(d.updatedAt)}</div>
      <div class="row-actions">
        <button class="icon-btn" data-row="play" type="button" aria-label="Listen from bookmark" title="Listen from bookmark"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.2v11.6L16 10Z" fill="currentColor"/></svg></button>
        <button class="icon-btn" data-row="delete" type="button" aria-label="Delete" title="Delete"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6"/></svg></button>
      </div>
    </li>`
    )
    .join('');
}

$('#docList').addEventListener('click', async (e) => {
  const row = e.target.closest('.doc-row');
  if (!row) return;
  const act = e.target.closest('[data-row]')?.dataset.row;
  const doc = state.docs.find((d) => d.id === row.dataset.id);
  if (act === 'delete') {
    if (await confirmDialog(`Delete "${doc.title}"? Saved versions are kept on disk.`)) {
      await api.del(`/api/documents/${doc.id}`);
      toast('Document deleted');
      loadLibrary();
    }
    return;
  }
  openDocument(row.dataset.id, { atBookmark: true, play: act === 'play' });
});
$('#docList').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('doc-row')) openDocument(e.target.dataset.id, { atBookmark: true });
});
$('#librarySearch').addEventListener('input', renderLibrary);

function confirmDialog(text) {
  const dlg = $('#confirmDialog');
  $('#confirmText').textContent = text;
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

async function newDocument() {
  const doc = await api.post('/api/documents', { title: 'Untitled', paragraphs: [{ type: 'body', text: '' }] });
  await openDocument(doc.id, { focusTitle: true });
}

// ---------- Import ----------

async function importFile(file) {
  if (!file) return;
  if (!/\.(docx|md|markdown|txt)$/i.test(file.name)) return toast('Use a .docx, .md or .txt file', 'error');
  const fd = new FormData();
  fd.append('file', file);
  toast(`Importing ${file.name}`);
  try {
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    const doc = await res.json();
    if (!res.ok) throw new Error(doc.error || 'Import failed');
    await openDocument(doc.id);
    toast(`Imported ${file.name}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#fileInput').addEventListener('change', (e) => {
  importFile(e.target.files[0]);
  e.target.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  $('#dropOverlay').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  importFile(e.dataTransfer.files[0]);
});

// ---------- Open and save ----------

async function openDocument(id, { atBookmark = false, play = false, focusTitle = false } = {}) {
  try {
    player.stop();
    player.queue = [];
    player.cursor = 0;
    const doc = await api.get(`/api/documents/${id}`);
    state.doc = doc;
    state.config.lastOpenedDocId = id;
    showEditor();
    $('#docTitle').value = doc.title;
    document.title = `${doc.title} - Cadence`;
    $('#styleSelect').value = doc.style || 'narrative';
    $('#paper').classList.toggle('academic', doc.style === 'academic');
    $('#wordTarget').value = doc.wordTarget || '';
    editor.load(doc.paragraphs);
    setSaveState('');
    refreshDerived();
    loadRevisions();

    const bm = doc.bookmark || { paraIndex: 0, sentIndex: 0 };
    const para = Math.min(bm.paraIndex || 0, doc.paragraphs.length - 1);
    $('#positionLabel').textContent = 'Press play or Option+Space to listen from the cursor';
    if (focusTitle) {
      requestAnimationFrame(() => { $('#docTitle').focus(); $('#docTitle').select(); });
    } else if (atBookmark) {
      const q = buildSentenceReadQueue(editor.paragraphs, para, bm.sentIndex || 0);
      const offset = q[0]?.paraIndex === para ? q[0].start : 0;
      requestAnimationFrame(() => editor.setCaret(para, offset));
    } else {
      requestAnimationFrame(() => editor.setCaret(0, 0, { scroll: false }));
    }
    if (play) startReading({ paraIndex: para, sentIndex: bm.sentIndex || 0 });
  } catch (e) {
    toast(e.message, 'error');
  }
}

let saveTimer = null;
function scheduleSave() {
  state.dirty = true;
  setSaveState('Editing');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

async function flushSave(extra = {}) {
  clearTimeout(saveTimer);
  if (!state.doc || (!state.dirty && !extra.createSnapshot)) return;
  const payload = {
    id: state.doc.id,
    title: $('#docTitle').value.trim() || 'Untitled',
    style: $('#styleSelect').value,
    wordTarget: Number($('#wordTarget').value) || null,
    paragraphs: editor.getParagraphs(),
    ...extra,
  };
  state.dirty = false;
  setSaveState('Saving');
  try {
    const saved = await api.post('/api/documents', payload);
    state.doc = { ...state.doc, ...saved, bookmark: state.doc.bookmark };
    setSaveState('Saved');
    if (extra.createSnapshot) loadRevisions();
  } catch (e) {
    state.dirty = true;
    setSaveState('Not saved. Retrying');
    saveTimer = setTimeout(flushSave, 3000);
  }
}

function setSaveState(text) {
  $('#saveState').textContent = text;
}

let bookmarkTimer = null;
function saveBookmark(item, immediate = false) {
  if (!state.doc || !item) return;
  state.doc.bookmark = { paraIndex: item.paraIndex, sentIndex: item.sentIndex };
  clearTimeout(bookmarkTimer);
  const send = () => api.post(`/api/documents/${state.doc.id}/bookmark`, state.doc.bookmark).catch(() => {});
  if (immediate) send();
  else bookmarkTimer = setTimeout(send, 1500);
}

window.addEventListener('beforeunload', () => {
  if (state.doc && state.dirty) {
    navigator.sendBeacon?.('/api/documents', new Blob([JSON.stringify({ id: state.doc.id, title: $('#docTitle').value, paragraphs: editor.getParagraphs() })], { type: 'application/json' }));
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

$('#docTitle').addEventListener('input', () => {
  document.title = `${$('#docTitle').value || 'Untitled'} - Cadence`;
  scheduleSave();
});
$('#docTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.setCaret(0, 0); } });
$('#styleSelect').addEventListener('change', () => {
  $('#paper').classList.toggle('academic', $('#styleSelect').value === 'academic');
  scheduleSave();
});
$('#wordTarget').addEventListener('input', () => { scheduleSave(); refreshDerived(); });

// ---------- Derived views: stats, checks, strip ----------

let derivedTimer = null;
editor.addEventListener('change', () => {
  scheduleSave();
  if (player.playing) {
    player.pause();
    toast('Paused while you edit. Press Option+Space to continue from the cursor.');
  }
  clearTimeout(derivedTimer);
  derivedTimer = setTimeout(refreshDerived, 300);
});

function refreshDerived() {
  const paras = editor.paragraphs;
  const stats = computeBurstinessStats(paras);
  const target = Number($('#wordTarget').value) || 0;
  $('#docStats').textContent = `${stats.wordCount.toLocaleString('en-CA')}${target ? ` of ${target.toLocaleString('en-CA')}` : ''} words, about ${stats.listenTimeFormatted} to listen`;

  const flags = editor.collectFlags();
  $('#flagCount').hidden = flags.length === 0;
  $('#flagCount').textContent = flags.length;

  $('#statsGrid').innerHTML = [
    [stats.wordCount.toLocaleString('en-CA') + (target ? ` / ${target.toLocaleString('en-CA')}` : ''), 'Words'],
    [stats.sentenceCount, 'Sentences'],
    [stats.burstinessCv.toFixed(2), 'Sentence variety, aim for 0.45 or more'],
      ]
    .map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`)
    .join('');

  $('#flagsEmpty').hidden = flags.length > 0;
  $('#flagList').innerHTML = flags
    .slice(0, 200)
    .map((f, i) => `<li class="flag-item" data-i="${i}" tabindex="0"><span><b>${escapeHtml(f.text.replace(/^[,\s]+/, '') || f.text)}</b><span class="muted">${f.label}</span></span><span class="where">Paragraph ${f.index + 1}</span></li>`)
    .join('');
  $('#flagList').onclick = (e) => {
    const li = e.target.closest('.flag-item');
    if (!li) return;
    const f = flags[Number(li.dataset.i)];
    quietSelection = true;
    editor.focusFlag(f.index, f.start, f.end);
  };

  $('#reportText').textContent = 'Open this to run the full report.';
  renderStrip();
}

$('.report').addEventListener('toggle', async (e) => {
  if (!e.target.open) return;
  $('#reportText').textContent = 'Checking';
  try {
    const r = await api.post('/api/audit', { text: editor.plainText(), style: $('#styleSelect').value });
    $('#reportText').textContent = r.reportText;
  } catch (err) {
    $('#reportText').textContent = err.message;
  }
});

let stripItems = [];
function renderStrip() {
  stripItems = buildSentenceReadQueue(editor.paragraphs, 0, 0);
  const flagSet = new Set();
  editor.paragraphs.forEach((p, pi) => {
    for (const f of findFlags(p.text)) flagSet.add(`${pi}:${f.start}`);
  });
  const now = player.current;
  const html = stripItems
    .map((s, i) => {
      const words = s.text.split(/\s+/).length;
      const flagged = [...flagSet].some((k) => {
        const [pi, st] = k.split(':').map(Number);
        return pi === s.paraIndex && st >= s.start && st < s.end;
      });
      const isNow = now && now.paraIndex === s.paraIndex && now.sentIndex === s.sentIndex;
      const done = now && (s.paraIndex < now.paraIndex || (s.paraIndex === now.paraIndex && s.sentIndex < now.sentIndex));
      const cls = ['tick', s.sentIndex === 0 && i > 0 ? 'para-start' : '', flagged ? 'flagged' : '', isNow ? 'now' : done ? 'done' : ''].filter(Boolean).join(' ');
      const h = Math.round(30 + Math.min(70, words * 2.2));
      return `<span class="${cls}" data-i="${i}" style="--w:${Math.max(2, words)};--h:${h}%" title="Paragraph ${s.paraIndex + 1}, sentence ${s.sentIndex + 1}, ${words} words${flagged ? ', flagged' : ''}"></span>`;
    })
    .join('');
  $('#strip').innerHTML = html;
}

$('#strip').addEventListener('click', (e) => {
  const t = e.target.closest('.tick');
  if (!t) return;
  const s = stripItems[Number(t.dataset.i)];
  startReading({ paraIndex: s.paraIndex, sentIndex: s.sentIndex });
});

// ---------- Reading ----------

function startReading(from = editor.readingStart()) {
  dictation.stop();
  const queue = buildSentenceReadQueue(editor.paragraphs, from.paraIndex, from.sentIndex);
  if (!queue.length) return toast('Nothing to read from here.');
  player.play(queue);
}

function togglePlay() {
  if (player.playing) player.pause();
  else startReading();
}

player.addEventListener('sentence', (e) => {
  const item = e.detail;
  if (!item) return;
  editor.setReadingHighlight(item.paraIndex, item.start, item.end);
  const total = stripItems.length;
  const idx = stripItems.findIndex((s) => s.paraIndex === item.paraIndex && s.sentIndex === item.sentIndex);
  $('#positionLabel').textContent = `Paragraph ${item.paraIndex + 1}, sentence ${item.sentIndex + 1}${total ? ` (${idx + 1} of ${total})` : ''}`;
  $$('#strip .tick').forEach((t, i) => {
    t.classList.toggle('now', i === idx);
    t.classList.toggle('done', i < idx);
  });
  saveBookmark(item);
});

player.addEventListener('state', (e) => {
  const playing = e.detail.playing;
  $('#playBtn').classList.toggle('playing', playing);
  $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Read aloud');
  if (!playing && state.doc) {
    const item = player.current;
    if (item) {
      saveBookmark(item, true);
      // Leave the caret where reading stopped so play resumes there.
      editor.clearReadingHighlight();
      if (!state.pendingAi) editor.setCaret(item.paraIndex, item.start, { focus: document.activeElement === document.body || editor.root.contains(document.activeElement), scroll: false });
    }
  }
});
player.addEventListener('finished', () => {
  editor.clearReadingHighlight();
  $('#positionLabel').textContent = 'Finished. Press play to start again from the cursor';
});
player.addEventListener('notice', (e) => toast(e.detail));

$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', () => (player.queue.length ? player.jump(-1) : startReading()));
$('#nextBtn').addEventListener('click', () => (player.queue.length ? player.jump(1) : startReading()));
$('#rateSelect').addEventListener('change', () => {
  const rate = Number($('#rateSelect').value);
  player.setRate(rate);
  saveConfig({ rate });
});
$('#voiceSelect').addEventListener('change', () => {
  const voiceId = $('#voiceSelect').value;
  saveConfig({ voiceId });
  if (player.playing) {
    player.stopAudio();
    player.playCurrent();
  } else {
    player.say('This is how this voice sounds.', voiceId);
  }
});

// ---------- Suggestions ----------

function currentTarget() {
  const sel = editor.getSelectionInfo();
  if (sel && !sel.multi) return { index: sel.index, start: sel.start, end: sel.end, text: sel.text, kind: 'selection' };
  const index = Math.max(0, editor.getCaret()?.index ?? editor.currentIndex);
  const p = editor.paragraphs[index];
  return p ? { index, start: 0, end: p.text.length, text: p.text, kind: 'paragraph' } : null;
}

function updateTargetLabel() {
  const t = editor.getSelectionInfo() || editor.getCaret() ? currentTarget() : pendingSelectionTarget || currentTarget();
  if (!t) return;
  $('#targetLabel').textContent = t.kind === 'selection' ? `Working on your selection in paragraph ${t.index + 1}` : `Working on paragraph ${t.index + 1}`;
}

async function requestEdit(action, instruction = '', { target = currentTarget(), speak = false } = {}) {
  if (!target || (!target.text.trim() && action !== 'ask')) return toast('Put the cursor in a paragraph or select some text first.');
  if (state.pendingAi) return;
  state.pendingAi = true;
  player.pause();
  const para = editor.paragraphs[target.index];
  const note = $('#aiNote');
  note.hidden = false;
  note.textContent = 'Working on a suggestion';
  try {
    const context = editor.paragraphs.slice(Math.max(0, target.index - 1), target.index + 2).map((p) => p.text).join('\n\n');
    const res = await api.post('/api/edit', {
      action,
      instruction,
      targetText: target.text,
      contextText: context,
      style: $('#styleSelect').value,
    });
    note.textContent = res.source === 'offline' ? 'Offline edit. Add a Gemini API key in Settings for full rewrites.' : '';
    note.hidden = !note.textContent;
    if (res.proposedText) {
      editor.addSuggestion({
        id: `s-${Date.now()}`,
        paraId: para.id,
        start: target.start,
        end: target.end,
        original: target.text,
        proposed: res.proposedText,
        rationale: res.rationale,
        source: res.source,
      });
    } else if (res.rationale) {
      toast(res.rationale);
    }
    if (speak && (res.spokenReply || res.rationale)) player.say(res.spokenReply || res.rationale);
  } catch (e) {
    note.hidden = true;
    toast(e.message, 'error');
  } finally {
    state.pendingAi = false;
  }
}

function renderSuggestions() {
  const list = editor.suggestions;
  $('#suggestionsEmpty').hidden = list.length > 0;
  $('#suggestionList').innerHTML = list
    .map((s) => {
      const idx = editor.paragraphs.findIndex((p) => p.id === s.paraId);
      return `<li class="sugg-item" data-id="${s.id}">
        <div class="where">Paragraph ${idx + 1}</div>
        <div class="diff">${computeWordDiffHtml(s.original, s.proposed)}</div>
        <div class="row">
          <button class="btn primary" data-act="accept" type="button">Accept</button>
          <button class="btn" data-act="show" type="button">Show</button>
          <button class="btn subtle" data-act="reject" type="button">Reject</button>
        </div></li>`;
    })
    .join('');
}

function handleSuggestion(id, action) {
  const s = editor.suggestions.find((x) => x.id === id);
  if (!s) return;
  if (action === 'accept') {
    const ok = editor.acceptSuggestion(id);
    if (!ok) return toast('That text changed since the suggestion was made, so it was not applied.');
    toast('Edit accepted. Cmd+Z to undo.');
    if (Date.now() - state.lastSnapshotAt > 5 * 60 * 1000) {
      state.lastSnapshotAt = Date.now();
      flushSave({ createSnapshot: true, snapshotReason: 'Accepted an edit' });
    }
  } else if (action === 'reject') {
    editor.removeSuggestion(id);
  } else if (action === 'listen') {
    player.say(s.proposed);
  } else if (action === 'show') {
    const loc = editor.locateSuggestion(s);
    if (loc) editor.selectRange(loc.index, loc.start, loc.end);
  }
}

editor.addEventListener('suggestions', renderSuggestions);
editor.addEventListener('suggestion-action', (e) => handleSuggestion(e.detail.id, e.detail.action));
$('#suggestionList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) handleSuggestion(btn.closest('.sugg-item').dataset.id, btn.dataset.act);
});

$('#askInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#askForm').requestSubmit();
  }
});
$$('.quick .chip').forEach((b) => b.addEventListener('click', () => requestEdit(b.dataset.action)));

// ---------- Selection toolbar ----------

const selBar = $('#selToolbar');
let selTimer = null;
let lastSelection = null;
let pendingSelectionTarget = null;
let quietSelection = false; // set when the app selects text itself (flag list), so no toolbar pops up
editor.addEventListener('selection', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    updateTargetLabel();
    const info = editor.getSelectionInfo();
    if (info && !info.multi) pendingSelectionTarget = { index: info.index, start: info.start, end: info.end, text: info.text, kind: 'selection' };
    else if (!info && editor.getCaret()) pendingSelectionTarget = null; // caret collapsed inside the editor
    updateTargetLabel();
    if (!info || player.playing || quietSelection) { selBar.hidden = true; quietSelection = false; return; }
    lastSelection = info;
    selBar.querySelectorAll('[data-sel]').forEach((b) => { b.hidden = info.multi && b.dataset.sel !== 'listen'; });
    selBar.hidden = false;
    const w = selBar.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, info.rect.left + info.rect.width / 2 - w / 2));
    const y = info.rect.top - selBar.offsetHeight - 8 < 60 ? info.rect.bottom + 8 : info.rect.top - selBar.offsetHeight - 8;
    selBar.style.left = `${x}px`;
    selBar.style.top = `${y}px`;
  }, 120);
});
selBar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
selBar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-sel]')?.dataset.sel;
  const info = lastSelection;
  if (!act || !info) return;
  selBar.hidden = true;
  if (act === 'listen') return player.say(info.text);
  if (act === 'heading') return editor.toggleHeading(info.index);
  const target = { index: info.index, start: info.start, end: info.end, text: info.text, kind: 'selection' };
  if (act === 'ask') {
    openPanel('edit');
    $('#targetLabel').textContent = `Working on your selection in paragraph ${info.index + 1}`;
    $('#askInput').focus();
    pendingSelectionTarget = target;
    return;
  }
  requestEdit(act, '', { target });
});
function isQuestionText(text) {
  return /\?\s*$|^(what|why|how|is|does|should|can|could|would|do)\b/i.test(text.trim()) && !/\b(change|make|rewrite|replace|cut|remove|add|shorten|tighten)\b/i.test(text);
}
$('#askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#askInput').value.trim();
  if (!text) return $('#askInput').focus();
  const p = pendingSelectionTarget;
  const stillValid = p && editor.paragraphs[p.index]?.text.slice(p.start, p.end) === p.text;
  const target = stillValid ? p : currentTarget();
  pendingSelectionTarget = null;
  requestEdit(isQuestionText(text) ? 'ask' : 'rewrite', text, { target }).then(() => { $('#askInput').value = ''; });
});

// ---------- Voice commands ----------

function handleVoiceCommand(text) {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^(stop|pause)( reading)?$/.test(t)) return player.pause();
  if (/^(read|play|continue|resume|keep going)( (it|aloud|from here))?$/.test(t)) return startReading();
  if (/^(next|skip)( sentence)?$/.test(t)) return player.jump(1);
  if (/^(back|previous|go back|repeat( that)?)( sentence)?$/.test(t)) return player.queue.length ? (t.startsWith('repeat') ? player.jump(0) : player.jump(-1)) : null;
  if (/^(accept|accept it|accept that|yes)$/.test(t)) {
    const idx = editor.getCaret()?.index ?? editor.currentIndex;
    const s = editor.suggestions.find((x) => x.paraId === editor.paragraphs[idx]?.id) || editor.suggestions.at(-1);
    return s ? handleSuggestion(s.id, 'accept') : toast('No suggestion to accept.');
  }
  if (/^(reject|reject it|discard|no)$/.test(t)) {
    const s = editor.suggestions.at(-1);
    return s ? handleSuggestion(s.id, 'reject') : null;
  }
  if (/^undo( that)?$/.test(t)) return editor.undo();
  $('#askInput').value = text;
  // Edit the sentence that was being read if reading was interrupted, otherwise the selection or paragraph.
  let target = currentTarget();
  const item = player.current;
  if (wasReadingWhenListening && item) {
    target = { index: item.paraIndex, start: item.start, end: item.end, text: item.text, kind: 'sentence' };
  }
  requestEdit(isQuestionText(text) ? 'ask' : 'rewrite', text, { target, speak: true }).then(() => { $('#askInput').value = ''; });
}

let wasReadingWhenListening = false;
function toggleMic() {
  if (!dictation.listening) {
    wasReadingWhenListening = player.playing;
    player.pause();
    openPanel('edit');
  }
  dictation.toggle();
}
dictation.addEventListener('state', (e) => {
  $('#micBtn').setAttribute('aria-pressed', String(e.detail));
  $('#micBtn span').textContent = e.detail ? 'Listening' : 'Speak';
  if (e.detail) $('#askInput').placeholder = 'Listening. Say an instruction, or "read", "stop", "accept".';
  else $('#askInput').placeholder = 'Tell Cadence what to change, or ask a question. Example: make the ending more concrete';
});
dictation.addEventListener('partial', (e) => { $('#askInput').value = e.detail; });
dictation.addEventListener('final', (e) => handleVoiceCommand(e.detail));
dictation.addEventListener('error', (e) => toast(e.detail, 'error'));
$('#micBtn').addEventListener('click', toggleMic);

// ---------- Panel ----------

function openPanel(tab) {
  $('#editorView').classList.remove('panel-hidden');
  $('#panelToggle').setAttribute('aria-pressed', 'true');
  if (tab) selectTab(tab);
}
function selectTab(tab) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  $$('.tabpanel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
$('#panelToggle').addEventListener('click', () => {
  const hidden = $('#editorView').classList.toggle('panel-hidden');
  $('#panelToggle').setAttribute('aria-pressed', String(!hidden));
  try { localStorage.setItem('cadence_panel_hidden', hidden ? '1' : ''); } catch (e) {}
});
try {
  if (localStorage.getItem('cadence_panel_hidden') || window.innerWidth < 1060) {
    $('#editorView').classList.add('panel-hidden');
    $('#panelToggle').setAttribute('aria-pressed', 'false');
  }
} catch (e) {}
$('#showFlags').addEventListener('change', () => {
  editor.setFlagsEnabled($('#showFlags').checked);
  saveConfig({ showFlags: $('#showFlags').checked });
});

// ---------- History ----------

async function loadRevisions() {
  if (!state.doc) return;
  const { revisions } = await api.get(`/api/documents/${state.doc.id}/revisions`).catch(() => ({ revisions: [] }));
  $('#revisionList').innerHTML = revisions.length
    ? revisions
        .map((r, i) => `<li class="rev-item"><div>${escapeHtml(r.reason || 'Version')}<div class="when">${new Date(r.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}${r.wordCount ? `, ${r.wordCount} words` : ''}</div></div><button class="btn" data-rev="${i}" type="button">Restore</button></li>`)
        .join('')
    : '<li class="muted small">No saved versions yet.</li>';
  $('#revisionList').onclick = async (e) => {
    const b = e.target.closest('[data-rev]');
    if (!b) return;
    const rev = revisions[Number(b.dataset.rev)];
    await flushSave({ createSnapshot: true, snapshotReason: 'Before restoring an earlier version' });
    editor.pushUndo();
    editor.paragraphs = rev.paragraphs.map((p) => ({ ...p }));
    editor.render();
    editor.emitChange();
    toast('Earlier version restored. Cmd+Z to undo.');
  };
}
$('#snapshotBtn').addEventListener('click', async () => {
  state.dirty = true;
  await flushSave({ createSnapshot: true, snapshotReason: 'Saved by you' });
  toast('Version saved');
});

// ---------- Export ----------

const exportMenu = $('#exportMenu');
$('#exportBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  $('#exportBtn').setAttribute('aria-expanded', String(!exportMenu.hidden));
  if (!exportMenu.hidden) exportMenu.querySelector('a').focus();
});
document.addEventListener('click', () => { exportMenu.hidden = true; $('#exportBtn').setAttribute('aria-expanded', 'false'); });
exportMenu.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-export]');
  if (!a) return;
  await flushSave();
  const fmt = a.dataset.export;
  const url = `/api/documents/${state.doc.id}/export?format=${fmt}${fmt === 'mp3' ? `&voice=${encodeURIComponent($('#voiceSelect').value)}` : ''}`;
  if (fmt === 'mp3') toast('Preparing audio. This can take a minute for long documents.');
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
});

// ---------- Settings ----------

function renderPronunciations(list) {
  $('#pronList').innerHTML = list
    .map((p, i) => `<li><input type="text" data-p="from" data-i="${i}" value="${escapeHtml(p.from)}" placeholder="Written" aria-label="Written form" /><input type="text" data-p="to" data-i="${i}" value="${escapeHtml(p.to)}" placeholder="Say it as" aria-label="Spoken form" /><button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button></li>`)
    .join('');
}
function readPronunciations() {
  const rows = $$('#pronList li');
  return rows.map((li) => ({ from: li.querySelector('[data-p="from"]').value, to: li.querySelector('[data-p="to"]').value })).filter((p) => p.from.trim());
}
$('#addPronBtn').addEventListener('click', () => {
  const list = readPronunciations();
  list.push({ from: '', to: '' });
  renderPronunciations(list);
  $$('#pronList [data-p="from"]').at(-1).focus();
});
$('#pronList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  const list = $$('#pronList li').map((li) => ({ from: li.querySelector('[data-p="from"]').value, to: li.querySelector('[data-p="to"]').value }));
  list.splice(Number(b.dataset.remove), 1);
  renderPronunciations(list);
});

function openSettings() {
  const c = state.config;
  fillVoiceSelect($('#setVoice'), c.voiceId);
  $$('input[name="theme"]').forEach((r) => { r.checked = r.value === (c.themePreference || 'system'); });
  $('#setApiKey').value = '';
  $('#setApiKey').placeholder = c.hasApiKey ? 'Saved. Type to replace' : 'Not set';
  $('#removeKeyBtn').hidden = !c.hasApiKey;
  renderPronunciations(c.pronunciations || []);
  $('#settingsDialog').showModal();
}
$$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => theme.applyTheme(r.value)));
$('#previewVoiceBtn').addEventListener('click', () => player.say('Ophthalmology first caught my attention at the slit lamp.', $('#setVoice').value));
$('#removeKeyBtn').addEventListener('click', async () => {
  await saveConfig({ apiKey: '' });
  $('#removeKeyBtn').hidden = true;
  $('#setApiKey').placeholder = 'Not set';
  toast('API key removed');
});
$('#settingsDialog').addEventListener('close', async () => {
  const dlg = $('#settingsDialog');
  if (dlg.returnValue !== 'save') {
    theme.applyTheme(state.config.themePreference || 'system');
    return;
  }
  const patch = {
    voiceId: $('#setVoice').value,
    themePreference: $$('input[name="theme"]').find((r) => r.checked)?.value || 'system',
    pronunciations: readPronunciations(),
  };
  const key = $('#setApiKey').value.trim();
  if (key) patch.apiKey = key;
  await saveConfig(patch);
  theme.applyTheme(state.config.themePreference);
  fillVoiceSelect($('#voiceSelect'), state.config.voiceId);
  player.cache.clear();
  toast('Settings saved');
});

// ---------- Commands and shortcuts ----------

document.addEventListener('click', (e) => {
  const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
  if (cmd === 'import') $('#fileInput').click();
  else if (cmd === 'new') newDocument();
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'library') showLibrary();
});

window.addEventListener('keydown', (e) => {
  if ($('#settingsDialog').open || $('#confirmDialog').open) return;
  const inEditor = $('#editorView').hidden === false;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newDocument(); return; }
  if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (!inEditor) return;

  if (e.altKey && (e.code === 'Space')) { e.preventDefault(); togglePlay(); return; }
  if (e.altKey && e.code === 'KeyM') { e.preventDefault(); toggleMic(); return; }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPanel('edit'); $('#askInput').focus(); return; }
  if (mod && e.key === '\\') { e.preventDefault(); $('#panelToggle').click(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); state.dirty = true; flushSave(); return; }
  if (mod && e.key === 'Enter') {
    const idx = editor.getCaret()?.index ?? editor.currentIndex;
    const s = editor.suggestions.find((x) => x.paraId === editor.paragraphs[idx]?.id) || editor.suggestions.at(-1);
    if (s) { e.preventDefault(); handleSuggestion(s.id, 'accept'); }
    return;
  }
  if (e.key === 'Escape') {
    if (!selBar.hidden) { selBar.hidden = true; return; }
    if (player.playing) { player.pause(); return; }
    if (dictation.listening) { dictation.stop(); return; }
  }
  if (!typing || player.playing) {
    if (e.key === ' ' && !typing) { e.preventDefault(); togglePlay(); }
    else if (e.key === '[' && player.queue.length) { e.preventDefault(); player.jump(-1); }
    else if (e.key === ']' && player.queue.length) { e.preventDefault(); player.jump(1); }
  }
});

// ---------- Start ----------

async function init() {
  try {
    await loadConfig();
    await loadLibrary();
    if (!dictation.available) $('#micBtn').title = 'Voice input needs the Cadence app, Safari or Chrome';
  } catch (e) {
    toast(`Could not reach the Cadence server. ${e.message}`, 'error');
  }
}
init();
