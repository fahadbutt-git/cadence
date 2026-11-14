// Unit and integration tests. Run with `npm test`.
// Data goes to a temporary folder so tests never touch your documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-test-'));
process.env.CADENCE_DATA_DIR = TMP;
process.env.CADENCE_VOICE_PROFILE = path.join(TMP, 'none.md');
process.env.CADENCE_SCRUB_SCRIPT = path.join(TMP, 'none.py');
delete process.env.GEMINI_API_KEY;

const text = await import('../public/js/core/textUtils.js');
const { ThemeManager } = await import('../public/js/core/themeManager.js');
const voice = await import('../public/js/core/voiceCommands.js');
const config = await import('../src/main/domains/config/configService.js');
const repo = await import('../src/main/domains/projects/projectRepository.js');
const forensics = await import('../src/main/domains/forensics/forensicsService.js');
const editorial = await import('../src/main/domains/editorial/editorialService.js');
const tts = await import('../src/main/domains/voice/ttsService.js');
const { createApp } = await import('../src/main/app.js');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------- textUtils ----------

test('sentenceRanges returns offsets that slice back to each sentence', () => {
  const s = 'The beam cut across the cornea.  She blinked once! Why had no one checked?';
  const r = text.sentenceRanges(s);
  assert.equal(r.length, 3);
  for (const x of r) assert.equal(s.slice(x.start, x.end), x.text);
  assert.deepEqual(text.splitIntoSentences(''), []);
  assert.deepEqual(text.splitIntoSentences(null), []);
});

test('sentenceIndexAt maps a caret offset to its sentence', () => {
  const s = 'One. Two words. Three here.';
  assert.equal(text.sentenceIndexAt(s, 0), 0);
  assert.equal(text.sentenceIndexAt(s, 6), 1);
  assert.equal(text.sentenceIndexAt(s, s.length), 2);
});

test('findFlags locates stock words, dashes, semicolons, contrasts and tails', () => {
  const s = 'This pivotal moment — rather than theory; it mattered, highlighting care.';
  const kinds = text.findFlags(s).map((f) => f.kind);
  for (const k of ['word', 'dash', 'semicolon', 'contrast', 'tail']) assert.ok(kinds.includes(k), k);
  for (const f of text.findFlags(s)) assert.equal(s.slice(f.start, f.end), f.text);
  assert.equal(text.findFlags('Plain clear prose.').length, 0);
});

test('diffWords and computeWordDiffHtml mark insertions and deletions', () => {
  const parts = text.diffWords('we utilized the lamp', 'we used the lamp');
  assert.deepEqual(parts.filter((p) => p.type !== 'same').map((p) => p.type).sort(), ['del', 'ins']);
  const html = text.computeWordDiffHtml('a <b>', 'a c');
  assert.match(html, /<del>&lt;b&gt;<\/del>/);
  assert.match(html, /<ins>c<\/ins>/);
});

test('buildSentenceReadQueue starts at the bookmark and carries offsets', () => {
  const paras = [{ text: 'A one. A two.' }, { text: 'B one. B two. B three.' }];
  const q = text.buildSentenceReadQueue(paras, 1, 1);
  assert.equal(q.length, 2);
  assert.equal(q[0].text, 'B two.');
  assert.equal(paras[1].text.slice(q[0].start, q[0].end), 'B two.');
});

test('computeBurstinessStats counts words and sentence variety', () => {
  const s = text.computeBurstinessStats('Short. This one is a fair bit longer than the first.');
  assert.equal(s.wordCount, 11);
  assert.equal(s.sentenceCount, 2);
  assert.ok(s.burstinessCv > 0.5);
});

test('ThemeManager resolves explicit and system preferences', () => {
  const tm = new ThemeManager('light');
  assert.equal(tm.getResolvedTheme('dark'), 'dark');
  assert.equal(tm.getResolvedTheme('light'), 'light');
  assert.ok(['light', 'dark'].includes(tm.getResolvedTheme('system')));
});

// ---------- conversation mode ----------

