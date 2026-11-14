// Spoonjoy's actions, each declared once with Ouro UI's one action model (ouro-ui-core's defineAction). Every surface
// is generated from these declarations into actions/generated/: the MCP tool, the WebMCP tool, the web control's props
// and component AX entry, and, for spoonjoy-apple, the App Intent, its Button(intent:) and the Reins action.
//
// Change a declaration, then run `pnpm actions:generate` and commit actions/generated/. Never edit a generated file;
// `pnpm actions:check` (CI) fails when one differs from what these declarations generate. Guide:
// https://github.com/ourostack/ouro-ui-core/blob/main/docs/guides/actions.md
//
// Each area's actions live in their own file beside this one; this file gathers them into the set.
import { defineAction, defineActions, field } from "../tools/ouro-actions/ouro-actions.mts";
import { access } from "./access.mts";
import { cookbooks } from "./cookbooks.mts";
import { covers } from "./covers.mts";
import { recipes } from "./recipes.mts";
import { shopping } from "./shopping.mts";
import { spoons } from "./spoons.mts";

/**
 * Person-only: approving an agent's connection request. An agent starts the request (start_agent_connection) and
 * waits (poll_agent_connection); only the person may approve it, on its page with the code their agent shows them. An
 * agent that could approve its own request would grant itself the person's account.
 */
export const approveAgentConnection = defineAction({
  id: "approve_agent_connection",
  consent: "person-only",
  label: "Approve access",
  description: "Let this agent, app or device use your Spoonjoy account.",
  agent: "Approve a pending agent connection request, which gives that client access to the person's Spoonjoy account.",
  input: {
    requestId: field.string({ label: "Request", description: "The connection request's id, from start_agent_connection.", arg: true }),
  },
  output: {},
  personOnly: {
    reason: "You can't approve access to the person's Spoonjoy account; only they can.",
    how: "with Approve access on the connection page, after typing the code you showed them",
  },
  cli: "connection approve",
});

export default defineActions("spoonjoy", [...access, ...recipes, ...shopping, ...cookbooks, ...spoons, ...covers, approveAgentConnection], { tool: "spoonjoy" });
