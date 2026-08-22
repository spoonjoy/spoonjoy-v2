# Unit 0 production red evidence

Observed at `2026-08-22T01:49:10Z` against canonical `https://spoonjoy.app` in a disposable Chromium context.

- The page was controlled by live `/sw.js`.
- The rendered Apple control was one GET form targeting same-origin `/auth/apple`.
- Clicking it stayed on `/login` and emitted a pre-handoff `form-action` violation for the `/login` document.
- Chromium reported the blocked origin as `https://spoonjoy.app`, the rendered form action origin—not Apple's origin. This falsifies the approved blocked-origin criterion.
- In the same context, direct document navigation to `/auth/apple` reached `appleid.apple.com/auth/authorize` with client `app.spoonjoy.client`, the registered Spoonjoy callback, and `form_post`.
- Canonical and Worker health agreed on source `851d9566c955d8db4bcead1b44300ed279b9d5f2` and Worker version `61caff11-8e88-4337-ad14-39f610fa89fe`.
- Live and source-tree `/sw.js` SHA-256 both equal `de4541deef70d177ec02bd05ecae5e79eb02e6c87a65dd8041f3ac58e1a39d63`.
- Fix #297 (`86c58120`) is an ancestor of the observed production source.

No provider credentials, OAuth state, PKCE values, cookies, full authorization URL, or provider page content were persisted.
