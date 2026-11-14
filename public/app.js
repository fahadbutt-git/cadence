import { ThemeManager } from './js/core/themeManager.js';
import { buildSentenceReadQueue, computeBurstinessStats, computeWordDiffHtml, escapeHtml, findFlags } from './js/core/textUtils.js';
import { Editor, rangeFromOffsets } from './js/editor.js';
import { Player } from './js/player.js';
import { Dictation } from './js/dictation.js';
import { parseCommand, isBargeIn, cleanTranscript, VOICE_HELP } from './js/core/voiceCommands.js';
import { Comments } from './js/comments.js';
import { LanguageChecker } from './js/language.js';
import { FindBar } from './js/find.js';
import { Tracker } from './js/tracking.js';
import { WordChoice } from './js/wordchoice.js';

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
const comments = new Comments(editor, { list: $('#commentList'), empty: $('#commentsEmpty'), count: $('#commentCount'), showResolved: $('#showResolved') });
const language = new LanguageChecker(editor, $('#issuePop'));
const tracker = new Tracker(editor, { list: $('#changeList'), empty: $('#changesEmpty'), count: $('#changeCount'), markup: $('#markup') });
const wordChoice = new WordChoice(editor, $('#choicePop'), api);
const finder = new FindBar(editor, {
  bar: $('#findBar'), input: $('#findInput'), replace: $('#replaceInput'), count: $('#findCount'),
  prev: $('#findPrev'), next: $('#findNext'), one: $('#replaceOne'), all: $('#replaceAll'), matchCase: $('#findCase'), close: $('#findClose'),
});

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
  const groups = state.config.checkGroups || {};
  $$('[data-group]').forEach((cb) => { cb.checked = groups[cb.dataset.group] !== false; });
  editor.groups = { house: groups.house !== false, clarity: groups.clarity !== false, style: groups.style !== false };
  language.enabled = state.config.grammarCheck !== false;
  editor.root.spellcheck = !language.enabled; // the built-in checker would double up the underlines
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
  stopTalk();
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
    comments.load(doc.comments || []);
    tracker.load(doc.tracking);
    setTrackUi();
    wordChoice.hide();
    finder.close();
    language.hide();
    language.schedule(0);
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
    comments: comments.all(),
    tracking: tracker.toJSON(),
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
comments.addEventListener('change', () => scheduleSave());
editor.addEventListener('change', () => {
  scheduleSave();
  language.schedule();
  tracker.schedule();
  comments.render();
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
  updateCheckBadge(flags);

  $('#statsGrid').innerHTML = [
    [stats.wordCount.toLocaleString('en-CA') + (target ? ` / ${target.toLocaleString('en-CA')}` : ''), 'Words'],
    [stats.sentenceCount, 'Sentences'],
    [stats.burstinessCv.toFixed(2), 'Sentence variety, aim for 0.45 or more'],
    [stats.gradeLevel.toFixed(1), 'Reading grade level'],
    [stats.longSentences, 'Sentences over 25 words'],
    [stats.charCount.toLocaleString('en-CA'), 'Characters with spaces'],
      ]
    .map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`)
    .join('');

  $('#flagsEmpty').hidden = flags.length > 0;
  $('#flagList').innerHTML = flags
    .slice(0, 200)
    .map((f, i) => `<li class="flag-item" data-i="${i}" tabindex="0"><span class="snippet"><b>${escapeHtml((() => { const t = f.text.replace(/^[,\s]+/, '') || f.text; return t.length > 60 ? t.slice(0, 60) + '…' : t; })())}</b><span class="muted">${f.label}</span></span><span class="where">Paragraph ${f.index + 1}</span></li>`)
    .join('');
  $('#flagList').onclick = (e) => {
    const li = e.target.closest('.flag-item');
    if (!li) return;
    const f = flags[Number(li.dataset.i)];
    quietSelection = true;
    editor.focusFlag(f.index, f.start, f.end);
  };

  $('#reportText').textContent = 'Open this to run the full report.';
  renderIssues();
  renderStrip();
}

function renderIssues() {
  const list = language.enabled ? language.issues : [];
  $('#issuesEmpty').hidden = list.length > 0;
  $('#issuesEmpty').textContent = language.enabled ? 'No spelling or grammar issues found.' : 'Spelling and grammar checking is off. Turn it on in Settings.';
  $('#issueList').innerHTML = list
    .slice(0, 200)
    .map((i, n) => `<li class="flag-item issue-item" data-n="${n}" tabindex="0"><span><b>${escapeHtml(i.text.length > 40 ? i.text.slice(0, 40) + '…' : i.text)}</b>${
      i.suggestions[0] !== undefined ? `<button class="btn subtle fix" data-fix="${n}" type="button" title="Apply">${i.suggestions[0] === '' ? 'Remove' : escapeHtml(i.suggestions[0])}</button>` : ''
    }<br><span class="muted">${escapeHtml(i.message.replace(/`/g, ''))}</span></span><span class="where">Paragraph ${i.index + 1}</span></li>`)
    .join('');
}
$('#issueList').addEventListener('click', (e) => {
  const fix = e.target.closest('[data-fix]');
  const li = e.target.closest('.issue-item');
  if (!li) return;
  const issue = language.issues[Number(li.dataset.n)];
  if (!issue) return;
  if (fix) return language.apply(issue, issue.suggestions[0]);
  quietSelection = true;
  editor.selectRange(issue.index, issue.start, issue.end);
});
// The badge counts what usually needs fixing: spelling, grammar and stock AI phrasing.
function updateCheckBadge(flags = editor.collectFlags()) {
  const n = flags.filter((f) => f.group === 'house').length + (language.enabled ? language.issues.length : 0);
  $('#flagCount').hidden = n === 0;
  $('#flagCount').textContent = n;
}
language.addEventListener('change', () => {
  renderIssues();
  updateCheckBadge();
});
language.addEventListener('error', (e) => console.warn('Grammar check:', e.detail));
language.addEventListener('add-word', async (e) => {
  try {
    state.config = await api.post('/api/dictionary', { word: e.detail });
    language.clearCache();
    toast(`Added "${e.detail}" to your dictionary`);
  } catch (err) {
    toast(err.message, 'error');
  }
});
// Click an underlined word to see suggestions.
editor.addEventListener('para-click', (e) => {
  if (!language.enabled) return;
  const c = editor.getCaret();
  const sel = document.getSelection();
  if (!c || !sel?.isCollapsed) return language.hide();
  const issue = language.issueAt(c.index, c.offset);
  if (!issue) return language.hide();
  const el = editor.paraEl(issue.index);
  const range = el && rangeFromOffsets(el, issue.start, issue.end);
  if (range) language.show(issue, range.getBoundingClientRect());
});
$$('[data-group]').forEach((cb) => cb.addEventListener('change', () => {
  const groups = Object.fromEntries($$('[data-group]').map((x) => [x.dataset.group, x.checked]));
  editor.setGroups(groups);
  saveConfig({ checkGroups: groups });
  refreshDerived();
}));

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
    for (const f of findFlags(p.text, editor.groups)) if (f.group === 'house' || f.kind === 'veryhard') flagSet.add(`${pi}:${f.start}`);
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
  if (!talk.on) dictation.stop();
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
  talk.lastReadAt = Date.now();
  state.pausePoint = { paraIndex: item.paraIndex, sentIndex: item.sentIndex };
  if (talk.on) caption('cadence', `Reading paragraph ${item.paraIndex + 1}`);
});

player.addEventListener('state', (e) => {
  const playing = e.detail.playing;
  $('#playBtn').classList.toggle('playing', playing);
  $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Read aloud');
  if (!playing && state.doc) {
    const item = player.current;
    if (item) {
      state.pausePoint = { paraIndex: item.paraIndex, sentIndex: item.sentIndex };
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

async function requestEdit(action, instruction = '', { target = currentTarget(), speak = false, conversational = false } = {}) {
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
    if (speak && (res.spokenReply || res.rationale)) {
      const tail = conversational && res.proposedText ? ' Say accept, read it, or reject. Then say continue.' : '';
      (conversational ? say : (t) => player.say(t))((res.spokenReply || res.rationale) + tail);
    }
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
    $('#choiceBtn').textContent = WordChoice.isShort(info.text) ? 'Synonyms' : 'Reword';
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
  if (act === 'comment') {
    pendingSelectionTarget = { index: info.index, start: info.start, end: info.end, text: info.text, kind: 'selection' };
    return openCommentComposer();
  }
  if (act === 'heading') return editor.toggleHeading(info.index);
  if (act === 'choice') return wordChoice.open({ index: info.index, start: info.start, end: info.end, text: info.text }, info.rect, { style: $('#styleSelect').value });
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

// ---------- Conversation mode ----------
// Talk keeps the microphone open. Speaking while Cadence reads pauses it (barge-in),
// the utterance is parsed into a command or an edit, and "continue" resumes from the paused sentence.

const talk = { on: false, lastSaid: '', lastReadAt: 0, bargeCtx: null };

function caption(who, text) {
  const el = $('#caption');
  if (!talk.on && who !== 'cadence') { el.hidden = true; return; }
  el.hidden = !text;
  el.dataset.who = who;
  $('#captionWho').textContent = who === 'you' ? 'You' : who === 'cadence' ? 'Cadence' : '';
  $('#captionText').textContent = text;
}

function say(text) {
  if (!text) return;
  talk.lastSaid = text;
  caption('cadence', text);
  player.say(text);
}

// What Cadence is saying right now, which the microphone may also be hearing.
function echoContext() {
  const ctx = [];
  if (!player.playing && !player.audio.paused) ctx.push(talk.lastSaid); // a spoken reply is playing
  const item = player.current;
  if (item) {
    ctx.push(item.text);
    const prev = player.queue[player.cursor - 1];
    const next = player.queue[player.cursor + 1];
    if (prev) ctx.push(prev.text);
    if (next) ctx.push(next.text);
  }
  return ctx;
}

function resumeFromPause() {
  const p = state.pausePoint;
  if (p && p.paraIndex < editor.paragraphs.length) startReading({ paraIndex: p.paraIndex, sentIndex: p.sentIndex });
  else startReading();
}

function moveSentence(delta) {
  const all = buildSentenceReadQueue(editor.paragraphs, 0, 0);
  if (!all.length) return;
  const p = state.pausePoint || editor.readingStart();
  let i = all.findIndex((s) => s.paraIndex === p.paraIndex && s.sentIndex === p.sentIndex);
  if (i < 0) i = 0;
  const t = all[Math.max(0, Math.min(all.length - 1, i + delta))];
  startReading({ paraIndex: t.paraIndex, sentIndex: t.sentIndex });
}

function goToParagraph(index) {
  const n = editor.paragraphs.length;
  const i = index < 0 ? n - 1 : Math.max(0, Math.min(n - 1, index));
  startReading({ paraIndex: i, sentIndex: 0 });
}

function stepRate(dir) {
  const opts = [...$('#rateSelect').options].map((o) => o.value);
  const i = opts.indexOf($('#rateSelect').value);
  const next = opts[Math.max(0, Math.min(opts.length - 1, i + dir))];
  $('#rateSelect').value = next;
  $('#rateSelect').dispatchEvent(new Event('change'));
  return next;
}

/** Target for a spoken edit: selection, the sentence just read, or the paragraph at the caret. */
function voiceTarget(scope) {
  const sel = editor.getSelectionInfo();
  if ((scope === 'selection' || scope === 'auto') && sel && !sel.multi) {
    return { index: sel.index, start: sel.start, end: sel.end, text: sel.text, kind: 'selection' };
  }
  const p = state.pausePoint;
  const recentlyRead = p && Date.now() - talk.lastReadAt < 10 * 60 * 1000;
  if (p && (scope === 'sentence' || (scope === 'auto' && recentlyRead))) {
    const para = editor.paragraphs[p.paraIndex];
    const r = para && buildSentenceReadQueue([para], 0, p.sentIndex)[0];
    if (r) return { index: p.paraIndex, start: r.start, end: r.end, text: r.text, kind: 'sentence' };
  }
  const index = p && (scope === 'paragraph' || recentlyRead) ? p.paraIndex : Math.max(0, editor.getCaret()?.index ?? editor.currentIndex);
  const para = editor.paragraphs[index];
  return para ? { index, start: 0, end: para.text.length, text: para.text, kind: 'paragraph' } : null;
}

function suggestionHere() {
  const p = state.pausePoint;
  const idx = p ? p.paraIndex : editor.getCaret()?.index ?? editor.currentIndex;
  return editor.suggestions.find((x) => x.paraId === editor.paragraphs[idx]?.id) || editor.suggestions.at(-1);
}

function describeChange(h) {
  if (!h) return '';
  const short = (t) => t.trim().split(/\s+/).slice(0, 12).join(' ').replace(/[.!?,;:]+$/, '');
  if (h.kind === 'para-del') return `A removed paragraph that began, ${short(h.del)}.`;
  if (h.kind === 'para-ins') return `A new paragraph, ${short(h.ins)}.`;
  if (h.del && h.ins) return `${short(h.del)}, changed to, ${short(h.ins)}.`;
  return h.ins ? `Added, ${short(h.ins)}.` : `Deleted, ${short(h.del)}.`;
}

async function runCommand(cmd, heard) {
  switch (cmd.type) {
    case 'none': return;
    case 'pause': player.pause(); return say('Paused.');
    case 'resume': caption('cadence', 'Reading'); return resumeFromPause();
    case 'restart': return goToParagraph(0);
    case 'next': return moveSentence(1);
    case 'prev': return moveSentence(-1);
    case 'repeat': return moveSentence(0);
    case 'nextParagraph': return goToParagraph((state.pausePoint?.paraIndex ?? editor.currentIndex) + 1);
    case 'prevParagraph': return goToParagraph((state.pausePoint?.paraIndex ?? editor.currentIndex) - 1);
    case 'gotoParagraph': return goToParagraph(cmd.n < 0 ? -1 : cmd.n - 1);
    case 'trackOn': await toggleTracking(true); return say('Tracking changes.');
    case 'trackOff': {
      const n = tracker.hunks.length;
      if (n) return say(`There ${n === 1 ? 'is one change' : `are ${n} changes`} to review first. Say accept all changes, or reject all changes.`);
      await toggleTracking(false);
      return say('Tracking is off.');
    }
    case 'nextChange':
    case 'prevChange': {
      const h = tracker.step(cmd.type === 'nextChange' ? 1 : -1);
      if (!h) return say('There are no tracked changes.');
      return say(describeChange(h));
    }
    case 'acceptAllChanges': { const n = tracker.acceptAll(); return say(n ? `Accepted ${n} change${n === 1 ? '' : 's'}.` : 'There are no changes to accept.'); }
    case 'rejectAllChanges': { const n = tracker.rejectAll(); return say(n ? `Rejected ${n} change${n === 1 ? '' : 's'}. Say undo to bring them back.` : 'There are no changes to reject.'); }
    case 'accept': {
      const s = suggestionHere();
      if (!s && tracker.activeId) { tracker.accept(tracker.activeId); return say(tracker.activeId ? `Accepted. Next: ${describeChange(tracker.find(tracker.activeId))}` : 'Accepted. That was the last change.'); }
      if (!s) return say('There is no suggestion to accept.');
      handleSuggestion(s.id, 'accept');
      return say('Done. Say continue when you are ready.');
    }
    case 'reject': {
      const s = suggestionHere();
      if (!s && tracker.activeId) { tracker.reject(tracker.activeId); return say(tracker.activeId ? `Rejected. Next: ${describeChange(tracker.find(tracker.activeId))}` : 'Rejected. That was the last change.'); }
      if (!s) return say('Nothing to reject.');
      handleSuggestion(s.id, 'reject');
      return say('Kept the original.');
    }
    case 'readSuggestion': {
      const s = suggestionHere();
      return s ? say(s.proposed) : resumeFromPause();
    }
    case 'undo': return editor.undo() ? say('Undone.') : say('Nothing to undo.');
    case 'redo': return editor.redo() ? say('Redone.') : say('Nothing to redo.');
    case 'faster': return say(`Speed ${stepRate(1)}.`);
    case 'slower': return say(`Speed ${stepRate(-1)}.`);
    case 'flags': {
      const idx = state.pausePoint?.paraIndex ?? editor.currentIndex;
      const f = editor.collectFlags().filter((x) => x.index === idx);
      return say(f.length ? `${f.length} flagged in this paragraph: ${[...new Set(f.map((x) => x.text.replace(/^[,\s]+/, '')))].slice(0, 5).join(', ')}.` : 'Nothing flagged in this paragraph.');
    }
    case 'snapshot':
      state.dirty = true;
      await flushSave({ createSnapshot: true, snapshotReason: 'Saved by voice' });
      return say('Version saved.');
    case 'stopTalking': stopTalk(); return say('Okay. Talk is off.');
    case 'comment': {
      let paraId = null;
      let index = null;
      if (!cmd.general) {
        index = state.pausePoint?.paraIndex ?? editor.getCaret()?.index ?? editor.currentIndex;
        paraId = editor.paragraphs[index]?.id || null;
      }
      comments.add({ paraId, text: cmd.text });
      return say(paraId ? `Comment added to paragraph ${index + 1}.` : 'General comment added.');
    }
    case 'help': return say(VOICE_HELP);
    case 'ask':
    case 'edit': {
      let target = voiceTarget(cmd.scope);
      if (!target) return say('Put the cursor in a paragraph first.');
      // "Replace X with Y": widen to the paragraph, then the document, when X is not in the target.
      const named = cmd.type === 'edit' && cmd.instruction.match(/\b(?:replace|change|swap|delete|remove|cut)\s+["“']?(.+?)["”']?(?:\s+(?:with|to|for)\s|$)/i);
      if (named && !target.text.toLowerCase().includes(named[1].toLowerCase())) {
        const want = named[1].toLowerCase();
        const order = [target.index, ...editor.paragraphs.map((_, i) => i).filter((i) => i !== target.index)];
        const hit = order.find((i) => editor.paragraphs[i].text.toLowerCase().includes(want));
        if (hit === undefined) return say(`I could not find ${named[1]} in the document.`);
        const para = editor.paragraphs[hit];
        target = { index: hit, start: 0, end: para.text.length, text: para.text, kind: 'paragraph' };
      }
      caption('cadence', cmd.type === 'ask' ? 'Thinking' : `Working on the ${target.kind}`);
      $('#askInput').value = heard;
      await requestEdit(cmd.type === 'ask' ? 'ask' : cmd.action, cmd.type === 'ask' ? cmd.question : cmd.instruction, { target, speak: true, conversational: true });
      $('#askInput').value = '';
      return;
    }
    default: return;
  }
}

function startTalk() {
  if (!dictation.available) return toast('Voice input needs the Cadence app, Safari or Chrome.', 'error');
  talk.on = true;
  dictation.start({ continuous: true });
  setTalkUi(true);
  caption('cadence', player.playing ? 'Listening. Talk any time to interrupt.' : 'Listening. Say continue to start reading, or tell me what to change.');
}

function stopTalk() {
  talk.on = false;
  dictation.stop();
  setTalkUi(false);
}

function toggleTalk() {
  return talk.on ? stopTalk() : startTalk();
}

function setTalkUi(on) {
  for (const b of [$('#talkBtn'), $('#micBtn')]) b.setAttribute('aria-pressed', String(on));
  $('#talkBtn span').textContent = on ? 'Talking' : 'Talk';
  $('#micBtn span').textContent = on ? 'Talking' : 'Talk';
  if (!on) $('#caption').hidden = true;
}

dictation.addEventListener('state', (e) => {
  if (!e.detail && talk.on) { talk.on = false; setTalkUi(false); }
});
dictation.addEventListener('partial', (e) => {
  const text = e.detail;
  if (!talk.on) { $('#askInput').value = text; return; }
  const speaking = player.playing || !player.audio.paused;
  if (speaking) {
    const ctx = echoContext();
    if (!isBargeIn(text, ctx)) return; // the microphone is hearing Cadence's own voice
    talk.bargeCtx = ctx; // keep it to strip the echo from the final transcript
    player.pause();
    player.stopAudio();
  }
  caption('you', talk.bargeCtx ? cleanTranscript(text, talk.bargeCtx) : text);
});
dictation.addEventListener('final', (e) => {
  const speaking = player.playing || !player.audio.paused;
  if (talk.on && speaking && !isBargeIn(e.detail, echoContext())) return;
  const ctx = talk.bargeCtx || (speaking ? echoContext() : []);
  talk.bargeCtx = null;
  const heard = ctx.length ? cleanTranscript(e.detail, ctx) : e.detail.trim();
  if (!heard) return;
  caption('you', heard);
  runCommand(parseCommand(heard), heard);
});
dictation.addEventListener('error', (e) => toast(e.detail, 'error'));
$('#micBtn').addEventListener('click', toggleTalk);
$('#talkBtn').addEventListener('click', toggleTalk);

// ---------- Comments ----------

let commentTarget = null; // { paraId, quote, index } or null for the whole document

function resolveCommentTarget() {
  if ($('#commentGeneral').checked) return null;
  const p = pendingSelectionTarget;
  if (p && editor.paragraphs[p.index]?.text.slice(p.start, p.end) === p.text) {
    return { paraId: editor.paragraphs[p.index].id, quote: p.text, index: p.index };
  }
  const index = Math.max(0, editor.getCaret()?.index ?? state.pausePoint?.paraIndex ?? editor.currentIndex);
  const para = editor.paragraphs[index];
  return para ? { paraId: para.id, quote: '', index } : null;
}

function updateCommentTargetLabel() {
  commentTarget = resolveCommentTarget();
  const t = commentTarget;
  $('#commentTarget').textContent = !t
    ? 'Comment on the whole document'
    : t.quote
      ? `Comment on "${t.quote.length > 50 ? t.quote.slice(0, 50) + '…' : t.quote}" in paragraph ${t.index + 1}`
      : `Comment on paragraph ${t.index + 1}`;
}

function openCommentComposer({ general = false } = {}) {
  openPanel('comments');
  $('#commentGeneral').checked = general;
  updateCommentTargetLabel();
  $('#commentInput').focus();
}

$('#commentGeneral').addEventListener('change', updateCommentTargetLabel);
$('#commentInput').addEventListener('focus', updateCommentTargetLabel);
$('#commentForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#commentInput').value.trim();
  if (!text) return $('#commentInput').focus();
  const t = resolveCommentTarget();
  comments.add({ paraId: t?.paraId || null, quote: t?.quote || '', text });
  $('#commentInput').value = '';
  pendingSelectionTarget = null;
  $('#commentGeneral').checked = false;
  updateCommentTargetLabel();
});
$('#commentInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#commentForm').requestSubmit(); }
});
editor.addEventListener('selection', () => {
  const c = editor.getCaret();
  if (c && c.index >= 0) comments.setActive(editor.paragraphs[c.index]?.id);
  if (!$('[data-panel="comments"]').hidden && document.activeElement !== $('#commentInput')) {
    clearTimeout(commentLabelTimer);
    commentLabelTimer = setTimeout(updateCommentTargetLabel, 150);
  }
});
let commentLabelTimer = null;
editor.addEventListener('comment-marker', (e) => {
  openPanel('comments');
  comments.setActive(e.detail.paraId);
  $(`#commentList .comment-item[data-para="${CSS.escape(e.detail.paraId)}"]`)?.scrollIntoView({ block: 'nearest' });
});
comments.addEventListener('suggest', async (e) => {
  const c = e.detail;
  const loc = comments.locate(c);
  if (!loc) return toast('That paragraph no longer exists.');
  const para = editor.paragraphs[loc.index];
  const target = loc.end > loc.start
    ? { index: loc.index, start: loc.start, end: loc.end, text: para.text.slice(loc.start, loc.end), kind: 'selection' }
    : { index: loc.index, start: 0, end: para.text.length, text: para.text, kind: 'paragraph' };
  openPanel('edit');
  await requestEdit('rewrite', `Revise to address this reviewer comment: ${c.text}`, { target });
});
$('#reviewBtn').addEventListener('click', async () => {
  const btn = $('#reviewBtn');
  btn.disabled = true;
  btn.textContent = 'Reading the draft';
  try {
    const res = await api.post('/api/review', { paragraphs: editor.paragraphs.map((p) => ({ type: p.type, text: p.text })), style: $('#styleSelect').value });
    const n = comments.addMany(res.comments.map((c) => ({ paraId: c.paraIndex === null ? null : editor.paragraphs[c.paraIndex]?.id || null, quote: c.quote || '', text: c.text })));
    toast(res.notice || (n ? `Added ${n} comment${n === 1 ? '' : 's'}${res.source === 'offline' ? ' from the offline checks. Add a Gemini key in Settings for full feedback.' : ''}` : 'No comments to add.'));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get editor feedback';
  }
});

// ---------- Track changes ----------

function setTrackUi() {
  $('#trackToggle').setAttribute('aria-pressed', String(tracker.on));
  $('#trackOn').checked = tracker.on;
  $('#markupView').value = tracker.view;
  const any = tracker.hunks.length > 0;
  ['#acceptAll', '#rejectAll', '#changePrev', '#changeNext'].forEach((sel) => { $(sel).disabled = !any; });
}

async function toggleTracking(force) {
  const turnOn = force ?? !tracker.on;
  if (turnOn) {
    tracker.start();
    openPanel('changes');
    toast('Tracking changes. Edits now show as changes you can accept or reject.');
  } else if (tracker.on || tracker.baseline) {
    const n = tracker.hunks.length;
    if (n && !(await confirmDialog(`Stop tracking? The ${n} pending change${n === 1 ? '' : 's'} will be kept in the text as accepted. Reject any you do not want first.`))) {
      setTrackUi();
      return;
    }
    tracker.stop();
    toast('Tracking stopped');
  }
  setTrackUi();
}

tracker.addEventListener('change', () => { scheduleSave(); setTrackUi(); });
tracker.addEventListener('update', setTrackUi);
tracker.addEventListener('view', (e) => {
  $('#paper').hidden = e.detail === 'all';
  $('#markupView').value = e.detail;
  if (e.detail === 'all') { selBar.hidden = true; language.hide(); }
});
$('#trackToggle').addEventListener('click', () => toggleTracking());
$('#trackOn').addEventListener('change', () => toggleTracking($('#trackOn').checked));
$('#markupView').addEventListener('change', () => tracker.setView($('#markupView').value));
$('#changeNext').addEventListener('click', () => tracker.step(1));
$('#changePrev').addEventListener('click', () => tracker.step(-1));
$('#acceptAll').addEventListener('click', () => { const n = tracker.acceptAll(); if (n) toast(`Accepted ${n} change${n === 1 ? '' : 's'}`); });
$('#rejectAll').addEventListener('click', async () => {
  const n = tracker.hunks.length;
  if (!n || !(await confirmDialog(`Reject all ${n} change${n === 1 ? '' : 's'} and go back to the text as it was when tracking started? Cmd+Z undoes this.`))) return;
  tracker.rejectAll();
  toast(`Rejected ${n} change${n === 1 ? '' : 's'}`);
});
$('#changeList').addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-hunk]');
  if (!li) return;
  if (e.key === 'Enter') { e.preventDefault(); tracker.select(li.dataset.hunk, { reveal: true }); }
  if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); tracker.accept(li.dataset.hunk); $('#changeList [data-hunk].active')?.focus(); }
  if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); tracker.reject(li.dataset.hunk); $('#changeList [data-hunk].active')?.focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus(); }
});

