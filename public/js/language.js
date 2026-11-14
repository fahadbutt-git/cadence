// Spelling and grammar: asks the local server (Harper) about changed paragraphs,
// draws underlines, and shows a suggestion card when an underlined word is clicked.

import { escapeHtml } from './core/textUtils.js';

export class LanguageChecker extends EventTarget {
  constructor(editor, popEl) {
    super();
    this.editor = editor;
    this.pop = popEl;
    this.enabled = true;
    this.cache = new Map(); // paragraph text -> issues (offsets inside that paragraph)
    this.issues = []; // [{ index, start, end, text, kind, message, suggestions }]
    this.ignored = new Set();
    this.timer = null;
    this.seq = 0;
    this.current = null;
    this.bindPopover();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.issues = [];
      this.editor.setLayer('grammar', []);
      this.emit();
    } else {
      this.schedule(0);
    }
  }

  clearCache() {
    this.cache.clear();
    this.schedule(0);
  }

  schedule(delay = 700) {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    this.timer = setTimeout(() => this.run(), delay);
  }

  key(issue, paraText) {
    return `${issue.kind}\u0000${issue.text}\u0000${paraText}`;
  }

  async run() {
    const seq = ++this.seq;
    const paras = this.editor.paragraphs.map((p) => p.text);
    const missing = [...new Set(paras.filter((t) => t.trim() && !this.cache.has(t)))];
    if (missing.length) {
      try {
        const res = await fetch('/api/grammar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paragraphs: missing }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Grammar check failed');
        const { issues } = await res.json();
        missing.forEach((t) => this.cache.set(t, []));
        for (const i of issues) this.cache.get(missing[i.paraIndex]).push(i);
        if (this.cache.size > 400) this.cache = new Map([...this.cache].slice(-200));
      } catch (e) {
        if (seq === this.seq) this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
        return;
      }
    }
    if (seq !== this.seq) return;
    const now = this.editor.paragraphs;
    this.issues = [];
    now.forEach((p, index) => {
      for (const i of this.cache.get(p.text) || []) {
        if (this.ignored.has(this.key(i, p.text))) continue;
        this.issues.push({ ...i, index });
      }
    });
    this.editor.setLayer('grammar', this.issues.map((i) => ({ index: i.index, start: i.start, end: i.end, expect: i.text })));
    this.emit();
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  issueAt(index, offset) {
    return this.issues.find((i) => i.index === index && offset >= i.start && offset <= i.end) || null;
  }

  apply(issue, replacement) {
    const p = this.editor.paragraphs[issue.index];
    if (!p || p.text.slice(issue.start, issue.end) !== issue.text) {
      this.schedule(0);
      return false;
    }
    this.editor.replaceSpan(issue.index, issue.start, issue.end, replacement);
    this.hide();
    return true;
  }

  /** Apply one replacement to every listed issue in a single undo step. */
  applyAll(list, replacement) {
    const paras = this.editor.getParagraphs();
    let n = 0;
    const sorted = [...list].sort((a, b) => a.index - b.index || b.start - a.start);
    for (const i of sorted) {
      const p = paras[i.index];
      if (!p || p.text.slice(i.start, i.end) !== i.text) continue;
      p.text = p.text.slice(0, i.start) + replacement + p.text.slice(i.end);
      n++;
    }
    if (n) this.editor.setParagraphs(paras);
    this.hide();
    return n;
  }

  ignoreAll(list) {
    for (const i of list) {
      const p = this.editor.paragraphs[i.index];
      if (p) this.ignored.add(this.key(i, p.text));
    }
    this.hide();
    this.run();
  }

  ignore(issue) {
    const p = this.editor.paragraphs[issue.index];
    if (p) this.ignored.add(this.key(issue, p.text));
    this.hide();
    this.run();
  }

  // ---------- Popover ----------

  show(issue, rect) {
    this.current = issue;
    const pop = this.pop;
    const label = { Spelling: 'Spelling', Typo: 'Spelling', Grammar: 'Grammar', Agreement: 'Grammar', Punctuation: 'Punctuation', Capitalization: 'Capitalization', Repetition: 'Repeated word', Style: 'Style', WordChoice: 'Word choice', Usage: 'Usage', Regionalism: 'Canadian spelling', BoundaryError: 'Spacing' }[issue.kind] || 'Suggestion';
    pop.querySelector('.pop-kind').textContent = label;
    pop.querySelector('.pop-msg').innerHTML = escapeHtml(issue.message).replace(/`([^`]+)`/g, '<b>$1</b>');
    const fixes = pop.querySelector('.pop-fixes');
    fixes.innerHTML = issue.suggestions.length
      ? issue.suggestions.map((s, i) => `<button type="button" data-fix="${i}" class="${s === '' ? 'del' : ''}">${s === '' ? 'Remove' : escapeHtml(s)}</button>`).join('')
      : '';
    pop.querySelector('[data-pop="dict"]').hidden = !['Spelling', 'Typo'].includes(issue.kind);
    pop.hidden = false;
    const w = pop.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left));
    const below = rect.bottom + 8;
    pop.style.left = `${x}px`;
    pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 70 ? rect.top - pop.offsetHeight - 8 : below}px`;
  }

  hide() {
    this.pop.hidden = true;
    this.current = null;
  }

  bindPopover() {
    this.pop.addEventListener('mousedown', (e) => e.preventDefault());
    this.pop.addEventListener('click', async (e) => {
      const issue = this.current;
      if (!issue) return;
      const fix = e.target.closest('[data-fix]');
      if (fix) return this.apply(issue, issue.suggestions[Number(fix.dataset.fix)]);
      const act = e.target.closest('[data-pop]')?.dataset.pop;
      if (act === 'ignore') this.ignore(issue);
      if (act === 'dict') {
        this.hide();
        this.dispatchEvent(new CustomEvent('add-word', { detail: issue.text }));
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target)) this.hide();
    });
  }
}
