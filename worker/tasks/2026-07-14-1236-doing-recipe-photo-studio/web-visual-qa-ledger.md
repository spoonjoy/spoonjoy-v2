# Web Visual QA Ledger

Date: 2026-07-14
Surface: recipe detail owner management Photo Studio
Local target: `http://localhost:5173`

## Coverage

- Desktop viewport: `1440x900`
- Mobile viewport: `390x844`
- States exercised:
  - No photo / first-photo form
  - Processing original cover
  - Editorial ready cover with regeneration controls
  - Generated AI placeholder cover

## Artifacts

Focused viewport screenshots and snapshots live in `./visual-qa/`.

- `desktop-no-photo-photo-studio.png`
- `desktop-no-photo-cover-history.png`
- `desktop-processing-original-cover-history.png`
- `desktop-editorial-ready-cover-history.png`
- `desktop-generated-placeholder-cover-history.png`
- `mobile-no-photo-photo-studio.png`
- `mobile-no-photo-cover-history.png`
- `mobile-processing-original-cover-history.png`
- `mobile-editorial-ready-cover-history.png`
- `mobile-editorial-ready-regeneration-controls.png`
- `mobile-editorial-ready-spoon-photo-controls.png`
- `mobile-generated-placeholder-cover-history.png`
- `mobile-generated-placeholder-regeneration-controls.png`
- `layout-audit.json`

## Checks

- Required Photo Studio and Recipe covers labels were present in every desktop/mobile state.
- No captured route rendered the app error boundary.
- No captured DOM snapshot contained the rejected labels `Chef photo`, `Spoonjoy cookbook`, or `On the counter`.
- The mobile and desktop layout audit found no visible horizontal overflow after excluding screen-reader-only text and normal input text scrolling.
- First-photo controls showed `Post as Spoon` and `Editorialize cover` checked by default.
- Placeholder generation and regeneration controls rendered with prompt-addition fields.
- Provenance labels rendered as `Original photo`, `Editorial photo`, or `AI generated`.

## Ledger

| Item | Status | Notes |
| --- | --- | --- |
| Local dev session secret missing from Worker env | closed | Added ignored local `.dev.vars` for visual QA only; `/login` rendered cleanly afterward. |
| First-pass full-page screenshots looked clipped | closed | Replaced full-page captures with focused viewport screenshots after each target section is placed in view; layout audit confirms `docScrollWidth` equals the viewport width for mobile and desktop captures. |
| First-pass targeted control screenshots were invalid | closed | Removed the bad artifacts and replaced them with label-targeted viewport captures for regeneration and Spoon-photo controls. |
| Mobile generated-placeholder panel did not expand in first capture | closed | Retried with fresh locator state and label-targeted captures; `mobile-generated-placeholder-regeneration-controls.png` shows the controls. |
| Long mobile action labels | closed | DOM layout audit reported no visible horizontal overflow for buttons, labels, and containers across all tested states. |
| Rejected cover-copy regression | closed | Snapshot scan found no rejected label on the exercised recipe detail surfaces. |

Reviewer gate: converged on re-review with no blocker, major, or minor findings.