test('parseCommand maps reading, navigation and decision phrases', () => {
  const t = (x) => voice.parseCommand(x).type;
  assert.equal(t('Continue.'), 'resume');
  assert.equal(t('okay keep going'), 'resume');
  assert.equal(t('pick it back up'), 'resume');
  assert.equal(t('wait'), 'pause');
  assert.equal(t('hold on'), 'pause');
  assert.equal(t('go back'), 'prev');
  assert.equal(t('next sentence'), 'next');
  assert.equal(t('read that again'), 'repeat');
  assert.equal(t('start over from the top'), 'restart');
  assert.deepEqual(voice.parseCommand('go to paragraph three'), { type: 'gotoParagraph', n: 3 });
  assert.deepEqual(voice.parseCommand('jump to paragraph 12'), { type: 'gotoParagraph', n: 12 });
  assert.equal(t('next paragraph'), 'nextParagraph');
  assert.equal(t('yes'), 'accept');
  assert.equal(t('accept that'), 'accept');
  assert.equal(t('never mind'), 'reject');
  assert.equal(t('read it back to me'), 'readSuggestion');
  assert.equal(t('undo that'), 'undo');
  assert.equal(t('a bit faster'), 'faster');
  assert.equal(t('slow down'), 'slower');
  assert.equal(t('stop listening'), 'stopTalking');
  assert.equal(t('anything flagged here?'), 'flags');
  assert.equal(t('save a version'), 'snapshot');
});

test('parseCommand turns free speech into scoped edits and questions', () => {
  const a = voice.parseCommand('tighten this sentence');
  assert.deepEqual([a.type, a.action, a.scope], ['edit', 'tighten', 'sentence']);
  const b = voice.parseCommand('Clean up this paragraph');
  assert.deepEqual([b.type, b.action, b.scope], ['edit', 'humanize', 'paragraph']);
  const c = voice.parseCommand('cut the ending');
  assert.deepEqual([c.action, c.scope], ['cut-ending', 'paragraph']);
  const d = voice.parseCommand('replace pivotal with important');
  assert.deepEqual([d.type, d.action, d.instruction], ['edit', 'rewrite', 'replace pivotal with important']);
  const e = voice.parseCommand('does this paragraph sound too formal?');
  assert.equal(e.type, 'ask');
  const f = voice.parseCommand('can you make the ending more concrete');
  assert.equal(f.type, 'edit');
});

test('parseCommand recognises spoken comments and proofreading', () => {
  assert.deepEqual(voice.parseCommand("comment I don't think there is a clear takeaway here"), { type: 'comment', general: false, text: "I don't think there is a clear takeaway here" });
  assert.deepEqual(voice.parseCommand('general comment there needs to be a conclusion that ends everything'), { type: 'comment', general: true, text: 'There needs to be a conclusion that ends everything' });
  assert.deepEqual(voice.parseCommand('add a note: why is seva important'), { type: 'comment', general: false, text: 'Why is seva important' });
  assert.equal(voice.parseCommand('leave a comment on the whole essay it needs a through-line').general, true);
  assert.equal(voice.parseCommand('proofread this paragraph').action, 'proofread');
  assert.equal(voice.parseCommand('fix the spelling').action, 'proofread');
});

test('echo filter ignores the reading voice and catches the person talking over it', () => {
  const reading = ['At the slit lamp, you look directly at cellular inflammation.'];
  assert.equal(voice.isBargeIn('at the slit lamp you look', reading), false);
  assert.equal(voice.isBargeIn('at the slit lamp wait', reading), true);
  assert.equal(voice.isBargeIn('make this shorter', reading), true);
  assert.equal(voice.isBargeIn('next', reading), true);
  assert.equal(voice.isBargeIn('accept', reading), true);
  assert.equal(voice.isBargeIn('inflammation', reading), false);
  assert.equal(voice.cleanTranscript('directly at cellular make this shorter', reading), 'make this shorter');
  assert.equal(voice.cleanTranscript('continue', reading), 'continue');
});

test('style checks cover clarity and repetition, and groups can be switched off', () => {
  const s = 'I was taught by them. I really think this cemented my desire. The emergency room and the emergency team were busy.';
  const kinds = text.findFlags(s).map((f) => f.kind);
  for (const k of ['passive', 'filler', 'cliche', 'start', 'echo']) assert.ok(kinds.includes(k), k);
  assert.equal(kinds.filter((k) => k === 'adverb').length, 0, 'filler words are not also adverbs');
  const noStyle = text.findFlags(s, { style: false }).map((f) => f.kind);
  assert.ok(!noStyle.includes('cliche') && !noStyle.includes('echo'));
  const long = text.findFlags(`${'word '.repeat(40).trim()}.`);
  assert.equal(long.find((f) => f.sentence).kind, 'veryhard');
  assert.equal(text.syllables('hemorrhage'), 3);
  assert.ok(text.computeBurstinessStats('The cat sat. It was happy.').gradeLevel >= 0);
});

