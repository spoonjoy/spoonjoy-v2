# Unit 1d Visual QA Ledger

## Surfaces
- `/mcp` desktop viewport: 1440 x 1200
- `/mcp` mobile viewport: 390 x 1200

## Evidence
- Desktop screenshot: `mcp-desktop.png`
- Mobile screenshot: `mcp-mobile.png`
- Overflow metrics: `unit-1d-overflow.json`
- Post-audit desktop screenshot: `mcp-audit-desktop.png`
- Post-audit mobile top screenshot: `mcp-audit-mobile.png`
- Post-audit mobile full-page screenshot: `mcp-audit-mobile-full.png`
- Post-audit mobile bottom screenshot: `mcp-audit-mobile-bottom.png`

## Absurdity Ledger

| Item | Evidence | Viewport/state | Why it matters | Disposition |
| --- | --- | --- | --- | --- |
| Initial mobile render clipped text and badges to the right. | First mobile screenshot before fix, then `unit-1d-overflow.json` after fix | 390 x 1200, `/mcp` | The page looked broken and unreadable on a normal narrow phone viewport. | fixed: explicit `minmax(0,1fr)` grid columns and `min-w-0` header/grid wrappers removed page-level overflow. |
| Claude Code command is wider than the mobile viewport. | `mcp-mobile.png`, `unit-1d-overflow.json` | 390 x 1200, code block | Long shell commands cannot wrap cleanly without becoming harder to copy. | intentionally accepted: the command is contained in a horizontally scrollable code block; page-level overflow remains false. |
| Fixed mobile dock appears over the very bottom of the screenshot. | `mcp-mobile.png` | 390 x 1200, top of page | The app's global mobile dock overlays the viewport bottom while the page continues below. | intentionally accepted: this is existing global app chrome with page scroll available and bottom padding; no `/mcp` text is clipped after scrolling. |
| Post-audit copy did not yet make the app-to-agent task gradient apparent. | `mcp-audit-desktop.png`, `mcp-audit-mobile.png` | 1440 x 1200 and 390 x 1200, `/mcp` | The clarified audience needs to know when to use the app, when to use an agent, and why MCP exists. | fixed: added TL;DR language plus an Easy/Middle/Complex section that maps app, future generative UI, and agent work. |
| Mobile command block needed to stay readable after the post-audit copy pass. | `mcp-audit-mobile-full.png`, `mcp-audit-mobile-bottom.png` | 390 x 1200, setup section and page bottom | The setup path is the actionable part of the page; it cannot collapse into one long invisible line on phones. | fixed: split the Claude Code command over multiple lines with a token variable; bottom screenshot confirms final content remains reachable above the mobile dock. |

## Final Result
- No `ready` or `needs reviewer gate` visual items remain.
- Desktop and mobile screenshots show the revised app-to-agent thesis above the fold, readable hierarchy, wrapped prose, wrapped badges, a usable setup command, and no page-level horizontal overflow.
