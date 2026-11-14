import { GoogleGenAI } from '@google/genai';
import { getVoiceProfileSummary } from '../config/configService.js';

export const ACTIONS = {
  rewrite: 'Apply the instruction to the target text.',
  tighten:
    'Tighten the target text by roughly 10 to 25 percent. Prefer active verbs. Keep every concrete fact, name and number.',
  humanize:
    'Remove AI-sounding phrasing from the target text: stock words (delve, tapestry, testament, pivotal, crucial, foster, navigate, leverage, utilize, multifaceted, intricate), participial tails (", highlighting...", ", underscoring..."), "not X but Y" contrasts, em dashes and semicolons. Keep the author\'s meaning and voice.',
  'cut-ending':
    'If the target text ends on a moralizing summary sentence that explains what the experience meant, remove it so the text ends on a concrete action or detail. Change nothing else.',
  'from-dictation':
    'The target text is rough dictated speech. Turn it into a clean paragraph in the author\'s voice. Keep their specific details and phrases.',
  ask: 'Answer the question about the text. Do not edit. Return an empty proposedText.',
};

const RULES = `House rules for any text you write:
- Canadian English spelling (honour, centre, modelling, counselling).
- No em dashes and no semicolons in running prose.
- Never open a paragraph with "Because".
- No stock AI vocabulary (delve, tapestry, testament, pivotal, crucial, foster, navigate, leverage, utilize, multifaceted, intricate, underscore, showcase).
- No participial "-ing" explanation tails and no moralizing closing sentence.
- Keep every concrete clinical, engineering and personal fact.`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Offline editor used when no API key is configured. Handles explicit, mechanical edits only. */
export function localRuleBasedEdit(action = 'humanize', text = '', instruction = '') {
  const original = text || '';
  let revised = original;
  const changes = [];

  if (instruction) {
    const replace = instruction.match(
      /(?:change|replace|swap)\s+["“']?(.+?)["”']?\s+(?:to|with|for)\s+["“']?(.+?)["”']?\s*[.!?]?$/i
    );
    const remove = instruction.match(/(?:delete|remove|cut)\s+(?:the\s+(?:word|phrase)\s+)?["“']?(.+?)["”']?\s*[.!?]?$/i);
    if (replace) {
      const pat = new RegExp(`\\b${escapeRe(replace[1].trim())}\\b`, 'gi');
      if (pat.test(revised)) {
        revised = revised.replace(pat, replace[2].trim());
        changes.push(`replaced "${replace[1].trim()}" with "${replace[2].trim()}"`);
      }
    } else if (remove && !/sentence|ending|last/i.test(remove[1])) {
      const pat = new RegExp(`\\s*\\b${escapeRe(remove[1].trim())}\\b`, 'gi');
      if (pat.test(revised)) {
        revised = revised.replace(pat, '');
        changes.push(`removed "${remove[1].trim()}"`);
      }
    }
  }

  if (action === 'humanize' || action === 'tighten') {
    const swaps = [
      [/\s*(?:—|--)\s*/g, ', ', 'replaced dashes with commas'],
      [/;\s+(\w)/g, (_, c) => `. ${c.toUpperCase()}`, 'split semicolon clauses'],
      [/\bdelve[ds]?\s+into\b/gi, 'examine', null],
      [/\butiliz(e|es|ed|ing)\b/gi, (m) => m.toLowerCase().replace('utiliz', 'us'), null],
      [/\bleverag(e|es|ed|ing)\b/gi, (m) => m.toLowerCase().replace('leverag', 'us'), null],
      [/\b(pivotal|crucial)\b/gi, 'important', null],
      [/\bserved as a testament to\b/gi, 'showed', null],
      [/\ba testament to\b/gi, 'evidence of', null],
      [/,\s*(?:ultimately\s+)?(?:underscoring|highlighting|demonstrating)\s+/gi, '. This showed ', null],
    ];
    for (const [pat, rep, label] of swaps) {
      if (pat.test(revised)) {
        revised = revised.replace(pat, rep);
        changes.push(label || 'replaced stock AI phrasing');
      }
    }
  }

  if (action === 'tighten') {
    const filler = /\b(very|really|quite|just|actually|basically|in order)\s+/gi;
    if (filler.test(revised)) {
      revised = revised.replace(filler, (m, w) => (w.toLowerCase() === 'in order' ? '' : ''));
      changes.push('cut filler words');
    }
  }

  if (action === 'cut-ending') {
    const sents = revised.match(/[^.!?]+[.!?]+["')\]]*(\s|$)|[^.!?]+$/g) || [revised];
    const last = sents[sents.length - 1] || '';
    if (sents.length > 1 && /\b(taught me|reminded me|showed me|underscor|true meaning|ultimately|this experience)\b/i.test(last)) {
      sents.pop();
      revised = sents.join('');
      changes.push('cut the closing summary sentence');
    }
  }

  revised = revised.replace(/ {2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  const changed = revised !== original.trim();
  const unique = [...new Set(changes)];
  const summary = unique.slice(0, 3).join(', ');

  return {
    proposedText: changed ? revised : '',
    rationale: changed
      ? `Offline edit: ${summary}.`
      : 'No mechanical change found. Add a Gemini API key in Settings for full rewrites, or give an exact instruction such as "replace utilized with used".',
    spokenReply: changed
      ? `I ${summary}. Have a look and accept it if it reads right.`
      : 'I did not find anything to change. Try an exact instruction, like replace one word with another.',
    source: 'offline',
  };
}

export function parseModelJson(raw = '') {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Model reply was not valid JSON');
  }
}

export function buildPrompt({ action, targetText, contextText, instruction, style }) {
  const task = ACTIONS[action] || ACTIONS.rewrite;
  return `${task}

Document type: ${style === 'academic' ? 'academic manuscript (AMA style, formal, precise)' : 'personal statement or narrative (plain, concrete, first person)'}.
${instruction ? `\nInstruction from the author: ${instruction}\n` : ''}
Target text (return a replacement for exactly this span):
"""${targetText}"""

Surrounding context (do not rewrite, for reference only):
"""${(contextText || '').slice(0, 6000)}"""`;
}

export async function generateEditorialRevision({
  apiKey = '',
  model = 'gemini-3.8-flash',
  action = 'rewrite',
  targetText = '',
  contextText = '',
  instruction = '',
  style = 'narrative',
  client = null,
}) {
  if (!targetText.trim() && action !== 'ask') throw new Error('Nothing selected to edit');
  if (!apiKey.trim() && !client) return localRuleBasedEdit(action, targetText, instruction);

  const profile = getVoiceProfileSummary();
  const system = `You are Cadence, a careful co-editor sitting beside the author. You suggest edits; the author decides.
${RULES}
${profile ? `\nAuthor voice profile:\n${profile.slice(0, 4000)}` : ''}

Reply as JSON with keys:
- proposedText: replacement for the target text, or "" if no edit is needed or the author only asked a question.
- rationale: one short sentence on why.
- spokenReply: one or two natural sentences to say aloud to the author.`;

  try {
    const ai = client || new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      system_instruction: system,
      input: buildPrompt({ action, targetText, contextText, instruction, style }),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            proposedText: { type: 'string' },
            rationale: { type: 'string' },
            spokenReply: { type: 'string' },
          },
          required: ['proposedText', 'rationale', 'spokenReply'],
        },
      },
      store: false,
    });
    const parsed = parseModelJson(interaction.output_text || '');
    const proposed = (parsed.proposedText || '').trim();
    return {
      proposedText: proposed && proposed !== targetText.trim() ? proposed : '',
      rationale: parsed.rationale || '',
      spokenReply: parsed.spokenReply || parsed.rationale || '',
      source: 'gemini',
    };
  } catch (err) {
    const local = localRuleBasedEdit(action, targetText, instruction);
    return { ...local, rationale: `Gemini request failed (${err.message}). ${local.rationale}`, source: 'offline' };
  }
}
