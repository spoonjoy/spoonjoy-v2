# Recipe image provider research and unblock handoff

Date: 2026-06-08

## Context

Spoonjoy recipe and spoon image handling had three linked issues:

- uploaded food photos could display sideways when EXIF orientation was not normalized;
- assigned recipe/spoon images were not reliably generating AI variants;
- recipe placeholders with no uploaded photo could fall back to a corrupted Chef RJ-derived asset.

The upload and duplicate-posting defects have been fixed and merged. Production risotto cleanup is complete: the two duplicate spoons were soft-deleted, the remaining risotto spoon now points at an upright JPEG, temporary repair credentials were revoked, and the recipe has one active cover row.

The remaining blocker is AI stylized variant generation. This is not currently blocked by the recipe/spoon write path; original uploaded images should continue to be usable even when stylization fails.

## Current production blocker

Production Worker diagnostics after the latest image fallback deploy show OpenAI rejecting image generation with:

- `code`: `billing_hard_limit_reached`
- `status`: `400`
- `type`: `billing_limit_user_error`
- example request id: `req_c5d4a653c8084578a60c597b8a8c14d3`

This means the current OpenAI-only stylization path cannot produce variants until billing is unblocked or a second provider is added. Retrying the same code path will not fix it.

## Recommendation

Use Google Gemini 3.1 Flash Image as the immediate secondary provider to unblock production, then run a short visual benchmark against Black Forest Labs FLUX.2 Pro/Max and Gemini 3 Pro Image before deciding the long-term primary.

Why this order:

- Gemini is cheap, supports image editing and multi-turn image workflows, and is likely the smallest implementation delta for the current Cloudflare Worker code.
- Gemini paid tier docs say prompts and responses are not used to improve Google products.
- Black Forest Labs is probably the strongest visual-quality candidate for food-preserving image-to-image edits, but its API is async/polling and should get a terms/privacy check before becoming primary.
- OpenAI should not remain the only image provider. Its current failure mode is an account-level billing hard stop.

Concrete provider default:

```text
Primary now: OpenAI if billing is fixed quickly, otherwise Gemini 3.1 Flash Image
Fallback now: Gemini 3.1 Flash Image
Evaluation candidate: BFL FLUX.2 Pro/Max, Gemini 3 Pro Image, optionally fal for fastest model bakeoff
Lower-cost fallback candidate: Stability image-to-image
```

## Provider comparison

| Provider | Best fit | Strengths | Risks / gaps | Current assessment |
| --- | --- | --- | --- | --- |
| OpenAI GPT Image | Lowest code change if billing is fixed | Already integrated; strong error metadata; current docs list GPT Image 2 with image edit support | Account billing cap is blocking production; code does not yet use `gpt-image-2`; OpenAI-only is a single point of failure | Keep, but never as the only provider |
| Google Gemini 3.1 Flash Image | Immediate unblock and fallback | Current high-efficiency Gemini image model; image generation/editing; multi-turn editing; paid tier docs say no product-improvement use; about `$0.067` per 1K image on standard paid tier | Need prompt/output QA on actual Spoonjoy food photos | Recommended immediate secondary provider |
| Google Gemini 3 Pro Image | Premium Gemini eval candidate | Native image generation/editing with stronger contextual understanding; about `$0.134` per 1K/2K image on standard paid tier | Higher cost; may be unnecessary if Flash quality is good enough | Benchmark against BFL for final primary choice |
| Black Forest Labs FLUX.2 / Kontext | Likely best image-to-image quality | Built for reference-image edits, identity/style preservation, production-grade visual edits | Async polling; signed result URLs; terms/privacy check still required | Recommended visual-quality benchmark and likely long-term primary if it wins |
| fal | Fast evaluation layer | Easy access to multiple models; good queue/result APIs; usage analytics/pricing APIs | Adds aggregator dependency instead of direct provider relationship | Good for bakeoff or fallback abstraction, less ideal as only primary |
| Stability | Cost-sensitive fallback | Mature image APIs; low per-image pricing; failed generations not charged | Less obviously tailored to food-preserving editorial redraws than FLUX/Gemini/OpenAI | Candidate fallback after visual eval |

## Concrete unblock plan

### Phase 0: keep user flows non-blocking

- Recipe and spoon create/update must save the original uploaded image even when stylization fails.
- The UI should show upload progress, disable submit while upload is in flight, and avoid duplicate posts.
- GIF uploads should remain unsupported.
- EXIF orientation should be normalized before storage so originals and AI inputs are upright.

### Phase 1: provider registry and fallback

Add a small sync provider registry around the existing image generation runner. The first implementation should support OpenAI and Gemini because both can return image bytes/URLs within the current request/background-task shape:

