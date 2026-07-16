# Dependency Advisory Policy

Spoonjoy web CI runs OSV-Scanner against `pnpm-lock.yaml` on every push and pull request.

## Scanner Pin

- Scanner: OSV-Scanner `v2.3.8`
- Release tag ref: `408fcd6f8707999a29e7ba45e15809764cf24f67`
- Linux amd64 binary SHA-256: `bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc`
- Official docs used for this gate:
  - `https://google.github.io/osv-scanner/supported-languages-and-lockfiles/`
  - `https://google.github.io/osv-scanner/usage/`
  - `https://google.github.io/osv-scanner/output/`
  - `https://google.github.io/osv-scanner/configuration/`

## Severity Policy

Every OSV vulnerability reported from `pnpm-lock.yaml` is actionable by default, including unknown-severity findings. The gate records OSV severity metadata when present, but it does not downgrade or ignore a finding based on severity.

The advisory job fails closed when:

- the scanner cannot run, cannot reach OSV, returns a scanner/error exit, or writes malformed JSON
- OSV reports any unallowlisted vulnerability in `pnpm-lock.yaml`
- the allowlist file is missing, malformed, broad, or expired

## Allowlist Policy

Temporary exceptions live in `security/advisory-allowlist.json`. Each entry must include:

- `id`: OSV/GHSA/CVE identifier to allow
- `packageName`: exact package name from the OSV result
- `version`: exact package version from the OSV result
- `ecosystem`: exact ecosystem, such as `npm`
- `reason`: human-readable review rationale
- `expiresOn`: future date in `YYYY-MM-DD` format

Expired entries fail before the scanner runs. Broad package or package-version overrides are not allowed for this web gate.
