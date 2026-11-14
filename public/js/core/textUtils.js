// Pure text utilities shared by the browser and the Node server and tests.

export const BANNED_WORDS = [
  'delve', 'delves', 'delved', 'delving', 'tapestry', 'tapestries', 'testament',
  'beacon', 'beacons', 'symphony', 'crescendo', 'kaleidoscope', 'underscore',
  'underscores', 'underscored', 'underscoring', 'showcase', 'showcases', 'showcased',
  'showcasing', 'pivotal', 'crucial', 'paramount', 'indispensable', 'foster',
  'fosters', 'fostered', 'fostering', 'garner', 'garnered', 'bolster', 'bolstered',
  'multifaceted', 'intricate', 'intricacies', 'nuanced', 'realm', 'realms', 'embark',
  'embarked', 'harness', 'harnessed', 'harnessing', 'leverage', 'leveraged',
  'leveraging', 'utilize', 'utilizes', 'utilized', 'utilizing', 'catalyst',
  'cornerstone', 'bedrock', 'linchpin', 'unwavering', 'meticulous', 'meticulously',
  'steadfast', 'tireless', 'tirelessly', 'groundbreaking', 'indelible', 'interplay',
  'synergy', 'resonate', 'resonates', 'resonated', 'poignant', 'visceral', 'palpable',
  'burgeoning', 'overarching', 'holistic', 'seamless', 'seamlessly', 'invaluable',
  'spearhead', 'spearheaded', 'orchestrate', 'orchestrated', 'crucible', 'labyrinth',
  'odyssey', 'navigate', 'navigating',
];
// Older name kept for compatibility.
export const BANNED_RLHF_WORDS = BANNED_WORDS;

const ADVERB_EXCEPTIONS = new Set(['respectively', 'approximately', 'significantly', 'statistically', 'clinically', 'previously', 'only', 'family', 'early', 'likely', 'unlikely', 'reply', 'supply', 'apply', 'july', 'italy', 'holy', 'ugly', 'daily', 'friendly', 'lonely', 'elderly', 'ally', 'belly', 'bully', 'jelly', 'rally', 'silly', 'rely', 'comply', 'imply', 'multiply', 'assembly', 'anomaly', 'monopoly', 'emily', 'kelly', 'lily', 'molly', 'polly', 'sally', 'holly', 'billy', 'fly', 'butterfly', 'curly', 'costly', 'lively', 'lovely', 'timely', 'weekly', 'monthly', 'yearly', 'hourly', 'nightly', 'orderly', 'scholarly', 'deadly', 'oily', 'hilly', 'chilly', 'anomaly']);
const FILLERS = ['very', 'really', 'just', 'quite', 'actually', 'basically', 'literally', 'totally', 'somewhat', 'simply', 'truly', 'definitely', 'certainly', 'extremely', 'incredibly', 'absolutely'];
const HEDGES = ['i think', 'i believe', 'i feel that', 'in my opinion', 'kind of', 'sort of', 'it seems', 'i hope to', 'i would like to', 'i want to be able to', 'perhaps', 'somewhat'];
const CLICHES = [
  'passion for', 'passionate about', 'ever since i was', 'from a young age', 'since childhood', 'make a difference', 'lifelong dream',
  'at the end of the day', 'first and foremost', 'last but not least', 'in today\'s world', 'it goes without saying', 'needless to say',
  'thinking outside the box', 'step out of my comfort zone', 'out of my comfort zone', 'hit the ground running', 'wear many hats',
  'jack of all trades', 'team player', 'hard worker', 'fast-paced environment', 'touch the lives', 'giving back',
  'i have always wanted', 'i knew i wanted', 'cemented my desire', 'solidified my interest', 'sparked my interest', 'ignited my passion',
  'fuelled my passion', 'fueled my passion', 'truest', 'purest form', 'well-rounded', 'unique perspective', 'invaluable experience',
  'learning experience', 'eye-opening', 'rewarding experience', 'in conclusion', 'to sum up',
];
const STOPWORDS = new Set('about above after again against because before being below between could doing during every from further having here itself might other ought ourselves should since some such than that their theirs them themselves then there these they this those through under until very were what when where which while whom with would your yours yourself also into just more most much only over same both each many make made like well even still such being been have will they their which there these those within without patient patients medicine medical clinical'.split(' '));

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const REFERENCE_LIKE = /^\s*(\[?\d{1,3}[\].)]\s)|\bdoi[:\s]|\b(19|20)\d{2};\d+/i;