```text
IMAGE_PROVIDER_PRIMARY=openai|gemini
IMAGE_PROVIDER_FALLBACKS=gemini,openai
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_TIMEOUT_MS=30000
```

BFL, fal, and Stability remain benchmark/future provider candidates. BFL in particular should not be treated as a simple synchronous fallback because its API uses request creation, polling, and expiring signed result URLs; it needs durable async job state before production use.

Fallback rules:

- fall back on billing/quota/rate-limit/auth/provider-5xx failures;
- do not fall back on image-policy violations, invalid image input, unsupported MIME, or user-correctable validation errors;
- persist provider, model, request id, error code, and retryability for every failure;
- return the original image URL plus a visible "variant pending/failed" state instead of hiding the image.

### Phase 2: notifications and canary

Use PostHog for alerting rather than building a custom email notification system.

Required events/properties:

```text
image_variant_generation_failed
provider
model
status
code
type
request_id
recipe_id
spoon_id
chef_id
retryable
fallback_attempted
fallback_provider
```

Add a daily canary that generates a disposable tiny test variant and alerts when all providers fail or when the primary provider returns a hard-limit/billing/quota error. This catches account/provider failures before a real user discovers them.

### Phase 3: benchmark and choose long-term primary

Run the same Spoonjoy redraw prompt against 6-10 real food photos:

- risotto-style plated dish;
- tall/portrait phone image;
- landscape phone image;
- dim restaurant lighting;
- cluttered table background;
- no-photo placeholder path;
- one intentionally unsupported GIF.

Score outputs on:

- dish identity preservation;
- appetizing realism;
- no ingredient hallucination;
- orientation correctness;
- latency;
- cost;
- error metadata;
- privacy/terms acceptability.

If BFL clearly wins visually and terms are acceptable, make BFL primary and keep Gemini/OpenAI as fallback. If Gemini 3.1 Flash Image is visually good enough, keep Gemini primary for cost and operational simplicity; use Gemini 3 Pro Image only for premium fallback or difficult redraws.

## UX and prompt

The intended UX remains:

- user uploads or assigns a real food photo;
- original image appears immediately when upload succeeds;
- submit is disabled while the upload is still in progress;
- Spoonjoy generates an AI-stylized variant in the background or inline depending on route;
- if stylization fails, user still sees the original image and Spoonjoy records/alerts the failure.

The prompt should be treated as a controlled Spoonjoy system asset, not ad hoc UI text. It should preserve the actual dish and improve only presentation/style:

```text
Create an appetizing editorial food photograph based on the provided dish image. Preserve the actual dish, ingredients, plating, orientation, and overall composition. Improve lighting, color, texture, and background polish so it feels natural, warm, and realistic for a recipe app. Do not add text, logos, utensils, hands, new ingredients, or fantasy elements. Do not crop out the main dish.
```

## MCP / connector support

Image uploads through MCP/connector flows are in scope. The API and MCP paths should share the same image pipeline as the web UI:

- accept only supported image MIME types, not GIF;
- normalize orientation;
- store the original image in R2;
- attach the image to the recipe/spoon;
- enqueue or run stylization with provider fallback;
- return enough status for the client/agent to know whether a variant is ready, pending, or failed.

## Testing and validation checklist

- Unit test MIME validation, including GIF rejection.
- Unit test EXIF orientation normalization using a sideways JPEG fixture.
- Unit test provider fallback on `billing_hard_limit_reached`, quota, rate limit, auth, and 5xx errors.
- Unit test no fallback on invalid image input and policy/moderation failures.
- Integration test recipe image assignment produces an original cover even when stylization fails.
- Integration test spoon image assignment produces an original cover even when stylization fails.
- Browser/e2e test upload progress and disabled submit on recipe form and spoon form.
- Browser/e2e test duplicate submit prevention.
- API/MCP test image assignment uses the same pipeline and returns cover/variant status.
- Production canary test verifies at least one provider can generate a variant.
- PostHog alert test verifies provider failure events include email-notifiable properties.

## Sources

- OpenAI image generation docs: https://developers.openai.com/api/docs/guides/image-generation
- Google Gemini image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Google Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Black Forest Labs pricing: https://docs.us.bfl.ai/quick_start/pricing
- Black Forest Labs Kontext overview: https://docs.bfl.ai/kontext/kontext_overview
- Black Forest Labs FLUX.2 image editing docs: https://docs.bfl.ai/flux_2/flux2_image_editing
- fal model API pricing docs: https://fal.ai/docs/documentation/model-apis/pricing
- fal FLUX Kontext API docs: https://fal.ai/models/fal-ai/flux-pro/kontext/api
- Stability pricing: https://platform.stability.ai/pricing
- Stability API reference: https://platform.stability.ai/docs/api-reference
