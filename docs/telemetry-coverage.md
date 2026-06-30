# Telemetry coverage gate

Spoonjoy enforces that **meaningful server error paths emit telemetry**, and
**prevents regressions** where a new uninstrumented error path ships silently.

The gate is a vitest test — [`test/lib/telemetry-coverage.test.ts`](../test/lib/telemetry-coverage.test.ts)
— so it runs inside the existing `pnpm test:coverage` CI step. The audit logic
lives under [`app/lib/telemetry-coverage/`](../app/lib/telemetry-coverage). It is
modeled on the "nerve coverage" system in the ouroboros harness, adapted to
Spoonjoy's PostHog telemetry surface.

It is a **static source scan** (no runtime spying), so it is deterministic and
fast: it reads the server source once and checks two rules.

## What telemetry means here

Server telemetry = PostHog capture via the helpers in
[`app/lib/analytics-server.ts`](../app/lib/analytics-server.ts) and the domain
wrappers built on them:

| Helper | Emits | Where |
| --- | --- | --- |
| `captureException(config, { error, distinctId, route?, method?, extras? })` | PostHog `$exception` | `analytics-server.ts` |
| `captureEvent(config, { event, distinctId, properties? })` | a `spoonjoy.*` event | `analytics-server.ts` |
| `authTelemetryFromContext(ctx).captureException/captureEvent(...)` | `$exception` / `spoonjoy.*` | `auth-telemetry.server.ts` |
| `captureImageGenerationSkipped/Exception/ProviderFallback(...)` | `spoonjoy.image_generation.*` | `image-gen-telemetry.server.ts` |
| `captureLlmCallFailure(...)` | `spoonjoy.llm_call.failed` | `llm-telemetry.server.ts` |

### `spoonjoy.*` naming convention

All controlled server events use a dotted, lowercase namespace and are enforced
at the sink (`analytics-server.ts` rejects any non-matching name):

```
spoonjoy(.[a-z0-9_]+)+
```

Examples in the tree: `spoonjoy.ratelimit.backend_error`,
`spoonjoy.image_generation.skipped`, `spoonjoy.llm_call.failed`,
`spoonjoy.webauthn.*`. Exceptions are emitted as PostHog's native `$exception`
event (not a `spoonjoy.*` name) with structured `extras`.

Server payloads are **privacy-safe by construction**: `analytics-server.ts`
drops unsafe keys (body, headers, tokens, cookies, raw query, stack-in-props,
…) and any nested non-array object. Keep new telemetry properties scalar and
non-PII (ids, codes, phases, counts, booleans).

## The two enforced rules

### Rule 1 — ERROR-CONTEXT

Every `captureException` / `captureEvent` call must carry **at least one
diagnostic property beyond the bare identity** (`error` / `distinctId` /
`event`). A capture that lands in PostHog with nothing queryable is a failure.

- Low-level sink: `route`, `method`, or `extras` satisfy it.
- Auth sink (`telemetry.captureException(error, { provider, phase })`): the
  second-argument object **is** the `extras`, so `provider` / `phase` satisfy it.
- Domain wrappers (`captureImageGeneration*`, `captureLlmCallFailure`) build
  their properties from a typed input and are context-safe by construction; the
  scanner does not inspect their argument literal.

This adapts ouroboros Rule 3 ("error events must carry non-empty meta").

### Rule 2 — NO-NEW-GAP RATCHET

Every **server file that contains a `catch` block** (a potential silent error
path) must either:

1. contain a telemetry call (instrumented), **or**
2. be on the documented allowlist in
   [`allowlist.ts`](../app/lib/telemetry-coverage/allowlist.ts).

Scope: `app/lib/**/*.server.ts(x)` and all `app/routes/**/*.ts(x)` (every route
loader/action runs server-side on Workers). Client-only modules, tests, and
type declarations are out of scope.

The allowlist freezes **today's** gaps so the gate is green on day one. Anything
**new** — a freshly added catch-bearing server file with no telemetry and no
allowlist entry — fails the gate. This adapts ouroboros `file-completeness`.

The ratchet also fails on a **stale** allowlist entry: once you instrument a
file (or its catch block goes away), its allowlist entry must be removed, so the
gap list cannot silently rot.

## How to instrument a new error path

When the gate flags a new gap, instrument the failure path instead of letting it
go silent. Typical shapes:

**In a `.server.ts` library helper** that has a `PostHogServerConfig`:

```ts
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";

const config = resolvePostHogServerConfig(env);
try {
  await doRiskyThing();
} catch (error) {
  if (config.enabled) {
    // ctx.waitUntil(...) when you have a Workers ctx, so capture never blocks.
    await captureException(config, {
      error,
      distinctId: userId ?? "server",
      extras: { operation: "do_risky_thing", code }, // <-- diagnostic context
    });
  }
  throw error; // or map to a typed/4xx error as appropriate
}
```

**In an auth route/handler**, use the context sink:

```ts
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";

const telemetry = authTelemetryFromContext(context);
try {
  ...
} catch (error) {
  telemetry.captureException(error, { provider: "google", phase: "token_exchange" });
  throw error;
}
```

**For a controlled non-exception event**, emit a `spoonjoy.*` event:

```ts
await captureEvent(config, {
  event: "spoonjoy.feature.subevent",
  distinctId: userId ?? "anon",
  properties: { reason, count }, // scalars only; unsafe keys are dropped
});
```

Always attach context (Rule 1): `route`/`method`/`extras`/`properties` with the
operation, an error code/phase, ids — never request bodies, headers, or tokens.

## When NOT to instrument (use the allowlist)

The gate favors **low false-positives**. Some catch blocks legitimately need no
capture. When that is the case, add an entry to `allowlist.ts` with a category
and a one-line reason rather than forcing telemetry:

- `swallow` — intentional swallow with a reason (parse fallback, best-effort
  cleanup, optional feature). No user-facing failure is hidden.
- `rethrow` — the catch only re-throws / recovers a race; the surfaced error is
  captured by an instrumented caller.
- `expected-4xx` — maps to an expected client error (validation, not-found,
  auth-rejected) handled by the caller.
- `non-request` — not on a user-facing request path (stdio MCP transport,
  build/codegen helper, dev-only fallback).
- `delegated` — the catch IS instrumented, but capture happens in a shared
  helper the file delegates to (no capture call in the file itself).
- `backfill` — a genuine user-facing error path that **should** emit telemetry
  but does not yet; tracked for a follow-up PR.
- `llm-owned` — owned by the parallel LLM-telemetry workstream.

## Current gap report (backlog)

The gate launched with **38** allowlisted gaps, including **24 `backfill`** entries
(genuine instrumentation debt). That debt has since been **fully closed** (#217 / #218 /
#219): 9 paths were instrumented and 15 were re-categorized as already-covered
(`delegated` / `rethrow` / …). **0 `backfill` entries remain.**

The allowlist now holds **30** entries — all deliberate (no telemetry warranted) except
the single `llm-owned` entry tracked by the LLM-telemetry workstream:

| Category | Count | Backfill priority |
| --- | --- | --- |
| `delegated` | 10 | none (instrumented via a shared helper) |
| `rethrow` | 6 | none |
| `swallow` | 5 | none |
| `expected-4xx` | 5 | none |
| `non-request` | 3 | none |
| `llm-owned` | 1 | owned by the LLM-telemetry workstream |

The authoritative, per-file list with reasons is the single source of truth in
[`allowlist.ts`](../app/lib/telemetry-coverage/allowlist.ts). To close a gap:
instrument the file, then delete its allowlist entry (the gate will fail if the
entry lingers once the file is instrumented).