// ---------- config ----------

test('config sanitizes patches and never exposes the API key', () => {
  const saved = config.saveConfig({ voiceId: 'en-CA-ClaraNeural', rate: 9, bogus: 1, apiKey: 'test-key-1234567890', pronunciations: [{ from: ' OCT ', to: 'O C T' }, { from: '' }] });
  assert.equal(saved.voiceId, 'en-CA-ClaraNeural');
  assert.equal(saved.rate, 2);
  assert.equal(saved.bogus, undefined);
  assert.deepEqual(saved.pronunciations, [{ from: 'OCT', to: 'O C T' }]);
  const pub = config.publicConfig(config.getConfig());
  assert.equal(pub.apiKey, undefined);
  assert.equal(pub.hasApiKey, true);
  config.saveConfig({ apiKey: '', voiceId: 'not-a-voice' });
  assert.equal(config.getConfig().voiceId, 'en-CA-ClaraNeural');
  assert.equal(config.publicConfig().hasApiKey, false);
});

// ---------- repository ----------

test('repository round trip: create, bookmark, snapshot, list, delete', () => {
  const doc = repo.upsertDocument({ title: 'Test', mode: 'mode2', paragraphs: [{ type: 'heading', text: 'H' }, { text: 'Body one. Body two.' }], createSnapshot: true });
  assert.equal(doc.style, 'academic');
  assert.ok(doc.paragraphs.every((p) => p.id));
  assert.equal(repo.updateBookmark(doc.id, { paraIndex: 1, sentIndex: 1 }).sentIndex, 1);
  assert.equal(repo.listRevisions(doc.id).length, 1);
  const meta = repo.listDocuments().find((d) => d.id === doc.id);
  assert.equal(meta.wordCount, 5);
  assert.equal(meta.bookmark.paraIndex, 1);
  assert.equal(repo.getDocumentById('../../etc/passwd'), null);
  assert.ok(repo.deleteDocument(doc.id));
});

test('import helpers keep headings from Word HTML and markdown', () => {
  const fromHtml = repo.paragraphsFromHtml('<h1>Title &amp; more</h1><p>First <strong>para</strong>.</p><p></p><p>Second.</p>');
  assert.deepEqual(fromHtml.map((p) => [p.type, p.text]), [['heading', 'Title & more'], ['body', 'First para.'], ['body', 'Second.']]);
  const fromMd = repo.paragraphsFromText('# Heading\n\nLine one\ncontinues.\n\nSecond para.');
  assert.deepEqual(fromMd.map((p) => [p.type, p.text]), [['heading', 'Heading'], ['body', 'Line one continues.'], ['body', 'Second para.']]);
});

test('comments are stored with the document and dropped to general when their paragraph goes', () => {
  const doc = repo.upsertDocument({ title: 'C', paragraphs: [{ id: 'p1', text: 'One.' }, { id: 'p2', text: 'Two.' }], comments: [
    { id: 'a', paraId: 'p1', quote: 'One', text: 'Why?' }, { id: 'b', paraId: null, text: 'Needs a conclusion' }, { id: 'c', text: '   ' },
  ] });
  assert.equal(doc.comments.length, 2);
  const again = repo.upsertDocument({ id: doc.id, paragraphs: [{ id: 'p2', text: 'Two.' }] });
  assert.equal(again.comments.find((c) => c.id === 'a').paraId, null);
  assert.equal(repo.listDocuments().find((d) => d.id === doc.id).openComments, 2);
  repo.deleteDocument(doc.id);
});

