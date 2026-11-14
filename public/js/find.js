// Find and replace across paragraphs, with all matches highlighted.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class FindBar {
  constructor(editor, els) {
    this.editor = editor;
    this.els = els; // { bar, input, replace, count, prev, next, one, all, matchCase, close }
    this.matches = [];
    this.cursor = -1;
    const { input, replace, prev, next, one, all, matchCase, close } = els;
    input.addEventListener('input', () => this.search(true));
    matchCase.addEventListener('change', () => this.search(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    replace.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.replaceOne(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    one.addEventListener('click', () => this.replaceOne());
    all.addEventListener('click', () => this.replaceAll());
    close.addEventListener('click', () => this.close());
    editor.addEventListener('change', () => { if (!this.els.bar.hidden) this.search(false); });
  }

  get isOpen() {
    return !this.els.bar.hidden;
  }

  open({ withReplace = false } = {}) {
    this.els.bar.hidden = false;
    const sel = this.editor.getSelectionInfo();
    if (sel && !sel.multi && sel.text.length < 80) this.els.input.value = sel.text;
    (withReplace && this.els.input.value ? this.els.replace : this.els.input).focus();
    this.els.input.select();
    this.search(true);
  }

  close() {
    this.els.bar.hidden = true;
    this.matches = [];
    this.editor.setLayer('find', []);
    this.editor.setLayer('find-current', []);
  }

  regex(flags = 'g') {
    const q = this.els.input.value;
    if (!q) return null;
    return new RegExp(escapeRe(q), this.els.matchCase.checked ? flags : `${flags}i`);
  }

  search(resetCursor) {
    const re = this.regex();
    this.matches = [];
    if (re) {
      this.editor.paragraphs.forEach((p, index) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(p.text)) !== null) {
          this.matches.push({ index, start: m.index, end: m.index + m[0].length, expect: m[0] });
          if (!m[0].length) re.lastIndex++;
        }
      });
    }
    if (resetCursor || this.cursor >= this.matches.length) {
      const caret = this.editor.getCaret();
      const after = caret ? this.matches.findIndex((m) => m.index > caret.index || (m.index === caret.index && m.start >= caret.offset)) : 0;
      this.cursor = this.matches.length ? Math.max(0, after) : -1;
    }
    this.draw();
  }

  draw() {
    const n = this.matches.length;
    this.els.count.textContent = this.els.input.value ? (n ? `${this.cursor + 1} of ${n}` : 'No matches') : '';
    this.editor.setLayer('find', this.matches);
    this.editor.setLayer('find-current', this.cursor >= 0 && this.matches[this.cursor] ? [this.matches[this.cursor]] : []);
  }

  step(dir) {
    if (!this.matches.length) return;
    this.cursor = (this.cursor + dir + this.matches.length) % this.matches.length;
    const m = this.matches[this.cursor];
    this.draw();
    const el = this.editor.paraEl(m.index);
    if (el) this.editor.scrollToRect(el.getBoundingClientRect());
  }

  replaceOne() {
    const m = this.matches[this.cursor];
    if (!m) return;
    this.editor.replaceSpan(m.index, m.start, m.end, this.els.replace.value);
    this.search(false);
  }

  replaceAll() {
    const re = this.regex();
    if (!re) return 0;
    const n = this.editor.replaceAllMatches(re, this.els.replace.value);
    this.search(true);
    this.els.count.textContent = n ? `Replaced ${n}` : 'No matches';
    return n;
  }
}
