Ad-hoc regression scripts from development (Python + Playwright). They print what
happened next to what was expected, rather than asserting; read the output.
The maintained, asserting tests are in `tests/e2e` (`npm test`).

Build and serve the repo root first (the same server `npm test` uses):

```sh
npm run build:demo && npm run build:harness && python3 -m http.server 8765
python3 tests/playwright/t14.py
```

- `ZOOM_DEMO_URL` — the demo (default `http://localhost:8765/dist/`).
- `ZOOM_SCAN_URL` — the plain-HTML harness for `t11` (default `http://localhost:8765/test/scan.html`).
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` — use an already-installed Chromium.

See HANDOFF.md §9 for what each covers.
