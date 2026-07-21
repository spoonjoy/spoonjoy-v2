# Unit 1.3a Red Evidence

## Scope

The test-only diff freezes the three source-controlled production release modes:

- `atomic-bootstrap`
- `atomic-product-activation`
- `protocol-v1-canary`

It covers exact release provenance, mode and boundary validation, migration-state provenance, atomic forward repair, gradual canary restoration, manual rollback ancestry, bootstrap probes, artifact serialization, secret sanitization, and the executable workflow artifact validator.

## Red Run

```text
pnpm exec vitest run test/scripts/deploy-production-canary.test.ts test/scripts/deployment-preflight.test.ts test/release-workflow-security.test.ts --reporter=json --outputFile=/tmp/spoonjoy-unit-1.3a-r22.json

Test Files: 3 failed (expected against the pre-implementation runtime)
Tests:      564 collected
Passing:    381
Failing:    183 intentional contract failures
Pending:    0
```

There were no collection, transform, timeout, or harness failures. The executable synthetic lifecycle matrix passes, proving that the intended jq grammar accepts all frozen lifecycle tuples and rejects representative poison mutations.

`git diff --check` passes.

## Review

The harsh release/security review converged in Round 22 with `APPROVED`. The review closed unreachable artifact tuples, exact writer-attempt ordering, zero-migration failure recovery, phase-specific version identity, migration provenance, manual rollback live-state failures, and zero-command/zero-writer behavior for unschemaable direct inputs.

Production implementation files were not changed during this unit.
