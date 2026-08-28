# OAuth consent client hardening

Status: IN_PROGRESS

## Objective

Reduce dynamic-client consent phishing without disabling RFC 7591 registration: constrain reserved-name callback use, identify every dynamically registered client as unverified during consent, and put the callback origin in the main consent flow.

## Grounded source

- Base: `origin/main` at `1f1acb40c8c1f5d10dd83475211a1790e8b6ce23`.
- Registration flows through `handleOAuthRegister` to `registerOAuthClient`.
- Authorization flows through `validateClientRedirect` to `AuthorizeView`, then `app/routes/oauth.authorize.tsx` renders consent.
- Existing special-case compatibility tuples are `Claude` with `https://claude.ai/api/mcp/auth_callback` and `Spoonjoy Apple` with `https://spoonjoy.app/oauth/callback`.
- Open registration remains intentional and rate-limited. No dependency change is required; a small schema migration adds durable OAuth-client revocation.

## Chosen design

Do not infer verified identity from caller-supplied DCR metadata. Every OAuth client in the current schema is dynamically registered and the consent UI must call it unverified, including a caller that submits the exact Claude tuple. Keep the existing special-case compatibility predicates for Claude legacy-resource behavior and Spoonjoy Apple provider hints, but centralize and tighten them to exact singleton registrations; they must never suppress the UI warning or claim identity verification. Registration measures names in Unicode code points with `Array.from`, permits at most 80, rejects Unicode `Cc` controls plus bidi controls `U+061C`, `U+200E`, `U+200F`, `U+202A–U+202E`, and `U+2066–U+2069`, rejects duplicate redirect entries, and rejects a reserved name paired with any noncanonical redirect set. Legacy display removes that same prohibited set, takes the first 80 Unicode code points, trims, and falls back to `This app`. Consent places the unverified warning and callback origin before attacker-controlled client text and keeps the callback visible outside the collapsed details.

Revocation is a durable state, not physical deletion: add nullable `OAuthClient.revokedAt`. All client lookup for authorize/token/refresh and every OAuth-backed API credential authentication must require a non-revoked client. This makes a credential minted by an already in-flight request after revocation unusable. The production operation sets `revokedAt` first, deletes related codes/tokens/credentials and dependents, then rechecks and repeats the dependent sweep; the tombstone row remains so no late request can restore access.

## Non-goals

- Do not require an initial access token or disable open DCR.
- Do not add CIMD, attestation, client secrets, a trust database, or admin UI.
- Do not label any DCR client verified or trusted based on self-asserted name/redirect metadata.
- Do not change PKCE, scope, resource, or ordinary token rotation semantics.

## Slice 1: registration and deleted-client policy

1. Add frozen tests first in `test/lib/oauth-server.server.test.ts` and/or `test/lib/oauth-routes.server.test.ts` for both reserved identities, case/whitespace normalization, both mixed-callback orderings, duplicate approved callbacks, unapproved callbacks, 80/81-code-point boundaries (including surrogate-pair emoji), every prohibited control/bidi range, allowed ZWJ text, and ordinary third-party names. Cover every compatibility consumer with legacy mixed-row negative tests. At the HTTP boundary assert `invalid_client_metadata` and no row persistence. Run the focused tests and record the expected red caused by missing reserved-name and input guards.
2. Implement the smallest shared exact-registration predicate, display-name limit, and registration guard in `app/lib/oauth-server.server.ts`; replace the duplicate native-provider constants/predicate in `app/lib/oauth-route.server.ts` and tighten Claude legacy promotion to the same exact-registration rule. Name it for compatibility/callback shape, not identity trust.
3. Return RFC-compatible `invalid_client_metadata` from registration for a reserved name with a non-approved redirect set.
4. Add a migration and frozen tests for `OAuthClient.revokedAt`. Prove revoked clients cannot authorize, exchange codes, rotate refresh tokens, or authenticate an OAuth access credential, including a simulated credential created after revocation. Add the minimum active-client checks at all four boundaries.
5. Update the D1 invariant audit's Claude classification from name-plus-`LIKE` to the same normalized-name and exact-singleton stored representation, with mixed-row regression coverage.
6. Update public DCR documentation to state the exact 80-code-point/prohibited-character/duplicate-redirect/reserved-name constraints and revocation behavior.
7. Run the focused server, registration, auth, audit, and migration suites green with 100% statements, branches, and functions coverage for modified logic.

## Slice 2: consent identity surface

1. Add frozen route/component tests first in `test/routes/oauth-authorize.test.tsx` proving the callback origin and unverified warning precede any client-controlled text, ordinary clients, unnamed clients, and an exact self-registered Claude tuple are all unverified, and legacy names deterministically remove the prohibited set and truncate at 80 Unicode code points without splitting surrogate pairs. The exact callback remains in details. Run focused tests and record the expected red.
2. Keep `AuthorizeView` free of false trust state; carry only the validated client name and callback already needed for rendering.
3. Render the visible callback identity and unverified warning in `app/routes/oauth.authorize.tsx` using existing components and styles. Preserve accessibility and both consent forms.
4. Run focused route tests and visual QA at desktop and narrow mobile widths.

