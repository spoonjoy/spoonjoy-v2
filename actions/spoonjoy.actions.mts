// Spoonjoy's actions, each declared once with Ouro UI's one action model (ouro-ui-core's defineAction). Every surface
// is generated from these declarations into actions/generated/: the MCP tool, the WebMCP tool, the web control's props
// and component AX entry, and, for spoonjoy-apple, the App Intent, its Button(intent:) and the Reins action.
//
// Change a declaration, then run `pnpm actions:generate` and commit actions/generated/. Never edit a generated file;
// `pnpm actions:check` (CI) fails when one differs from what these declarations generate. Guide:
// https://github.com/ourostack/ouro-ui-core/blob/main/docs/guides/actions.md
import { defineAction, defineActions, field } from "../tools/ouro-actions/ouro-actions.mts";

/** The person's quick add on the shopping list, and the MCP tool agents already call by this name. */
export const addShoppingListItem = defineAction({
  id: "add_shopping_list_item",
  consent: "write",
  label: "Add to list",
  description: "Add an item to your shopping list.",
  agent: "Add or restore one item on the person's shopping list. It adds to the quantity of a matching item still on the list (same ingredient and unit); a removed or cleared matching item comes back at the added quantity, not on top of its old one.",
  input: {
    name: field.string({ label: "Item", description: "What to buy, such as eggs or flour.", arg: true, ask: "What should I add to your shopping list?" }),
    quantity: field.number({ label: "Quantity", description: "How many or how much, as a number above 0. Leave it out when it doesn't matter.", optional: true, min: 0 }),
    unit: field.string({ label: "Unit", description: "The unit for the quantity, such as grams, cups or cans. Leave it out for a plain count.", optional: true }),
    categoryKey: field.string({ label: "Category", description: "Optional. The aisle's category key, such as produce or pantry.", optional: true, protocolOnly: true }),
    iconKey: field.string({ label: "Icon", description: "Optional. The item's icon key, such as wheat or package.", optional: true, protocolOnly: true }),
    idempotencyKey: field.string({ label: "Idempotency key", description: "Optional. Send the same key again when retrying this exact call, such as after a timeout, and the item is added once.", optional: true, protocolOnly: true }),
    ownerEmail: field.string({ label: "Owner", description: "Optional. Whose list, for a local server with no signed-in person; a signed-in caller always acts on their own list.", optional: true, protocolOnly: true }),
  },
  output: {},
  cli: "list add",
});

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

export default defineActions("spoonjoy", [addShoppingListItem, approveAgentConnection], { tool: "spoonjoy" });