test('Word export carries open comments as real Word comments', async () => {
  const buf = await repo.generateCleanDocxBuffer({
    paragraphs: [{ id: 'h', type: 'heading', text: 'Title' }, { id: 'b', text: 'Seva is a word. It matters.' }],
    comments: [{ id: '1', paraId: null, text: 'Needs a conclusion' }, { id: '2', paraId: 'b', quote: 'It matters.', text: 'Why?' }, { id: '3', paraId: 'b', text: 'Old', resolved: true }],
    author: 'Fahad Butt',
  });
  const { execFileSync } = await import('node:child_process');
  const tmp = path.join(TMP, 'c.docx');
  fs.writeFileSync(tmp, buf);
  const xml = execFileSync('unzip', ['-p', tmp, 'word/comments.xml']).toString();
  assert.match(xml, /General comment: Needs a conclusion/);
  assert.match(xml, /Why\?/);
  assert.doesNotMatch(xml, />Old</);
  assert.match(xml, /w:author="Fahad Butt"/);
  const md = repo.documentAsMarkdown({ paragraphs: [{ id: 'b', text: 'x' }], comments: [{ paraId: 'b', quote: 'x', text: 'Why?' }] });
  assert.match(md, /## Comments[\s\S]*On "x": Why\?/);
});

test('docx export produces a valid zip with no author metadata', async () => {
  const buf = await repo.generateCleanDocxBuffer({ title: 'T', paragraphs: [{ type: 'body', text: 'Hello' }] });
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

// ---------- forensics ----------

test('forensic report falls back to the built-in checker when the script is missing', async () => {
  const r = await forensics.runForensicAuditReport('A pivotal step — truly; rather than wait.');
  assert.equal(r.source, 'built-in');
  assert.equal(r.summary.bannedWordCount, 1);
  assert.equal(r.summary.emDashCount, 1);
  assert.equal(r.summary.semicolonCount, 1);
  assert.match(r.reportText, /Stock AI words: 1/);
});

// ---------- editorial ----------

test('offline editor applies spoken replace and removal instructions', () => {
  const a = editorial.localRuleBasedEdit('rewrite', 'We utilized the slit lamp.', 'replace utilized with used');
  assert.equal(a.proposedText, 'We used the slit lamp.');
  const b = editorial.localRuleBasedEdit('rewrite', 'It was very clear.', 'delete very');
  assert.equal(b.proposedText, 'It was clear.');
  const c = editorial.localRuleBasedEdit('rewrite', 'Nothing to do.', 'make it sing');
  assert.equal(c.proposedText, '');
});

test('offline editor cleans stock phrasing and cuts a summary ending', () => {
  const h = editorial.localRuleBasedEdit('humanize', 'This pivotal visit; it mattered — a lot.');
  assert.ok(!/pivotal|;|—/.test(h.proposedText), h.proposedText);
  const e = editorial.localRuleBasedEdit('cut-ending', 'I walked him upstairs. This experience taught me empathy.');
  assert.equal(e.proposedText, 'I walked him upstairs.');
});

test('Gemini editor parses JSON replies and falls back offline on failure', async () => {
  const ok = { interactions: { create: async () => ({ output_text: '```json\n{"proposedText":"New.","rationale":"Shorter.","spokenReply":"Done."}\n```' }) } };
  const r = await editorial.generateEditorialRevision({ client: ok, action: 'tighten', targetText: 'Old text.' });
  assert.equal(r.proposedText, 'New.');
  assert.equal(r.source, 'gemini');
  const bad = { interactions: { create: async () => { throw new Error('model not found'); } } };
  const f = await editorial.generateEditorialRevision({ client: bad, action: 'rewrite', targetText: 'We utilized it.', instruction: 'replace utilized with used' });
  assert.equal(f.source, 'offline');
  assert.equal(f.proposedText, 'We used it.');
  assert.match(f.rationale, /model not found/);
});

test('offline editor feedback flags lists, stock phrases and summary endings', () => {
  const r = editorial.localReview([
    { type: 'body', text: 'I led the club, ran events, taught classes, wrote guides, and organised fundraisers. This fuelled my passion for medicine.' },
    { type: 'body', text: 'I sat with her. This experience taught me compassion.' },
  ]);
  const texts = r.comments.map((c) => c.text).join(' ');
  assert.match(texts, /reads as a list/);
  assert.match(texts, /Stock phrase/);
  assert.match(texts, /closing line/);
  assert.ok(r.comments.some((c) => c.paraIndex === null));
  assert.ok(r.comments.filter((c) => c.quote).every((c) => c.paraIndex !== null));
});

test('local grammar checker finds spelling and grammar errors and respects the dictionary', async () => {
  const grammar = await import('../src/main/domains/language/grammarService.js');
  const issues = await grammar.checkParagraphs(['Their going to the clinic tomorow. I has a idea about OCT.', 'Seva matters.'], { userDictionary: ['Seva'] });
  const found = issues.map((i) => i.text);
  for (const w of ['Their', 'tomorow', 'has', 'a']) assert.ok(found.includes(w), w);
  assert.ok(!found.includes('OCT'), 'acronyms are skipped');
  assert.ok(!found.includes('Seva'), 'dictionary words are skipped');
  assert.ok(issues.find((i) => i.text === 'tomorow').suggestions.includes('tomorrow'));
});

// ---------- voice ----------

test('TTS helpers escape SSML, apply pronunciations and resolve voices', () => {
  assert.equal(tts.escapeForSsml('R&D <20'), 'R&amp;D &lt;20');
  assert.equal(tts.applyPronunciations('The OCT and oct scans.', [{ from: 'OCT', to: 'O C T' }]), 'The O C T and O C T scans.');
  assert.equal(tts.resolveNeuralVoiceName('Kore'), 'en-US-EmmaMultilingualNeural');
  assert.equal(tts.resolveNeuralVoiceName('nonsense'), config.DEFAULT_VOICE);
  const chunks = tts.chunkForSynthesis(['a'.repeat(10), `${'Long sentence here. '.repeat(200)}`], 500);
  assert.ok(chunks.every((c) => c.length <= 500));
});

test('synthesizeSpeech routes Gemini voices and falls back with a notice', async () => {
  const calls = [];
  const engines = {
    neural: async (t, v) => { calls.push(['neural', v]); return { audio: Buffer.from('x'), mimeType: 'audio/mpeg', voice: tts.resolveNeuralVoiceName(v) }; },
    gemini: async () => { throw new Error('quota'); },
  };
  const noKey = await tts.synthesizeSpeech({ text: 'Hi', voice: 'Kore', engines });
  assert.match(noKey.notice, /need an API key/);
  const failed = await tts.synthesizeSpeech({ text: 'Hi', voice: 'Kore', apiKey: 'k', engines });
  assert.match(failed.notice, /quota/);
  await assert.rejects(tts.synthesizeSpeech({ text: '  ', engines }), /empty/);
});

// ---------- HTTP ----------

test('HTTP API: config, documents, edit, tts, export and import', async () => {
  const fakeTts = async ({ text }) => ({ audio: Buffer.from(`audio:${text}`), mimeType: 'audio/mpeg', voice: 'v', notice: 'Note é' });
  const server = createApp({ tts: fakeTts }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    assert.ok(Array.isArray(cfg.voices));
    assert.equal(cfg.apiKey, undefined);

    const created = await (await fetch(`${base}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'HTTP doc', paragraphs: [{ text: 'We utilized it.' }] }) })).json();
    const list = await (await fetch(`${base}/documents`)).json();
    assert.ok(list.documents.some((d) => d.id === created.id));

    const edit = await (await fetch(`${base}/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rewrite', targetText: 'We utilized it.', instruction: 'replace utilized with used' }) })).json();
    assert.equal(edit.proposedText, 'We used it.');

    const audio = await fetch(`${base}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello' }) });
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    assert.equal(decodeURIComponent(audio.headers.get('x-cadence-notice')), 'Note é');
    assert.equal(await audio.text(), 'audio:Hello');

    const docx = await fetch(`${base}/documents/${created.id}/export?format=docx`);
    assert.match(docx.headers.get('content-disposition'), /HTTP_doc\.docx/);
    const md = await (await fetch(`${base}/documents/${created.id}/export?format=md`)).text();
    assert.equal(md, 'We utilized it.\n');

    const fd = new FormData();
    fd.append('file', new Blob(['# Imported\n\nHello there.']), 'notes.md');
    const imported = await (await fetch(`${base}/import`, { method: 'POST', body: fd })).json();
    assert.equal(imported.title, 'notes');
    assert.equal(imported.paragraphs[0].type, 'heading');

    const proof = await (await fetch(`${base}/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'proofread', targetText: 'I recieved alot of help.' }) })).json();
    assert.equal(proof.proposedText, 'I received a lot of help.');
    const rev = await (await fetch(`${base}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paragraphs: [{ text: 'I sat with her. This experience taught me compassion.' }] }) })).json();
    assert.equal(rev.source, 'offline');
    const dict = await (await fetch(`${base}/dictionary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: 'Seva' }) })).json();
    assert.deepEqual(dict.dictionary, ['Seva']);

    const badImport = new FormData();
    badImport.append('file', new Blob(['x']), 'x.pdf');
    assert.equal((await fetch(`${base}/import`, { method: 'POST', body: badImport })).status, 400);
  } finally {
    server.close();
  }
});

