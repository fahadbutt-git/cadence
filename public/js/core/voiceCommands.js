// Spoken command parsing and echo filtering for conversation mode.
// Pure functions, shared by the browser and the tests.

const UNITS = {
  one: 1, first: 1, won: 1, two: 2, second: 2, to: 2, too: 2, three: 3, third: 3, tree: 3, four: 4, fourth: 4, for: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9,
};
const TEENS = {
  ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14,
  fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19,
};
const TENS = { twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40, fifty: 50, fiftieth: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, hundredth: 100 };

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
export function isBargeIn(transcript, contextTexts = [], { pending = false, reply = '' } = {}) {
  const raw = String(transcript).trim();
  // Assent words while reading only matter when there is something to accept.
  if (isFiller(raw) && !(pending && /^(yes|yeah|no)$/i.test(raw.replace(/[.,!?]/g, '')))) return false;
  const words = tokens(raw);
  const seq = ` ${words.join(' ')} `;
  // Words heard that sit, in order, inside the text being read are the reading voice ("Next, I rotated...").
  const inRead = words.length > 0 && contextTexts.some((t) => ` ${tokens(t).join(' ')} `.includes(seq));
  // Cadence's own spoken reply is heard from its start ("Sorry, I heard..."), so only a prefix of it is echo.
  const replyTokens = tokens(reply);
  const fromReply = words.length > 0 && replyTokens.slice(0, words.length).join(' ') === words.join(' ');
  if (inRead || fromReply) return false;
  // A short utterance that is exactly a command counts, even when the reply just said that word ("Say accept").
  const cmd = parseCommand(raw).type;
  if (words.length <= 4 && !['edit', 'ask', 'none', 'comment', 'unknown'].includes(cmd)) return true;
  const novel = novelWords(transcript, [...contextTexts, reply]);
  if (novel.length >= 2 || novel.some((w) => BARGE_WORDS.has(w))) return true;
  // A single new word still counts when it is a command on its own ("next", "accept", "back").
  return novel.length === 1 && !['edit', 'ask', 'none', 'unknown'].includes(parseCommand(novel[0]).type);
}

/**
 * Drop the leading part of a transcript that was Cadence's own reading voice, keep what the person said.
 * Only a run of two or more words that appears, in order, in what was being read counts as echo, so a
 * command like "tighten this" survives even when those words also occur in the text.
 */
export function cleanTranscript(transcript = '', contextTexts = []) {
  const words = String(transcript).trim().split(/\s+/).filter(Boolean);
  const ctx = contextTexts.map((t) => ` ${tokens(t).join(' ')} `);
  // Everything heard was the reading voice: nothing was said.
  const all = tokens(words.join(' '));
  if (all.length && ctx.some((c) => c.includes(` ${all.join(' ')} `))) return '';
  for (let k = words.length - 1; k >= 2; k--) {
    const prefix = tokens(words.slice(0, k).join(' '));
    if (prefix.length < 2) continue;
    const needle = ` ${prefix.join(' ')} `;
    if (ctx.some((c) => c.includes(needle))) return words.slice(k).join(' ').trim();
  }
  return words.join(' ').trim();
}

/** Paragraph number from "paragraph 21", "paragraph twenty one", "the third paragraph", "paragraph to". -1 means the last. */
export function numberFrom(text) {
  const digit = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\b/);
  if (digit) return Number(digit[1]);
  if (/\b(last|final|end)\b/.test(text)) return -1;
  // Only read number words next to "paragraph" so "go to" does not become 2.
  const after = text.match(/paragraph\s+((?:[\w-]+\s?){1,2})/);
  const before = text.match(/(?:the\s+)?([\w-]+(?:\s[\w-]+)?)\s+paragraph\b/);
  const near = after || before;
  const words = tokens(after ? after[1] : before ? before[1] : text).flatMap((w) => w.split('-'));
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (UNITS[w] !== undefined && (words[i + 1] === 'hundred' || words[i + 1] === 'hundredth')) return UNITS[w] * 100;
    if (w === 'hundred' || w === 'hundredth') return 100;
    if (TENS[w] !== undefined) return TENS[w] + (UNITS[words[i + 1]] && !['to', 'too', 'for'].includes(words[i + 1]) ? UNITS[words[i + 1]] : 0);
    if (TEENS[w] !== undefined) return TEENS[w];
    if (UNITS[w] !== undefined && (near || !['to', 'too', 'for'].includes(w))) return UNITS[w];
  }
  return null;
}

