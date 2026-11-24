// Account mail (password resets, email changes, household invites) from a self-hosted server, through the owner's own
// SMTP server. The Worker hands each message to the server around it over the SELF_HOST binding (POST /mail in
// self-host/host-api.mjs), and this sends it; the SMTP password never reaches the Worker.
//
//   SPOONJOY_SMTP_HOST      the SMTP server; mail is off without it
//   SPOONJOY_SMTP_PORT      587, or 465 with SPOONJOY_SMTP_SECURITY=tls
//   SPOONJOY_SMTP_SECURITY  starttls (the default: upgrade to TLS, or refuse to send), tls (TLS from the start) or
//                           none (plain, for a relay on the same machine or network)
//   SPOONJOY_SMTP_USERNAME, SPOONJOY_SMTP_PASSWORD
//                           the account to sign in with, if the server asks for one
//   SPOONJOY_EMAIL_FROM     the From address, which the SMTP server must allow

const SECURITY = ["starttls", "tls", "none"];

/** The SMTP settings in a container's environment, or null when mail is off. Throws on settings it can't use. */
export function mailSettings(env) {
  const host = env.SPOONJOY_SMTP_HOST?.trim();
  if (!host) return null;
  const security = env.SPOONJOY_SMTP_SECURITY?.trim().toLowerCase() || "starttls";
  if (!SECURITY.includes(security)) {
    throw new Error(`SPOONJOY_SMTP_SECURITY must be starttls, tls or none; got "${env.SPOONJOY_SMTP_SECURITY}".`);
  }
  let port = security === "tls" ? 465 : 587;
  if (env.SPOONJOY_SMTP_PORT?.trim()) {
    port = Number(env.SPOONJOY_SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`SPOONJOY_SMTP_PORT must be a whole number from 1 to 65535; got "${env.SPOONJOY_SMTP_PORT}".`);
    }
  }
  if (!env.SPOONJOY_EMAIL_FROM?.trim()) {
    throw new Error("SPOONJOY_EMAIL_FROM must be set to the address account mail comes from when SPOONJOY_SMTP_HOST is set.");
  }
  const username = env.SPOONJOY_SMTP_USERNAME?.trim() || null;
  if (username && !env.SPOONJOY_SMTP_PASSWORD) {
    throw new Error("SPOONJOY_SMTP_PASSWORD must be set with SPOONJOY_SMTP_USERNAME.");
  }
  return { host, port, security, username, password: username ? env.SPOONJOY_SMTP_PASSWORD : null };
}

/**
 * Sends one message through the SMTP server in `settings` (mailSettings'). `createTransport` is nodemailer's. Resolves
 * once the server accepted the message, and rejects with the server's refusal otherwise.
 */
export function smtpMailer(settings, createTransport) {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    ...(settings.username ? { auth: { user: settings.username, pass: settings.password } } : {}),
  });
  return async ({ to, from, subject, text, html }) => {
    await transport.sendMail({ to, from, subject, text, html });
  };
}