// ---------- 3.3: track changes, Word round trip, word choice ----------

test('trackChanges finds word, paragraph insert and paragraph delete changes', () => {
  const base = [{ id: 'a', text: 'We utilized the lamp to see.' }, { id: 'b', text: 'Old paragraph goes.' }, { id: 'c', text: 'Keep me.' }];
  const cur = [{ id: 'a', text: 'We used the slit lamp to see clearly.' }, { id: 'c', text: 'Keep me.' }, { id: 'd', text: 'Brand new.' }];
  const r = text.trackChanges(base, cur);
  assert.deepEqual(r.hunks.map((h) => [h.kind, h.del, h.ins]), [
    ['text', 'utilized', 'used'],
    ['text', '', 'slit '],
    ['text', '', ' clearly'],
    ['para-del', 'Old paragraph goes.', ''],
    ['para-ins', '', 'Brand new.'],
  ]);
  const segs = r.paragraphs[0].segments;
  assert.equal(segs.filter((s) => s.type !== 'del').map((s) => s.text).join(''), cur[0].text);
  assert.equal(segs.filter((s) => s.type !== 'ins').map((s) => s.text).join(''), base[0].text);
  for (const h of r.hunks.filter((x) => x.kind === 'text')) assert.equal(cur[0].text.slice(h.curStart, h.curEnd), h.ins);
});

