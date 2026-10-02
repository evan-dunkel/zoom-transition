Ad-hoc regression scripts from development (Python + Playwright).
Serve the built demo first, e.g. `python3 build.py && cp dist/index.html /tmp/site/book-store-zoom.html && (cd /tmp/site && python3 -m http.server 8765)`.
Some scripts use `file:///mnt/user-data/outputs/book-store-zoom.html` or `/home/claude/...` paths from the original sandbox; point them at your served file.
See HANDOFF.md §9 for what each covers.
