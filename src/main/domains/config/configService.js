import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../../../..');

// CADENCE_DATA_DIR lets tests (and portable installs) keep data outside the repo.
export const DATA_DIR = process.env.CADENCE_DATA_DIR
  ? path.resolve(process.env.CADENCE_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const DOCS_DIR = path.join(DATA_DIR, 'documents');
export const REVISIONS_DIR = path.join(DATA_DIR, 'revisions');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const SKILL_DIR = path.join(os.homedir(), '.gemini/antigravity/skills/master-writing-skill');
export const VOICE_PROFILE_PATH =
  process.env.CADENCE_VOICE_PROFILE || path.join(SKILL_DIR, 'references/user-voice-profile.md');
export const SCRUB_SCRIPT_PATH =
  process.env.CADENCE_SCRUB_SCRIPT || path.join(SKILL_DIR, 'scripts/scrub_ai_watermarks.py');

// Free Microsoft neural voices (no key). Gemini voices need an API key.
export const VOICES = [
  { id: 'en-US-AvaMultilingualNeural', name: 'Ava', detail: 'US, warm', provider: 'neural' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', detail: 'US, steady', provider: 'neural' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma', detail: 'US, calm', provider: 'neural' },
  { id: 'en-US-BrianMultilingualNeural', name: 'Brian', detail: 'US, conversational', provider: 'neural' },
  { id: 'en-CA-ClaraNeural', name: 'Clara', detail: 'Canadian', provider: 'neural' },
  { id: 'en-CA-LiamNeural', name: 'Liam', detail: 'Canadian', provider: 'neural' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', detail: 'British', provider: 'neural' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', detail: 'British', provider: 'neural' },
  { id: 'Kore', name: 'Kore', detail: 'Gemini, firm', provider: 'gemini' },
  { id: 'Charon', name: 'Charon', detail: 'Gemini, informative', provider: 'gemini' },
  { id: 'Aoede', name: 'Aoede', detail: 'Gemini, breezy', provider: 'gemini' },
  { id: 'Puck', name: 'Puck', detail: 'Gemini, upbeat', provider: 'gemini' },
  { id: 'Leda', name: 'Leda', detail: 'Gemini, youthful', provider: 'gemini' },
  { id: 'Orus', name: 'Orus', detail: 'Gemini, firm', provider: 'gemini' },
];

// Kept for backwards compatibility with older imports.
export const STUDIO_NEURAL_VOICES = VOICES;
export const GEMINI_VOICE_IDS = VOICES.filter((v) => v.provider === 'gemini').map((v) => v.id);
export const DEFAULT_VOICE = 'en-US-AvaMultilingualNeural';

export function ensureDataDirectories() {
  [DATA_DIR, DOCS_DIR, REVISIONS_DIR, UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

export function getDefaultConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY || '',
    voiceId: DEFAULT_VOICE,
    rate: 1,
    textModel: 'gemini-3.8-flash',
    ttsModel: 'gemini-3.8-flash-tts',
    themePreference: 'system',
    showFlags: true,
    pronunciations: [],
    lastOpenedDocId: null,
  };
}

// Only these keys may be written from the client.
const WRITABLE_KEYS = Object.keys(getDefaultConfig());

export function sanitizeConfigPatch(patch = {}) {
  const out = {};
  for (const key of WRITABLE_KEYS) {
    if (patch[key] === undefined) continue;
    out[key] = patch[key];
  }
  if (out.rate !== undefined) {
    const r = Number(out.rate);
    out.rate = Number.isFinite(r) ? Math.min(2, Math.max(0.5, r)) : 1;
  }
  if (out.voiceId !== undefined && !VOICES.some((v) => v.id === out.voiceId)) {
    delete out.voiceId;
  }
  if (out.pronunciations !== undefined) {
    out.pronunciations = Array.isArray(out.pronunciations)
      ? out.pronunciations
          .filter((p) => p && typeof p.from === 'string' && p.from.trim())
          .map((p) => ({ from: p.from.trim(), to: String(p.to || '').trim() }))
          .slice(0, 200)
      : [];
  }
  if (out.themePreference !== undefined && !['system', 'light', 'dark'].includes(out.themePreference)) {
    out.themePreference = 'system';
  }
  return out;
}

export function getConfig(configPath = CONFIG_FILE) {
  ensureDataDirectories();
  let cfg = getDefaultConfig();
  if (fs.existsSync(configPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg = { ...cfg, ...sanitizeConfigPatch(saved) };
      if (saved.lastOpenedDocId) cfg.lastOpenedDocId = saved.lastOpenedDocId;
    } catch (e) {
      console.error('Could not read config, using defaults:', e.message);
    }
  }
  if (!cfg.apiKey && process.env.GEMINI_API_KEY) cfg.apiKey = process.env.GEMINI_API_KEY;
  return cfg;
}

export function saveConfig(patch = {}, configPath = CONFIG_FILE) {
  ensureDataDirectories();
  const current = getConfig(configPath);
  const merged = { ...current, ...sanitizeConfigPatch(patch) };
  if (patch.lastOpenedDocId !== undefined) merged.lastOpenedDocId = patch.lastOpenedDocId;
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// Never send the raw key to the browser.
export function publicConfig(cfg = getConfig()) {
  const { apiKey, ...rest } = cfg;
  return { ...rest, hasApiKey: Boolean(apiKey && apiKey.trim().length > 10), voices: VOICES };
}

export function getVoiceProfileSummary(profilePath = VOICE_PROFILE_PATH) {
  try {
    if (fs.existsSync(profilePath)) return fs.readFileSync(profilePath, 'utf8');
  } catch (e) {
    console.error('Could not load voice profile:', e.message);
  }
  return '';
}
