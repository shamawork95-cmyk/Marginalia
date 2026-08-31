## Iteration 1
- Initializing project files and installing puppeteer.
- Extracted `exportAnnotatedDocument` string-building logic into `src/services/downloadService.ts`.
- Implemented `/api/download` Express endpoint in `server.ts` utilizing `puppeteer`.
- Rewrote `src/utils/documentExporter.ts` to `fetch()` from backend API.
- Fixed template string escaping and `waitUntil` API deprecation.
- Status: Completed successfully.
