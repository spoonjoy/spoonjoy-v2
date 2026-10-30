import { OURO_PROVENANCE } from "~/lib/ouro-provenance.server";
import { SOURCE_REPOSITORY } from "~/lib/ouro-provenance";

/** A plain-text hello for language models and the agents they drive: what Spoonjoy is, and where to look. */
export function llmsText(origin: string) {
  return `# Spoonjoy

> Spoonjoy is a recipe app for home cooks: recipes as steps you can cook from, cookbooks, a shopping list grouped by aisle, and an API and MCP server for agents. Its screens are built from Ouro HX components (${OURO_PROVENANCE.ouroTag}), and the code is open: it is the reference for building an app with Ouro HX.

## Try it

- [Test Kitchen](${origin}/test-kitchen): cook a recipe without an account, and add ?xray to outline the Ouro HX components on the page, with links to their docs and source

## Build with it

- [Source](${SOURCE_REPOSITORY}): React Router on Cloudflare Workers
- [Building with Ouro HX](${SOURCE_REPOSITORY}/blob/main/docs/building-with-ouro-hx.md): how Spoonjoy installs, themes and composes Ouro HX, and what to do when HX lacks a component
- [Ouro HX provenance](${origin}/ouro-provenance.json): the Ouro HX release and, page by page, the files a page is built from and the HX components they render
- [Ouro HX](https://ui.ouro.bot/): the component library

## Use it from an agent

- [Developers](${origin}/developers): the API, OAuth and MCP in one place
- [API docs](${origin}/api/docs): the REST API reference
- [MCP](${origin}/mcp): connect an agent to a Spoonjoy account
`;
}
