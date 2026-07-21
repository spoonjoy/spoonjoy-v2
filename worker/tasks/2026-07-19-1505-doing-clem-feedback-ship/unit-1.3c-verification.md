# Unit 1.3c Verification

## Coverage And Failure Matrix

- The deploy-script and deployment-preflight matrices cover every release mode, lifecycle phase, migration state, D1 response envelope, version upload/lookup, candidate stage, promotion, rollback/repair, artifact schema, marker provenance, and zero-migration path.
- Modified deploy scripts have 100% statement, branch, and function coverage: 1,618/1,618 statements, 1,385/1,385 branches, and 249/249 functions combined.
- The executable workflow artifact serializer is exercised directly through Bash and JQ tests, including every valid and impossible post-D1 phase tuple.
- Adapter tests capture the exact outbound D1 URL, authorization/content headers, ordered SQL batch body, and sanitized error behavior.

## Security And Recovery

- Tokens, SQL bodies, and unbounded provider errors are excluded from logs and artifacts. Tests exercise redaction for nested objects, thrown values, request failures, and malformed provider responses.
- Bootstrap and first-product activation never roll back across the newly introduced Durable Object lifecycle boundary. Failures after D1 mutation require forward repair.
- Protocol-v1 canary rollback is restricted to a validated protocol-compatible previous version and cannot select an inert or pre-boundary version.
- Release artifacts bind exact revision, tree, workflow source, deployment UUID, migration state, Worker version, phase, and repair/rollback disposition.

## Final Gate

- Focused release matrix: 721/721 tests passed.
- Full app gate: 7,734/7,734 tests passed with 100% statements, branches, functions, and lines.
- Recipe route warning repairs passed 113/113 and 21/21 focused tests with no React act or navigation warnings.
- Script and app typechecks, production build, deployment preflight, and whitespace validation passed with zero warnings.
- Fresh release/security review converged with no finding at any severity.
