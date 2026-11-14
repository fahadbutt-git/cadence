# Changelog

## 3.5.0

Fixes from a testing round with six simulated users (a personal statement writer, a mentor reviewing in Word, a voice-first user, a researcher with a long manuscript, a keyboard-only user on a small screen, and an adversarial tester).

Work is never lost
- Saves carry a version. If the same document was changed in another window, Cadence asks before overwriting, and keeps the other text as a saved version. A save for a document deleted elsewhere offers to save it as a new one.
- A slow save can no longer write one document's text into another.
- Leaving a document, creating a new one or importing waits for every pending save, including text typed while a save was in flight. If saving is failing, Cadence stays put with a message.
- Undo after pasting over a selection brings the selection back.
- Settings are written safely with a backup, so a crash cannot wipe the dictionary, reviewer name or key.
- Pasting text that ends in a line break (a paragraph copied from Word or email) works, and keeps the space before the pasted text.

Track changes
- Joining, splitting and moving paragraphs, and turning a paragraph into a heading, are each one change you can accept or reject.
- Undo after Accept undoes the accept.
- Comments on a deleted paragraph come back with the paragraph when the deletion is rejected, and follow text that is joined into another paragraph.
- Long paragraphs are still compared word by word, and a one-word to two-word replacement is one change.
- Word export: comments on deleted or joined paragraphs stay on their text, moved paragraphs, a deleted last paragraph, superscript citations, Letter page size, and comments keep their original author.

Word and text import
- A Word file's own tracked changes, including moves, are kept as tracked changes instead of being accepted silently, and paragraphs are paired by similarity so mixed accept and reject decisions come out right.
- Comments keep their author and date, land on the right paragraph when text repeats, and on the right occurrence of a phrase.
- Nested bullet points stay separate, superscript citations are kept, tables come in one row per line, and the Title style becomes a heading.
- Markdown reference lists stay one reference per paragraph, emphasis markers are removed, and pasted Markdown headings become headings.
- Text files in UTF-16 or Windows encodings, file names in any language, and clear messages for damaged or oversized files.

Spelling, grammar and style
- "neuro" in "neuro-ophthalmology" is no longer flagged, and offensive words are never offered as a fix.
- Hundreds of ophthalmology, drug, statistics and reference-list words added. Names in mid-sentence, micrometres ("83 um"), number ranges and superscript citations are no longer flagged.
- "Change all" only appears when the fix is a near miss, so a correct medical term is never replaced everywhere.
- Ignoring a word lasts for the document, and removing a dictionary word takes effect at once.
- Academic style no longer flags passive voice, semicolons in statistics and references, or dashes in number ranges.
- "Dr." no longer ends a sentence when reading aloud or checking length.
- Running editor feedback twice does not duplicate comments. A deleted comment can be brought back with Undo.
- Offline Tighten no longer leaves a lower-case start or removes meaningful words.

Talk and reading
- Commands said while Cadence is talking (accept, continue, stop listening) are heard.
- Cadence's own reading voice no longer interrupts it after a few sentences.
- Turning Talk off mid-sentence no longer runs a half-heard phrase as an edit.
- "Accept" applies the suggestion Cadence just described.
- Many more natural phrasings ("continue please", "scratch that", "go to the last paragraph", "paragraph twenty one", "can you repeat that"), and short noise like "uh" is ignored.
- "Cut the last sentence" works. Faster and slower keep reading. The end of the document is announced.
- Citation numbers are not read aloud, and pronunciations work for symbols like µm and ≥.

Keyboard, layout and accessibility
- The Export menu opens above the page and works with the keyboard.
- Talk is now Cmd+Shift+M (Option+M still works outside text, so you can type µ). On a Mac, Control shortcuts are left to text editing.
- Space on a button or tab presses it instead of starting playback, and nothing fires behind an open dialog.
- Typing while Cadence reads no longer scrambles the text.
- Cmd+Enter in the comment box no longer accepts a suggestion elsewhere.
- Messages stay readable in the top bar and never push buttons off screen. Talk stays available in narrow windows.
- Focus returns to the text after closing find, pop-ups and the panel. View, Zoom In and Zoom Out in the Mac app.
- Compare matches paragraphs by identity, and the shortcut lists are complete.