// Check groups shown in the Checks tab. Each group can be switched off.
export const CHECK_GROUPS = {
  house: 'Stock AI phrasing',
  clarity: 'Clarity',
  style: 'Style',
};

export const FLAG_RULES = [
  { kind: 'word', group: 'house', label: 'Stock AI word', pattern: new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'gi') },
  // Dashes between numbers are ranges (12–18, 24-2), not prose.
  { kind: 'dash', group: 'house', label: 'Dash in running prose', pattern: /—|–|--/g, keep: (m, str, i) => !(/\d\s*$/.test(str.slice(0, i)) && /^\s*\d/.test(str.slice(i + m.length))) },
  // Semicolons inside parentheses or before numbers belong to statistics and references: (…; P = .38), 2019;126(3).
  { kind: 'semicolon', group: 'house', label: 'Semicolon', pattern: /;/g, keep: (m, str, i) => !REFERENCE_LIKE.test(str) && !/^\s*(\d|P\s*[=<>]|p\s*[=<>])/.test(str.slice(i + 1)) && (str.slice(0, i).split('(').length - str.slice(0, i).split(')').length) <= 0 },
  { kind: 'contrast', group: 'house', label: 'Contrast frame', pattern: /\brather than\b|\bnot (?:just |only |merely )?\w+(?: \w+)?, but\b/gi },
  { kind: 'tail', group: 'house', label: 'Explanation tail', pattern: /,\s*(?:ultimately\s+)?(?:highlighting|underscoring|demonstrating|showcasing|reflecting|emphasizing)\b/gi },
  { kind: 'passive', group: 'clarity', label: 'Passive voice', narrativeOnly: true, pattern: /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w{3,}ed|known|seen|given|taken|made|done|shown|written|born|brought|built|caught|chosen|drawn|driven|found|held|kept|led|left|lost|meant|met|paid|put|said|sent|sold|spent|taught|thought|told|understood|won|worn)\b(?:\s+by\b)?/gi },
  { kind: 'adverb', group: 'clarity', label: 'Adverb', pattern: /\b[a-z]{3,}ly\b/gi, keep: (m) => !ADVERB_EXCEPTIONS.has(m.toLowerCase()) && !FILLERS.includes(m.toLowerCase()) },
  { kind: 'filler', group: 'clarity', label: 'Filler word', pattern: new RegExp(`\\b(?:${FILLERS.join('|')})\\b`, 'gi'), keep: (m, str, i) => !/^\s+than\b/i.test(str.slice(i + m.length)) },
  { kind: 'hedge', group: 'clarity', label: 'Hedge', pattern: new RegExp(`\\b(?:${HEDGES.map(esc).join('|')})\\b`, 'gi') },
  { kind: 'cliche', group: 'style', label: 'Cliché', pattern: new RegExp(`\\b(?:${CLICHES.map(esc).join('|')})\\b`, 'gi') },
];

