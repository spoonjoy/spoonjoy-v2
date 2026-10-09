import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import {
  EmailDeliveryError,
  canSendAccountEmail,
  resolveEmailDeliveryMode,
  sendTransactionalEmail,
  textToHtml,
} from "~/lib/transactional-email.server";

const message = {
  to: "codex_e2e_mail@example.com",
  purpose: "verify_email" as const,
  subject: "Confirm your email for Spoonjoy",
  text: "Hi chef,\n\nConfirm your address:\nhttps://spoonjoy.app/verify-email?token=abc&x=1\n\nThanks",
};

describe("transactional-email.server", () => {
  afterEach(async () => {
    await db.emailOutbox.deleteMany({ where: { toAddress: message.to } });
  });

  it("chooses capture, send or disabled from the environment", () => {
    const binding = { send: vi.fn() };
    expect(resolveEmailDeliveryMode(undefined)).toBe("disabled");
    expect(resolveEmailDeliveryMode(null)).toBe("disabled");
    expect(resolveEmailDeliveryMode({})).toBe("disabled");
    expect(resolveEmailDeliveryMode({ EMAIL: binding })).toBe("disabled");
    expect(resolveEmailDeliveryMode({ EMAIL: binding, SPOONJOY_EMAIL_FROM: "  " })).toBe("disabled");
    expect(resolveEmailDeliveryMode({ EMAIL: {}, SPOONJOY_EMAIL_FROM: "chef@spoonjoy.app" })).toBe("disabled");
    expect(resolveEmailDeliveryMode({ EMAIL: binding, SPOONJOY_EMAIL_FROM: "chef@spoonjoy.app" })).toBe("send");
    expect(resolveEmailDeliveryMode({ SPOONJOY_EMAIL_MODE: " Capture " })).toBe("capture");
    expect(resolveEmailDeliveryMode({ SPOONJOY_EMAIL_MODE: "send" })).toBe("disabled");
    expect(canSendAccountEmail({})).toBe(false);
    expect(canSendAccountEmail({ SPOONJOY_EMAIL_MODE: "capture" })).toBe(true);
  });

  it("refuses to pretend when mail is not configured", async () => {
    await expect(sendTransactionalEmail(db, {}, message)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(await db.emailOutbox.count({ where: { toAddress: message.to } })).toBe(0);
  });

  it("captures the message in the outbox on QA instead of sending it", async () => {
    await sendTransactionalEmail(db, { SPOONJOY_EMAIL_MODE: "capture" }, message);

    const rows = await db.emailOutbox.findMany({ where: { toAddress: message.to } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "verify_email", subject: message.subject, textBody: message.text });
  });

  it("sends text and matching HTML through the Cloudflare binding from the configured address", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "m1" });

    await sendTransactionalEmail(db, { EMAIL: { send }, SPOONJOY_EMAIL_FROM: " Spoonjoy <hello@spoonjoy.app> " }, message);

    expect(send).toHaveBeenCalledWith({
      to: message.to,
      from: "Spoonjoy <hello@spoonjoy.app>",
      subject: message.subject,
      text: message.text,
      html: textToHtml(message.text),
    });
    expect(await db.emailOutbox.count({ where: { toAddress: message.to } })).toBe(0);
  });

  it("reports a provider refusal without echoing the provider's message", async () => {
    const env = { EMAIL: { send: vi.fn().mockRejectedValue(new TypeError(`bad recipient ${message.to}`)) }, SPOONJOY_EMAIL_FROM: "hello@spoonjoy.app" };
    const error = await sendTransactionalEmail(db, env, message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).message).toBe("Email provider refused the verify_email message (TypeError)");

    const nonError = { EMAIL: { send: vi.fn().mockRejectedValue("nope") }, SPOONJOY_EMAIL_FROM: "hello@spoonjoy.app" };
    await expect(sendTransactionalEmail(db, nonError, message)).rejects.toThrow("Email provider refused the verify_email message");
  });

  it("renders paragraphs, line breaks and links, escaping markup", () => {
    expect(textToHtml('Hi <chef> & "friends"\nline two\n\nhttps://spoonjoy.app/a?b=1&c=2')).toBe(
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:16px;line-height:1.5;color:#1f1b16">' +
        "<p>Hi &lt;chef&gt; &amp; &quot;friends&quot;<br>line two</p>" +
        '<p><a href="https://spoonjoy.app/a?b=1&amp;c=2">https://spoonjoy.app/a?b=1&amp;c=2</a></p>' +
        "</div>",
    );
  });
});
