# Cadence

Listen to your writing, edit it by selection or by voice, and review every suggested change in place before it touches the text.

## Install

1. Open the latest release on GitHub and download `Cadence-macOS-AppleSilicon.zip`.
2. Double-click it and drag **Cadence.app** into **Applications**.
3. Run once in Terminal, because the app is not notarized:
   `xattr -dr com.apple.quarantine /Applications/Cadence.app`
4. Open Cadence.

**Updates.** Cadence checks GitHub for a new release a few seconds after launch, and from Cadence, Check for Updates. Choose Install and Relaunch: it downloads the new version, swaps itself in Applications and reopens. Your documents are untouched because they live outside the app.

The app carries its own Node runtime and server, so nothing else needs installing. Documents live in `~/Library/Application Support/Cadence/data`. On first launch it copies documents and settings from the original project folder if they exist. The server only listens on this Mac (127.0.0.1).

## Releasing

Everything is version controlled in this repository. To ship a change:

1. Commit the change.
2. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
3. Push to `main`.

GitHub Actions builds the app on a Mac, runs the tests, checks that the packed server starts, and publishes release `v<version>` with the zip attached. Installed copies pick it up through Check for Updates.

## Develop

```bash
npm install          # first time only
npm test
npm start            # http://localhost:3847 in a browser
npm run app          # development build of the app, runs from this folder
```

## How it works

**Library.** Your documents, newest first. "Open at bookmark" takes you back to the sentence where you last stopped listening. Import a .docx, .md or .txt file with Import, Cmd+O, or by dropping it on the window. Headings in Word files are kept.

**Editor.** One page, one player bar, one side panel you can hide (Cmd+\\).

- Put the cursor anywhere and press Option+Space. Reading starts at that sentence, highlights it, and scrolls with you. Press Escape to stop. The bookmark is saved when you stop.
- The strip in the player shows every sentence as a bar sized by its length, so you can see the rhythm of the piece. Orange bars contain a flagged phrase. Click any bar to listen from there.
- Select text to get a small toolbar: Listen, Tighten, Clean up, Rewrite, Heading.
- Suggestions appear under their paragraph with the change marked. Accept (Cmd+Enter), Listen or Reject. Cmd+Z undoes an accepted edit.
- **Talk** (Option+M, or the Talk button) keeps the microphone open while Cadence reads. Speak at any time: it pauses, acts on what you said, and picks back up when you say "continue". Commands include continue, pause, back, next, repeat, start over, go to paragraph three, faster, slower, accept, reject, read it, undo, what is flagged, save a version, help and stop listening. Anything else is treated as an edit to the sentence you interrupted ("tighten this", "replace pivotal with important", "make the ending more concrete"). Cadence ignores its own reading voice, but headphones make it more reliable.
- **Comments.** Leave notes on the whole document, a paragraph or a phrase (Comments tab, the selection toolbar, Cmd+Option+M, or say "comment ..." while Talk is on). Get editor feedback adds mentor-style comments for you. Suggest edit turns a comment into a proposed change. Word export keeps them as real Word comments.
- **Spelling and grammar** are checked on this Mac with [Harper](https://writewithharper.com) in Canadian English. Click an underline for fixes. Add names and terms to your dictionary.
- **Checks** also covers stock AI phrasing (dashes, semicolons, contrast frames, "-ing" tails), clarity (long sentences, passive voice, adverbs, fillers, hedges) and style (clichés, repeated words, repeated openings), with a reading grade level. Each group can be switched off.
- **Track changes** (Cmd+Shift+E, or the Track changes button). Edits from then on are recorded. The Changes tab lists them with Accept and Reject, Previous and Next, and Accept all or Reject all. Switch between Simple markup, All markup and No markup. Word export writes them as real tracked changes.
- **Word choice.** Select a word and choose Synonyms, or select a sentence and choose Reword for three alternatives.
- **Word files in and out.** Importing a .docx keeps its comments. Exporting keeps comments and tracked changes, or gives a copy with changes accepted, or a clean copy.
- **Find and replace** (Cmd+F), **focus mode** (Cmd+Shift+F), and **compare** any saved version with the current draft.
- History keeps saved versions. Restoring one saves the current text first.
- Export as Word (.docx, Arial or Times New Roman 12 pt, double spaced, no author metadata), Markdown, or an MP3 of the whole document. Exports go to Downloads.

## Voices and AI

- Free neural voices (Ava, Andrew, Emma, Brian, Clara, Liam, Sonia, Ryan) need an internet connection but no key. If they cannot be reached, Cadence reads with the macOS system voice and tells you.
- Add a Gemini API key in Settings for full rewrites (gemini-3.8-flash) and Gemini voices (gemini-3.8-flash-tts). The key is stored in `data/config.json` and is never sent to the page.
- Without a key, edits are offline and mechanical: exact replacements, removals, dash and semicolon cleanup, stock word swaps, and cutting a summary ending.
- Settings has a pronunciation list for names, acronyms and drug names.
- If `~/.gemini/antigravity/skills/master-writing-skill` exists, Cadence uses its voice profile for rewrites and its scrubber script for the full report.

## Keyboard

| Keys | Action |
| --- | --- |
| Option+Space | Read from cursor, or pause |
| Escape | Stop reading, close the toolbar |
| [ and ] | Previous or next sentence while reading |
| Option+M | Speak an instruction |
| Cmd+K | Type an instruction |
| Cmd+Enter | Accept the suggestion for this paragraph |
| Cmd+Z, Cmd+Shift+Z | Undo, redo |
| Cmd+Shift+H | Toggle heading |
| Cmd+Shift+E | Track changes on or off |
| Option+Shift+Up or Down | Move the paragraph up or down |
| A or R in the Changes list | Accept or reject the focused change |
| Cmd+\\ | Show or hide the panel |
| Cmd+N, Cmd+O, Cmd+, | New, import, settings |

## Layout

```text
server.js                       Local server entry (127.0.0.1:3847)
src/main/app.js                 Express app
src/main/routes/apiRouter.js    /api routes
src/main/domains/
  config/configService.js       Settings, voice list, key handling
  projects/projectRepository.js Documents, bookmarks, versions, import and export
  voice/ttsService.js           Neural and Gemini speech, pronunciations, MP3 export
  editorial/editorialService.js Gemini edits with an offline fallback
  forensics/forensicsService.js Checks and full report
public/
  index.html, styles.css, app.js
  js/editor.js                  Editable page, highlights, undo, inline suggestions
  js/player.js                  Sentence reader with prefetch and system voice fallback
  js/dictation.js               Voice input (native in the app, Web Speech in browsers)
  js/core/textUtils.js          Sentences, flags, diff, stats (shared with the server)
macos/CadenceApp.swift          macOS app: window, server start, file picker, downloads, dictation
macos/assets/                   App icon (SVG source, PNG, ICNS)
tests/unit.test.js              npm test
```

Tests write to a temporary folder and never touch `data/`.