/** Repeated content words close together (echoes). */
function echoFlags(str) {
  const out = [];
  const re = /[A-Za-z][A-Za-z'-]{4,}/g;
  const seen = new Map();
  let m;
  let n = 0;
  while ((m = re.exec(str)) !== null) {
    n++;
    const w = m[0].toLowerCase().replace(/'s$/, '');
    if (STOPWORDS.has(w)) continue;
    // Capitalised words in mid-sentence are names; repeating a name is fine.
    if (/^[A-Z]/.test(m[0]) && m.index > 0 && !/[.!?]\s*$/.test(str.slice(0, m.index))) continue;
    const prev = seen.get(w);
    if (prev !== undefined && n - prev <= 25) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: 'echo', group: 'style', label: 'Repeated word nearby' });
    }
    seen.set(w, n);
  }
  return out;
}

/** Long sentences and repeated sentence openings. */
function sentenceFlags(str) {
  const out = [];
  const ranges = sentenceRanges(str);
  let prevStart = '';
  for (const r of ranges) {
    const words = r.text.split(/\s+/).filter(Boolean).length;
    if (words > 35) out.push({ start: r.start, end: r.end, text: r.text, kind: 'veryhard', group: 'clarity', label: `Very long sentence (${words} words)`, sentence: true });
    else if (words > 25) out.push({ start: r.start, end: r.end, text: r.text, kind: 'hard', group: 'clarity', label: `Long sentence (${words} words)`, sentence: true });
    const first = (r.text.match(/^[A-Za-z']+/) || [''])[0];
    if (first && first.toLowerCase() === prevStart && !['the', 'a', 'an'].includes(prevStart)) {
      out.push({ start: r.start, end: r.start + first.length, text: first, kind: 'start', group: 'style', label: 'Same opening as previous sentence' });
    }
    prevStart = first.toLowerCase();
  }
  return out;
}

/**
 * All flagged spans in a string: [{ start, end, text, kind, group, label, sentence? }], sorted by position.
 * groups: optional { house, clarity, style } booleans; missing means on.
 */
export function findFlags(text = '', groups = null, { style = 'narrative' } = {}) {
  const out = [];
  const str = String(text || '');
  const on = (g) => !groups || groups[g] !== false;
  for (const rule of FLAG_RULES) {
    if (!on(rule.group)) continue;
    // Methods sections are written in the passive voice; academic style does not flag it.
    if (rule.narrativeOnly && style === 'academic') continue;
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(str)) !== null) {
      if (m[0].length === 0) { rule.pattern.lastIndex++; continue; }
      if (rule.keep && !rule.keep(m[0], str, m.index)) continue;
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: rule.kind, group: rule.group, label: rule.label });
    }
  }
  // Technical writing repeats its terms on purpose, so academic style skips "repeated word nearby".
  if (on('style') && style !== 'academic') out.push(...echoFlags(str));
  out.push(...sentenceFlags(str).filter((f) => on(f.group)));
  // Drop word-level flags fully inside a longer word-level flag (for example "passion for" inside a cliché).
  const word = out.filter((f) => !f.sentence).sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = word.filter((f, i) => !word.some((g, j) =>
    j !== i && g.start <= f.start && g.end >= f.end && (g.end - g.start > f.end - f.start || (g.end - g.start === f.end - f.start && j < i))));
  return [...kept, ...out.filter((f) => f.sentence)].sort((a, b) => a.start - b.start);
}

/** Estimated syllables in an English word. */
export function syllables(word = '') {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Sentence spans with character offsets into the original string. */
export function sentenceRanges(text = '') {
  const str = String(text || '');
  if (!str.trim()) return [];
  const out = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const s of seg.segment(str)) {
      const lead = s.segment.length - s.segment.trimStart().length;
      const trimmed = s.segment.trim();
      if (!trimmed) continue;
      const start = s.index + lead;
      out.push({ start, end: start + trimmed.length, text: trimmed });
    }
    return mergeAbbreviations(str, out);
  }
  const re = /[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const lead = m[0].length - m[0].trimStart().length;
    const trimmed = m[0].trim();
    if (trimmed) out.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed });
  }
  return mergeAbbreviations(str, out);
}