// ---------- Word choice ----------

wordChoice.addEventListener('applied', (e) => toast(`Changed to "${e.detail}". Cmd+Z to undo.`));
document.addEventListener('mousedown', (e) => { if (!$('#choicePop').hidden && !e.target.closest('#choicePop')) wordChoice.hide(); });

// ---------- Selection word count ----------

let selCountTimer = null;
editor.addEventListener('selection', () => {
  clearTimeout(selCountTimer);
  selCountTimer = setTimeout(() => {
    const n = editor.selectionWordCount();
    if (n) $('#docStats').textContent = `${n.toLocaleString('en-CA')} of ${computeBurstinessStats(editor.paragraphs).wordCount.toLocaleString('en-CA')} words selected`;
    else if ($('#docStats').dataset.sel) refreshDerived();
    $('#docStats').dataset.sel = n ? '1' : '';
  }, 150);
});

// ---------- Find and focus ----------

$('#findToggle').addEventListener('click', () => (finder.isOpen ? finder.close() : finder.open()));
function setFocusMode(on) {
  $('#paper').classList.toggle('focus', on);
  $('#focusToggle').setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('cadence_focus', on ? '1' : ''); } catch (e) {}
}
$('#focusToggle').addEventListener('click', () => setFocusMode(!$('#paper').classList.contains('focus')));
try { if (localStorage.getItem('cadence_focus')) setFocusMode(true); } catch (e) {}

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
        .map((r, i) => `<li class="rev-item"><div>${escapeHtml(r.reason || 'Version')}<div class="when">${new Date(r.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}${r.wordCount ? `, ${r.wordCount} words` : ''}</div></div><button class="btn" data-rev="${i}" type="button">Compare</button></li>`)
        .join('')
    : '<li class="muted small">No saved versions yet.</li>';
  $('#revisionList').onclick = (e) => {
    const b = e.target.closest('[data-rev]');
    if (b) compareVersion(revisions[Number(b.dataset.rev)]);
  };
}

