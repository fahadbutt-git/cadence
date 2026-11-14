// Document editor: one contenteditable root, one <div class="para"> per paragraph.
// Highlights use the CSS Custom Highlight API so the text DOM is never rewritten while reading.

import { findFlags, sentenceIndexAt, computeWordDiffHtml, escapeHtml } from './core/textUtils.js';

const uid = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const HAS_HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
const PLAINTEXT_OK = (() => {
  const d = document.createElement('div');
  try { d.contentEditable = 'plaintext-only'; } catch (e) { return false; }
  return d.contentEditable === 'plaintext-only';
})();

/** Build a DOM Range covering [start, end) character offsets inside an element. */
export function rangeFromOffsets(el, start, end) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let node;
  let startSet = false;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (!startSet && start <= pos + len) {
      range.setStart(node, Math.max(0, start - pos));
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(node, Math.max(0, end - pos));
      return range;
    }
    pos += len;
  }
  if (!startSet) range.setStart(el, el.childNodes.length);
  range.setEnd(el, el.childNodes.length);
  return range;
}

function offsetWithin(el, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setEnd(node, offset); } catch (e) { return 0; }
  return r.toString().length;
}

export class Editor extends EventTarget {
  constructor(root) {
    super();
    this.root = root;
    this.paragraphs = [];
    this.suggestions = [];
    this.undoStack = [];
    this.redoStack = [];
    this.typingTimer = null;
    this.flagsEnabled = true;
    this.groups = null; // check groups that are on; null means all
    this.layers = {}; // extra highlight layers: name -> [{ index, start, end, expect }]
    this.commentCounts = {}; // paraId -> open comment count
    this.paraMarks = {}; // paraId -> 'changed' | 'inserted' (tracked changes margin bar)
    this.currentIndex = 0;
    this.root.contentEditable = PLAINTEXT_OK ? 'plaintext-only' : 'true';
    this.root.spellcheck = true;
    this.root.setAttribute('role', 'textbox');
    this.root.setAttribute('aria-multiline', 'true');
    this.bind();
  }

  // ---------- Model ----------

