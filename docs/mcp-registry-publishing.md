# Publishing Spoonjoy to the official MCP Registry

The [official MCP Registry](https://registry.modelcontextprotocol.io) is the
canonical metadata repository for public MCP servers (backed by Anthropic,
GitHub, Microsoft, PulseMCP). Publishing here is the cheapest win: many
third-party directories (Glama, Smithery, PulseMCP, mcp.so) federate from it, so
one listing propagates widely. There is no human review.

Our connector is a remote Streamable-HTTP MCP server at `https://spoonjoy.app/mcp`
(OAuth 2.1 + dynamic client registration). The registry entry is
[`server.json`](../server.json) at the repo root.

We publish under the **`app.spoonjoy`** namespace (the reverse-DNS of
`spoonjoy.app`), which requires proving control of the domain via a DNS TXT
record. The namespace + identity were chosen deliberately — see the project
memory and `server.json`.

---

## One-time: what Ari must do

These steps need credentials / DNS access that the build can't perform.

### 1. Install the publisher CLI

```bash
# macOS (Homebrew)
brew install mcp-publisher
# or build from source: https://github.com/modelcontextprotocol/registry
```

### 2. Generate a signing keypair

```bash
openssl genpkey -algorithm ed25519 -out mcp-registry-key.pem
# Derive the PUBLIC key for the DNS record:
openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | xxd -p -c 64
```

The last command prints the 64-hex-char Ed25519 public key used below.

### 3. Add the DNS TXT record (apex of spoonjoy.app)

Add a TXT record at the **apex** of `spoonjoy.app` (host `@`, **not** a
subdomain/selector):

```
spoonjoy.app.  IN  TXT  "v=MCPv1; k=ed25519; p=<PUBLIC_KEY_HEX_FROM_STEP_2>"
```

Wait for it to propagate (`dig +short TXT spoonjoy.app` should show it). Remove
any stale `v=MCPv1` records to avoid verification failures.

### 4. Authenticate + publish

```bash
PRIVATE_KEY="$(openssl pkey -in mcp-registry-key.pem -noout -text \
  | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"

mcp-publisher login dns --domain spoonjoy.app --private-key "${PRIVATE_KEY}"
mcp-publisher publish        # reads ./server.json
```

`publish` validates `server.json` against the schema and confirms the remote at
`https://spoonjoy.app/mcp` is reachable, then lists `app.spoonjoy/spoonjoy`.

### 5. Verify

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=spoonjoy" | jq .
```

---

## Keeping it current

- `server.json` is validated in CI by `test/server-json.test.ts` (name namespace,
  remote URL, schema, version shape).
- Bump `version` in `server.json` when the connector's capabilities change, then
  re-run `mcp-publisher publish`.
- Do **not** change the remote URL or namespace without re-running DNS auth.
