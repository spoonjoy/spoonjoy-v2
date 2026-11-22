// The platform ports: the services where a self-hosted server differs from spoonjoy.app. A self-hosted server runs
// the same Worker in workerd, so D1, R2, the cook-session Durable Object and waitUntil keep their Cloudflare
// bindings (app/cloudflare-env.d.ts) and need no port. AI, push and email do differ: a self-hosted server brings its
// own model address, sends push directly or through a relay, and has its own mail. Cloudflare adapters
// (../adapters/cloudflare.server.ts) serve spoonjoy.app; a self-hosted server adds its own behind these interfaces.
// Application code takes the ports it uses as arguments; it never reads their env or secrets itself.
import type { NotificationPayload, PushSubscriptionRecord, SendPushResult } from "~/lib/web-push.server";
import type { TransactionalEmail } from "~/lib/transactional-email.server";

/** Notifications to a person's devices: web push on Cloudflare. */
export interface Push {
  web(subscription: PushSubscriptionRecord, payload: NotificationPayload): Promise<SendPushResult>;
}

export interface GenerateJsonInput {
  systemPrompt: string;
  userText: string;
  /** Names the answer's shape for providers that ask for one. */
  schemaName: string;
  /** A JSON Schema both providers read: type, properties, required, items and enum. */
  responseSchema: Record<string, unknown>;
  maxOutputTokens?: number;
}

/**
 * A model that answers in JSON shaped by a schema: on spoonjoy.app OpenAI, then Gemini; a self-hosted server can
 * point it at any OpenAI-compatible address. Returns the raw JSON text, which the caller parses and validates.
 */
export interface AI {
  generateJson(input: GenerateJsonInput): Promise<string>;
}

/** Account email: sent, or captured to the outbox on QA. */
export interface Email {
  send(email: TransactionalEmail): Promise<void>;
}

export interface Platform {
  push: Push;
  ai: AI;
  email: Email;
}

export type PortName = keyof Platform;

/** A port whose binding or secret this environment lacks. */
export class PlatformUnavailableError extends Error {
  readonly port: PortName;

  constructor(port: PortName, missing: string) {
    super(`The ${port} port is not available here: ${missing} is not configured.`);
    this.name = "PlatformUnavailableError";
    this.port = port;
  }
}
