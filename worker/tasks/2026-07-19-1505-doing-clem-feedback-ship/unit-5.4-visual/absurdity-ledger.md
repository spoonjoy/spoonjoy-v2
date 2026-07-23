# Unit 5.4 Absurdity Ledger

| Surface / evidence | Viewport / state | User-visible concern | Disposition |
| --- | --- | --- | --- |
| Real Worker recipe Save action | Desktop and mobile recipe detail | Saving returned 500 after the D1 write because the route header composer assumed Node's `Headers.getSetCookie()`. | `fixed` in `2b1986d5`; standard, Cloudflare `getAll`, and legacy header shapes are covered. |
| Real Worker recipe Save action and saved list | Desktop and mobile recipe detail, populated, search, and pagination | Saving still returned 500 because Prisma's D1 raw adapter converted an ISO-looking `String` projection to `Date`, violating strict stored-timestamp validation. | `fixed`; SQL returns a non-ISO `saved-at:` text envelope and the service strips and strictly validates it. Real Worker save, unsave, and populated list all return 200. |
| `recipe-cookbook-dialog-*.png` | 1440x900 and 390x844 | Programmatic focus on the dialog title rendered a blue input-like outline. | `fixed`; the title retains programmatic focus and uses `focus:outline-none`. Recaptured at both viewports. |
| `saved-populated-mobile.png` and `saved-search-mobile.png` | 390x844 populated and search | Saved descriptions were clamped to two lines and visibly ellipsized. | `fixed`; saved rows opt into full subtitle wrapping while shared rows retain their existing clamp. Recaptured with complete descriptions. |
| Initial populated/search captures | 390x844 populated and search | The capture inherited scroll position and did not start at the top of the state. | `fixed`; this was a probe-state issue. The probe now resets scroll and the final captures start at the top. |
| `recipe-controls-cookbook-focused-mobile.png` | 390x844 recipe detail | The fixed action dock overlays the bottom viewport region. | `intentionally accepted`; it is the product's expected dock behavior, all content remains reachable by normal scrolling, and target/overflow metrics pass. |
| `saved-empty-*.png` | 1440x900 and 390x844 empty | Empty content leaves substantial open space. | `intentionally accepted`; the state is truthful, readable, and gives one direct recovery action without decorative filler. |
| Populated/search/pagination captures | Both viewports | Seeded recipes without photos render neutral placeholders. | `intentionally accepted`; the fixtures accurately exercise missing-image behavior and no asset is broken. |

There are no `ready` or `needs reviewer gate` items.

Fresh visual reviewer Euclid inspected all 13 screenshots, `metrics.json`, and the relevant code/test diff. The reviewer reported no actionable visual, accessibility, or runtime regression and returned `CONVERGED`.

Fresh implementation reviewer Hume found one MINOR non-visual integrity gap in the first D1 text-envelope version: SQLite concatenation could stringify a BLOB. Both SQL projections now guard `typeof(savedAt) = 'text'`, the frozen outgoing-SQL tests pass, and Hume returned `CONVERGED` in Round 2.
