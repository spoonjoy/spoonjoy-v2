# Domains

New code lives in a bounded context under `app/domains/<context>/`. Existing `app/lib` modules move into their context when a change touches them, one at a time, never in one big move.

## Contexts

| Folder | Context | Kind | Holds |
|---|---|---|---|
| `kitchen` | Kitchen | core | the recipe (steps, ingredients, step output links), organizers (tags, categories, tools), cookbooks, ratings, comments, attachments |
| `cooking` | Cooking | core | cook mode, cook sessions, timers, cooking now, spoons (cook log with photos), last-made |
| `planning` | Planning | core | meal plan, plan entries, plan rules, calendar feed, plan to shopping list |
| `pantry-and-shopping` | Pantry and Shopping | core | shopping lists, items, labels and aisle order, pantry stock |
| `food-knowledge` | Food knowledge | shared kernel | foods, units, conversion, nutrition, swaps, ingredient parsing, food names |
| `households-and-identity` | Households and Identity | supporting | users, households, membership and roles, invites, sign-in |
| `move-in` | Move-in | supporting, anti-corruption layer | import jobs, one source adapter per app we import from |
| `community-and-federation` | Community and Federation | supporting | chefs, follows, forks with provenance, recipes travelling between servers |
| `integrations` | Integrations | generic | domain events out: webhooks, notifiers, recipe actions, calendar feeds |
| `platform` | Platform | ports and adapters | feature flags, and the ports the app runs on (database, blobs, realtime, jobs, push, AI, email) |

## Inside a context

- `index.ts` is the context's public surface. Everything else imports the context as `~/domains/<context>` (or `~/domains/<context>/index.server` for its server-only surface).
- `model/` holds entities, value objects and domain events, and does no I/O.
- `application/` holds use cases, which take ports from Platform rather than reaching for D1, R2 or a fetch.
- `adapters/` holds D1, HTTP, MCP and UI glue.

Food knowledge's quantity formatting (`food-knowledge/model/quantity.ts`) is the worked example: a pure model, exported through `food-knowledge/index.ts` and imported by components and routes as `~/domains/food-knowledge`.

## Platform ports

Platform ports cover only what a self-hosted server does differently from spoonjoy.app: `AI` (Gemini here; a self-hosted server brings its own model address), `Push` (web push here; a self-hosted server sends directly or through a relay) and `Email` (account mail, captured to the outbox on QA). A self-hosted server runs the same Worker in workerd, so D1, R2, the cook-session Durable Object and `waitUntil` keep their Cloudflare bindings and need no port. Application code takes the ports it uses as arguments and never reads their secrets itself. `cloudflarePlatform(env)` (`~/domains/platform/index.server`) builds them for spoonjoy.app from today's code; a port whose binding or secret is missing throws `PlatformUnavailableError` naming it.

A context may have an `index.server.ts` beside its `index.ts` for server-only exports, imported as `~/domains/<context>/index.server`.

## Platform jobs

The jobs port (`platform/ports/jobs.ts`) runs work on the server after the request that asked for it, so it keeps going when the person closes the page. Define a kind with `defineJob<Payload>("context.name", { maxAttempts })`, register its handler on `jobHandlers` in `workers/app.ts`, and enqueue it with a key that names the work: `jobs.enqueue(kind, payload, { key })`. A key that is waiting, running or done is not enqueued again. Each delivery leases its key before it runs, so one run of a key goes at a time, and a delivery whose key is done is skipped. Queues delivers at least once and a run can die part-way, so a handler must be safe to run again, resuming from what it already saved, and must check its payload. A run that throws is retried after 10 s, doubling up to 15 minutes, until its attempts run out; then its key is freed. On spoonjoy.app `queueJobs(env.JOBS, d1JobKeys(env.DB))` sends jobs on Cloudflare Queues and keeps keys in D1's `PlatformJobKey` table, and the Worker reports a job's last failure to PostHog; tests use `memoryJobs(registry)` and `drain()`. The `JOBS` queue binding arrives with the first job kind, with `max_retries` at least the largest `maxAttempts`; until then enqueueing throws `JobsUnavailableError`.

## The rule, checked

`pnpm lint` runs `scripts/check-domain-boundaries.mjs`, which fails when:

- a context has no `index.ts`, or `app/domains/` holds a folder that is not one of the contexts above (`context-index`, `unknown-context`);
- any app code imports another context's folders instead of its index (`context-internals`);
- a file in a `model/` imports anything but its own context's `model/`, the shared kernel (`~/domains/food-knowledge`) and pure packages: no other app code, no Node or Cloudflare built-ins, React, React Router, Prisma or AI clients (`model-purity`).

Each failure names the file, the import and the fix. Tests are not checked, so a test may reach a context's internals.