function compareVersion(rev) {
  const now = editor.paragraphs;
  const byId = new Map(now.map((p, i) => [p.id, i]));
  const blocks = [];
  let added = 0;
  let removed = 0;
  const seen = new Set();
  rev.paragraphs.forEach((old, i) => {
    const j = byId.has(old.id) ? byId.get(old.id) : i < now.length && !rev.paragraphs.some((x) => x.id === now[i].id) ? i : -1;
    const cur = j >= 0 ? now[j] : null;
    if (cur) seen.add(cur.id);
    const before = old.text;
    const after = cur ? cur.text : '';
    if (before === after) return;
    const wb = before.split(/\s+/).filter(Boolean).length;
    const wa = after.split(/\s+/).filter(Boolean).length;
    added += Math.max(0, wa - wb);
    removed += Math.max(0, wb - wa);
    blocks.push(`<div class="compare-para"><div class="where">${cur ? `Paragraph ${j + 1}` : 'Removed since this version'}</div>${computeWordDiffHtml(before, after)}</div>`);
  });
  now.forEach((p, j) => {
    if (seen.has(p.id) || rev.paragraphs.some((x) => x.id === p.id)) return;
    if (!p.text.trim()) return;
    added += p.text.split(/\s+/).filter(Boolean).length;
    blocks.push(`<div class="compare-para"><div class="where">Paragraph ${j + 1}, new since this version</div><ins>${escapeHtml(p.text)}</ins></div>`);
  });
  $('#compareTitle').textContent = `${rev.reason || 'Version'}, ${new Date(rev.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`;
  $('#compareSummary').textContent = blocks.length
    ? `${blocks.length} paragraph${blocks.length === 1 ? '' : 's'} differ. Struck-through text is in the saved version only, underlined text is in your current draft.`
    : 'This version matches your current text.';
  $('#compareBody').innerHTML = blocks.join('');
  const dlg = $('#compareDialog');
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'restore') return;
    await flushSave({ createSnapshot: true, snapshotReason: 'Before restoring an earlier version' });
    editor.pushUndo();
    editor.paragraphs = rev.paragraphs.map((p) => ({ ...p }));
    editor.render();
    editor.emitChange();
    toast('Earlier version restored. Cmd+Z to undo.');
  }, { once: true });
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
  const kind = a.dataset.export;
  const fmt = kind.startsWith('docx') ? 'docx' : kind;
  const clean = kind === 'docx-clean' ? '&comments=0&changes=0' : kind === 'docx-final' ? '&changes=0' : '';
  const url = `/api/documents/${state.doc.id}/export?format=${fmt}${clean}${fmt === 'mp3' ? `&voice=${encodeURIComponent($('#voiceSelect').value)}` : ''}`;
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

