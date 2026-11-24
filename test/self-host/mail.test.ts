import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { mailSettings, smtpMailer } from "../../self-host/mail.mjs";

const FROM = { SPOONJOY_EMAIL_FROM: "Our kitchen <kitchen@example.com>" };

describe("mailSettings", () => {
  it("leaves mail off without an SMTP server", () => {
    expect(mailSettings({})).toBeNull();
    expect(mailSettings({ SPOONJOY_SMTP_HOST: "  ", ...FROM })).toBeNull();
  });

  it("upgrades to TLS on port 587 unless told otherwise", () => {
    expect(mailSettings({ SPOONJOY_SMTP_HOST: " smtp.example.com ", ...FROM })).toEqual({
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: null,
      password: null,
    });
  });

  it("uses TLS from the start on port 465, or plain SMTP to a relay nearby, on the port given", () => {
    expect(mailSettings({ SPOONJOY_SMTP_HOST: "smtp.example.com", SPOONJOY_SMTP_SECURITY: " TLS ", ...FROM })).toMatchObject({ port: 465, security: "tls" });
    expect(mailSettings({ SPOONJOY_SMTP_HOST: "relay", SPOONJOY_SMTP_SECURITY: "none", SPOONJOY_SMTP_PORT: "25", ...FROM })).toMatchObject({ port: 25, security: "none" });
    expect(mailSettings({ SPOONJOY_SMTP_HOST: "relay", SPOONJOY_SMTP_SECURITY: "", SPOONJOY_SMTP_PORT: " ", ...FROM })).toMatchObject({ port: 587, security: "starttls" });
  });

  it("signs in with the account given", () => {
    expect(mailSettings({ SPOONJOY_SMTP_HOST: "smtp.example.com", SPOONJOY_SMTP_USERNAME: " chef ", SPOONJOY_SMTP_PASSWORD: "app-password", ...FROM })).toMatchObject({
      username: "chef",
      password: "app-password",
    });
  });

  it("refuses settings it can't send with, naming the one to fix", () => {
    const host = { SPOONJOY_SMTP_HOST: "smtp.example.com", ...FROM };
    expect(() => mailSettings({ ...host, SPOONJOY_SMTP_SECURITY: "ssl" })).toThrow('SPOONJOY_SMTP_SECURITY must be starttls, tls or none; got "ssl".');
    for (const port of ["0", "65536", "smtp", "58.7"]) {
      expect(() => mailSettings({ ...host, SPOONJOY_SMTP_PORT: port })).toThrow(`SPOONJOY_SMTP_PORT must be a whole number from 1 to 65535; got "${port}".`);
    }
    expect(() => mailSettings({ SPOONJOY_SMTP_HOST: "smtp.example.com" })).toThrow(/^SPOONJOY_EMAIL_FROM must be set/);
    expect(() => mailSettings({ ...host, SPOONJOY_SMTP_USERNAME: "chef" })).toThrow("SPOONJOY_SMTP_PASSWORD must be set with SPOONJOY_SMTP_USERNAME.");
  });
});

describe("smtpMailer", () => {
  const message = { to: "cook@example.com", from: "Our kitchen <kitchen@example.com>", subject: "Reset your password", text: "Hi", html: "<p>Hi</p>" };

  function transport() {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    return { sendMail, createTransport };
  }

  it("requires TLS on a starttls server and signs in when there's an account", async () => {
    const { sendMail, createTransport } = transport();
    const send = smtpMailer({ host: "smtp.example.com", port: 587, security: "starttls", username: "chef", password: "app-password" }, createTransport);

    await send({ ...message, extra: "ignored" });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      auth: { user: "chef", pass: "app-password" },
    });
    expect(sendMail).toHaveBeenCalledWith(message);
  });

  it("starts with TLS on a tls server, and sends plain to a relay with no account", async () => {
    const tls = transport();
    smtpMailer({ host: "smtp.example.com", port: 465, security: "tls", username: null, password: null }, tls.createTransport);
    expect(tls.createTransport).toHaveBeenCalledWith({ host: "smtp.example.com", port: 465, secure: true, requireTLS: false, ignoreTLS: false });

    const plain = transport();
    smtpMailer({ host: "relay", port: 25, security: "none", username: null, password: null }, plain.createTransport);
    expect(plain.createTransport).toHaveBeenCalledWith({ host: "relay", port: 25, secure: false, requireTLS: false, ignoreTLS: true });
  });

  it("passes on the SMTP server's refusal", async () => {
    const { sendMail, createTransport } = transport();
    sendMail.mockRejectedValue(Object.assign(new Error("535 Authentication failed"), { code: "EAUTH" }));
    const send = smtpMailer({ host: "smtp.example.com", port: 587, security: "starttls", username: "chef", password: "wrong" }, createTransport);

    await expect(send(message)).rejects.toMatchObject({ code: "EAUTH" });
  });
});