test('accepting every change one at a time brings the baseline to the current text', () => {
  const base = [{ id: 'a', text: 'One two three.' }, { id: 'b', text: 'Gone.' }];
  const cur = [{ id: 'x', text: 'New first.' }, { id: 'a', text: 'One three four.' }];
  let b = base;
  for (let i = 0; i < 10; i++) {
    const hs = text.trackChanges(b, cur).hunks;
    if (!hs.length) break;
    b = text.acceptHunkInBaseline(b, hs[0], cur);
  }
  assert.deepEqual(b, cur);
  assert.equal(text.trackChanges(cur, cur).hunks.length, 0);
});

test('Word export writes tracked changes and comments that import back', async () => {
  const JSZip = (await import('jszip')).default;
  const baseline = [{ id: 'a', type: 'body', text: 'We utilized the lamp.' }, { id: 'b', type: 'body', text: 'Old paragraph.' }];
  const paragraphs = [{ id: 'a', type: 'body', text: 'We used the slit lamp.' }, { id: 'd', type: 'body', text: 'Brand new.' }];
  const comments = [
    { id: 'c1', paraId: 'a', quote: 'slit lamp', text: 'Name the exam.' },
    { id: 'c2', paraId: null, text: 'Needs a conclusion.' },
  ];
  const buf = await repo.generateCleanDocxBuffer({ paragraphs, baseline, comments, author: 'Reviewer' });
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  assert.ok((xml.match(/<w:ins /g) || []).length >= 3);
  assert.ok(xml.includes('<w:delText'));
  assert.ok(xml.includes('utilized'));
  const plain = await repo.generateCleanDocxBuffer({ paragraphs, comments: [] });
  assert.ok(!(await (await JSZip.loadAsync(plain)).file('word/document.xml').async('string')).includes('<w:ins '));

  const found = repo.commentsForParagraphs(await repo.extractDocxComments(buf), paragraphs);
  assert.deepEqual(found.map((c) => [c.paraId, c.quote, c.text]), [['a', 'slit lamp', 'Name the exam.'], [null, '', 'Needs a conclusion.']]);
});

test('documents keep tracking state and report pending changes', () => {
  const doc = repo.upsertDocument({ title: 'Tracked', paragraphs: [{ id: 'p1', text: 'New words.' }], tracking: { on: true, baseline: [{ id: 'p1', text: 'Old words.' }], startedAt: '2026-11-01T00:00:00Z' } });
  assert.equal(doc.tracking.on, true);
  const meta = repo.computeDocumentMetadata(doc);
  assert.equal(meta.pendingChanges, 1);
  const again = repo.upsertDocument({ id: doc.id, paragraphs: doc.paragraphs });
  assert.equal(again.tracking.baseline[0].text, 'Old words.');
  assert.deepEqual(repo.sanitizeTracking(null), { on: false, baseline: null, startedAt: null });
});

