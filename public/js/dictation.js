// Voice input. Uses the macOS app's native speech recognizer when present,
// otherwise the browser's Web Speech API.
//
// start({ continuous: true }) keeps listening after each utterance (conversation mode)
// and emits one 'final' event per utterance until stop() is called.

export class Dictation extends EventTarget {
  constructor() {
    super();
    this.listening = false;
    this.continuous = false;
    this.native = window.webkit?.messageHandlers?.cadenceDictation || null;
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.rec = null;
    this.buffer = '';
    // The macOS app calls this with { type: 'partial' | 'final' | 'error' | 'end', text }.
    window.__cadenceDictation = (evt) => this.handle(evt);
  }

  get available() {
    return Boolean(this.native || this.SR);
  }

  start({ continuous = false } = {}) {
    if (this.listening) return;
    if (!this.available) {
      this.emit('error', 'Voice input is not available here. Use the Cadence app, Safari or Chrome.');
      return;
    }
    this.continuous = continuous;
    this.buffer = '';
    this.listening = true;
    this.emit('state', true);
    if (this.native) {
      this.native.postMessage({ cmd: 'start', locale: 'en-CA', continuous });
    } else {
      this.startWeb();
    }
  }

  startWeb() {
    const rec = new this.SR();
    rec.lang = 'en-CA';
    rec.interimResults = true;
    rec.continuous = this.continuous;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          if (this.continuous) this.emit('final', t.trim());
          else this.buffer += t;
        } else {
          interim += t;
        }
      }
      if (interim.trim()) this.emit('partial', (this.continuous ? interim : this.buffer + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.emit('error', e.error === 'not-allowed'
        ? 'Microphone access was blocked. Allow it in System Settings, Privacy and Security.'
        : `Voice input stopped (${e.error}).`);
      this.listening = false;
    };
    rec.onend = () => {
      // Browsers end recognition after silence; restart while conversation mode is on.
      if (this.listening && this.continuous) {
        try { rec.start(); return; } catch (err) { /* fall through */ }
      }
      this.finish();
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { this.finish(); }
  }

  stop() {
    if (!this.listening) return;
    if (this.native) {
      this.native.postMessage({ cmd: 'stop' });
    } else if (this.rec) {
      const wasContinuous = this.continuous;
      this.continuous = false;
      this.rec.stop();
      if (wasContinuous) this.finish();
    }
  }

  toggle(opts) {
    return this.listening ? this.stop() : this.start(opts);
  }

  handle(evt = {}) {
    if (evt.type === 'partial') this.emit('partial', evt.text || '');
    else if (evt.type === 'final') {
      if (this.continuous) this.emit('final', (evt.text || '').trim());
      else { this.buffer = evt.text || ''; this.finish(); }
    } else if (evt.type === 'error') { this.emit('error', evt.text || 'Voice input failed.'); this.finish(); }
    else if (evt.type === 'end') this.finish();
  }

  finish() {
    if (!this.listening) return;
    this.listening = false;
    this.rec = null;
    this.emit('state', false);
    const text = this.buffer.trim();
    this.buffer = '';
    if (text && !this.continuous) this.emit('final', text);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
