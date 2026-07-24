# Unit 5.2a Red Evidence

## Contract audit

- The REST adapter contract covers bearer scope enforcement, private cache headers, strict list and mutation inputs, exact envelopes, method errors, semantic validation, and owner-scoped outgoing service calls.
- PUT proves missing and soft-deleted targets against the real saved-recipes service.
- DELETE proves idempotence against real missing, soft-deleted, and hard-deleted database states, including hard-delete cascade cleanup.
- PUT and DELETE both prove same-request write recovery, completion-failure recovery, later-request replay semantics, conflict behavior, and in-progress behavior.
- OpenAPI, route registration, generated-playground operation coverage, and both developer documentation surfaces are frozen by tests.

## Red run

Command:

```text
pnpm exec vitest run test/routes/api-v1-saved-recipes.test.ts test/routes/api-v1-openapi.test.ts test/config/api-v1-route-coverage.test.ts test/docs/developer-platform-docs.test.ts test/config/clem-feedback-boundaries.test.ts
```

Result: 16 expected failures and 22 passes across five files. Every failure is caused by the saved REST resource being absent: route requests return `404`, resource/playground entries are missing, the OpenAPI path is undefined, and developer docs do not mention the resource. The change-boundary ratchet passes.

`pnpm run typecheck` also passes with no warnings.

## Review gate

The fresh reviewer call reached the account-level sub-agent usage limit before returning a verdict. A cold local adversarial pass found and repaired one weakness before commit: lifecycle deletion coverage had used mocked IDs instead of real database states. No remaining blocker or major finding was identified. External reviewer evidence is degraded for this unit solely because of the service quota; execution continues under the repository's no-human-gate policy.