const ABBREVIATION_END = /\b(?:Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|al|Fig|Figs|No|Vol|approx|Inc|Ltd|Co|e\.g|i\.e)\.$/;
/** "Dr. Micieli showed me" is one sentence: join pieces that end in a title or common abbreviation. */
function mergeAbbreviations(str, ranges) {
  const out = [];
  for (const r of ranges) {
    const prev = out[out.length - 1];
    if (prev && ABBREVIATION_END.test(prev.text)) {
      prev.end = r.end;
      prev.text = str.slice(prev.start, r.end);
    } else out.push({ ...r });
  }
  return out;
}

export function splitIntoSentences(text = '') {
  return sentenceRanges(text).map((r) => r.text);
}

/** Index of the sentence containing a character offset (clamped). */
export function sentenceIndexAt(text = '', offset = 0) {
  const ranges = sentenceRanges(text);
  if (!ranges.length) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (offset < ranges[i].end) return i;
  }
  return ranges.length - 1;
}

export function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Word-level diff: [{ type: 'same' | 'del' | 'ins', text }]. */
export function diffWords(oldText = '', newText = '') {
  const a = (oldText || '').trim().split(/\s+/).filter(Boolean);
  const b = (newText || '').trim().split(/\s+/).filter(Boolean);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { parts.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) parts.push({ type: 'del', text: a[i++] });
    else parts.push({ type: 'ins', text: b[j++] });
  }
  while (i < m) parts.push({ type: 'del', text: a[i++] });
  while (j < n) parts.push({ type: 'ins', text: b[j++] });
  return parts;
}

export function computeWordDiffHtml(oldText = '', newText = '') {
  return diffWords(oldText, newText)
    .map((p) => {
      const safe = escapeHtml(p.text);
      if (p.type === 'del') return `<del>${safe}</del>`;
      if (p.type === 'ins') return `<ins>${safe}</ins>`;
      return safe;
    })
    .join(' ');
}

export function computeBurstinessStats(fullText = '') {
  const textStr = Array.isArray(fullText)
    ? fullText.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n')
    : String(fullText || '');
  const words = textStr.trim().split(/\s+/).filter(Boolean);
  const lengths = splitIntoSentences(textStr)
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0);
  let cv = 0;
  if (lengths.length > 1) {
    const mean = lengths.reduce((x, y) => x + y, 0) / lengths.length;
    const variance = lengths.reduce((x, y) => x + (y - mean) ** 2, 0) / lengths.length;
    cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  }
  const totalSec = Math.round((words.length / 150) * 60);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = words.length && lengths.length ? 0.39 * (words.length / lengths.length) + 11.8 * (syl / words.length) - 15.59 : 0;
  return {
    gradeLevel: Math.max(0, Number(grade.toFixed(1))),
    longSentences: lengths.filter((n) => n > 25).length,
    wordCount: words.length,
    charCount: textStr.length,
    sentenceCount: lengths.length,
    listenTimeFormatted: `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`,
    burstinessCv: Number(cv.toFixed(2)),
  };
}

/** Flat list of sentences to read, starting at a paragraph and sentence. */
export function buildSentenceReadQueue(paragraphs = [], startParaIdx = 0, startSentIdx = 0) {
  const queue = [];
  // Reading stops at a References heading unless you start inside the reference list.
  const refAt = paragraphs.findIndex((p) => p?.type === 'heading' && /^(references|bibliography|works cited)\s*$/i.test(p.text || ''));
  paragraphs.forEach((p, pIdx) => {
    if (pIdx < startParaIdx) return;
    if (refAt >= 0 && startParaIdx < refAt && pIdx >= refAt) return;
    const raw = typeof p === 'string' ? p : p?.text || '';
    sentenceRanges(raw).forEach((r, sIdx) => {
      if (pIdx === startParaIdx && sIdx < startSentIdx) return;
      queue.push({ paraIndex: pIdx, sentIndex: sIdx, text: r.text, start: r.start, end: r.end });
    });
  });
  return queue;
}

