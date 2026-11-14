// Comments: general notes on the whole document, or notes anchored to a paragraph and optional phrase.
// Stored with the document. Shown as margin counts, highlighted phrases, and a list in the Comments tab.

import { escapeHtml } from './core/textUtils.js';

const uid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class Comments extends EventTarget {
  constructor(editor, { list, empty, count, showResolved }) {
    super();
    this.editor = editor;
    this.listEl = list;
    this.emptyEl = empty;
    this.countEl = count;
    this.showResolvedEl = showResolved;
    this.items = [];
    this.activeParaId = null;
    this.listEl.addEventListener('click', (e) => this.onClick(e));
    this.showResolvedEl.addEventListener('change', () => this.render());
  }

  load(items = []) {
    this.items = items.map((c) => ({ ...c }));
    this.render();
  }

  all() {
    return this.items.map((c) => ({ ...c }));
  }

  get open() {
    return this.items.filter((c) => !c.resolved);
  }

  add({ paraId = null, quote = '', text }) {
    const c = { id: uid(), paraId, quote: paraId ? quote : '', text: text.trim(), createdAt: new Date().toISOString(), resolved: false };
    if (!c.text) return null;
    this.items.push(c);
    this.changed();
    return c;
  }

  addMany(list = []) {
    let n = 0;
    for (const c of list) {
      if (!c.text?.trim()) continue;
      this.items.push({ id: uid(), paraId: c.paraId || null, quote: c.paraId ? c.quote || '' : '', text: c.text.trim(), createdAt: new Date().toISOString(), resolved: false });
      n++;
    }
    if (n) this.changed();
    return n;
  }

  update(id, patch) {
    const c = this.items.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    this.changed();
  }

  remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.changed();
  }

  changed() {
    this.render();
    this.dispatchEvent(new Event('change'));
  }

  setActive(paraId) {
    if (paraId === this.activeParaId) return;
    this.activeParaId = paraId;
    this.listEl.querySelectorAll('.comment-item').forEach((li) => li.classList.toggle('active', li.dataset.para === paraId));
  }

  /** Where a comment's phrase sits now: { index, start, end } or the paragraph, or null if the paragraph is gone. */
  locate(c) {
    if (!c.paraId) return null;
    const index = this.editor.paragraphs.findIndex((p) => p.id === c.paraId);
    if (index < 0) return null;
    const text = this.editor.paragraphs[index].text;
    const at = c.quote ? text.indexOf(c.quote) : -1;
    return at >= 0 ? { index, start: at, end: at + c.quote.length } : { index, start: 0, end: 0 };
  }

  render() {
    const paras = this.editor.paragraphs;
    const order = new Map(paras.map((p, i) => [p.id, i]));
    const showResolved = this.showResolvedEl.checked;
    const visible = this.items
      .filter((c) => showResolved || !c.resolved)
      .sort((a, b) => (a.paraId ? order.get(a.paraId) ?? 1e9 : -1) - (b.paraId ? order.get(b.paraId) ?? 1e9 : -1) || a.createdAt.localeCompare(b.createdAt));

    this.listEl.innerHTML = visible
      .map((c) => {
        const idx = c.paraId ? order.get(c.paraId) : undefined;
        const where = !c.paraId ? 'Whole document' : idx === undefined ? 'Paragraph removed' : `Paragraph ${idx + 1}`;
        return `<li class="comment-item${c.resolved ? ' resolved' : ''}${c.paraId && c.paraId === this.activeParaId ? ' active' : ''}" data-id="${c.id}" data-para="${c.paraId || ''}">
          <div class="where" data-act="show" title="Show in the text">${where}</div>
          ${c.quote ? `<div class="quote">${escapeHtml(c.quote)}</div>` : ''}
          <div class="body">${escapeHtml(c.text)}</div>
          <div class="row">
            ${c.resolved || !c.paraId ? '' : `<button class="btn subtle" data-act="suggest" type="button" title="Ask Cadence for an edit that addresses this comment">Suggest edit</button>`}
            <button class="btn subtle" data-act="${c.resolved ? 'reopen' : 'resolve'}" type="button">${c.resolved ? 'Reopen' : 'Resolve'}</button>
            <button class="btn subtle" data-act="delete" type="button">Delete</button>
          </div></li>`;
      })
      .join('');
    this.emptyEl.hidden = visible.length > 0;

    const open = this.open;
    this.countEl.hidden = open.length === 0;
    this.countEl.textContent = open.length;

    const counts = {};
    for (const c of open) if (c.paraId) counts[c.paraId] = (counts[c.paraId] || 0) + 1;
    this.editor.setCommentCounts(counts);
    this.drawHighlights();
  }

  drawHighlights() {
    const items = [];
    for (const c of this.open) {
      if (!c.quote) continue;
      const loc = this.locate(c);
      if (loc && loc.end > loc.start) items.push({ ...loc, expect: c.quote });
    }
    this.editor.setLayer('comment', items);
  }

  onClick(e) {
    const btn = e.target.closest('[data-act]');
    const li = e.target.closest('.comment-item');
    if (!btn || !li) return;
    const c = this.items.find((x) => x.id === li.dataset.id);
    if (!c) return;
    const act = btn.dataset.act;
    if (act === 'resolve') this.update(c.id, { resolved: true });
    else if (act === 'reopen') this.update(c.id, { resolved: false });
    else if (act === 'delete') this.remove(c.id);
    else if (act === 'suggest') this.dispatchEvent(new CustomEvent('suggest', { detail: c }));
    else if (act === 'show') {
      const loc = this.locate(c);
      if (loc) loc.end > loc.start ? this.editor.selectRange(loc.index, loc.start, loc.end) : this.editor.setCaret(loc.index, 0);
    }
  }
}
