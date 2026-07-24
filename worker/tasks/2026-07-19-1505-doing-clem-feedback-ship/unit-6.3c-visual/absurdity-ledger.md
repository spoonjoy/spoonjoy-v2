# Unit 6.3c Visual Absurdity Ledger

| Surface | Viewport | Observation | Disposition |
| --- | --- | --- | --- |
| Global search filters | 1440x900 | Query, scope, course, and tag controls form a clear hierarchy. Every enabled measured search/filter control is natively focusable and at least 44x44 px. | Verified; no open issue. |
| Global search filters | 390x844 | A 40-character unbroken tag wraps inside its chip. The document remains exactly 390 px wide and every enabled measured search/filter control is natively focusable and at least 44x44 px. | Fixed and verified; no horizontal overflow or clipping. |
| Global long query | 390x844 | A 160-character unbroken query remains contained in the search field and wraps in the results heading without widening the document. | Fixed and verified; no horizontal overflow or occlusion. |
| My Recipes filters | 1440x900 | Search and filter controls remain dense, legible, and aligned with the existing recipe workspace. Every enabled measured search/filter control is natively focusable and at least 44x44 px. | Verified; no open issue. |
| My Recipes filters | 390x844 | Long tags wrap, controls remain reachable, and the document remains exactly 390 px wide. The existing fixed mobile navigation dock crosses the full-page capture at its fixed viewport position, while the page remains scrollable beneath it and the new filter controls are unobscured. | Existing application-shell behavior accepted; no Unit 6.3c issue. |

No item requires a reviewer gate or remains ready for repair.
