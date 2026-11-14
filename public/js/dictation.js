// Voice input. Uses the macOS app's native speech recognizer when present,
// otherwise the browser's Web Speech API.

export class Dictation extends EventTarget {
  constructor() {
    super();
    this.listening = false;
    this.native = window.webkit?.messageHandlers?.cadenceDictation || null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.SR = SR || null;
    this.rec = null;
    this.finalText = '';
    // The macOS app calls this with { type: 'partial' | 'final' | 'error' | 'end', text }.
    window.__cadenceDictation = (evt) => this.handle(evt);
  }

  get available() {
    return Boolean(this.native || this.SR);
  }

  toggle() {
    return this.listening ? this.stop() : this.start();
  }

  start() {
    if (this.listening) return;
    if (!this.available) {
      this.emit('error', 'Voice input is not available here. Use the Cadence app, Safari or Chrome.');
      return;
    }
    this.finalText = '';
    this.listening = true;
    this.emit('state', true);
    if (this.native) {
      this.native.postMessage({ cmd: 'start', locale: 'en-CA' });
      return;
    }
    const rec = new this.SR();
    rec.lang = 'en-CA';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this.finalText += t;
        else interim += t;
      }
      this.emit('partial', (this.finalText + interim).trim());
    };
    rec.onerror = (e) => {
      const msg = e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in System Settings, Privacy and Security.' : e.error === 'no-speech' ? '' : `Voice input stopped (${e.error}).`;
      if (msg) this.emit('error', msg);
    };
    rec.onend = () => this.finish();
    this.rec = rec;
    try { rec.start(); } catch (e) { this.finish(); }
  }

  stop() {
    if (!this.listening) return;
    if (this.native) this.native.postMessage({ cmd: 'stop' });
    else if (this.rec) this.rec.stop();
  }

  handle(evt = {}) {
    if (evt.type === 'partial') this.emit('partial', evt.text || '');
    else if (evt.type === 'final') { this.finalText = evt.text || ''; this.finish(); }
    else if (evt.type === 'error') { this.emit('error', evt.text || 'Voice input failed.'); this.finish(); }
    else if (evt.type === 'end') this.finish();
  }

  finish() {
    if (!this.listening) return;
    this.listening = false;
    this.rec = null;
    this.emit('state', false);
    const text = this.finalText.trim();
    if (text) this.emit('final', text);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
