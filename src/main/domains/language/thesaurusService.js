// Word alternatives from Datamuse (free, no key). The words either side of the selection
// rank the results by context, so "bank" beside "river" gives different words than beside "loan".

const ENDPOINT = 'https://api.datamuse.com/words';

export async function findSynonyms({ word = '', left = '', right = '', fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const w = word.trim();
  if (!w || w.split(/\s+/).length > 3) return { word: w, options: [], source: 'none' };
  const params = new URLSearchParams({ ml: w, max: '16', md: 'p' });
  const lc = left.trim().split(/\s+/).pop();
  const rc = right.trim().split(/\s+/)[0];
  if (lc) params.set('lc', lc.replace(/[^\p{L}'-]/gu, ''));
  if (rc) params.set('rc', rc.replace(/[^\p{L}'-]/gu, ''));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    const lower = w.toLowerCase();
    const options = [];
    for (const item of Array.isArray(list) ? list : []) {
      const t = String(item.word || '');
      if (!t || t.toLowerCase() === lower || options.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
      options.push(matchCase(w, t));
      if (options.length >= 10) break;
    }
    return { word: w, options, source: 'datamuse' };
  } catch (err) {
    return { word: w, options: [], source: 'none', error: 'Synonyms need an internet connection.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the capitalization pattern of the original word. */
export function matchCase(original, candidate) {
  if (original === original.toUpperCase() && /[A-Z]/.test(original) && original.length > 1) return candidate.toUpperCase();
  if (original[0] === original[0].toUpperCase() && /[A-Z]/.test(original[0])) return candidate[0].toUpperCase() + candidate.slice(1);
  return candidate;
}
