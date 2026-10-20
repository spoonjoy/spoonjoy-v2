import { OURO_PROVENANCE } from "~/lib/ouro-provenance.server";
import { SOURCE_REPOSITORY } from "~/lib/ouro-provenance";

/** A plain-text hello for language models and the agents they drive: what Spoonjoy is, and where to look. */
export function llmsText(origin: string) {
  return `# Spoonjoy

> Spoonjoy is a recipe app for home cooks: recipes as steps you can cook from, cookbooks, a shopping list grouped by aisle, and an API and MCP server for agents. Every control is an Ouro HX component (${OURO_PROVENANCE.ouroTag}), and the code is open: it is the reference for building an app with Ouro HX.

## Try it

- [Test Kitchen](${origin}/test-kitchen): cook a recipe without an account; add ?xray to outline every Ouro HX component with links to its docs and source

## Build with it

- [Source](${SOURCE_REPOSITORY}): React Router 7 on Cloudflare Workers
- [Building with Ouro HX](${SOURCE_REPOSITORY}/blob/main/docs/building-with-ouro-hx.md): how Spoonjoy installs, themes and composes Ouro HX, and what to do when HX lacks a component
- [Ouro HX provenance](${origin}/ouro-provenance.json): the Ouro HX release, and for each page the files it is built from and the HX components they render
- [Ouro HX](https://ourostack.github.io/ouro-ui/): the component library

## Use it from an agent

- [Developers](${origin}/developers): the API, OAuth and MCP in one place
- [API docs](${origin}/api/docs): the REST API reference
- [MCP](${origin}/mcp): connect an agent to a Spoonjoy account
`;
}
