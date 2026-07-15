PR URL: https://github.com/spoonjoy/spoonjoy-apple/pull/47

# Recipe Photo Studio: native Apple

## Summary
- Adds native Photo Studio support for the real backend contracts: upload photo, optional Spoon fields, editorial defaults, generated placeholders, prompt-guided regeneration, activation/archive/no-cover, and status-aware copy.
- Preserves staged picker bytes through validation/cancellation, supports queued offline cover uploads with canonical `photo` media, and keeps legacy activation compatibility while using canonical `activateWhenReady`.
- Wires SwiftUI controls through platform-native picker/staging/action planning and keeps native request builders, sync replay, and source contracts aligned with web/REST/MCP.

## Validation
- Final Swift test: 587 tests / 52 suites, `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/swift-test.log`.
- Final native validation matrix: 39/39 validation steps passed, `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/matrix/apple/validation-matrix.json`.
- Screenshot/design route matrix: 34/34 routes passed, zero failed/blocked/missing-review routes, `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/matrix/apple/matrix-route-matrix.json`.
- Coverage enforcement: 100.00% (26,810 / 26,810), `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/matrix/apple/matrix-coverage-enforce.log`.
- Final warning scan: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/native/fail-on-warning-final.log`.

## Companion Work
- Web/backend companion branch: `spoonjoy-v2:worker/recipe-photo-studio`.
- Doing doc: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio.md`.
