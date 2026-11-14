# Changelog

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
