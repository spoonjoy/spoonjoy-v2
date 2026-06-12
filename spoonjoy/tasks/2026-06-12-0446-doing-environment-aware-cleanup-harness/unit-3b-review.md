Reviewer: Tesla (`019ebc0f-ca3d-74e1-a998-d4f4ad987a6b`)

Verdict: FINDINGS

- BLOCKER: `disposable_credentials` was populated twice into a `PRIMARY KEY` table, which would fail if matching credentials existed.
- MAJOR: `NotificationEvent.payload` blockers only checked `LIMIT 1` from each target set and omitted disposable user IDs.
- MAJOR: cover rows were deleted before `SearchDocument.imageUrl` cleanup read them; search cleanup also omitted `href` and spoon/cover `entityId` cases.
- MINOR: blocker abort used malformed `json_extract`; it aborts before mutation, but operator output is generic unless blocker rows are selected first.

Resolution:
- Fix in Unit 4b implementation pass before QA R2 apply is enabled.
