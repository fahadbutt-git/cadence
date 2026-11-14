// Sentence-by-sentence reader. Fetches neural audio from the server, prefetches ahead,
// and falls back to the system voice when the online voice is unreachable.

const PREFETCH_AHEAD = 2;
const CACHE_LIMIT = 80;

export class Player extends EventTarget {
  constructor({ getVoice, getRate }) {
    super();
    this.getVoice = getVoice;
    this.getRate = getRate;
    this.audio = new Audio();
    this.audio.preservesPitch = true;
    this.queue = [];
    this.cursor = 0;
    this.playing = false;
    this.cache = new Map();
    this.offline = false;
    this.token = 0;
    this.notified = new Set();
    this.audio.addEventListener('ended', () => this.advance(this.token));
    this.audio.addEventListener('error', () => {
      if (this.playing && this.audio.src) this.speakWithSystem(this.queue[this.cursor]?.text, this.token);
    });
  }

  get current() {
    return this.queue[this.cursor] || null;
  }

  // ---------- Audio fetching ----------

  key(text, voice) {
    return `${voice}\u0000${text}`;
  }

  fetchAudio(text, voice) {
    const k = this.key(text, voice);
    if (this.cache.has(k)) return this.cache.get(k);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const p = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Voice request failed (${res.status})`);
        }
        const notice = res.headers.get('X-Cadence-Notice');
        if (notice) this.notify(decodeURIComponent(notice));
        return URL.createObjectURL(await res.blob());
      })
      .catch((err) => {
        clearTimeout(timer);
        this.cache.delete(k);
        throw err;
      });
    this.cache.set(k, p);
    if (this.cache.size > CACHE_LIMIT) {
      const [oldKey, oldVal] = this.cache.entries().next().value;
      this.cache.delete(oldKey);
      oldVal.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    }
    return p;
  }

  prefetch() {
    if (this.offline) return;
    const voice = this.getVoice();
    for (let i = 1; i <= PREFETCH_AHEAD; i++) {
      const item = this.queue[this.cursor + i];
      if (item) this.fetchAudio(item.text, voice).catch(() => {});
    }
  }

  notify(message) {
    if (this.notified.has(message)) return;
    this.notified.add(message);
    this.dispatchEvent(new CustomEvent('notice', { detail: message }));
  }

  // ---------- Transport ----------

  play(queue, startAt = 0) {
    this.stopAudio();
    this.queue = queue || [];
    this.cursor = Math.max(0, Math.min(startAt, this.queue.length - 1));
    if (!this.queue.length) return;
    this.offline = false;
    this.playing = true;
    this.emitState();
    this.playCurrent();
  }

  resume() {
    if (!this.queue.length) return;
    this.playing = true;
    this.emitState();
    this.playCurrent();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.stopAudio();
    this.emitState();
  }

  stop() {
    this.pause();
    this.dispatchEvent(new Event('stopped'));
  }

  jump(delta) {
    if (!this.queue.length) return;
    const next = Math.max(0, Math.min(this.queue.length - 1, this.cursor + delta));
    this.cursor = next;
    if (this.playing) {
      this.stopAudio();
      this.playCurrent();
    } else {
      this.dispatchEvent(new CustomEvent('sentence', { detail: this.current }));
    }
  }

  setRate(rate) {
    this.audio.playbackRate = rate;
  }

  stopAudio() {
    this.token++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  advance(token) {
    if (token !== this.token || !this.playing) return;
    if (this.cursor >= this.queue.length - 1) {
      this.playing = false;
      this.emitState();
      this.dispatchEvent(new Event('finished'));
      return;
    }
    this.cursor++;
    this.playCurrent();
  }

  async playCurrent() {
    const item = this.current;
    if (!item) return;
    const token = ++this.token;
    this.dispatchEvent(new CustomEvent('sentence', { detail: item }));
    if (this.offline) return this.speakWithSystem(item.text, token);
    try {
      // Ask for the current sentence first, then the next ones.
      const pending = this.fetchAudio(item.text, this.getVoice());
      this.prefetch();
      const url = await pending;
      if (token !== this.token || !this.playing) return;
      this.audio.src = url;
      this.audio.playbackRate = this.getRate();
      await this.audio.play();
    } catch (err) {
      if (token !== this.token || !this.playing) return;
      if (err.name === 'NotAllowedError') {
        this.playing = false;
        this.emitState();
        this.notify('Click play to allow audio.');
        return;
      }
      this.offline = true;
      this.notify('The online voice is not reachable. Reading with the system voice for now.');
      this.speakWithSystem(item.text, token);
    }
  }

  systemVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    const en = voices.filter((v) => /^en(-|_)/i.test(v.lang));
    return (
      en.find((v) => /premium|enhanced/i.test(v.name)) ||
      en.find((v) => v.lang === 'en-CA') ||
      en.find((v) => v.default) ||
      en[0] ||
      null
    );
  }

  speakWithSystem(text, token) {
    if (!('speechSynthesis' in window) || !text) {
      this.playing = false;
      this.emitState();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.systemVoice();
    if (v) u.voice = v;
    u.rate = this.getRate();
    u.onend = () => this.advance(token);
    window.speechSynthesis.speak(u);
  }

  /** Say something once, outside the reading queue (spoken replies, previews). */
  async say(text, voice = this.getVoice()) {
    if (!text) return;
    this.pause();
    const token = ++this.token;
    try {
      const url = await this.fetchAudio(text, voice);
      if (token !== this.token) return;
      this.audio.src = url;
      this.audio.playbackRate = this.getRate();
      await this.audio.play();
    } catch (e) {
      if (token !== this.token || !('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const v = this.systemVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    }
  }

  emitState() {
    this.dispatchEvent(new CustomEvent('state', { detail: { playing: this.playing } }));
  }
}
