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

const ADVERB_EXCEPTIONS = new Set(['only', 'family', 'early', 'likely', 'unlikely', 'reply', 'supply', 'apply', 'july', 'italy', 'holy', 'ugly', 'daily', 'friendly', 'lonely', 'elderly', 'ally', 'belly', 'bully', 'jelly', 'rally', 'silly', 'rely', 'comply', 'imply', 'multiply', 'assembly', 'anomaly', 'monopoly', 'emily', 'kelly', 'lily', 'molly', 'polly', 'sally', 'holly', 'billy', 'fly', 'butterfly', 'curly', 'costly', 'lively', 'lovely', 'timely', 'weekly', 'monthly', 'yearly', 'hourly', 'nightly', 'orderly', 'scholarly', 'deadly', 'oily', 'hilly', 'chilly', 'anomaly']);
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

// Check groups shown in the Checks tab. Each group can be switched off.
export const CHECK_GROUPS = {
  house: 'Stock AI phrasing',
  clarity: 'Clarity',
  style: 'Style',
};

export const FLAG_RULES = [
  { kind: 'word', group: 'house', label: 'Stock AI word', pattern: new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'gi') },
  { kind: 'dash', group: 'house', label: 'Dash in running prose', pattern: /—|–|--/g },
  { kind: 'semicolon', group: 'house', label: 'Semicolon', pattern: /;/g },
  { kind: 'contrast', group: 'house', label: 'Contrast frame', pattern: /\brather than\b|\bnot (?:just |only |merely )?\w+(?: \w+)?, but\b/gi },
  { kind: 'tail', group: 'house', label: 'Explanation tail', pattern: /,\s*(?:ultimately\s+)?(?:highlighting|underscoring|demonstrating|showcasing|reflecting|emphasizing)\b/gi },
  { kind: 'passive', group: 'clarity', label: 'Passive voice', pattern: /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w{3,}ed|known|seen|given|taken|made|done|shown|written|born|brought|built|caught|chosen|drawn|driven|found|held|kept|led|left|lost|meant|met|paid|put|said|sent|sold|spent|taught|thought|told|understood|won|worn)\b(?:\s+by\b)?/gi },
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
export function findFlags(text = '', groups = null) {
  const out = [];
  const str = String(text || '');
  const on = (g) => !groups || groups[g] !== false;
  for (const rule of FLAG_RULES) {
    if (!on(rule.group)) continue;
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(str)) !== null) {
      if (m[0].length === 0) { rule.pattern.lastIndex++; continue; }
      if (rule.keep && !rule.keep(m[0], str, m.index)) continue;
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: rule.kind, group: rule.group, label: rule.label });
    }
  }
  if (on('style')) out.push(...echoFlags(str));
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
    return out;
  }
  const re = /[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const lead = m[0].length - m[0].trimStart().length;
    const trimmed = m[0].trim();
    if (trimmed) out.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed });
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
  paragraphs.forEach((p, pIdx) => {
    if (pIdx < startParaIdx) return;
    const raw = typeof p === 'string' ? p : p?.text || '';
    sentenceRanges(raw).forEach((r, sIdx) => {
      if (pIdx === startParaIdx && sIdx < startSentIdx) return;
      queue.push({ paraIndex: pIdx, sentIndex: sIdx, text: r.text, start: r.start, end: r.end });
    });
  });
  return queue;
}
