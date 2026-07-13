# Unit 1d Visual QA Ledger

## Surfaces
- `/mcp` desktop viewport: 1440 x 1200
- `/mcp` mobile viewport: 390 x 1200

## Evidence
- Desktop screenshot: `mcp-desktop.png`
- Mobile screenshot: `mcp-mobile.png`
- Overflow metrics: `unit-1d-overflow.json`

## Absurdity Ledger

| Item | Evidence | Viewport/state | Why it matters | Disposition |
| --- | --- | --- | --- | --- |
| Initial mobile render clipped text and badges to the right. | First mobile screenshot before fix, then `unit-1d-overflow.json` after fix | 390 x 1200, `/mcp` | The page looked broken and unreadable on a normal narrow phone viewport. | fixed: explicit `minmax(0,1fr)` grid columns and `min-w-0` header/grid wrappers removed page-level overflow. |
| Claude Code command is wider than the mobile viewport. | `mcp-mobile.png`, `unit-1d-overflow.json` | 390 x 1200, code block | Long shell commands cannot wrap cleanly without becoming harder to copy. | intentionally accepted: the command is contained in a horizontally scrollable code block; page-level overflow remains false. |
| Fixed mobile dock appears over the very bottom of the screenshot. | `mcp-mobile.png` | 390 x 1200, top of page | The app's global mobile dock overlays the viewport bottom while the page continues below. | intentionally accepted: this is existing global app chrome with page scroll available and bottom padding; no `/mcp` text is clipped after scrolling. |

## Final Result
- No `ready` or `needs reviewer gate` visual items remain.
- Desktop and mobile screenshots show readable hierarchy, wrapped prose, wrapped badges, and no page-level horizontal overflow.
