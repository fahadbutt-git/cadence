import { GoogleGenAI } from '@google/genai';
import { getVoiceProfileSummary } from '../config/configService.js';
import { splitIntoSentences } from '../../../../public/js/core/textUtils.js';

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
  proofread:
    'Proofread the target text. Fix only errors: spelling, grammar, punctuation, agreement, and wrong words that are real words (for example "spinal cold injury" should be "spinal cord injury"). Keep the wording, voice and length otherwise identical. Use Canadian spelling.',
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
  if (action === 'ask') {
    const words = original.split(/\s+/).filter(Boolean).length;
    const sentences = (original.match(/[.!?]+(\s|$)/g) || []).length || 1;
    const facts = `This passage has ${words} word${words === 1 ? '' : 's'} in ${sentences} sentence${sentences === 1 ? '' : 's'}, about ${Math.round(words / sentences)} words per sentence.`;
    return {
      proposedText: '',
      rationale: `${facts} Answering questions needs a Gemini key in Settings.`,
      spokenReply: `${facts} To answer questions like that I need a Gemini key, which you can add in Settings.`,
      source: 'offline',
    };
  }
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
        changes.push(`replaced “${replace[1].trim()}” with “${replace[2].trim()}”`);
      }
    } else if (remove && !/sentence|ending|last/i.test(remove[1])) {
      const pat = new RegExp(`\\s*\\b${escapeRe(remove[1].trim())}\\b`, 'gi');
      if (pat.test(revised)) {
        revised = revised.replace(pat, '');
        changes.push(`removed “${remove[1].trim()}”`);
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
    const before = revised;
    revised = revised
      .replace(/\b([Ii])n order to\b/g, (m, i) => (i === 'I' ? 'To' : 'to'))
      .replace(/\b(very|really|actually|basically)\s+(?=[a-z])/gi, '')
      .replace(/\bI think (that )?/g, '');
    if (revised !== before) changes.push('cut filler words');
  }

  if (action === 'cut-ending') {
    const sents = revised.match(/[^.!?]+[.!?]+["')\]]*(\s|$)|[^.!?]+$/g) || [revised];
    const last = sents[sents.length - 1] || '';
    // An explicit "cut the last sentence" cuts it; otherwise only a moralising summary ending is cut.
    const explicit = /\b(last|final) (sentence|line)\b|\b(cut|remove|drop|delete|get rid of|lose) the end(ing)?\b/i.test(instruction);
    if (sents.length > 1 && (explicit || /\b(taught me|reminded me|showed me|underscor|true meaning|ultimately|this experience)\b/i.test(last))) {
      sents.pop();
      revised = sents.join('');
      changes.push('cut the closing summary sentence');
    }
  }

  revised = revised.replace(/ {2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  // Removing a word at the start of a sentence can leave it lower case.
  revised = revised.replace(/([.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  if (/^[A-Z]/.test(original.trim())) revised = revised.charAt(0).toUpperCase() + revised.slice(1);
  const changed = revised !== original.trim();
  const unique = [...new Set(changes)];
  const summary = unique.slice(0, 3).join(', ');

  return {
    proposedText: changed ? revised : '',
    rationale: changed
      ? `Offline edit: ${summary}.`
      : 'No mechanical change found. Add a Gemini API key in Settings for full rewrites, or give an exact instruction such as “replace utilized with used”.',
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

// ---------- Editor feedback as comments ----------

const REVIEW_RUBRIC = `Review this draft the way an experienced mentor marks up a residency personal statement or similar piece.
Write margin comments, not rewrites. Each comment is one to three short sentences, direct and specific, phrased as a question or an instruction to the author.
Judge each paragraph on:
- Does it have one clear takeaway? Say what is missing if not.
- Does every detail serve the narrative or the reason for choosing the specialty or program? Flag lists of titles, roles or activities that make no point.
- Does it show who the writer is and what drives them, not just what they did?
- Does it connect to the theme or story introduced earlier?
- For a program paragraph: does it say why this program fits the writer's story, not just what the program offers?
Also judge the whole piece: is there a through-line, and does a conclusion tie it together?
Skip praise unless it tells the author what to keep. Do not comment on spelling. At most three comments per paragraph.`;

/** Offline feedback built from the text checks, used when no API key is set. */
export function localReview(paragraphs = []) {
  const comments = [];
  const bodies = paragraphs.map((p, i) => ({ ...p, i })).filter((p) => p.type !== 'heading' && (p.text || '').trim());
  for (const p of bodies) {
    const text = p.text;
    const sents = splitIntoSentences(text);
    if (!sents.length) sents.push(text);
    const notes = [];
    // A list: four or more comma-separated chunks that are mostly short.
    const listy = sents.find((s) => {
      const parts = s.split(/,|;|\band\b/).map((x) => x.trim().split(/\s+/).filter(Boolean).length).filter(Boolean);
      const short = parts.filter((n) => n <= 6).length;
      return parts.length >= 4 && short / parts.length >= 0.6;
    });
    if (listy) notes.push({ quote: listy.trim(), text: 'This reads as a list. Keep only the items that make the paragraph\'s point, or say what they add up to.' });
    const iStarts = sents.filter((s) => /^\s*I\b/.test(s)).length;
    if (sents.length >= 4 && iStarts / sents.length > 0.5) notes.push({ text: 'Most sentences start with "I". Vary the openings so the paragraph reads less like a list of actions.' });
    const long = sents.filter((s) => s.split(/\s+/).length > 35);
    if (long.length) notes.push({ quote: long[0].trim(), text: `${long.length === 1 ? 'This sentence runs' : `${long.length} sentences run`} past 35 words. Split them so the main point lands.` });
    const last = (sents.at(-1) || '').trim();
    if (sents.length > 1 && /\b(taught me|showed me|reminded me|this experience|ultimately|truly|purest|truest)\b/i.test(last)) notes.push({ quote: last, text: 'This closing line explains what the story meant. Consider ending on the concrete moment instead.' });
    const stock = text.match(/\b(passion for|passionate about|make a difference|ever since|lifelong dream|cemented my desire|fuell?ed my passion)\b/i);
    if (stock) notes.push({ quote: stock[0], text: 'Stock phrase. Replace it with the specific detail that made you feel this.' });
    // Anchor on the opening words only, so the highlight marks where the issue starts without shading whole sentences.
    const anchor = (q) => (q ? q.split(/\s+/).slice(0, 8).join(' ') : '');
    for (const n of notes.slice(0, 3)) {
      const q = anchor(n.quote);
      comments.push({ paraIndex: p.i, quote: q && text.includes(q) ? q : '', text: n.text });
    }
  }
  const last = bodies.at(-1);
  if (last && last.text.split(/\s+/).length < 60) comments.push({ paraIndex: null, text: 'The ending is short. Make sure the conclusion ties the opening theme to why you want this specialty and program.' });
  if (bodies.length >= 3) comments.push({ paraIndex: null, text: 'Check that each paragraph has one clear takeaway and that together they build one argument. Offline review only checks surface patterns. Add a Gemini API key in Settings for full editor feedback.' });
  return { comments, source: 'offline' };
}

export async function generateReview({ apiKey = '', model = 'gemini-3.8-flash', paragraphs = [], style = 'narrative', client = null }) {
  if (!apiKey.trim() && !client) return localReview(paragraphs);
  const numbered = paragraphs.map((p, i) => `[${i}]${p.type === 'heading' ? ' (heading)' : ''} ${p.text}`).join('\n\n');
  try {
    const ai = client || new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      system_instruction: `${REVIEW_RUBRIC}\n\nDocument type: ${style === 'academic' ? 'academic manuscript' : 'personal statement or narrative'}.\n${RULES}\n\nReply as JSON: { "comments": [ { "paraIndex": number or null for a comment on the whole piece, "quote": exact short phrase from that paragraph or "", "text": the comment } ] }`,
      input: numbered,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            comments: {
              type: 'array',
              items: {
                type: 'object',
                properties: { paraIndex: { type: ['integer', 'null'] }, quote: { type: 'string' }, text: { type: 'string' } },
                required: ['paraIndex', 'text'],
              },
            },
          },
          required: ['comments'],
        },
      },
      store: false,
    });
    const parsed = parseModelJson(interaction.output_text || '');
    const comments = (parsed.comments || [])
      .filter((c) => c && c.text && (c.paraIndex === null || (Number.isInteger(c.paraIndex) && c.paraIndex >= 0 && c.paraIndex < paragraphs.length)))
      .map((c) => ({
        paraIndex: c.paraIndex,
        quote: c.paraIndex !== null && c.quote && paragraphs[c.paraIndex].text.includes(c.quote) ? c.quote : '',
        text: c.text.trim(),
      }));
    return { comments, source: 'gemini' };
  } catch (err) {
    const local = localReview(paragraphs);
    return { ...local, notice: `Gemini request failed (${err.message}). Showing offline feedback.` };
  }
}

// ---------- Alternatives: several rewordings to choose from ----------

export async function generateAlternatives({ apiKey = '', model = 'gemini-3.8-flash', targetText = '', contextText = '', style = 'narrative', client = null } = {}) {
  const target = targetText.trim();
  if (!target) throw Object.assign(new Error('Select a sentence or phrase first'), { status: 400 });
  if (!apiKey.trim() && !client) {
    return { options: [], source: 'offline', message: 'Rewordings need a Gemini key in Settings. Single words get synonyms without one.' };
  }
  const profile = getVoiceProfileSummary();
  const system = `You offer the author alternative wordings for a passage. You never change facts, names or numbers.
${RULES}
${profile ? `\nAuthor voice profile:\n${profile.slice(0, 3000)}` : ''}

Reply as JSON: { "options": [ { "text": "...", "label": "..." } ] } with exactly three options that differ in a real way:
one plainer, one shorter, one that keeps the length but improves rhythm or precision. label is two to four words describing the option.`;
  try {
    const ai = client || new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model,
      system_instruction: system,
      input: `Document type: ${style === 'academic' ? 'academic manuscript' : 'personal statement or narrative'}.

Passage to reword:
"""${target}"""

Context (for reference only):
"""${(contextText || '').slice(0, 4000)}"""`,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: { options: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, label: { type: 'string' } }, required: ['text', 'label'] } } },
          required: ['options'],
        },
      },
      store: false,
    });
    const parsed = parseModelJson(interaction.output_text || '');
    const seen = new Set([target]);
    const options = (parsed.options || [])
      .map((o) => ({ text: String(o.text || '').trim(), label: String(o.label || '').trim() }))
      .filter((o) => o.text && !seen.has(o.text) && seen.add(o.text))
      .slice(0, 4);
    return { options, source: 'gemini' };
  } catch (err) {
    return { options: [], source: 'offline', message: `Gemini request failed (${err.message}).` };
  }
}