function renderDictionary() {
  const words = state.config.dictionary || [];
  $('#dictList').innerHTML = words.length
    ? words.map((w) => `<li>${escapeHtml(w)}<button type="button" class="icon-btn" data-word="${escapeHtml(w)}" aria-label="Remove ${escapeHtml(w)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg></button></li>`).join('')
    : '<li class="muted small" style="border:0">No words yet.</li>';
}
$('#dictList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-word]');
  if (!b) return;
  state.config = await api.post('/api/dictionary', { word: b.dataset.word, remove: true });
  renderDictionary();
  language.clearCache();
});

function openSettings() {
  const c = state.config;
  fillVoiceSelect($('#setVoice'), c.voiceId);
  $$('input[name="theme"]').forEach((r) => { r.checked = r.value === (c.themePreference || 'system'); });
  $('#setApiKey').value = '';
  $('#setApiKey').placeholder = c.hasApiKey ? 'Saved. Type to replace' : 'Not set';
  $('#removeKeyBtn').hidden = !c.hasApiKey;
  renderPronunciations(c.pronunciations || []);
  $('#setReviewer').value = c.reviewerName || '';
  $('#setGrammar').checked = c.grammarCheck !== false;
  renderDictionary();
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
    reviewerName: $('#setReviewer').value.trim(),
    grammarCheck: $('#setGrammar').checked,
  };
  const key = $('#setApiKey').value.trim();
  if (key) patch.apiKey = key;
  await saveConfig(patch);
  theme.applyTheme(state.config.themePreference);
  fillVoiceSelect($('#voiceSelect'), state.config.voiceId);
  player.cache.clear();
  editor.root.spellcheck = !state.config.grammarCheck;
  if (language.enabled !== state.config.grammarCheck) language.setEnabled(state.config.grammarCheck);
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
  if (e.altKey && !mod && e.code === 'KeyM') { e.preventDefault(); toggleTalk(); return; }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPanel('edit'); $('#askInput').focus(); return; }
  if (mod && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); finder.open({ withReplace: e.altKey }); return; }
  if (mod && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); $('#focusToggle').click(); return; }
  if (mod && e.altKey && e.code === 'KeyM') { e.preventDefault(); openCommentComposer(); return; }
  if (mod && e.key.toLowerCase() === 'g' && finder.isOpen) { e.preventDefault(); finder.step(e.shiftKey ? -1 : 1); return; }
  if (mod && e.key === '\\') { e.preventDefault(); $('#panelToggle').click(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); state.dirty = true; flushSave(); return; }
  if (mod && e.key === 'Enter') {
    const idx = editor.getCaret()?.index ?? editor.currentIndex;
    const s = editor.suggestions.find((x) => x.paraId === editor.paragraphs[idx]?.id) || editor.suggestions.at(-1);
    if (s) { e.preventDefault(); handleSuggestion(s.id, 'accept'); }
    return;
  }
  if (mod && e.shiftKey && e.code === 'KeyE') { e.preventDefault(); toggleTracking(); return; }
  if (e.key === 'Escape') {
    if (!$('#choicePop').hidden) { wordChoice.hide(); return; }
    if (tracker.view === 'all' && !typing) { tracker.setView('simple'); return; }
    if (!$('#issuePop').hidden) { language.hide(); return; }
    if (finder.isOpen) { finder.close(); return; }
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
