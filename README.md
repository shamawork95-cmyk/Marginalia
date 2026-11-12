# Marginalia

A desktop annotator for close readers. Open a PDF, EPUB, DOCX or text file, or paste a poem or
passage, then highlight, underline, file passages under themes and write notes in the margin.
Everything stays on your computer.

- **Reading:** a bookshelf of your documents with reading progress, a two-page spread with page
  turns (arrows, keys or a swipe), 1, 2, 4 or 6 PDF pages in view, focus mode, a poetry view, and
  Urdu and other right-to-left text in Nastaliq.
- **Marking:** highlight, underline, strikeout, terminology, area highlight, pen, shapes, brackets,
  black-out boxes, reactions, sticky notes and text boxes, linked marks, several themes on one passage.
- **Finding:** Find in a document, search across everything, and motif tracing across your collections.
- **Keeping:** exports to PDF, Markdown, JSON and a commonplace book, class packs for students,
  and automatic backups of your marks.

## Install

Download the installer for your system from the
[latest release](https://github.com/shamawork95-cmyk/Marginalia/releases/latest).
Windows updates itself. The Mac build is not signed (there is no paid Apple developer account),
so macOS asks you to confirm the first time you open it, and updates must be installed by hand.

## Run from source

Needs Node.js 22 or later.

```bash
npm install
npm run desktop
```

`npm run desktop` builds the app and opens it in Electron. Do not use `npm run dev` for the app:
it serves the interface without the desktop shell, so storage settings, updates and PDF printing
are missing.

## Checks

Run these before every commit, in this order:

```bash
npm run build
npm test
```

`npm test` runs `tsc --noEmit` and then every `*.test.ts` in the repo root, `src/` and
`electron/`. The release workflow runs the same checks before it builds installers.

The guide on My Collections uses real screenshots of the app. After changing anything it shows,
retake them with `npm run guide:capture` (it uses a throwaway library, never yours).

## Releasing

1. Bump the version in `package.json`, `package-lock.json` and `CURRENT_APP_VERSION` in
   `src/data/changelog.ts`, and add a changelog entry.
2. Commit on `main`, then tag `vX.Y.Z` (annotated).
3. Push `main` and the tag. GitHub Actions builds the Windows and Mac installers, checks the
   release is complete, and publishes it.

See `CLAUDE.md` for the project's conventions and the repositories releases go to.

## Privacy

Marginalia has no account, no analytics, no tracking and no crash reporting. Your library, marks,
notes, themes and settings are stored in your user data folder on this device and nowhere else.
The only network requests it makes on its own are update checks against GitHub releases.
The optional AI features are off by default and send text to Google's Gemini only when you turn
them on, add your own key and press a button. Unexpected errors are written to a local
`crash.log` in the same folder, which never leaves your computer. "Send feedback" opens an email
in your own mail app; nothing is sent unless you send it. See [PRIVACY.md](PRIVACY.md) for the
full policy.

## Licence

See [LICENSE](LICENSE). Third-party components and fonts are listed in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
