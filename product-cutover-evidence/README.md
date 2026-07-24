# Product Cutover Evidence Inputs

This directory contains reviewed, source-controlled authorization inputs for product repairs. Runtime output artifacts do not belong here.

- `product-skew-receipts/<environment>-from-<lineage-parent-source-sha>.json` authorizes an ordinary forward repair.
- `product-skew-receipts/executed-<receipt-sha256>.json` is an immutable, fully materialized executed skew receipt referenced by byte-identical reuse evidence.
- `product-repair-approvals/<environment>-from-<lineage-parent-source-sha>.json` authorizes a post-restoration product repair and embeds its skew receipt.
- `product-repair-chain/<environment>.json` freezes `runtimeFloorSourceSha`, `originalFailedRestorationSourceSha`, and the latest failed repair artifact for a cross-run post-restoration chain.

Every file is validated against its exact schema and source/environment binding before any D1 or Worker mutation. Initial activation and same-target reconciliation require no file here. Do not copy `qa-product-release.json`, `production-release.json`, or `production-product-cutover-state.json` into this directory.

The source-controlled forward receipt or approval is keyed by the already-known lineage parent. Its candidate source and candidate manifest merge/tree fields use the literal `candidate`, which the gate resolves only to the exact checked-out target SHA and tree before reading blobs or running builds. This avoids an impossible self-reference to the commit that contains the authorization file. After that candidate has executed, any receipt retained for later digest reuse must be materialized with its exact 40-hex source and tree; executed receipt loading rejects the `candidate` token.

Each skew manifest binds an exact Git merge/tree/blob, source SHA-256, allowlisted deterministic build command, and that builder's output digest. An executed receipt also records the two cross-build SHA-256 values and the gate rebuilds all six combinations: each source's native Worker/DO pair plus candidate Worker/predecessor DO and predecessor Worker/candidate DO. The cutover source record independently binds the Wrangler/Cloudflare deployable module-set digests. Both proofs must pass; a source-level builder digest is not substituted for live deployed-runtime attestation.

For post-restoration work, the checked-in `product-repair-chain/<environment>.json` is authoritative whenever it exists. Local workflow output is only a same-run recovery fallback and cannot override reviewed chain state.
