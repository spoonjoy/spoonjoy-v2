import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { captureEvent, resolvePostHogServerConfig, type PostHogServerEnv } from "~/lib/analytics-server";

// Account mail (verification links, email-change confirmations and notices, password resets).
//
// Delivery modes, chosen per environment:
// - "send": Cloudflare Email Service through the Worker's `send_email` binding named EMAIL, from
//   SPOONJOY_EMAIL_FROM. Used when both are configured.
// - "capture": SPOONJOY_EMAIL_MODE=capture writes each message to the EmailOutbox table instead of
//   sending it. QA uses this so journeys and proofs can follow links without a mailbox.
// - "disabled": neither is configured. Features that need mail say so instead of pretending.

export type EmailPurpose =
  | "verify_email"
  | "change_email_confirm"
  | "change_email_notice"
  | "email_changed_notice"
  | "reset_password";

/** The Cloudflare Email Service binding's send call (the subset Spoonjoy uses). */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

export type TransactionalEmailEnv = PostHogServerEnv & {
  EMAIL?: SendEmailBinding | unknown;
  SPOONJOY_EMAIL_FROM?: string;
  SPOONJOY_EMAIL_MODE?: string;
  SPOONJOY_BASE_URL?: string;
};

// Capture mode stores account mail, including its sign-in links, in a table anyone with database
// access can read, so it runs only where the site is a QA stack (shared QA or a per-run Journeys
// stack) or a local host. Anywhere else, including production with the variable set by mistake or
// with no SPOONJOY_BASE_URL at all, mail is disabled instead.
const CAPTURE_HOST = /^(spoonjoy-v2-qa(-run-[a-z0-9-]+)?\.mendelow-studio\.workers\.dev|localhost|127\.0\.0\.1)$/;
// Captured QA mail is only read by tests moments after it is sent.
const CAPTURED_EMAIL_RETENTION_MS = 24 * 60 * 60 * 1000;

function isCaptureSite(baseUrl: string | undefined): boolean {
  return Boolean(baseUrl) && URL.canParse(baseUrl!) && CAPTURE_HOST.test(new URL(baseUrl!).hostname);
}

export type EmailDeliveryMode = "send" | "capture" | "disabled";

export interface TransactionalEmail {
  to: string;
  purpose: EmailPurpose;
  subject: string;
  text: string;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

function hasSendBinding(value: unknown): value is SendEmailBinding {
  return Boolean(value) && typeof (value as { send?: unknown }).send === "function";
}

export function resolveEmailDeliveryMode(env?: TransactionalEmailEnv | null): EmailDeliveryMode {
  if (env?.SPOONJOY_EMAIL_MODE?.trim().toLowerCase() === "capture") {
    return isCaptureSite(env.SPOONJOY_BASE_URL) ? "capture" : "disabled";
  }
  if (hasSendBinding(env?.EMAIL) && env?.SPOONJOY_EMAIL_FROM?.trim()) return "send";
  return "disabled";
}

/** True when Spoonjoy can send account mail in this environment. */
export function canSendAccountEmail(env?: TransactionalEmailEnv | null): boolean {
  return resolveEmailDeliveryMode(env) !== "disabled";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain text is the source of truth. The HTML part is the same text with paragraphs and links,
// so the two can never say different things.
export function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => {
    const escaped = escapeHtml(paragraph).replace(/\n/g, "<br>");
    const linked = escaped.replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
    return `<p>${linked}</p>`;
  });
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:#1f1b16">${paragraphs.join("")}</div>`;
}

/**
 * Sends (or, on QA, captures) one account email. Throws EmailDeliveryError when mail is disabled
 * or the provider refuses it, so callers decide what the user is told.
 */
export async function sendTransactionalEmail(
  db: PrismaClientType,
  env: TransactionalEmailEnv | null | undefined,
  email: TransactionalEmail,
): Promise<void> {
  const mode = resolveEmailDeliveryMode(env);
  if (mode === "disabled") {
    throw new EmailDeliveryError("Account email is not configured in this environment");
  }

  if (mode === "capture") {
    await db.emailOutbox.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - CAPTURED_EMAIL_RETENTION_MS) } } });
    await db.emailOutbox.create({
      data: { toAddress: email.to, purpose: email.purpose, subject: email.subject, textBody: email.text },
    });
    return;
  }

  try {
    await (env!.EMAIL as SendEmailBinding).send({
      to: email.to,
      from: env!.SPOONJOY_EMAIL_FROM!.trim(),
      subject: email.subject,
      text: email.text,
      html: textToHtml(email.text),
    });
  } catch (error) {
    // The provider's message can include the address; keep it out of logs, telemetry and responses.
    // Callers turn this into a "couldn't send" answer, so this is where a refused send is recorded.
    await captureEvent(resolvePostHogServerConfig(env!), {
      event: "spoonjoy.email.delivery_failed",
      distinctId: "system",
      properties: { purpose: email.purpose, error_name: error instanceof Error ? error.name : typeof error },
    });
    throw new EmailDeliveryError(
      `Email provider refused the ${email.purpose} message${error instanceof Error ? ` (${error.name})` : ""}`,
    );
  }
}
