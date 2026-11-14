# Vendored: Ouro UI's action generator

`ouro-actions.mts` and `actions.claims.json` are copied unchanged from [ouro-ui-core v0.10.0](https://github.com/ourostack/ouro-ui-core/releases/tag/v0.10.0). Their SHA-256 hashes are in that release's `dist-manifest.json`, and `test/lib/mcp/declared-actions.server.test.ts` checks them:

| File | SHA-256 |
| --- | --- |
| `ouro-actions.mts` | `e343d27993276dbd4bbd9a5351f1c3935eebd8db19039d37671a774d8dbefa84` |
| `actions.claims.json` | `944f48be5f9409dd70e0774dfe4976fef9cc3ba3f4ab4b9231df428700523f1a` |

Never edit them. To upgrade, download a newer release's files (`gh release download vX.Y.Z --repo ourostack/ouro-ui-core --pattern ouro-actions.mts --pattern actions.claims.json`), update the hashes here and in the test, and run `pnpm actions:generate`. Anything the generator can't do yet goes back to ouro-ui-core as a pull request with a test. The guide is [docs/guides/actions.md](https://github.com/ourostack/ouro-ui-core/blob/main/docs/guides/actions.md) there.
