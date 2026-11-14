# Cadence

Listen to your writing, edit it by selection or by voice, and review every suggested change in place before it touches the text.

## Install

1. Open the latest release on GitHub and download `Cadence-macOS-AppleSilicon.zip`.
2. Double-click it and drag **Cadence.app** into **Applications**.
3. Run once in Terminal, because the app is not notarized:
   `xattr -dr com.apple.quarantine /Applications/Cadence.app`
4. Open Cadence.

The app carries its own Node runtime and server, so nothing else needs installing. Documents live in `~/Library/Application Support/Cadence/data`. On first launch it copies documents and settings from the original project folder if they exist. The server only listens on this Mac (127.0.0.1).

New releases are built by GitHub Actions on a Mac whenever a `v*` tag is pushed. Every push to `main` also builds the app and keeps it as a downloadable artifact.

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
- Press Option+M or Speak and say an instruction ("replace pivotal with important", "make the ending more concrete"). While reading, the instruction applies to the sentence that was playing. You can also say "read", "stop", "next", "accept", "reject" or "undo".
- Checks lists stock AI words, dashes, semicolons, contrast frames and "-ing" explanation tails. Click one to jump to it.
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