// ---------- Tracked changes ----------
// Tracking compares the current text with a baseline captured when tracking started.
// Tokens keep their trailing whitespace so joining them rebuilds the text exactly.

export function tokenize(text = '') {
  // Words, spaces and punctuation are separate tokens, so "bank, and more." vs "bank." deletes only ", and more".
  return String(text).match(/\s+|[\p{L}\p{N}’'_-]+|[^\s\p{L}\p{N}’'_-]+/gu) || [];
}

function lcsOps(a0, b0) {
  // Common prefix and suffix are cheap to skip and keep the table small for long paragraphs.
  let pre = 0;
  while (pre < a0.length && pre < b0.length && a0[pre] === b0[pre]) pre++;
  let suf = 0;
  while (suf < a0.length - pre && suf < b0.length - pre && a0[a0.length - 1 - suf] === b0[b0.length - 1 - suf]) suf++;
  const head = a0.slice(0, pre).map((t) => ['same', t]);
  const tail = a0.slice(a0.length - suf).map((t) => ['same', t]);
  const a = a0.slice(pre, a0.length - suf);
  const b = b0.slice(pre, b0.length - suf);
  return [...head, ...lcsCore(a, b), ...tail];
}

function lcsCore(a, b) {
  const m = a.length;
  const n = b.length;
  // Long paragraphs: line up whole sentences first, then compare words inside the sentences that differ.
  if (m * n > 4e6) return chunkedOps(a, b);
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push(['same', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['del', a[i++]]);
    else ops.push(['ins', b[j++]]);
  }
  while (i < m) ops.push(['del', a[i++]]);
  while (j < n) ops.push(['ins', b[j++]]);
  return ops;
}

