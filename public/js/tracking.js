// Track changes, in the spirit of Word's Track Changes and Google Docs' Suggesting mode.
// When tracking starts, the current text becomes the baseline. Every edit after that, typed,
// dictated or accepted from a suggestion, shows as a change that can be accepted or rejected.
// Accepting moves the baseline forward. Rejecting puts the baseline wording back in the text.

import { trackChanges, acceptHunkInBaseline, rejectHunkInCurrent, escapeHtml } from './core/textUtils.js';

const clone = (list) => list.map((p) => ({ id: p.id, type: p.type, text: p.text }));

export class Tracker extends EventTarget {
  constructor(editor, { list, empty, count, markup }) {
    super();
    this.editor = editor;
    this.listEl = list;
    this.emptyEl = empty;
    this.countEl = count;
    this.markupEl = markup;
    this.on = false;
    this.baseline = null;
    this.startedAt = null;
    this.view = 'simple'; // simple | all | none
    this.result = { paragraphs: [], deleted: [], hunks: [] };
    this.activeId = null;
    this.timer = null;
    this.listEl.addEventListener('click', (e) => this.onListClick(e));
    this.markupEl.addEventListener('click', (e) => {
      const h = e.target.closest('[data-h]');
      if (h) this.select(h.dataset.h, { scroll: true, fromMarkup: true });
    });
    this.markupEl.addEventListener('dblclick', () => this.setView('simple'));
  }

  // ---------- State ----------

  load(tracking) {
    this.on = Boolean(tracking?.on);
    this.baseline = Array.isArray(tracking?.baseline) ? clone(tracking.baseline) : null;
    this.startedAt = tracking?.startedAt || null;
    this.activeId = null;
    this.refresh();
  }

  toJSON() {
    return { on: this.on, baseline: this.baseline, startedAt: this.startedAt };
  }

  get hunks() {
    return this.result.hunks;
  }

  start() {
    if (this.on) return;
    this.on = true;
    if (!this.baseline) {
      this.baseline = clone(this.editor.paragraphs);
      this.startedAt = new Date().toISOString();
    }
    this.changed();
  }

  /** Stop recording. Pending changes are accepted so later edits are not mistaken for them. */
  stop() {
    this.on = false;
    this.baseline = null;
    this.startedAt = null;
    this.changed();
  }

  setView(view) {
    this.view = view;
    this.dispatchEvent(new CustomEvent('view', { detail: view }));
    this.draw();
  }

  /** Recompute after edits. Cheap enough per keystroke pause. */
  schedule(delay = 250) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  refresh() {
    this.result = this.baseline ? trackChanges(this.baseline, this.editor.paragraphs) : { paragraphs: [], deleted: [], hunks: [] };
    if (this.activeId && !this.hunks.some((h) => h.id === this.activeId)) this.activeId = null;
    this.draw();
    this.dispatchEvent(new Event('update'));
  }

  changed() {
    this.refresh();
    this.dispatchEvent(new Event('change'));
  }

  // ---------- Decisions ----------

  find(id) {
    return this.hunks.find((h) => h.id === id);
  }

  accept(id) {
    const h = this.find(id);
    if (!h) return false;
    const at = this.hunks.indexOf(h);
    this.editor.pushUndo(); // so Cmd+Z undoes the accept itself
    this.baseline = acceptHunkInBaseline(this.baseline, h, this.editor.paragraphs);
    this.refresh();
    this.focusIndex(at);
    this.dispatchEvent(new Event('change'));
    return true;
  }

  reject(id) {
    const h = this.find(id);
    if (!h) return false;
    const at = this.hunks.indexOf(h);
    const caret = this.editor.getCaret();
    this.editor.setParagraphs(rejectHunkInCurrent(this.editor.paragraphs, h, this.baseline), { caret });
    this.refresh();
    this.focusIndex(at);
    this.dispatchEvent(new Event('change'));
    return true;
  }

  /** After a decision, the change that moved into its place (ids shift as offsets change). */
  focusIndex(at) {
    const h = this.hunks[Math.min(at, this.hunks.length - 1)];
    this.activeId = h ? h.id : null;
    this.draw();
  }

  acceptAll() {
    const n = this.hunks.length;
    if (!n) return 0;
    this.editor.pushUndo();
    this.baseline = clone(this.editor.paragraphs);
    this.activeId = null;
    this.changed();
    return n;
  }

  rejectAll() {
    const n = this.hunks.length;
    if (!n) return 0;
    this.editor.setParagraphs(clone(this.baseline));
    this.activeId = null;
    this.changed();
    return n;
  }

