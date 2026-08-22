# Unit 5 Cold Review — Initial Verdict

Exact reviewed head: `36e03e81`

Verdict: `FAIL` — no blocker, two major findings, and two actionable minor findings.

## Findings

1. **MAJOR — document-request false positive.** The page adapter fell back to the rendered link `href` when it did not observe a navigation request, so the canary could pass without proving a top-level OAuth-start document request.
2. **MAJOR — CSP evidence lifetime/scope.** CSP evidence lived in replaceable page-global state, so an app-origin violation could disappear during provider handoff while a provider-origin violation could be misclassified.
3. **MINOR — provider path.** The canary validated provider host and parameters but not the provider authorization endpoint path.
4. **MINOR — stale comment.** `OAuthButton` still described `redirectTo` as being carried in a form action after the implementation changed to a link.

## Required remediation

- Require an actually observed top-level `Document` request for the exact same-origin `/auth/{provider}` URL, with no rendered-href fallback.
- Keep CSP evidence outside replaceable document state; retain only pre-handoff Spoonjoy-origin events and ignore provider-origin events.
- Pin the public provider authorization path in each canary contract.
- Correct the stale link comment.

All four findings are actionable and must converge through strict TDD and fresh re-review.
