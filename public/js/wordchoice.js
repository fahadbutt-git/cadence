// Word choice: synonyms for a word or short phrase (like Wordtune's smart synonyms and the Word
// thesaurus), and a few rewordings of a longer selection to choose from (like Wordtune's rewrite).

import { escapeHtml } from './core/textUtils.js';

export class WordChoice extends EventTarget {
  constructor(editor, pop, api) {
    super();
    this.editor = editor;
    this.pop = pop;
    this.api = api;
    this.target = null; // { index, start, end, text }
    this.token = 0;
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (b) this.apply(b.dataset.choice);
      if (e.target.closest('[data-choice-close]')) this.hide();
    });
  }

  static isShort(text) {
    return text.trim().split(/\s+/).length <= 3 && text.trim().length <= 40;
  }

  async open(target, rect, { style = 'narrative' } = {}) {
    this.target = target;
    const token = ++this.token;
    const short = WordChoice.isShort(target.text);
    this.render(short ? 'Synonyms' : 'Other ways to say it', '<p class="muted small">Looking</p>');
    this.place(rect);
    try {
      let options;
      let note = '';
      const para = this.editor.paragraphs[target.index]?.text || '';
      if (short) {
        const q = new URLSearchParams({ word: target.text.trim(), left: para.slice(Math.max(0, target.start - 40), target.start), right: para.slice(target.end, target.end + 40) });
        const res = await this.api.get(`/api/synonyms?${q}`);
        options = res.options.map((t) => ({ text: t }));
        note = res.error || (options.length ? '' : 'No synonyms found.');
      } else {
        const res = await this.api.post('/api/alternatives', { targetText: target.text, contextText: para, style });
        options = res.options;
        note = res.message || (options.length ? '' : 'No rewordings came back.');
      }
      if (token !== this.token) return;
      this.options = options;
      const items = options
        .map((o, i) => `<button type="button" class="choice${short ? ' word' : ''}" data-choice="${i}">${o.label ? `<span class="muted small">${escapeHtml(o.label)}</span>` : ''}${escapeHtml(o.text)}</button>`)
        .join('');
      this.render(short ? `Synonyms for “${escapeHtml(target.text.trim())}”` : 'Other ways to say it', `<div class="${short ? 'choices words' : 'choices'}">${items}</div>${note ? `<p class="muted small">${escapeHtml(note)}</p>` : ''}`);
      this.place(rect);
    } catch (err) {
      if (token === this.token) this.render('Word choice', `<p class="muted small">${escapeHtml(err.message)}</p>`);
    }
  }

  render(title, body) {
    this.pop.innerHTML = `<div class="row between"><p class="pop-kind">${title}</p><button type="button" class="icon-btn" data-choice-close aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button></div>${body}`;
    this.pop.hidden = false;
  }

  place(rect) {
    const w = this.pop.offsetWidth;
    const h = this.pop.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left));
    const below = rect.bottom + 8;
    const y = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 8) : below;
    this.pop.style.left = `${x}px`;
    this.pop.style.top = `${y}px`;
  }

  apply(i) {
    const o = this.options?.[Number(i)];
    const t = this.target;
    if (!o || !t) return;
    const para = this.editor.paragraphs[t.index];
    if (!para) return this.hide();
    // Keep spacing: replace the trimmed span only.
    const lead = t.text.length - t.text.trimStart().length;
    const trail = t.text.length - t.text.trimEnd().length;
    const start = t.start + lead;
    const end = t.end - trail;
    if (para.text.slice(start, end) !== t.text.trim()) return this.hide();
    this.editor.replaceSpan(t.index, start, end, o.text);
    this.hide();
    this.dispatchEvent(new CustomEvent('applied', { detail: o.text }));
  }

  hide() {
    this.token++;
    this.pop.hidden = true;
    this.target = null;
  }
}