  /** Step to the next or previous change from the active one or the caret. */
  step(dir) {
    if (!this.hunks.length) return null;
    let i = this.hunks.findIndex((h) => h.id === this.activeId);
    if (i < 0) {
      const c = this.editor.getCaret();
      const pos = (h) => {
        if (h.kind === 'para-del') return h.afterId ? [this.editor.paragraphs.findIndex((p) => p.id === h.afterId), Infinity] : [0, 0];
        return [this.editor.paragraphs.findIndex((p) => p.id === h.paraId), h.kind === 'text' || h.kind === 'join' || h.kind === 'split' ? h.curStart ?? 0 : 0];
      };
      if (c) {
        const after = this.hunks.findIndex((h) => { const [pi, off] = pos(h); return pi > c.index || (pi === c.index && off >= c.offset); });
        i = dir > 0 ? (after < 0 ? 0 : after) - 1 : after < 0 ? this.hunks.length : after;
      } else {
        i = dir > 0 ? -1 : this.hunks.length;
      }
    }
    const next = this.hunks[(i + dir + this.hunks.length) % this.hunks.length];
    this.select(next.id, { scroll: true, reveal: true });
    return next;
  }

  select(id, { scroll = false, reveal = false } = {}) {
    this.activeId = id;
    this.draw();
    const li = this.listEl.querySelector(`[data-hunk="${CSS.escape(id)}"]`);
    if (scroll) li?.scrollIntoView({ block: 'nearest' });
    const h = this.find(id);
    if (!h) return;
    if (this.view === 'all') {
      this.markupEl.querySelector(`[data-h="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } else if (reveal) {
      const index = this.editor.paragraphs.findIndex((p) => p.id === (h.kind === 'para-del' ? h.afterId : h.paraId));
      if (index >= 0) {
        if ((h.kind === 'text' || h.kind === 'join') && h.curEnd > h.curStart) this.editor.selectRange(index, h.curStart, h.curEnd);
        else this.editor.setCaret(index, h.kind === 'text' || h.kind === 'split' ? h.curStart : 0);
      }
    }
    this.dispatchEvent(new CustomEvent('select', { detail: h }));
  }

  onListClick(e) {
    const btn = e.target.closest('[data-hact]');
    const li = e.target.closest('[data-hunk]');
    if (!li) return;
    const id = li.dataset.hunk;
    if (btn?.dataset.hact === 'accept') return this.accept(id);
    if (btn?.dataset.hact === 'reject') return this.reject(id);
    this.select(id, { reveal: true });
  }

  // ---------- Drawing ----------

  draw() {
    const hunks = this.hunks;
    const marks = {};
    const ins = [];
    const paraIndex = new Map(this.editor.paragraphs.map((p, i) => [p.id, i]));
    if (this.view !== 'none') {
      for (const h of hunks) {
        const id = h.kind === 'para-del' ? h.afterId : h.paraId;
        if (id && paraIndex.has(id)) marks[id] = marks[id] || (h.kind === 'para-ins' ? 'inserted' : 'changed');
        if (h.kind === 'split' && paraIndex.has(h.newId)) marks[h.newId] = 'changed';
        if (['text', 'para-ins', 'join'].includes(h.kind) && h.curEnd > h.curStart) ins.push({ index: paraIndex.get(h.paraId), start: h.curStart, end: h.curEnd });
      }
    }
    this.editor.setParaMarks(marks);
    this.editor.setLayer('track-ins', ins);

    if (this.countEl) {
      this.countEl.hidden = !hunks.length;
      this.countEl.textContent = hunks.length;
    }
    this.emptyEl.hidden = hunks.length > 0;
    this.emptyEl.textContent = this.on
      ? 'Tracking is on. Edits you make from now on show here to accept or reject.'
      : 'Turn on Track changes to record your edits. Each one can then be accepted or rejected, and Word exports show them as tracked changes your reader can review.';
    const hadFocus = this.listEl.contains(document.activeElement);
    this.listEl.innerHTML = hunks
      .map((h) => {
        const where = this.describeWhere(h, paraIndex);
        const body =
          h.kind === 'move' || h.kind === 'format' || h.kind === 'join' || h.kind === 'split'
            ? `<span class="change-plain">${escapeHtml(clip(h.kind === 'join' || h.kind === 'split' ? h.text : h.ins, 160))}</span>`
            : h.kind === 'para-del'
            ? `<del>${escapeHtml(clip(h.del, 220))}</del>`
            : h.kind === 'para-ins'
              ? `<ins>${escapeHtml(clip(h.ins, 220))}</ins>`
              : `${h.del ? `<del>${escapeHtml(clip(h.del, 160))}</del>` : ''}${h.del && h.ins ? ' ' : ''}${h.ins ? `<ins>${escapeHtml(clip(h.ins, 160))}</ins>` : ''}`;
        return `<li class="change${h.id === this.activeId ? ' active' : ''}" data-hunk="${escapeHtml(h.id)}" tabindex="0"><div class="change-text">${body}</div><div class="change-foot"><span class="where">${where}</span><span class="row"><button class="btn" data-hact="accept" type="button">Accept</button><button class="btn subtle" data-hact="reject" type="button">Reject</button></span></div></li>`;
      })
      .join('');
    // Keep keyboard focus in the list after it is rebuilt.
    if (hadFocus) (this.listEl.querySelector('.change.active') || this.listEl.querySelector('.change'))?.focus({ preventScroll: true });

    this.markupEl.hidden = this.view !== 'all';
    if (this.view === 'all') this.markupEl.innerHTML = this.markupHtml();
  }

  describeWhere(h, paraIndex) {
    const n = (id) => (paraIndex.has(id) ? paraIndex.get(id) + 1 : null);
    if (h.kind === 'para-del') return h.afterId ? `Paragraph removed after paragraph ${n(h.afterId)}` : 'Paragraph removed at the start';
    if (h.kind === 'para-ins') return `New paragraph ${n(h.paraId)}`;
    if (h.kind === 'join') return `Paragraph joined to paragraph ${n(h.paraId)}`;
    if (h.kind === 'split') return `Paragraph ${n(h.paraId)} split in two`;
    if (h.kind === 'move') return `Paragraph moved to position ${n(h.paraId)}`;
    if (h.kind === 'format') return `Paragraph ${n(h.paraId)} changed to ${h.to === 'heading' ? 'a heading' : 'body text'}`;
    const verb = h.del && h.ins ? 'Replaced' : h.ins ? 'Added' : 'Deleted';
    return `${verb} in paragraph ${n(h.paraId)}`;
  }

  /** Full redline: deletions struck through, insertions underlined, like Word's All Markup. */
  markupHtml() {
    const { paragraphs, deleted } = this.result;
    const typeOf = new Map(this.editor.paragraphs.map((p) => [p.id, p.type]));
    const active = this.activeId;
    const cls = (id) => (id === active ? ' class="active"' : '');
    const delBlock = (afterId) =>
      deleted
        .filter((d) => d.afterId === afterId && d.text.trim())
        .map((d) => {
          const hid = d.moved ? `mv:${d.id}` : this.hunks.some((h) => h.id === `join:${d.id}`) ? `join:${d.id}` : `del:${d.id}`;
          return `<div class="para${d.type === 'heading' ? ' heading' : ''}${d.moved ? ' moved-from' : ''}"><del data-h="${escapeHtml(hid)}"${cls(hid)}>${escapeHtml(d.text)}</del></div>`;
        })
        .join('');
    let html = delBlock(null);
    for (const p of paragraphs) {
      const heading = typeOf.get(p.id) === 'heading' ? ' heading' : '';
      let inner = '';
      const splitHunk = this.hunks.find((h) => h.kind === 'split' && h.newId === p.id);
      if (p.status === 'inserted' || p.moved) {
        const hid = p.moved ? `mv:${p.id}` : splitHunk ? splitHunk.id : `ins:${p.id}`;
        inner = p.text || p.segments.length ? `<ins data-h="${escapeHtml(hid)}"${cls(hid)}>${escapeHtml(this.editor.paragraphs.find((x) => x.id === p.id)?.text || '')}</ins>` : '';
      } else {
        let hid = null;
        for (const s of p.segments) {
          if (s.type === 'same') { hid = null; inner += escapeHtml(s.text); continue; }
          if (!hid) hid = this.hunks.find((h) => (h.kind === 'join' || h.kind === 'split') && h.paraId === p.id && h.curStart === s.curStart)?.id || `${p.id}:${s.baseStart}:${s.curStart}`;
          inner += `<${s.type} data-h="${escapeHtml(hid)}"${cls(hid)}>${escapeHtml(s.text)}</${s.type}>`;
        }
      }
      html += `<div class="para${heading}">${inner || '<br>'}</div>${delBlock(p.id)}`;
    }
    return html;
  }
}

function clip(text, n) {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
