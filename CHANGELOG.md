# Changelog

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