function sentenceChunks(tokens) {
  const out = [];
  let cur = [];
  tokens.forEach((t, i) => {
    cur.push(t);
    if (/^[.!?]+$/.test(t) && (i + 1 >= tokens.length || /^\s+$/.test(tokens[i + 1]))) {
      if (i + 1 < tokens.length) cur.push(tokens[i + 1]);
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  // The whitespace after a sentence was pushed twice when it is also the next token; drop that copy.
  for (let i = 1; i < out.length; i++) if (out[i - 1].length && out[i][0] === out[i - 1][out[i - 1].length - 1] && /^\s+$/.test(out[i][0])) out[i].shift();
  return out.filter((c) => c.length);
}

function chunkedOps(a, b) {
  const ca = sentenceChunks(a);
  const cb = sentenceChunks(b);
  const ka = ca.map((c) => c.join(''));
  const kb = cb.map((c) => c.join(''));
  if (ca.length * cb.length > 4e6) return [...a.map((t) => ['del', t]), ...b.map((t) => ['ins', t])];
  const chunkOps = lcsCore(ka, kb);
  const ops = [];
  let i = 0;
  let j = 0;
  let pendDel = [];
  let pendIns = [];
  const flush = () => {
    if (pendDel.length || pendIns.length) {
      const da = pendDel.flat();
      const db = pendIns.flat();
      ops.push(...(da.length * db.length > 4e6 ? [...da.map((t) => ['del', t]), ...db.map((t) => ['ins', t])] : lcsCore(da, db)));
    }
    pendDel = [];
    pendIns = [];
  };
  for (const [type] of chunkOps) {
    if (type === 'same') { flush(); ops.push(...ca[i].map((t) => ['same', t])); i++; j++; }
    else if (type === 'del') pendDel.push(ca[i++]);
    else pendIns.push(cb[j++]);
  }
  flush();
  return ops;
}

/**
 * Segments of one paragraph: [{ type: 'same' | 'del' | 'ins', text, curStart, curEnd, baseStart, baseEnd }]
 * curStart/curEnd are offsets in the current text (deletions have zero width there).
 */
export function diffSegments(baseText = '', curText = '') {
  const ops = lcsOps(tokenize(baseText), tokenize(curText));
  const segs = [];
  let cur = 0;
  let base = 0;
  for (const [type, tok] of ops) {
    const last = segs[segs.length - 1];
    const seg = last && last.type === type ? last : null;
    const s = seg || { type, text: '', curStart: cur, curEnd: cur, baseStart: base, baseEnd: base };
    s.text += tok;
    if (type !== 'del') { cur += tok.length; s.curEnd = cur; }
    if (type !== 'ins') { base += tok.length; s.baseEnd = base; }
    if (!seg) segs.push(s);
  }
  return segs;
}

/** Group neighbouring deletions and insertions into reviewable changes. */
export function hunksFromSegments(paraId, segs) {
  const hunks = [];
  let h = null;
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    // A single space between two edits joins them into one change ("IOP" -> "intraocular pressure").
    if (s.type === 'same' && h && /^\s+$/.test(s.text) && segs[k + 1] && segs[k + 1].type !== 'same') {
      h.del += s.text; h.ins += s.text; h.baseEnd = s.baseEnd; h.curEnd = s.curEnd;
      continue;
    }
    if (s.type === 'same') { h = null; continue; }
    if (!h) {
      h = { kind: 'text', paraId, del: '', ins: '', curStart: s.curStart, curEnd: s.curStart, baseStart: s.baseStart, baseEnd: s.baseStart };
      hunks.push(h);
    }
    if (s.type === 'del') { h.del += s.text; h.baseEnd = s.baseEnd; }
    else { h.ins += s.text; h.curEnd = s.curEnd; }
  }
  for (const x of hunks) x.id = `${paraId}:${x.baseStart}:${x.curStart}`;
  return hunks;
}

/** Ids of `ids` that are not in the longest common ordered subsequence with `other`: the moved ones. */
function movedIds(baseOrder, curOrder) {
  const common = new Set(baseOrder.filter((id) => curOrder.includes(id)));
  const a = baseOrder.filter((id) => common.has(id));
  const b = curOrder.filter((id) => common.has(id));
  if (a.length * b.length > 4e6) return new Set();
  const kept = new Set(lcsCore(a, b).filter((o) => o[0] === 'same').map((o) => o[1]));
  return new Set([...common].filter((id) => !kept.has(id)));
}

/**
 * Compare baseline and current paragraph lists ({ id, type, text }).
 * Returns { paragraphs: [{ id, index, status, segments, moved }], deleted: [{ id, text, afterId, type, moved }], hunks }
 * in document order. Hunk kinds: text, para-ins, para-del, join, split, move, format.
 */
export function trackChanges(baseline = [], current = []) {
  const baseById = new Map(baseline.map((p, i) => [p.id, { ...p, i }]));
  const curIds = new Set(current.map((p) => p.id));
  const moved = movedIds(baseline.map((p) => p.id), current.map((p) => p.id));
  const paragraphs = [];
  let hunks = [];
  // Deleted baseline paragraphs (and the old place of moved ones), after the nearest earlier paragraph that stayed put.
  const deleted = [];
  let lastKept = null;
  for (const b of baseline) {
    if (curIds.has(b.id) && !moved.has(b.id)) { lastKept = b.id; continue; }
    deleted.push({ id: b.id, text: b.text, afterId: lastKept, type: b.type, moved: moved.has(b.id) });
  }
  const pushDeletedAfter = (afterId) => {
    for (const d of deleted.filter((x) => x.afterId === afterId && !x.moved)) {
      if (d.text.trim()) hunks.push({ kind: 'para-del', id: `del:${d.id}`, paraId: d.id, del: d.text, ins: '', afterId, type: d.type });
    }
  };
  pushDeletedAfter(null);
  current.forEach((p, index) => {
    const b = baseById.get(p.id);
    if (!b) {
      paragraphs.push({ id: p.id, index, status: 'inserted', segments: p.text ? [{ type: 'ins', text: p.text, curStart: 0, curEnd: p.text.length, baseStart: 0, baseEnd: 0 }] : [] });
      if (p.text.trim()) hunks.push({ kind: 'para-ins', id: `ins:${p.id}`, paraId: p.id, del: '', ins: p.text, curStart: 0, curEnd: p.text.length });
    } else {
      const isMoved = moved.has(p.id);
      if (isMoved) hunks.push({ kind: 'move', id: `mv:${p.id}`, paraId: p.id, del: '', ins: p.text, curStart: 0, curEnd: p.text.length });
      if ((b.type || 'body') !== (p.type || 'body')) hunks.push({ kind: 'format', id: `fmt:${p.id}`, paraId: p.id, from: b.type || 'body', to: p.type || 'body', del: '', ins: p.text, curStart: 0, curEnd: 0 });
      if (b.text === p.text) {
        paragraphs.push({ id: p.id, index, status: 'same', moved: isMoved, segments: p.text ? [{ type: 'same', text: p.text, curStart: 0, curEnd: p.text.length, baseStart: 0, baseEnd: p.text.length }] : [] });
      } else {
        const segments = diffSegments(b.text, p.text);
        paragraphs.push({ id: p.id, index, status: 'changed', moved: isMoved, segments });
        hunks.push(...hunksFromSegments(p.id, segments));
      }
    }
    pushDeletedAfter(p.id);
  });
  hunks = pairJoinsAndSplits(hunks, current, baseById);
  return { paragraphs, deleted, hunks };
}

const squash = (t = '') => t.replace(/\s+/g, ' ').trim();

/**
 * Pressing Backspace at the start of a paragraph adds its text to the paragraph above and removes it:
 * show that as one "joined" change. Enter in the middle does the opposite: one "split" change.
 */
function pairJoinsAndSplits(hunks, current, baseById) {
  const out = [];
  const used = new Set();
  const curText = new Map(current.map((p) => [p.id, p.text]));
  for (const h of hunks) {
    if (used.has(h)) continue;
    if (h.kind === 'para-del' && h.afterId) {
      const add = hunks.find((x) => !used.has(x) && x.kind === 'text' && x.paraId === h.afterId && !x.del && x.curEnd === (curText.get(h.afterId) || '').length && squash(x.ins) === squash(h.del));
      if (add) {
        used.add(add);
        const i = out.indexOf(add);
        if (i >= 0) out.splice(i, 1);
        out.push({ kind: 'join', id: `join:${h.paraId}`, paraId: h.afterId, removedId: h.paraId, removedType: h.type, del: '', ins: add.ins, text: h.del, curStart: add.curStart, curEnd: add.curEnd, baseStart: add.baseStart, baseEnd: add.baseEnd });
        continue;
      }
    }
    if (h.kind === 'para-ins') {
      const idx = current.findIndex((p) => p.id === h.paraId);
      const prev = current[idx - 1];
      const base = prev && baseById.get(prev.id);
      const cut = prev && hunks.find((x) => !used.has(x) && x.kind === 'text' && x.paraId === prev.id && !x.ins && base && x.baseEnd === base.text.length && squash(x.del) === squash(h.ins));
      if (cut) {
        used.add(cut);
        const i = out.indexOf(cut);
        if (i >= 0) out.splice(i, 1);
        out.push({ kind: 'split', id: `split:${h.paraId}`, paraId: prev.id, newId: h.paraId, del: cut.del, ins: '', text: h.ins, curStart: cut.curStart, curEnd: cut.curEnd, baseStart: cut.baseStart, baseEnd: cut.baseEnd });
        continue;
      }
    }
    out.push(h);
  }
  return out;
}

/** Accepting a change moves the baseline to match the current text for that change. */
export function acceptHunkInBaseline(baseline, hunk, current) {
  let out = baseline.map((p) => ({ ...p }));
  const insertAfterCurrentPredecessor = (para) => {
    const curIndex = current.findIndex((p) => p.id === para.id);
    const prevIds = current.slice(0, curIndex).map((p) => p.id).reverse();
    const anchor = prevIds.find((id) => out.some((p) => p.id === id));
    const at = anchor ? out.findIndex((p) => p.id === anchor) + 1 : 0;
    out.splice(at, 0, { ...para });
  };
  const textAccept = (h) => {
    const b = out.find((p) => p.id === h.paraId);
    if (b) b.text = b.text.slice(0, h.baseStart) + h.ins + b.text.slice(h.baseEnd);
  };
  if (hunk.kind === 'text') textAccept(hunk);
  else if (hunk.kind === 'para-del') out = out.filter((p) => p.id !== hunk.paraId);
  else if (hunk.kind === 'para-ins') insertAfterCurrentPredecessor(current.find((p) => p.id === hunk.paraId));
  else if (hunk.kind === 'join') {
    textAccept(hunk);
    out = out.filter((p) => p.id !== hunk.removedId);
  } else if (hunk.kind === 'split') {
    textAccept(hunk);
    insertAfterCurrentPredecessor(current.find((p) => p.id === hunk.newId));
  } else if (hunk.kind === 'move') {
    const para = out.find((p) => p.id === hunk.paraId);
    out = out.filter((p) => p.id !== hunk.paraId);
    insertAfterCurrentPredecessor(para);
  } else if (hunk.kind === 'format') {
    const b = out.find((p) => p.id === hunk.paraId);
    if (b) b.type = hunk.to;
  }
  return out;
}

/** Rejecting a change puts the baseline version back into the current paragraphs. Returns the new list. */
export function rejectHunkInCurrent(current, hunk, baseline) {
  let out = current.map((p) => ({ ...p }));
  const idx = (id) => out.findIndex((p) => p.id === id);
  const base = (id) => baseline.find((p) => p.id === id);
  const placeAfterBasePredecessor = (para) => {
    const bi = baseline.findIndex((p) => p.id === para.id);
    const prevIds = baseline.slice(0, bi).map((p) => p.id).reverse();
    const anchor = prevIds.find((id) => idx(id) >= 0);
    out.splice(anchor ? idx(anchor) + 1 : 0, 0, para);
  };
  if (hunk.kind === 'text') {
    const p = out[idx(hunk.paraId)];
    if (p) p.text = p.text.slice(0, hunk.curStart) + hunk.del + p.text.slice(hunk.curEnd);
  } else if (hunk.kind === 'para-ins') {
    out = out.filter((p) => p.id !== hunk.paraId);
  } else if (hunk.kind === 'para-del') {
    placeAfterBasePredecessor({ ...base(hunk.paraId) });
  } else if (hunk.kind === 'join') {
    const p = out[idx(hunk.paraId)];
    if (p) p.text = p.text.slice(0, hunk.curStart) + p.text.slice(hunk.curEnd);
    const back = base(hunk.removedId) || { id: hunk.removedId, type: hunk.removedType || 'body', text: hunk.text };
    out.splice(idx(hunk.paraId) + 1, 0, { ...back });
  } else if (hunk.kind === 'split') {
    const i = idx(hunk.paraId);
    const n = out[idx(hunk.newId)];
    if (i >= 0 && n) {
      const lead = (hunk.del.match(/^\s*/) || [''])[0] || (out[i].text && n.text ? ' ' : '');
      out[i].text = out[i].text + lead + n.text;
      out = out.filter((p) => p.id !== hunk.newId);
    }
  } else if (hunk.kind === 'move') {
    const para = out[idx(hunk.paraId)];
    out = out.filter((p) => p.id !== hunk.paraId);
    placeAfterBasePredecessor(para);
  } else if (hunk.kind === 'format') {
    const p = out[idx(hunk.paraId)];
    if (p) p.type = hunk.from;
  }
  return out;
}
