# Unit 6.3c Visual Verification

## Coverage

- Surfaces: global search and My Recipes filters.
- Viewports: 1440x900 and 390x844.
- State: ordinary query, 160-character unbroken query, course, a normal multi-word tag, and a 40-character unbroken tag.
- Interaction geometry: every enabled measured search/filter input, select, button, and link is natively focusable and at least 44x44 px. Component tests separately verify focus restoration, draft synchronization, native required validation, and the visible ten-tag limit.

## Results

- All five captures rendered without browser console errors or page errors.
- Desktop captures have 1440 px viewport, document, and body widths.
- Mobile captures have 390 px viewport, document, and body widths.
- No capture has horizontal overflow.
- Long tag labels wrap within their chips without occluding the remove action.
- The unbroken query remains contained in the field and wraps in the result heading.
- Filter hierarchy, contrast, labels, and active state remain legible at both sizes.

Machine-readable measurements are in `metrics.json`; the five PNG captures are stored beside this report. The absurdity ledger has no open item.