// Words people add that do not change the command.
const POLITE = /\b(please|thanks|thank you|for me|now|just|actually|maybe)\b/g;
const LEADING = /^(?:(?:okay|ok|so|um+|uh+|er+|alright|all right|right|well|cadence|hey cadence|hey|and|then)\b[\s,.]*)+/;
const ASKING = /^(?:can|could|would|will) you (?:please )?|^(?:i want you to|i'd like you to|let's|lets) /;

/** Lower case, drop fillers, politeness and "can you" so the command words are left. */
export function normalizeUtterance(raw = '') {
  let t = String(raw).toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").trim();
  t = t.replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(LEADING, '').replace(ASKING, '').trim();
  t = t.replace(POLITE, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

const FILLER_ONLY = /^(?:uh+|um+|hmm+|mm+|mm hmm|uh huh|ah+|oh|er+|huh|okay|ok|right|so|well|yeah|yes|no|and|like)$/;
/** Short noise that should never interrupt reading or become an edit. */
export function isFiller(raw = '') {
  return FILLER_ONLY.test(String(raw).toLowerCase().replace(/[.,!?]+/g, '').trim());
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
  const text = normalizeUtterance(raw);
  if (!text) return { type: 'none' };
  if (isFiller(text) && !/^(yes|yeah|no)$/.test(text)) return { type: 'none' };
  const has = (re) => re.test(text);
  const whole = (re) => new RegExp(`^(?:${re.source})$`).test(text);

  // Conversation control
  if (whole(/(stop listening|stop talking|goodbye|bye|that's all|thats all|that's it|thats it|i'm done|im done|i am done|i'm finished|im finished|i am finished|we're done|we are done|turn off talk|stop talk|end talk|end conversation|mic off|microphone off|turn off the (mic|microphone)|stop the (mic|microphone))/)) return { type: 'stopTalking' };
  if (whole(/(pause|pause it|stop|wait|wait a (sec|second|moment|minute)|hold on|hold on a (sec|second)|hang on|hang on a (sec|second)|one (sec|second|moment)|just a (sec|second|moment)|stop reading|pause reading|hold up|be quiet|quiet|shh+|shush)/)) return { type: 'pause' };
  if (whole(/(continue|resume|resume reading|keep going|go on|carry on|go ahead|read|play|play it|read on|keep reading|pick (it )?(back )?up|start|start reading|continue reading|go|go go|keep it going|keep on reading|let's keep going|lets keep going|keep going reading|read it on)/)) return { type: 'resume' };
  if (whole(/(start over|start again|restart|from the (top|start|beginning)|(go|go back|back) to the (top|start|beginning)|(read )?from the beginning|beginning of the (document|statement|essay)|top)/) || has(/\b(start over|from the top)\b/)) return { type: 'restart' };
  if (whole(/((skip|go|jump) to the end|the end|end)/)) return { type: 'gotoParagraph', n: -1 };
  if (whole(/(help|what can (i|you) (say|do)|what are the commands|commands|what do i say|how does this work)/)) return { type: 'help' };

  // Navigation
  if (has(/\bparagraph\b/) && !EDIT_VERBS.test(text) && has(/\b(go|jump|read|skip|take me|back)\b|^(the )?(\w+[\s-]?){1,2}paragraph$|^paragraph \w+/)) {
    if (has(/\bnext paragraph\b/)) return { type: 'nextParagraph' };
    if (has(/\b(previous|back a|the one before)\b.*paragraph|paragraph before\b/)) return { type: 'prevParagraph' };
    const n = numberFrom(text);
    if (n) return { type: 'gotoParagraph', n };
  }
  if (has(/\b(next|skip( the)?) paragraph\b/)) return { type: 'nextParagraph' };
  if (has(/\b(previous|back a) paragraph\b/) && !EDIT_VERBS.test(text)) return { type: 'prevParagraph' };
  if (whole(/((last|final) paragraph|read the (last|final) paragraph)/)) return { type: 'gotoParagraph', n: -1 };
  if (whole(/(repeat|repeat (that|it|this)|again|read (it|that) again|say that again|say it again|read that again|one more time|what was that|what did you say|come again|pardon|sorry|run that (by me )?again|again)/)) return { type: 'repeat' };
  if (whole(/(next|next one|skip|next sentence|skip (this|that)( one| sentence)?|skip it|move on|skip ahead|keep moving|onward)/)) return { type: 'next' };
  if (whole(/(back|go back|back up|previous|previous sentence|back one|go back one|go back a sentence|go back (a|one) (bit|line)|last sentence|the sentence before|before that)/)) return { type: 'prev' };
  const backN = text.match(/^(?:go )?back (?:up )?(one|two|three|four|five|1|2|3|4|5)( sentences?)?$/);
  if (backN) return { type: 'prev', count: { one: 1, two: 2, three: 3, four: 4, five: 5 }[backN[1]] || Number(backN[1]) };
  const aheadN = text.match(/^(?:skip|jump|go)(?: ahead| forward)? (one|two|three|four|five|1|2|3|4|5) sentences?$/);
  if (aheadN) return { type: 'next', count: { one: 1, two: 2, three: 3, four: 4, five: 5 }[aheadN[1]] || Number(aheadN[1]) };
  if (whole(/((go )?back to the (start|beginning|top) of (this|the) paragraph|start (this|the) paragraph again|read (this|the) paragraph again|from the start of (this|the) paragraph)/)) return { type: 'paragraphStart' };
  if (whole(/(read the whole (thing|document|essay|statement)|read (it|everything) from the (start|beginning|top))/)) return { type: 'restart' };

  // Tracked changes
  if (whole(/((turn on|start|enable|switch on) (tracking|track changes|tracked changes)|(turn|switch) (tracking|track changes) on|track changes( on)?|start tracking changes|suggesting mode)/)) return { type: 'trackOn' };
  if (whole(/((turn off|stop|disable|switch off) (tracking|track changes|tracked changes)|(turn|switch) (tracking|track changes) off|track changes off|stop tracking changes)/)) return { type: 'trackOff' };
  if (whole(/(next change|go to the next change|show me the next change|what's the next change|whats the next change)/)) return { type: 'nextChange' };
  if (whole(/(previous change|go back a change|the change before)/)) return { type: 'prevChange' };
  if (whole(/(accept all|accept all( the)? changes|accept all of them|accept everything|accept them all)/)) return { type: 'acceptAllChanges' };
  if (whole(/(reject all|reject all( the)? changes|reject all of them|reject everything|reject them all)/)) return { type: 'rejectAllChanges' };

  // Suggestions
  if (whole(/(accept|accept (it|that|this|this one|that one|the change|this change|that change|the suggestion|the edit)|yes|yeah|yep|yup|sure|do it|yeah do it|yes do it|apply (it|that)|sounds good|looks good|that works|that's better|thats better|i like (it|that)|go with (it|that)|use (it|that)|take (it|that)|keep (it|that)|perfect|great|good|nice)/)) return { type: 'accept' };
  if (whole(/(reject|reject (it|that|this|this one|that one|the change|this change|that change|the suggestion)|no|nope|nah|no thanks|discard( it)?|never ?mind|forget (it|that)|don't|dont|don't do that|dont do that|leave it|keep the original|scrap (it|that)|scratch that|bin it|skip the suggestion)/)) return { type: 'reject' };
  if (whole(/(read (it|that|the (suggestion|change|edit|new version|revision))( back)?( to me)?|how does (it|that) sound|let me hear (it|that)|read the new (one|version)|read that back|read it back)/)) return { type: 'readSuggestion' };
  if (whole(/(undo|undo (that|it|the last edit|the last change)|put it back|go back to how it was|take (it|that) back|change it back|revert( it| that)?)/)) return { type: 'undo' };
  if (whole(/(redo|redo (that|it))/)) return { type: 'redo' };

  // Reader settings and tools
  if (has(/\b(faster|speed up|read faster|quicker|too slow)\b/) && !EDIT_VERBS.test(text)) return { type: 'faster' };
  if (has(/\b(slower|slow down|read slower|too fast)\b/) && !EDIT_VERBS.test(text)) return { type: 'slower' };
  if (has(/\b(what's|what is|whats|anything|any) (flagged|wrong)\b|\bany (problems|issues|flags)\b|\bcheck (this|it|the paragraph)\b/)) return { type: 'flags' };
  if (whole(/(save|save (it|this)|save a version|save the document|make a checkpoint|checkpoint|save (a )?(snapshot|checkpoint))/) || has(/\b(save|keep) (a )?(version|snapshot|checkpoint)\b/)) return { type: 'snapshot' };

  // Comments: "comment the takeaway is unclear", "general comment needs a conclusion", "note: ..."
  const cm = String(raw).trim().match(/^(?:(?:add|make|leave)\s+(?:a\s+)?)?(general\s+|overall\s+)?(?:comment|note)(?:\s+(?:on|for)\s+(?:the\s+)?(?:whole\s+)?(?:document|essay|piece|statement))?[\s:,.-]+(?:that\s+)?(.{2,})$/i);
  if (cm) {
    const general = Boolean(cm[1]) || /^(?:(?:add|make|leave)\s+(?:a\s+)?)?(?:comment|note)\s+(?:on|for)\s+(?:the\s+)?(?:whole\s+)?(?:document|essay|piece|statement)/i.test(String(raw).trim());
    const body = cm[2].trim().replace(/^(?:on|about)\s+(?:this|the)\s+(?:paragraph|sentence)[\s:,-]*/i, '');
    return { type: 'comment', general, text: body.charAt(0).toUpperCase() + body.slice(1) };
  }

  // Edits and questions
  const scope = scopeFrom(text);
  if (has(/\b(proofread|fix (the )?(grammar|spelling|typos?))\b/)) return { type: 'edit', action: 'proofread', instruction: raw.trim(), scope };
  if (has(/\b(cut|remove|drop|delete|get rid of|lose|lop off) (the )?(ending|end|last sentence|last line|final sentence|summary|moral|conclusion)\b/)) return { type: 'edit', action: 'cut-ending', instruction: raw.trim(), scope: 'paragraph' };
  if (has(/\b(tighten|shorten|trim|make (it|this|that) (shorter|tighter|more concise)|cut (it|this|that) down|cut down)\b/) && !has(/\breplace\b/)) return { type: 'edit', action: 'tighten', instruction: raw.trim(), scope };
  if (has(/\b(clean (it |this |that )?up|humani[sz]e|less (like )?ai|sound(s)? less like ai|remove the ai)\b/)) return { type: 'edit', action: 'humanize', instruction: raw.trim(), scope };
  const question = /^(what|why|how|is|are|does|do|should|which|who|any|am i|was)\b/.test(text) || /\?\s*$/.test(String(raw));
  // "does this make sense" and "should I cut this" are questions even though they contain edit words.
  if (question && (/^(does|do|is|are|should|am i|was)\b/.test(text) || !EDIT_VERBS.test(text))) return { type: 'ask', question: raw.trim(), scope };
  // One to three words with no edit verb are most likely misheard, so ask again instead of rewriting.
  if (tokens(text).length <= 3 && !EDIT_VERBS.test(text)) return { type: 'unknown', heard: raw.trim() };
  return { type: 'edit', action: 'rewrite', instruction: raw.trim(), scope };
}

export const VOICE_HELP =
  'Say continue to keep reading, pause to stop, back or next to move a sentence, go to paragraph three, or start over. ' +
  'To edit, just say what you want, like tighten this sentence or replace pivotal with important. ' +
  'Then say accept, reject, read it, or undo. With track changes on, say next change, accept or reject, or accept all changes. To leave a note, say comment followed by the note, or general comment for the whole piece. Say stop listening when you are done.';
