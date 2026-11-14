// Spoonjoy's health, sign-in and API token actions, each declared once with Ouro UI's action model. The MCP tools keep
// the names and inputs agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { ownerEmail } from "./fields.mts";

const baseUrl = field.string({ label: "Server", description: "The Spoonjoy server's URL, when it isn't the default.", optional: true, protocolOnly: true });

export const health = defineAction({
  id: "health",
  consent: "read",
  label: "Health check",
  description: "Check that Spoonjoy is up.",
  agent: "Check Spoonjoy API readiness and whether the caller can use owner-scoped write operations.",
  input: {},
  output: {},
});

export const authStatus = defineAction({
  id: "auth_status",
  consent: "read",
  label: "Authentication status",
  description: "See whether this agent is connected to your Spoonjoy account.",
  agent: "Report the current Spoonjoy MCP authentication state and how an agent should obtain delegated access without asking for raw user credentials.",
  input: {},
  output: {},
});

export const startAgentConnection = defineAction({
  id: "start_agent_connection",
  consent: "write",
  label: "Start delegated connection",
  description: "Ask to connect this agent to your Spoonjoy account.",
  agent: "Start a browser-approved delegated Spoonjoy connection for this agent. Show the user authorizationUrl and, separately, userCode: they open the link, sign in and type the code to approve. Then poll with deviceCode. Grants kitchen and shopping-list scopes only, never account access.",
  input: {
    agentName: field.string({ label: "Agent", description: "The agent's name, shown to the person when they approve.", optional: true }),
    baseUrl,
    scopes: field.string({ label: "Scopes", description: "The scopes to ask for, separated by spaces or commas.", optional: true }),
  },
  output: {},
});

export const pollAgentConnection = defineAction({
  id: "poll_agent_connection",
  consent: "write",
  label: "Poll delegated connection",
  description: "Check whether you approved this agent's connection.",
  agent: "Poll a pending delegated Spoonjoy connection. When approved, the Spoonjoy MCP bridge activates and caches access; never ask for a Spoonjoy password.",
  input: {
    deviceCode: field.string({ label: "Code", description: "The deviceCode from start_agent_connection.", protocolOnly: true }),
    tokenName: field.string({ label: "Token name", description: "The name to give the token once approved.", optional: true }),
    baseUrl,
  },
  output: {},
});

export const createApiToken = defineAction({
  id: "create_api_token",
  // A write, as its MCP tool always was: the token is the caller's own, scoped by them, and shown once.
  consent: "write",
  label: "Create API token",
  description: "Make a token a program can use with your kitchen.",
  agent: "Create an owner-scoped Spoonjoy API token. The token is returned once and is stored hashed.",
  input: {
    ownerEmail,
    name: field.string({ label: "Name", description: "What the token is for.", optional: true }),
    scopes: field.oneOf({
      label: "Scopes",
      description: "The token's scopes, as one string separated by spaces or commas, or as a list.",
      optional: true,
      protocolOnly: true,
      options: [
        field.string({ label: "Scopes", description: "The scopes, separated by spaces or commas." }),
        field.list({ label: "Scopes", description: "The scopes, one per item.", of: field.string({ label: "Scope", description: "One scope, such as recipes:read." }) }),
      ],
    }),
    expiresInDays: field.oneOf({
      label: "Expires in",
      description: "Days until the token expires, 1 to 365. Defaults to 90. Pass null or \"never\" for a token that never expires.",
      optional: true,
      nullable: true,
      protocolOnly: true,
      options: [
        field.integer({ label: "Days", description: "Days until it expires, 1 to 365.", min: 1, max: 365 }),
        field.enum({ label: "Never", description: "A token that never expires.", values: ["never"] }),
      ],
    }),
  },
  output: {},
});

export const listApiTokens = defineAction({
  id: "list_api_tokens",
  consent: "read",
  label: "List API tokens",
  description: "See the tokens programs use with your kitchen.",
  agent: "List API token metadata for the configured owner. Token secrets are never returned.",
  input: { ownerEmail },
  output: {},
});

export const revokeApiToken = defineAction({
  id: "revoke_api_token",
  consent: "consequential",
  label: "Revoke API token",
  description: "Stop a token from working.",
  agent: "Revoke one API token owned by the configured owner.",
  input: {
    ownerEmail,
    credentialId: field.string({ label: "Token", description: "The token's credentialId, from list_api_tokens." }),
  },
  output: {},
  idempotent: true,
});

export const access = [health, authStatus, startAgentConnection, pollAgentConnection, createApiToken, listApiTokens, revokeApiToken];
