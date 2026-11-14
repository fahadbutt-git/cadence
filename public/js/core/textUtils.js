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

export const FLAG_RULES = [
  { kind: 'word', label: 'Stock AI word', pattern: new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'gi') },
  { kind: 'dash', label: 'Dash in running prose', pattern: /—|–|--/g },
  { kind: 'semicolon', label: 'Semicolon', pattern: /;/g },
  { kind: 'contrast', label: 'Contrast frame', pattern: /\brather than\b|\bnot (?:just |only |merely )?\w+(?: \w+)?, but\b/gi },
  { kind: 'tail', label: 'Explanation tail', pattern: /,\s*(?:ultimately\s+)?(?:highlighting|underscoring|demonstrating|showcasing|reflecting|emphasizing)\b/gi },
];

/** All flagged spans in a string: [{ start, end, text, kind, label }], sorted by position. */
export function findFlags(text = '') {
  const out = [];
  const str = String(text || '');
  for (const rule of FLAG_RULES) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(str)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: rule.kind, label: rule.label });
      if (m[0].length === 0) rule.pattern.lastIndex++;
    }
  }
  return out.sort((a, b) => a.start - b.start);
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
  return {
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
