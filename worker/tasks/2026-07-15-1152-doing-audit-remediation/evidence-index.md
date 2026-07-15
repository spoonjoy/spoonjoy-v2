# Spoonjoy Audit Remediation Evidence Index

Raw logs, screenshots, databases, environment backups, and generated validation output must not be committed here. Record only stable CI/deployment/TestFlight URLs, source SHAs, checksums, redacted summaries, and references to ignored or external evidence.

## Entries

### Unit 0 - Rebaseline And Inventory

- Web audited/current remote SHA: `b22c5fece92886a03747ccc5e05e525c4b97be55`.
- Native audited/current remote SHA: `bad81b49a07c006814315a56e4c98311693a7256`.
- Web remediation branch at inventory: `54938c0cd99aeabe37134dd4833efaef2084467a`, containing documentation-only commits on the current remote head.
- Native remediation branch at inventory: current remote head with no drift.
- Known-good rollback states: web `b22c5fec`; TestFlight build 35 from native `bad81b49`.
- The canonical local `main` checkouts are stale but clean and are not implementation inputs.
- `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback` was recreated and advanced by concurrent work during inventory. It is active/ambiguously owned and excluded from cleanup.
- Redacted Gitleaks 8.30.1 current-tree scan: web 29 findings across 19 paths; native 6 findings across 2 paths. Native findings are confined to generated task logs. Web findings are example/test signatures plus generated task evidence. No current-tree value was confirmed live; raw redacted reports remain under `/tmp/spoonjoy-*-current-gitleaks.json` and are not committed.
- Tracked web SQLite fixture SHA-256: `6fb7063662686cc32ded5d5c60a504644edfe2c1959ee97a2dbead8e68d459c7`; it contains five users, zero user credentials, two OAuth rows, eight recipes, and six cookbooks. It is classified local fixture data for removal, not production state.
- Web removal manifest: 944 paths / 59,779,612 bytes at `/tmp/spoonjoy-web-removal-candidates.txt`.
- Native removal manifest: 4,074 paths / 309,404,845 bytes at `/tmp/spoonjoy-native-removal-candidates.txt`.
- Removal classification: generated non-Markdown evidence under agent task roots, tracked local database, `.progress`, and top-level validation/deploy artifacts are `remove`; durable Markdown, `.gitkeep`, app assets, and deliberate test fixtures are `preserve`; any path whose ownership changes before cleanup is `human-review`.
- Human-only initiation: Clem credential retirement awaits Clem's provider/recovery verification; clean Apple callback registration awaits deployed dual support; no live-secret rotation is currently triggered; production owner smoke awaits final web SHA; installed TestFlight dogfood awaits the final candidate and physical-device access.
- Rollback compatibility: migrations in this run must remain additive; artifact and local OAuth cleanup require manifest/snapshot recovery; native rollback keeps build 35 available and uses forward-fix builds.