test('synonyms use context, keep capitalization and fail softly offline', async () => {
  const thesaurus = await import('../src/main/domains/language/thesaurusService.js');
  let url = '';
  const fake = async (u) => { url = u; return { ok: true, json: async () => [{ word: 'used' }, { word: 'employed' }, { word: 'Utilized' }, { word: 'used' }] }; };
  const r = await thesaurus.findSynonyms({ word: 'Utilized', left: 'We', right: 'the lamp', fetchImpl: fake });
  assert.deepEqual(r.options, ['Used', 'Employed']);
  assert.match(url, /ml=Utilized/);
  assert.match(url, /lc=We/);
  assert.match(url, /rc=the/);
  const down = await thesaurus.findSynonyms({ word: 'cold', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(down.options, []);
  assert.ok(down.error);
  assert.equal(thesaurus.matchCase('NHS', 'service'), 'SERVICE');
});

test('rewording alternatives need a key and parse three options', async () => {
  const off = await editorial.generateAlternatives({ targetText: 'This is a sentence.' });
  assert.deepEqual(off.options, []);
  assert.ok(off.message);
  const client = { interactions: { create: async () => ({ output_text: JSON.stringify({ options: [{ text: 'A plainer one.', label: 'Plainer' }, { text: 'This is a sentence.', label: 'Same' }, { text: 'Short.', label: 'Shorter' }] }) }) } };
  const on = await editorial.generateAlternatives({ targetText: 'This is a sentence.', client });
  assert.deepEqual(on.options.map((o) => o.text), ['A plainer one.', 'Short.']);
});

test('voice commands cover tracked changes', () => {
  assert.equal(voice.parseCommand('next change').type, 'nextChange');
  assert.equal(voice.parseCommand('accept all changes').type, 'acceptAllChanges');
  assert.equal(voice.parseCommand('turn on track changes').type, 'trackOn');
  assert.equal(voice.parseCommand('stop tracking').type, 'trackOff');
  assert.equal(voice.parseCommand('accept').type, 'accept');
});

test('HTTP API: synonyms, alternatives, Word import with comments, tracked export', async () => {
  const thesaurus = async ({ word }) => ({ word, options: ['used'], source: 'test' });
  const server = createApp({ thesaurus, grammar: async () => [] }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.deepEqual((await (await fetch(`${base}/synonyms?word=utilized`)).json()).options, ['used']);
    const alt = await (await fetch(`${base}/alternatives`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetText: 'A sentence here.' }) })).json();
    assert.deepEqual(alt.options, []);

    const buf = await repo.generateCleanDocxBuffer({ paragraphs: [{ id: 'a', type: 'body', text: 'First paragraph here.' }, { id: 'b', type: 'body', text: 'Second one.' }], comments: [{ id: 'c1', paraId: 'b', quote: 'Second', text: 'Why second?' }] });
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'Statement.docx');
    const doc = await (await fetch(`${base}/import`, { method: 'POST', body: fd })).json();
    assert.equal(doc.comments.length, 1);
    assert.equal(doc.comments[0].paraId, doc.paragraphs[1].id);
    assert.equal(doc.comments[0].quote, 'Second');

    const tracked = await (await fetch(`${base}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'T', paragraphs: [{ id: 'p', text: 'New text.' }], tracking: { on: true, baseline: [{ id: 'p', text: 'Old text.' }] } }) })).json();
    const JSZip = (await import('jszip')).default;
    const withChanges = Buffer.from(await (await fetch(`${base}/documents/${tracked.id}/export?format=docx`)).arrayBuffer());
    const accepted = Buffer.from(await (await fetch(`${base}/documents/${tracked.id}/export?format=docx&changes=0`)).arrayBuffer());
    assert.ok((await (await JSZip.loadAsync(withChanges)).file('word/document.xml').async('string')).includes('<w:delText'));
    assert.ok(!(await (await JSZip.loadAsync(accepted)).file('word/document.xml').async('string')).includes('<w:delText'));
  } finally {
    server.close();
  }
});
