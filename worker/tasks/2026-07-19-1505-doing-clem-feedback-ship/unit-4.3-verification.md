# Unit 4.3 Rejected-Scope Verification

## Frozen Authority

- Baseline source: `d50b8ff5730c68597f6b80077df799927a56e3bf`
- Feedback source SHA-256: `6cfb65216c4387c1ced9d1c42a68952502ef0966495980403d84fe51e346d5f3`
- Product/data contract SHA-256: `bf57163e073ed41968ad7b241a600f8797c8c417db7c25b314b50b850bf1374b`
- Cook protocol SHA-256: `5014c400570d79d09e5d20c168df4c14dccd705db2a140afc0a24abe684d6e8a`
- Feedback map SHA-256: `10d8c61cd755b1dc15d1303e46e0e0e83195ba35574fdd537f24e689484009de`

`unit-0r-audited-baseline.md` records why the product-contract digest changed after
the reviewed `4d8379f2` and `2ff6f338` commits and corrects the feedback-map digest
transcription without changing that file's bytes.

## Protected Provider Boundary

The executable guard reconstructs the protected provider token without adding a
ninth source hit. Baseline, `HEAD`, and the tracked plus untracked working tree must
contain exactly these eight paths:

- `app/lib/analytics-server.ts`
- `spoonjoy/tasks/2026-06-01-1830-doing-dev-platform-api-docs.md`
- `spoonjoy/tasks/2026-06-01-1830-planning-dev-platform-api-docs.md`
- `test/docs/developer-platform-guide.test.ts`
- `test/lib/analytics-server.test.ts`
- `test/routes/agent-connect.test.tsx`
- `test/routes/api-v1-telemetry.test.ts`
- `test/routes/developers.test.tsx`

The guard compares every protected line body to the baseline and inspects only
added or removed lines from a zero-context diff. The two historical task files
also retain their exact Git blob IDs and SHA-256 digests recorded in
`unit-0r-audited-baseline.md`.

## Whole-Change Allowlist

`unit-4.3-change-allowlist.json` content-addresses every changed product-tree path
relative to the baseline, including tests, binary assets, and untracked files.
Only task evidence under `.tasks/`, `spoonjoy/tasks/`, and `worker/tasks/` is
excluded. The manifest contains 133 entries and has SHA-256
`31e198cb5e5ddd002b6397c0c1d6b19f5f5483a28e7228caca610e2388ca7f26`.
The regression test validates schema version 1, the baseline source, and exact
path/status/content equality.

## Rejected Scope Guards

- Import remains agentic: route registration, MCP tool names, REST import paths,
  and each tracked or untracked executable client TS/TSX surface are checked independently.
  The static privacy disclosure is intentionally not treated as a UI control.
- Automated tag generation remains absent from Prisma models, migration tables and
  fields, OpenAPI operations and tag schemas, MCP tools, and client surfaces.
- Navigation ownership is unchanged from the baseline; the current navbar and all
  navigation component suites remain in the focused matrix.
- Personalized save metadata remains absent from REST/MCP read serializers,
  list/detail/search handler regions, and public OpenAPI schemas. Direct REST and
  MCP tests create saved-user state and assert the exact neutral response keys.

## Verification

- `test/config/clem-feedback-boundaries.test.ts`: 9/9 passed, including adversarial
  aliases for hidden client import helpers and automated categorization endpoints,
  schemas, persistence entities, and UI labels.
- Corrected focused matrix: 23 files and 446 tests passed with no warnings.
- The matrix includes the current navigation files, both agentic import adapters,
  REST/MCP saved-user read cases, protected analytics/telemetry/docs surfaces, and
  metadata/scaling boundaries.
- `pnpm run verify:clean:typecheck`: passed, including generated playground output,
  React Router type generation, TypeScript, and the warning policy.

## Review

Rounds 1-3 identified stale authority provenance, incomplete AI/import/save-state
inventories, a token-only provider oracle, overbroad diff context, and semantic
composition bypasses. Round 5 was dispatched after the guards moved to exact
persistence inventories, normalized import fragments, contextual API input
structure, and adjacent UI windows. The terminal result is recorded in the
doing-doc progress log. Round 5 returned `PASS` with no blocking findings after
independently reproducing the manifest digest, 9/9 boundary tests, 141/141
boundary plus saved-user REST/MCP/search tests, and warning-policy typecheck.
