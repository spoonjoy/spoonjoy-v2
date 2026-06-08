# OpenAI Image API Notes

Official sources checked on 2026-06-07:

- `https://developers.openai.com/api/docs/guides/image-generation`
- `https://api.openai.com/v1/images/generations` OpenAPI spec
- `https://api.openai.com/v1/images/edits` OpenAPI spec

Relevant findings:

- Current image generation guide examples decode `result.data[0].b64_json` directly.
- Current image edit guide examples pass binary image file inputs to `client.images.edit`.
- `/images/generations` OpenAPI examples return `data[0].b64_json`.
- `/images/edits` OpenAPI says multipart requests use binary `image` plus prompt; JSON requests use `images` references. This task intentionally uses multipart `File` inputs after Spoonjoy validates source bytes.
- `/images/edits` OpenAPI responses use `ImagesResponse`, same base response family as generation.

Implementation implication:

- Spoonjoy should stop fetching temporary generated image URLs for GPT image responses and should decode/store `b64_json`.
- Spoonjoy should stop passing a stored/source URL string directly as the edit `image`; it should resolve the URL/data/R2 source into validated bytes and construct a `File`.