  load(paragraphs) {
    this.paragraphs = (paragraphs?.length ? paragraphs : [{ id: uid(), type: 'body', text: '' }]).map((p) => ({
      id: p.id || uid(),
      type: p.type === 'heading' ? 'heading' : 'body',
      text: p.text || '',
    }));
    this.suggestions = [];
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  getParagraphs() {
    return this.paragraphs.map((p) => ({ ...p }));
  }

  plainText() {
    return this.paragraphs.map((p) => p.text).join('\n\n');
  }

  // ---------- Rendering ----------

  render() {
    const ids = new Set(this.paragraphs.map((p) => p.id));
    this.suggestions = this.suggestions.filter((x) => ids.has(x.paraId));
    const frag = document.createDocumentFragment();
    this.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = `para${p.type === 'heading' ? ' heading' : ''}`;
      div.dataset.id = p.id;
      div.dataset.placeholder = i === 0 ? 'Start writing, or paste your draft' : '';
      div.textContent = p.text;
      // An empty block needs a <br> or the browser cannot put the caret in it.
      if (!p.text) { div.appendChild(document.createElement('br')); div.classList.add('is-empty'); }
      frag.appendChild(div);
      const sugg = this.suggestions.find((s) => s.paraId === p.id);
      if (sugg) frag.appendChild(this.buildInlineSuggestion(sugg));
    });
    this.root.replaceChildren(frag);
    this.markCurrent(this.currentIndex);
    this.applyCommentCounts();
    this.applyParaMarks();
    this.refreshFlags();
  }

  paraEl(index) {
    const id = this.paragraphs[index]?.id;
    return id ? this.root.querySelector(`.para[data-id="${CSS.escape(id)}"]`) : null;
  }

  indexOfEl(el) {
    return this.paragraphs.findIndex((p) => p.id === el?.dataset?.id);
  }

  /** Read the DOM back into the model after native editing. */
  syncFromDom() {
    // Stray text or <br> directly under root: wrap into a paragraph.
    for (const node of [...this.root.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        const div = document.createElement('div');
        div.className = 'para';
        div.textContent = node.nodeValue;
        node.replaceWith(div);
      } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('para') && !node.classList.contains('inline-sugg')) {
        if (node.textContent.trim()) {
          const div = document.createElement('div');
          div.className = 'para';
          div.textContent = node.textContent;
          node.replaceWith(div);
        } else {
          node.remove();
        }
      }
    }
    const seen = new Set();
    const next = [];
    for (const el of this.root.querySelectorAll(':scope > .para')) {
      let id = el.dataset.id;
      if (!id || seen.has(id)) { id = uid(); el.dataset.id = id; }
      seen.add(id);
      // Rich-text fallback can insert <br>; keep plain text only.
      if (!PLAINTEXT_OK && el.querySelector('*')) el.textContent = el.textContent;
      const old = this.paragraphs.find((p) => p.id === id);
      el.classList.toggle('is-empty', !el.textContent);
      next.push({ id, type: el.classList.contains('heading') ? 'heading' : old?.type || 'body', text: el.textContent.replace(/\n+$/, '') });
    }
    if (!next.length) {
      this.paragraphs = [{ id: uid(), type: 'body', text: '' }];
      this.render();
      this.setCaret(0, 0);
    } else {
      this.paragraphs = next;
    }
    // Drop inline suggestions whose paragraph disappeared.
    const ids = new Set(this.paragraphs.map((p) => p.id));
    this.suggestions = this.suggestions.filter((s) => ids.has(s.paraId));
    this.root.querySelectorAll('.inline-sugg').forEach((n) => { if (!ids.has(n.dataset.para)) n.remove(); });
  }

  // ---------- Caret ----------

  getCaret() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !this.root.contains(sel.anchorNode)) return null;
    const el = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('.para');
    if (!el) return null;
    return { index: this.indexOfEl(el), offset: offsetWithin(el, sel.anchorNode, sel.anchorOffset) };
  }

  /** Selection inside a single paragraph, or null. */
  getSelectionInfo() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.root.contains(range.commonAncestorContainer)) return null;
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('.para');
    const endEl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest('.para');
    if (!startEl || !endEl) return null;
    const text = range.toString();
    if (!text.trim()) return null;
    if (startEl !== endEl) return { multi: true, text, rect: range.getBoundingClientRect() };
    const start = offsetWithin(startEl, range.startContainer, range.startOffset);
    const end = offsetWithin(startEl, range.endContainer, range.endOffset);
    return { multi: false, index: this.indexOfEl(startEl), start, end, text, rect: range.getBoundingClientRect() };
  }

  setCaret(index, offset = 0, { focus = true, scroll = true } = {}) {
    const el = this.paraEl(Math.max(0, Math.min(index, this.paragraphs.length - 1)));
    if (!el) return;
    if (focus) this.root.focus({ preventScroll: true });
    const r = rangeFromOffsets(el, offset, offset);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    if (scroll) this.scrollToRect(r.getBoundingClientRect().height ? r.getBoundingClientRect() : el.getBoundingClientRect());
  }

  selectRange(index, start, end) {
    const el = this.paraEl(index);
    if (!el) return;
    this.root.focus({ preventScroll: true });
    const r = rangeFromOffsets(el, start, end);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    this.scrollToRect(r.getBoundingClientRect());
  }

  /** Where reading should start: caret position, or the start of the current paragraph. */
  readingStart() {
    const c = this.getCaret();
    if (!c || c.index < 0) return { paraIndex: this.currentIndex, sentIndex: 0 };
    return { paraIndex: c.index, sentIndex: sentenceIndexAt(this.paragraphs[c.index].text, c.offset) };
  }

  markCurrent(index) {
    if (index < 0) return;
    this.currentIndex = index;
    this.root.querySelectorAll('.para.current').forEach((n) => n.classList.remove('current'));
    this.paraEl(index)?.classList.add('current');
  }

  scrollToRect(rect) {
    const scroller = this.root.closest('.desk');
    if (!scroller || !rect) return;
    const box = scroller.getBoundingClientRect();
    const top = box.top + box.height * 0.2;
    const bottom = box.top + box.height * 0.7;
    if (rect.top >= top && rect.bottom <= bottom) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollBy({ top: rect.top - (box.top + box.height * 0.35), behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---------- Highlights ----------

  setReadingHighlight(paraIndex, start, end) {
    this.root.querySelectorAll('.para.reading').forEach((n) => n.classList.remove('reading'));
    const el = this.paraEl(paraIndex);
    if (!el) return;
    el.classList.add('reading');
    this.markCurrent(paraIndex);
    const r = rangeFromOffsets(el, start, end);
    if (HAS_HIGHLIGHTS) CSS.highlights.set('reading', new Highlight(r));
    this.scrollToRect(r.getBoundingClientRect());
  }

  clearReadingHighlight() {
    if (HAS_HIGHLIGHTS) CSS.highlights.delete('reading');
    this.root.querySelectorAll('.para.reading').forEach((n) => n.classList.remove('reading'));
  }

  focusFlag(index, start, end) {
    const el = this.paraEl(index);
    if (!el) return;
    if (HAS_HIGHLIGHTS) {
      CSS.highlights.set('focus-flag', new Highlight(rangeFromOffsets(el, start, end)));
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => CSS.highlights.delete('focus-flag'), 2200);
    }
    this.selectRange(index, start, end);
  }

  /** All flags with paragraph positions. */
  collectFlags() {
    const out = [];
    this.paragraphs.forEach((p, index) => {
      for (const f of findFlags(p.text, this.groups)) out.push({ ...f, index });
    });
    return out;
  }

  refreshFlags() {
    if (HAS_HIGHLIGHTS) {
      const word = [];
      const hard = [];
      if (this.flagsEnabled) {
        this.paragraphs.forEach((p, i) => {
          const el = this.paraEl(i);
          if (!el) return;
          for (const f of findFlags(p.text, this.groups)) (f.sentence ? hard : word).push(rangeFromOffsets(el, f.start, f.end));
        });
      }
      word.length ? CSS.highlights.set('flag', new Highlight(...word)) : CSS.highlights.delete('flag');
      hard.length ? CSS.highlights.set('hard', new Highlight(...hard)) : CSS.highlights.delete('hard');
    }
    for (const name of Object.keys(this.layers)) this.drawLayer(name);
  }

  setFlagsEnabled(on) {
    this.flagsEnabled = on;
    this.refreshFlags();
  }

  setGroups(groups) {
    this.groups = groups;
    this.refreshFlags();
  }

  /** Named highlight layer (grammar, comment, find). Items whose text no longer matches are skipped. */
  setLayer(name, items = []) {
    this.layers[name] = items;
    this.drawLayer(name);
  }

  drawLayer(name) {
    if (!HAS_HIGHLIGHTS) return;
    const ranges = [];
    for (const it of this.layers[name] || []) {
      const p = this.paragraphs[it.index];
      if (!p || (it.expect !== undefined && p.text.slice(it.start, it.end) !== it.expect)) continue;
      const el = this.paraEl(it.index);
      if (el) ranges.push(rangeFromOffsets(el, it.start, it.end));
    }
    ranges.length ? CSS.highlights.set(name, new Highlight(...ranges)) : CSS.highlights.delete(name);
  }

  setCommentCounts(counts = {}) {
    this.commentCounts = counts;
    this.applyCommentCounts();
  }

  applyCommentCounts() {
    this.root.querySelectorAll(':scope > .para').forEach((el) => {
      const n = this.commentCounts[el.dataset.id] || 0;
      if (n) el.dataset.comments = String(n);
      else delete el.dataset.comments;
    });
  }

  setParaMarks(marks = {}) {
    this.paraMarks = marks;
    this.applyParaMarks();
  }

  applyParaMarks() {
    this.root.querySelectorAll(':scope > .para').forEach((el) => {
      const m = this.paraMarks[el.dataset.id];
      if (m) el.dataset.track = m;
      else delete el.dataset.track;
    });
  }

  /** Replace the whole paragraph list in one undo step (reject all, restore). */
  setParagraphs(next, { caret = null } = {}) {
    this.pushUndo();
    this.paragraphs = next.map((p) => ({ id: p.id || uid(), type: p.type === 'heading' ? 'heading' : 'body', text: p.text || '' }));
    if (!this.paragraphs.length) this.paragraphs = [{ id: uid(), type: 'body', text: '' }];
    this.render();
    if (caret) this.setCaret(caret.index, caret.offset, { focus: false });
    this.emitChange();
  }

  /** Move the paragraph with the caret (or the selected paragraphs) up or down one place. */
  moveParagraph(dir) {
    const sel = document.getSelection();
    let first = this.getCaret()?.index ?? this.currentIndex;
    let last = first;
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      const a = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest('.para');
      const b = (r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement)?.closest('.para');
      if (a && b) { first = this.indexOfEl(a); last = this.indexOfEl(b); }
    }
    if (first < 0 || last < 0) return false;
    if ((dir < 0 && first === 0) || (dir > 0 && last >= this.paragraphs.length - 1)) return false;
    const caret = this.getCaret();
    this.pushUndo();
    const block = this.paragraphs.splice(first, last - first + 1);
    this.paragraphs.splice(first + dir, 0, ...block);
    this.render();
    if (caret) this.setCaret(caret.index + dir, caret.offset);
    this.emitChange();
    return true;
  }

  /** Words in the current selection, across paragraphs. */
  selectionWordCount() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.root.contains(sel.anchorNode)) return 0;
    return sel.toString().split(/\s+/).filter(Boolean).length;
  }

  /** Replace every match of a pattern in one undo step. Returns the number of replacements. */
  replaceAllMatches(regex, replacement) {
    let count = 0;
    const next = this.paragraphs.map((p) => {
      const text = p.text.replace(regex, () => { count++; return replacement; });
      return { ...p, text };
    });
    if (!count) return 0;
    this.pushUndo();
    this.paragraphs = next;
    this.render();
    this.emitChange();
    return count;
  }

  /** Offset of the caret inside its paragraph, or null. */
  caretOffset() {
    return this.getCaret();
  }

  // ---------- Undo ----------

  snapshot() {
    return { paragraphs: this.getParagraphs(), caret: this.getCaret() };
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  restore(state) {
    this.paragraphs = state.paragraphs.map((p) => ({ ...p }));
    this.render();
    if (state.caret) this.setCaret(state.caret.index, state.caret.offset);
    this.emitChange();
  }

  undo() {
    if (!this.undoStack.length) return false;
    clearTimeout(this.typingTimer); this.typingTimer = null;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  // ---------- Structural edits ----------

  splitAtCaret() {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) document.execCommand('delete');
    this.syncFromDom();
    const c = this.getCaret();
    if (!c || c.index < 0) return;
    this.pushUndo();
    const p = this.paragraphs[c.index];
    const before = p.text.slice(0, c.offset).replace(/\s+$/, '');
    const after = p.text.slice(c.offset).replace(/^\s+/, '');
    p.text = before;
    const fresh = { id: uid(), type: 'body', text: after };
    this.paragraphs.splice(c.index + 1, 0, fresh);
    this.render();
    this.setCaret(c.index + 1, 0);
    this.emitChange();
  }

  toggleHeading(index = this.getCaret()?.index ?? this.currentIndex) {
    const p = this.paragraphs[index];
    if (!p) return;
    this.pushUndo();
    p.type = p.type === 'heading' ? 'body' : 'heading';
    const c = this.getCaret();
    this.render();
    if (c) this.setCaret(c.index, c.offset, { scroll: false });
    this.emitChange();
  }

  insertPlainText(text) {
    const normalized = text.replace(/\r\n?/g, '\n');
    const blocks = normalized.split(/\n\s*\n|\n/).map((b) => b.trim());
    this.pushUndo();
    if (blocks.length <= 1) {
      document.execCommand('insertText', false, normalized.replace(/\n/g, ' '));
      return;
    }
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) document.execCommand('delete');
    this.syncFromDom();
    const c = this.getCaret() || { index: this.paragraphs.length - 1, offset: this.paragraphs.at(-1).text.length };
    const p = this.paragraphs[c.index];
    const head = p.text.slice(0, c.offset);
    const tail = p.text.slice(c.offset);
    p.text = head + blocks[0];
    const added = blocks.slice(1).filter(Boolean).map((t) => ({ id: uid(), type: 'body', text: t }));
    const last = added.at(-1);
    const caretOffset = last.text.length;
    last.text += tail;
    this.paragraphs.splice(c.index + 1, 0, ...added);
    this.render();
    this.setCaret(c.index + added.length, caretOffset);
    this.emitChange();
  }

  /** Replace a span of text (used by accepted suggestions). */
  replaceSpan(index, start, end, replacement) {
    const p = this.paragraphs[index];
    if (!p) return false;
    this.pushUndo();
    p.text = p.text.slice(0, start) + replacement + p.text.slice(end);
    this.render();
    this.setCaret(index, start + replacement.length, { focus: false });
    this.emitChange();
    return true;
  }

  // ---------- Suggestions ----------

  addSuggestion(s) {
    this.suggestions = this.suggestions.filter((x) => x.paraId !== s.paraId);
    this.suggestions.push(s);
    const el = this.root.querySelector(`.para[data-id="${CSS.escape(s.paraId)}"]`);
    this.root.querySelector(`.inline-sugg[data-para="${CSS.escape(s.paraId)}"]`)?.remove();
    if (el) el.after(this.buildInlineSuggestion(s));
    this.dispatchEvent(new Event('suggestions'));
  }

  removeSuggestion(id) {
    const s = this.suggestions.find((x) => x.id === id);
    this.suggestions = this.suggestions.filter((x) => x.id !== id);
    if (s) this.root.querySelector(`.inline-sugg[data-para="${CSS.escape(s.paraId)}"]`)?.remove();
    this.dispatchEvent(new Event('suggestions'));
  }

  clearSuggestions() {
    this.suggestions = [];
    this.root.querySelectorAll('.inline-sugg').forEach((n) => n.remove());
    this.dispatchEvent(new Event('suggestions'));
  }

  /** Find where a suggestion's original text now lives; returns { index, start, end } or null. */
  locateSuggestion(s) {
    const index = this.paragraphs.findIndex((p) => p.id === s.paraId);
    if (index < 0) return null;
    const text = this.paragraphs[index].text;
    if (text.slice(s.start, s.end) === s.original) return { index, start: s.start, end: s.end };
    const at = text.indexOf(s.original);
    return at >= 0 ? { index, start: at, end: at + s.original.length } : null;
  }

  acceptSuggestion(id) {
    const s = this.suggestions.find((x) => x.id === id);
    if (!s) return false;
    const loc = this.locateSuggestion(s);
    this.suggestions = this.suggestions.filter((x) => x.id !== id);
    if (!loc) {
      this.render();
      this.dispatchEvent(new Event('suggestions'));
      return false;
    }
    this.replaceSpan(loc.index, loc.start, loc.end, s.proposed);
    this.dispatchEvent(new Event('suggestions'));
    return true;
  }

  buildInlineSuggestion(s) {
    const box = document.createElement('div');
    box.className = 'inline-sugg';
    box.contentEditable = 'false';
    box.dataset.para = s.paraId;
    box.dataset.sugg = s.id;
    box.innerHTML =
      (s.rationale ? `<p class="why">${escapeHtml(s.rationale)}</p>` : '') +
      `<div class="diff">${computeWordDiffHtml(s.original, s.proposed)}</div>` +
      '<div class="row">' +
      '<button class="btn primary" data-sugg-act="accept" type="button" title="Cmd+Enter">Accept</button>' +
      '<button class="btn" data-sugg-act="listen" type="button">Listen</button>' +
      '<button class="btn subtle" data-sugg-act="reject" type="button">Reject</button>' +
      '</div>';
    return box;
  }

  // ---------- Events ----------

  emitChange() {
    this.dispatchEvent(new Event('change'));
    clearTimeout(this.flagTimer);
    this.flagTimer = setTimeout(() => this.refreshFlags(), 200);
  }

  bind() {
    const r = this.root;

    r.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo') { e.preventDefault(); this.undo(); return; }
      if (e.inputType === 'historyRedo') { e.preventDefault(); this.redo(); return; }
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();
        this.splitAtCaret();
        return;
      }
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') return; // handled by paste/drop
      // Group typing into one undo step per pause.
      if (!this.typingTimer) this.pushUndo();
      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => { this.typingTimer = null; }, 900);
    });

    r.addEventListener('input', () => {
      this.syncFromDom();
      const c = this.getCaret();
      if (c) this.markCurrent(c.index);
      this.emitChange();
    });

    r.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text) this.insertPlainText(text);
    });

    r.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) return; // file import handled by app
      const text = e.dataTransfer?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      this.insertPlainText(text);
    });

    r.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.altKey && e.shiftKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // Word's shortcut for moving a paragraph.
        e.preventDefault();
        this.moveParagraph(e.key === 'ArrowUp' ? -1 : 1);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        this.toggleHeading();
      } else if (e.key === 'Backspace' && !e.metaKey) {
        // Merge with the previous paragraph ourselves so ids and types stay sane.
        const sel = document.getSelection();
        const c = this.getCaret();
        if (sel?.isCollapsed && c && c.offset === 0 && c.index > 0) {
          e.preventDefault();
          this.pushUndo();
          const prev = this.paragraphs[c.index - 1];
          const joinAt = prev.text.length;
          prev.text += this.paragraphs[c.index].text;
          this.paragraphs.splice(c.index, 1);
          this.render();
          this.setCaret(c.index - 1, joinAt);
          this.emitChange();
        }
      } else if (e.key === 'Delete') {
        const sel = document.getSelection();
        const c = this.getCaret();
        if (sel?.isCollapsed && c && c.index < this.paragraphs.length - 1 && c.offset === this.paragraphs[c.index].text.length) {
          e.preventDefault();
          this.pushUndo();
          const p = this.paragraphs[c.index];
          p.text += this.paragraphs[c.index + 1].text;
          this.paragraphs.splice(c.index + 1, 1);
          this.render();
          this.setCaret(c.index, c.offset);
          this.emitChange();
        }
      }
    });

    r.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sugg-act]');
      if (btn) {
        const box = btn.closest('.inline-sugg');
        this.dispatchEvent(new CustomEvent('suggestion-action', { detail: { id: box.dataset.sugg, action: btn.dataset.suggAct } }));
        return;
      }
      const el = e.target.closest('.para');
      if (el) {
        const index = this.indexOfEl(el);
        // The comment count bubble sits in the right margin of the paragraph.
        if (el.dataset.comments && e.clientX > el.getBoundingClientRect().right) {
          this.dispatchEvent(new CustomEvent('comment-marker', { detail: { index, paraId: el.dataset.id } }));
          return;
        }
        this.markCurrent(index);
        this.dispatchEvent(new CustomEvent('para-click', { detail: { index, x: e.clientX, y: e.clientY } }));
      }
    });

    document.addEventListener('selectionchange', () => {
      const c = this.getCaret();
      if (c && c.index >= 0 && c.index !== this.currentIndex) this.markCurrent(c.index);
      this.dispatchEvent(new Event('selection'));
    });
  }
}
