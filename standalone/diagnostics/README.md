# Diagnostics, standalone

The icon prototype plus a log panel, for reading the zoom's state on a real device. Each
tap on a work logs, at fixed times after the tap: the phase, how many flying copies are
up, the zoom's transform, the overlay's and the viewport's size and position, the first
section title's position, the column's and the page's scroll, and any script errors.
The panel keeps the last two opens, so one screenshot compares a first open with a reopen.

`python3 standalone/build.py diagnostics` (or `npm run build:diagnostics`).
