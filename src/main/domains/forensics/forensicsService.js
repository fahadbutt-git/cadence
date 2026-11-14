import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { UPLOADS_DIR, SCRUB_SCRIPT_PATH, ensureDataDirectories } from '../config/configService.js';
import { findFlags, computeBurstinessStats, FLAG_RULES } from '../../../../public/js/core/textUtils.js';

export { FLAG_RULES };

export function computeInlineForensicSummary(text = '') {
  const flags = findFlags(text);
  const byKind = (k) => flags.filter((f) => f.kind === k);
  return {
    bannedWordCount: byKind('word').length,
    bannedWordsUnique: [...new Set(byKind('word').map((f) => f.text.toLowerCase()))],
    emDashCount: byKind('dash').length,
    semicolonCount: byKind('semicolon').length,
    contrastCount: byKind('contrast').length,
    tailCount: byKind('tail').length,
    total: flags.length,
  };
}

export function buildBuiltInReport(text = '') {
  const s = computeInlineForensicSummary(text);
  const stats = computeBurstinessStats(text);
  const lines = [
    `Words ${stats.wordCount}, sentences ${stats.sentenceCount}, sentence length variation ${stats.burstinessCv} (aim for 0.45 or higher).`,
    `Stock AI words: ${s.bannedWordCount}${s.bannedWordsUnique.length ? ` (${s.bannedWordsUnique.join(', ')})` : ''}.`,
    `Dashes: ${s.emDashCount}. Semicolons: ${s.semicolonCount}.`,
    `"Rather than" or "not X but Y" contrasts: ${s.contrastCount}.`,
    `Participial explanation tails: ${s.tailCount}.`,
  ];
  return lines.join('\n');
}

function runScrubScript(text, mode) {
  return new Promise((resolve) => {
    if (!fs.existsSync(SCRUB_SCRIPT_PATH)) return resolve(null);
    ensureDataDirectories();
    const tmp = path.join(UPLOADS_DIR, `audit-${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, 'utf8');
    const args = [SCRUB_SCRIPT_PATH, tmp];
    if (mode === 'academic') args.push('--academic');
    execFile('python3', args, { timeout: 15000 }, (err, stdout) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      resolve(err && !stdout ? null : stdout);
    });
  });
}

export async function runForensicAuditReport(text = '', mode = 'narrative') {
  const summary = computeInlineForensicSummary(text);
  const scriptReport = await runScrubScript(text, mode);
  return {
    summary,
    reportText: scriptReport || buildBuiltInReport(text),
    source: scriptReport ? 'script' : 'built-in',
  };
}
