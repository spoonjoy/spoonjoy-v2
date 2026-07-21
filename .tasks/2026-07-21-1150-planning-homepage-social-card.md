# Planning: Homepage social card

**Status**: approved
**Created**: 2026-07-21 11:51

## Goal
Give `https://spoonjoy.app/` a complete, crawler-readable Open Graph and Twitter preview backed by a real 1200×630 PNG so LinkedIn can render a branded Featured card instead of the current gray placeholder.

## Upstream Work Items
- None

## Scope

### In Scope
- Update the existing exact metadata assertion in `test/routes/index.test.tsx`, then add complete homepage title, description, canonical, Open Graph, and Twitter metadata in `app/routes/_index.tsx`.
- Add a branded 1200×630 PNG social card and a maintainable source asset.
- Add tests that lock the metadata contract and verify the committed image is a 1200×630 PNG.
- Run repository validation, cold review, PR/merge, deployment verification, and production metadata/image smoke checks.

### Out of Scope
- Change the visible homepage UI.
- Refactor existing dynamic recipe, cookbook, or developer-page OG routes.
- Edit LinkedIn or add Spoonjoy to Featured before the headline crossover finishes and Ari approves the final profile action.

## Completion Criteria
- [x] Homepage HTML exposes absolute canonical, `og:title`, `og:description`, `og:type=website`, `og:url`, `og:image`, `og:image:type=image/png`, image dimensions, and Twitter-card fields.
- [x] The declared social image is a valid 1200×630 PNG with a branded, legible design.
- [ ] Production homepage HTML contains the expected metadata without Cloudflare challenge markers.
- [ ] Production serves the declared image as `image/png`; its bytes have the PNG signature and a 1200×630 IHDR.
- [ ] Homepage and image return real content rather than a Cloudflare challenge when requested with LinkedIn's crawler user agent.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings
- [x] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None.

## Decisions Made
- Use a committed raster PNG for the homepage card because LinkedIn needs a directly fetchable social image and the existing on-demand OG routes return SVG despite their `.png` URL suffix.
- Keep canonical and image URLs pinned to `https://spoonjoy.app/` so preview crawlers never receive environment-specific worker URLs.
- Preserve the existing homepage title and description while adding the missing social metadata.

## Context / References
- `app/routes/_index.tsx`
- `app/lib/og-metadata.ts`
- `app/lib/og-image.server.tsx`
- `test/routes/index.test.tsx`
- `test/routes/og-routes.test.ts`
- `wrangler.json`
- `AGENTS.md`

## Notes
The LinkedIn profile itself remains discussion-gated and frozen through the headline experiment; this task only repairs the underlying public-site card.

## Progress Log
- 2026-07-21 11:51 Created
- 2026-07-21 11:54 Tightened the metadata contract and crawler-perspective production gates after cold review; a live LinkedInBot probe confirmed Cloudflare currently serves the real homepage and existing PNG assets to that crawler.
