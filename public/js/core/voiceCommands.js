// Spoken command parsing and echo filtering for conversation mode.
// Pure functions, shared by the browser and the tests.

const NUMBER_WORDS = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5,
  six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, last: -1,
};

const EDIT_VERBS = /\b(change|make|rewrite|replace|swap|cut|remove|delete|add|shorten|tighten|trim|fix|reword|rephrase|simplify|split|merge|expand|move|use|say)\b/i;
const BARGE_WORDS = new Set(['stop', 'pause', 'wait', 'hold', 'cadence', 'hey']);

export function tokens(text = '') {
  return (String(text).toLowerCase().match(/[a-z0-9']+/g) || []).map((w) => w.replace(/^'+|'+$/g, ''));
}

/** Words in the transcript that were not part of what Cadence was just saying. */
export function novelWords(transcript, contextTexts = []) {
  const ctx = new Set(contextTexts.flatMap((t) => tokens(t)));
  return tokens(transcript).filter((w) => w && !ctx.has(w));
}

/**
 * Should a partial transcript heard while Cadence is speaking interrupt it?
 * The microphone also hears the reading voice; those words match the sentence being read and are ignored.
 */
export function isBargeIn(transcript, contextTexts = []) {
  const novel = novelWords(transcript, contextTexts);
  if (novel.length >= 2 || novel.some((w) => BARGE_WORDS.has(w))) return true;
  // A single new word still counts when it is a command on its own ("next", "accept", "back").
  return novel.length === 1 && !['edit', 'ask', 'none'].includes(parseCommand(novel[0]).type);
}

/** Drop leading words that came from the reading voice, keep what the person said. */
export function cleanTranscript(transcript = '', contextTexts = []) {
  const ctx = new Set(contextTexts.flatMap((t) => tokens(t)));
  const words = String(transcript).trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && ctx.has(tokens(words[i])[0])) i++;
  return words.slice(i).join(' ').trim();
}

function numberFrom(text) {
  const digit = text.match(/\b(\d{1,3})\b/);
  if (digit) return Number(digit[1]);
  for (const [w, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(text)) return n;
  }
  return null;
}

function scopeFrom(text) {
  if (/\b(this|that|the|whole|current) paragraph\b/.test(text)) return 'paragraph';
  if (/\b(this|that|the|last|current) (sentence|line)\b/.test(text)) return 'sentence';
  if (/\b(selection|selected|highlighted)\b/.test(text)) return 'selection';
  return 'auto';
}

/**
 * Turn an utterance into a command.
 * Returns { type, ... } where type is one of:
 * pause, resume, restart, prev, next, repeat, nextParagraph, prevParagraph, gotoParagraph,
 * accept, reject, readSuggestion, undo, redo, faster, slower, flags, snapshot, stopTalking, help,
 * edit { action, instruction, scope }, ask { question }, none.
 */
export function parseCommand(raw = '') {
  const text = String(raw).trim().toLowerCase().replace(/[.,!?]+$/g, '').replace(/^(okay|ok|so|um|uh|alright|all right|cadence|hey cadence)[, ]+/g, '').trim();
  if (!text) return { type: 'none' };
  const has = (re) => re.test(text);
  const whole = (re) => new RegExp(`^(?:${re.source})$`).test(text);

  // Conversation control
  if (whole(/(stop|stop listening|stop talking|goodbye|bye|that's all|thats all|we're done|turn off talk|end conversation)/) && /listening|talking|goodbye|bye|all|done|off|conversation/.test(text)) return { type: 'stopTalking' };
  if (whole(/(pause|stop|wait|hold on|hang on|one sec(ond)?|stop reading|pause reading|hold up)/)) return { type: 'pause' };
  if (whole(/(continue|resume|keep going|go on|carry on|go ahead|read|play|read on|keep reading|pick (it )?(back )?up|start reading|let's continue|lets continue|okay continue|continue reading|go)/)) return { type: 'resume' };
  if (has(/\b(start over|from the (top|start|beginning)|beginning of the (document|statement|essay))\b/)) return { type: 'restart' };
  if (whole(/(help|what can (i|you) say|commands)/)) return { type: 'help' };

  // Navigation
  if (has(/\b(go to|jump to|read|skip to|take me to) (the )?paragraph\b/) || whole(/paragraph \w+/)) {
    const n = numberFrom(text);
    if (n) return { type: 'gotoParagraph', n };
  }
  if (has(/\b(next|skip( the)?) paragraph\b/)) return { type: 'nextParagraph' };
  if (has(/\b(previous|last|back a) paragraph\b/) && !EDIT_VERBS.test(text)) return { type: 'prevParagraph' };
  if (whole(/(repeat|repeat that|again|say that again|read that again|one more time|what was that)/)) return { type: 'repeat' };
  if (whole(/(next|skip|next sentence|skip (this|that)( sentence)?|skip it)/)) return { type: 'next' };
  if (whole(/(back|go back|previous|previous sentence|back one|go back one)/)) return { type: 'prev' };

  // Suggestions
  if (whole(/(accept|accept (it|that|this|the change|the suggestion|the edit)|yes|yeah|yep|do it|apply (it|that)|sounds good|looks good|keep (it|that)|perfect|great)/)) return { type: 'accept' };
  if (whole(/(reject|reject (it|that|this)|no|nope|discard( it)?|never ?mind|forget (it|that)|don't|dont|leave it|keep the original)/)) return { type: 'reject' };
  if (whole(/(read (it|that|the (suggestion|change|edit|new version|revision))( back)?( to me)?|how does (it|that) sound|let me hear (it|that)|read the new (one|version))/)) return { type: 'readSuggestion' };
  if (whole(/(undo|undo (that|it)|put it back|go back to how it was)/)) return { type: 'undo' };
  if (whole(/(redo|redo (that|it))/)) return { type: 'redo' };

  // Reader settings and tools
  if (has(/\b(faster|speed up|read faster|quicker)\b/) && !EDIT_VERBS.test(text)) return { type: 'faster' };
  if (has(/\b(slower|slow down|read slower)\b/) && !EDIT_VERBS.test(text)) return { type: 'slower' };
  if (has(/\b(what's|what is|anything|any) (flagged|wrong)\b|\bany (problems|issues|flags)\b|\bcheck (this|it|the paragraph)\b/)) return { type: 'flags' };
  if (has(/\b(save|keep) (a )?(version|snapshot|checkpoint)\b/)) return { type: 'snapshot' };

  // Edits and questions
  const scope = scopeFrom(text);
  if (has(/\b(tighten|shorten|trim|make (it|this|that) (shorter|tighter|more concise)|cut it down)\b/) && !has(/\breplace\b/)) return { type: 'edit', action: 'tighten', instruction: raw.trim(), scope };
  if (has(/\b(clean (it |this |that )?up|humani[sz]e|less (like )?ai|sound(s)? less like ai|remove the ai)\b/)) return { type: 'edit', action: 'humanize', instruction: raw.trim(), scope };
  if (has(/\b(cut|remove|drop|delete) the (ending|last sentence|summary|moral|conclusion)\b/)) return { type: 'edit', action: 'cut-ending', instruction: raw.trim(), scope: scope === 'auto' ? 'paragraph' : scope };
  const question = /^(what|why|how|is|are|does|do|should|can|could|would|will|which|who|any)\b/.test(text) || /\?\s*$/.test(String(raw));
  if (question && !EDIT_VERBS.test(text.replace(/^(can|could|would) you /, ''))) return { type: 'ask', question: raw.trim(), scope };
  return { type: 'edit', action: 'rewrite', instruction: raw.trim(), scope };
}

export const VOICE_HELP =
  'Say continue to keep reading, pause to stop, back or next to move a sentence, go to paragraph three, or start over. ' +
  'To edit, just say what you want, like tighten this sentence or replace pivotal with important. ' +
  'Then say accept, reject, read it, or undo. Say stop listening when you are done.';