## 3.4.0

- Side panel rebuilt. It sits beside the page and never covers it. Drag its left edge to make it wider or narrower (double-click to reset). In a narrow window it fills the window while open, and picking an item takes you back to the text.
- Tabs fit on one line, with a close button. Arrow keys move between tabs, and the last tab you used is remembered.
- Checks is now in sections you can fold: Spelling and grammar, Style, Readability, Document settings, each with a count.
- Spelling and grammar groups repeats of the same word, so a name flagged five times is one row with Change all, Add to dictionary and Ignore. Clicking the row steps through each place it occurs.
- Style flags show the label, then the text, without cut-off sentences or nested scroll areas.
- Messages now show in the top bar instead of a pop-up over the page. Talk captions show in the reader bar.
- Settings can turn off the toolbar that appears when you select text.
- The page margins shrink with the space available.

## 3.3.0

- Track changes (Cmd+Shift+E), like Word's Track Changes and Google Docs' Suggesting mode. Every edit after you turn it on, typed, dictated or accepted from a suggestion, becomes a change you can accept or reject one at a time or all at once. Step through them with Previous and Next, or by voice ("next change", "accept", "reject", "accept all changes").
- Three views: Simple markup (insertions underlined, a bar beside changed paragraphs), All markup (deletions struck through, read only), and No markup.
- Word export writes your edits as real tracked changes under your reviewer name, with comments. Your reader can accept or reject them in Word. Export menu also has a copy with changes accepted, and a clean copy.
- Importing a Word file brings its comments in, anchored to the same paragraph and phrase.
- Synonyms for a selected word, ranked by the words around it, and three rewordings of a selected sentence (rewordings need a Gemini key).
- Move a paragraph up or down with Option+Shift+Up or Down, as in Word.
- Word count of the selection in the top bar.
- Fixed typing into a new empty paragraph at the end of a document, which used to add the text to the paragraph above.

## 3.2.0

- Comments: notes on the whole document, a paragraph, or a selected phrase. Add them from the Comments tab, the selection toolbar, Cmd+Option+M, or by voice ("comment ...", "general comment ..."). Margin counts show where they are. Resolve, reopen, delete, or turn one into a suggested edit.
- Editor feedback: one click adds mentor-style comments on each paragraph and the whole piece (clear takeaway, no lists without a point, ties to the story and the specialty, a real conclusion). Full feedback with a Gemini key, surface checks offline.
- Word export keeps comments as real Word comments under your name, with a clean copy option. Markdown export lists them at the end.
- Spelling and grammar checking on this Mac with Harper, in Canadian English. Click an underline for fixes, ignore it, or add the word to your dictionary. Clinical terms are preloaded.
- Proofread action: fixes only errors, including wrong words that are spelled correctly when a Gemini key is set.
- More style checks: long and very long sentences, passive voice, adverbs, filler words, hedges, clichés, repeated words nearby, and repeated sentence openings, in groups you can switch off. Reading grade level and character count.
- Find and replace (Cmd+F), focus mode (Cmd+Shift+F), and side-by-side comparison of saved versions.

## 3.1.0

- Talk mode: the microphone stays open while Cadence reads. Speaking pauses it, the request is carried out, and "continue" resumes from the paused sentence, including after an accepted edit.
- Spoken commands for reading (continue, pause, back, next, repeat, start over, go to paragraph N, faster, slower), decisions (accept, reject, read it, undo) and tools (what is flagged, save a version, help, stop listening). Anything else becomes an edit to the interrupted sentence.
- Cadence ignores its own reading voice so it does not interrupt itself.
- Caption line showing what Cadence heard and what it is doing.
- In-app updates: automatic check on launch and Cadence, Check for Updates. Installs the new release and relaunches.

## 3.0.0

- Rebuilt library and editor, inline suggestions, selection toolbar, sentence strip, checks, version history.
- Neural voices with prefetch and system voice fallback, pronunciation list, MP3 export.
- Gemini edits with an offline fallback.
- macOS app with file picker, downloads, native dictation, packed server and Node runtime.
- GitHub Actions build and release.
