# Unit 2.4a RED Evidence

## Frozen Contract

- The reviewed migration gate accepts only exact migration 0025 bytes and the frozen migration clock, legacy-index replacement, active identity index, and two cutover fences. Unrelated destructive DDL/DML remains rejected.
- The cutover contract freezes all four transitions, environment-specific predecessor bindings, QA same-build aliases, forward-only repair ancestry, repeatable post-restoration lineage, trigger inventory, recovery bookmarks, target identity, unlock readback, and schema-version-1 durable evidence.
- Runtime-changing repairs require source/blob/bundle manifests plus both executable Worker/DO skew matrices. Workflow-only repairs may reuse only a digest-bound prior executed receipt after proving both runtime bundles byte-identical.
- The deterministic topology preserves the exact historical product target, adds the protocol-v1 marker exactly once with the first real protocol routing, records immediate-parent and runtime-floor diffs independently, and proves marker immutability through every descendant.
- Product-era skew fixtures execute the exact public PATCH, canonical request hash, `owner:v1:<userId>` binding, fixed-order internal body, exact private path/method/header allowlist, both cross-version directions, and public Worker runtime evidence.

## Runtime Evidence

- Exact historical manifests pin merge/tree/source blob/source SHA-256/bundle SHA-256/build command identities for the #283, compatibility, boundary, and product snapshots.
- CI-local topology manifests pin 15 coherent release identities and 30 Worker/DO artifacts without requiring source-repository history.
- Worker bundle output is byte-identical when built with either compatible DO generation.
- `node test/fixtures/product-cutover/audit-runtime-history.mjs` independently audited 16 exact historical runtime sources against full Git history.

## RED Verification

- `pnpm typecheck` passed.
- Exact-source fixture: 7 passed, 483 skipped.
- Full product cutover gate: 490 total, 8 passed, 482 intentionally failed. Every failure is isolated to one of the nine absent Unit 2.4b exports: `assertReviewedMigrationSql`, `readD1RecoveryBookmark`, `readPostRestorationApprovalFile`, `readForwardRepairSkewReceiptFile`, `readExecutedSkewReceiptFile`, `assertProductCutoverPreconditions`, `runProductCutover`, `assertProductCutoverArtifact`, or `writeProductCutoverArtifactFile`.
- Existing deployment suite: 483 total, 469 passed, 14 intentionally failed at the Unit 2.4b product integration boundary.
- `git diff --check` passed.

## Cold Review

Twenty adversarial review rounds tightened graph coherence, history-independent CI evidence, floor-relative diffs, safe build-command execution, manifest/receipt coupling, exact protocol-boundary ownership, both real skew directions, stable private-header capture, canonical request hashing, and owner-key derivation. The final reviewer reran the current contract and returned `CONVERGED` with no remaining finding.

No production implementation, import UI, D1 cook-state model, or Pebble-specific work was added.