## Slice 3: delivery and operations

1. Run generated-contract, typecheck, build, full coverage, worker coverage if required by the repository, and the full test suite with zero warnings.
2. Run a cold hostile branch review, fix blocker/major findings, and repeat affected proof.
3. Add a frozen regression for the submitted request exactly: `/authorize` is absent, and the corrected `/oauth/authorize` request for client `cmt723pe00000tx0nap6unplp` with state `randomstate123` and no PKCE is rejected with `invalid_request`. Distinguish that failed PoC from a corrected user-approved DCR grant in tests and reply language.
4. Push, open the PR, wait for exact-head checks, merge, verify the landed tree, deploy through the established production path, and run the existing production MCP OAuth canary plus an adversarial untrusted-name consent smoke; revoke the exact temporary smoke client and prove its related active counts are zero. Because the new Claude singleton rule is an external compatibility constraint, also reconnect the real hosted Claude connector, verify tools work, then disconnect it and prove revocation before completion. Verify the Spoonjoy Apple canonical tuple through its provider-hint integration suite and documented native-auth production smoke; do not claim the current native app uses this OAuth bounce.
5. After durable revocation is live, query the exact reported client `cmt723pe00000tx0nap6unplp`; set its `revokedAt` first, revoke/delete only its authorization codes, refresh tokens, OAuth access credentials, and dependent records, then prove the client remains revoked and all related active counts are zero twice. Repeat the dependent sweep before the second proof so any in-flight post-revocation writes are removed; the retained tombstone guarantees such rows cannot authenticate or rotate meanwhile. If Cloudflare authentication remains unavailable after safe retries, treat production mutation as a credential-wall blocker rather than guessing.
6. Send the reviewed HEY reply only after the code is live and the exact client revocation is verified. State precisely that the posted `/authorize` request cannot run and the corrected path rejects its missing-PKCE/short-state request; acknowledge that a corrected flow can reach consent and that the unverified-client/callback presentation was hardened. Do not imply all user-approved malicious OAuth grants are technically impossible.
7. Clean task-owned smoke data, artifacts, branch, and worktree; update Desk and notify Slugger.

## Acceptance

- Reserved names cannot be registered with any callback set other than their exact approved singleton callback, but even an exact self-registered tuple remains labeled unverified.
- Every special-case compatibility consumer rejects pre-existing mixed or noncanonical registrations.
- New client names are limited to 80 Unicode code points and exclude the specified control/bidi set; legacy names use the specified deterministic safe-display transform.
- Ordinary valid HTTPS DCR remains functional.
- Consent visibly identifies the callback origin and labels all current DCR clients unverified.
- Existing canonical Claude and Spoonjoy Apple flows remain functional without claiming that self-asserted DCR metadata verifies identity.
- Modified production logic has 100% statement, branch, and function coverage; full required gates emit zero warnings.
- The exact reported production client is durably revoked and all its grant/credential/dependent records are absent after the final sweep.
- A revoked OAuth client cannot authorize, exchange or rotate a grant, or authenticate an OAuth-backed credential, including credentials created by an in-flight request after revocation.
- The change is merged, deployed, production-smoked, and the reporter has received the accurate reply.

## Execution evidence

- Strict TDD red: the initial focused run failed 30 registration, consent, and revocation assertions; the invariant-audit regression also failed before its exact-singleton SQL was implemented.
- Focused server/route/auth/audit/migration suites passed 254 tests; the later hostile-review additions passed their focused suites, including 158 Account Settings/API summary tests and 47 consent/mobile-navigation tests.
- Repository coverage gate passed 385 files and 8,370 tests at exactly 100% statements, branches, functions, and lines with zero warnings.
- Workers coverage passed 43 tests at 100% statements, branches, functions, and lines.
- Local and QA D1 migration rehearsals applied `0025_oauth_client_revocation.sql`; generated-contract, typecheck, and production-build gates passed.
- Hostile implementation review closed the late-credential, legacy mixed-callback, long-origin wrapping, and legacy-name display findings with no blocker or major remaining.
- Screenshot-backed QA covered 1280px desktop and true 390px CDP emulation using a long trusted-looking client name and attacker-controlled origin. The first mobile pass found the global dock obscuring security copy; `/oauth/authorize` now suppresses the dock, the fixed capture has no horizontal overflow, and fresh visual review passed. Durable captures are in `/Users/arimendelow/desk/spoonjoy-v2/oauth-consent-client-hardening/evidence/`.
