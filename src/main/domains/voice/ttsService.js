import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { DEFAULT_VOICE, GEMINI_VOICE_IDS, VOICES } from '../config/configService.js';

const GEMINI_TO_NEURAL = {
  Kore: 'en-US-EmmaMultilingualNeural',
  Charon: 'en-US-BrianMultilingualNeural',
  Aoede: 'en-US-AvaMultilingualNeural',
  Puck: 'en-US-AndrewMultilingualNeural',
  Leda: 'en-CA-ClaraNeural',
  Orus: 'en-CA-LiamNeural',
};

const NEURAL_TIMEOUT_MS = 15000;

export function resolveNeuralVoiceName(requested = DEFAULT_VOICE) {
  if (!requested) return DEFAULT_VOICE;
  if (GEMINI_TO_NEURAL[requested]) return GEMINI_TO_NEURAL[requested];
  const match = VOICES.find((v) => v.id === requested && v.provider === 'neural');
  return match ? match.id : DEFAULT_VOICE;
}

// The Edge service takes SSML, so reserved XML characters must be escaped
// or the request silently fails (e.g. "R&D", "<20 mmHg").
export function escapeForSsml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Apply the user's pronunciation list (whole-word, case-insensitive). Word edges are checked with Unicode
// letters, so entries such as µm, ≥ or % work too.
export function applyPronunciations(text = '', rules = []) {
  let out = String(text);
  for (const rule of rules || []) {
    if (!rule?.from || !rule.to) continue;
    const body = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pre = /^[\p{L}\p{N}]/u.test(rule.from) ? '(?<![\\p{L}\\p{N}])' : '';
    const post = /[\p{L}\p{N}]$/u.test(rule.from) ? '(?![\\p{L}\\p{N}])' : '';
    const pat = new RegExp(`${pre}${body}${post}`, 'giu');
    out = out.replace(pat, rule.to);
  }
  return out;
}

/** Citation numbers are not read aloud: superscripts (excluded²⁶) and bracketed numbers ([12], [3,4]). */
export function stripCitations(text = '') {
  return String(text).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻,]*[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '').replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '');
}

export async function synthesizeWithStudioNeural(text, voiceId = DEFAULT_VOICE) {
  const clean = (text || '').trim();
  if (!clean) throw new Error('Text is empty');
  const voice = resolveNeuralVoiceName(voiceId);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(escapeForSsml(clean));

  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      try { tts.close(); } catch (e) {}
      reject(new Error('Neural voice service timed out'));
    }, NEURAL_TIMEOUT_MS);
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', () => {
      clearTimeout(timer);
      try { tts.close(); } catch (e) {}
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return reject(new Error('Neural voice returned no audio'));
      resolve({ audio: buffer, mimeType: 'audio/mpeg', voice, provider: 'neural' });
    });
    audioStream.on('error', (err) => {
      clearTimeout(timer);
      try { tts.close(); } catch (e) {}
      reject(err);
    });
  });
}

export async function synthesizeWithGemini(text, voice, apiKey, ttsModel) {
  const client = new GoogleGenAI({ apiKey });
  const interaction = await client.interactions.create({
    model: ttsModel,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            annotations: [{ type: 'speech_metadata', style: 'clear, natural, steady reading pace' }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  });
  const data = interaction?.output_audio?.data;
  if (!data) throw new Error('Gemini returned no audio');
  return {
    audio: Buffer.from(data, 'base64'),
    mimeType: interaction.output_audio.mime_type || 'audio/wav',
    voice,
    provider: 'gemini',
  };
}

/**
 * Returns { audio: Buffer, mimeType, voice, provider, notice? }.
 * Gemini voices fall back to the nearest neural voice when no key is set or the call fails.
 */
export async function synthesizeSpeech({
  text,
  voice = DEFAULT_VOICE,
  apiKey = '',
  ttsModel = 'gemini-3.8-flash-tts',
  pronunciations = [],
  engines = { neural: synthesizeWithStudioNeural, gemini: synthesizeWithGemini },
}) {
  const clean = applyPronunciations(stripCitations(text || '').trim(), pronunciations);
  if (!clean) throw new Error('Text is empty');

  if (GEMINI_VOICE_IDS.includes(voice)) {
    if (apiKey) {
      try {
        return await engines.gemini(clean, voice, apiKey, ttsModel);
      } catch (err) {
        const res = await engines.neural(clean, voice);
        const name = VOICES.find((v) => v.id === res.voice)?.name || 'a free voice';
        return { ...res, notice: `Gemini voice failed (${err.message}). Using ${name} instead.` };
      }
    }
    const res = await engines.neural(clean, voice);
    return { ...res, notice: 'Gemini voices need an API key. Using the closest free voice.' };
  }
  return engines.neural(clean, voice);
}

/** Split long text into chunks the services accept (paragraph, then sentence boundaries). */
export function chunkForSynthesis(paragraphs = [], maxChars = 2500) {
  const chunks = [];
  for (const raw of paragraphs) {
    const text = (raw || '').trim();
    if (!text) continue;
    if (text.length <= maxChars) {
      chunks.push(text);
      continue;
    }
    let buf = '';
    for (const sent of text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]) {
      if ((buf + sent).length > maxChars && buf) {
        chunks.push(buf.trim());
        buf = '';
      }
      buf += sent;
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks;
}

/** Whole-document MP3 (neural voices produce MP3 frames that can be concatenated). */
export async function synthesizeDocumentMp3({ paragraphs = [], voice, pronunciations = [], engine = synthesizeWithStudioNeural }) {
  const chunks = chunkForSynthesis(paragraphs.map((p) => applyPronunciations(stripCitations(p), pronunciations)));
  if (!chunks.length) throw new Error('Document is empty');
  const buffers = [];
  for (const chunk of chunks) {
    const res = await engine(chunk, voice);
    buffers.push(res.audio);
  }
  return Buffer.concat(buffers);
}
