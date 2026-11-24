// Every account email Spoonjoy sends (password reset, household invite, report notice, and the
// verification and email-change mails when they ship) is laid out here, so they all look alike and
// a self-hosted server's SMTP mail looks the same as spoonjoy.app's.
//
// A mail is a heading, a few short paragraphs, at most one button and some small print. It renders
// twice: a plain-text part, which keeps the whole link for clients that show no HTML, and an HTML
// part in Spoonjoy's look (the brass mark and wordmark, Fraunces/Source Serif with Georgia behind
// them, bone paper and charcoal ink, sj-tokens.css's colours). The two serifs load from the sending
// site's own /fonts/email/ (copies of app/fonts/'s latin files, at URLs that never change), so a
// client that loads web fonts, such as Apple Mail, shows the app's type with no third party.
//
// Corners: the button is square unless the client can draw a squircle (`corner-shape`), so no client
// ever shows a plain round corner. Dark mode: clients that honour prefers-color-scheme get Spoonjoy's
// dark palette; the rest invert the colours themselves, and the brass mark reads on either.

export interface AccountEmailAction {
  /** The button's words, a verb first: "Choose a new password". */
  label: string;
  url: string;
}

export interface AccountEmailContent {
  /** The inbox preview line shown after the subject. */
  preview: string;
  heading: string;
  /** The paragraphs above the button. */
  body: string[];
  action?: AccountEmailAction;
  /** Small print below the button: how long a link lasts, what to do if it wasn't you. */
  footer?: string[];
}

export interface RenderedAccountEmail {
  text: string;
  html: string;
}

/** Where the mail's mark image is served from, on the site that sends it. */
export const ACCOUNT_EMAIL_MARK_PATH = "/images/email/spoonjoy-mark.png";

// sj-tokens.css's light and dark values. Mail clients don't read CSS variables, so they are written out.
const LIGHT = { page: "#fbfaf4", ink: "#28231d", soft: "#635d54", brass: "#9b6834", rule: "#e8e9df", action: "#28231d", onAction: "#fbfaf4" };
const DARK = { page: "#1e1c19", ink: "#f2eee6", soft: "#c8c0b4", brass: "#c4945c", rule: "#34302b", action: "#b9854b", onAction: "#1f1d1a" };
const DISPLAY = `Fraunces, Georgia, 'Times New Roman', serif`;
const BODY = `'Source Serif 4', Georgia, 'Times New Roman', serif`;
const UI = `'IBM Plex Sans Condensed', 'Avenir Next Condensed', 'Helvetica Neue', Arial, sans-serif`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The link as a person reads it: the host and the first path segment, with an ellipsis for anything
 * after it (a token), so it stays short and never wraps inside a word. The button and this link
 * still go to the whole URL.
 */
export function shortLink(url: string): string {
  const parsed = new URL(url);
  const [first = "", ...rest] = parsed.pathname.split("/").filter(Boolean);
  const more = rest.length > 0 || parsed.search !== "" || parsed.hash !== "";
  return `${parsed.host}${first ? `/${first}` : ""}${more ? "…" : ""}`;
}

/** Where the mail's web fonts are served from, on the site that sends it. */
export const ACCOUNT_EMAIL_FONT_PATHS = {
  display: "/fonts/email/fraunces-400-900-latin.woff2",
  body: "/fonts/email/source-serif-4-400-800-latin.woff2",
} as const;

function siteOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

export function renderAccountEmailText(content: AccountEmailContent): string {
  const parts = [content.heading, ...content.body];
  if (content.action) parts.push(`${content.action.label}: ${content.action.url}`);
  parts.push(...(content.footer ?? []), "Spoonjoy");
  return parts.join("\n\n");
}

const style = (origin: string) => `
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 400 900; font-display: swap; src: url("${origin}${ACCOUNT_EMAIL_FONT_PATHS.display}") format('woff2'); }
@font-face { font-family: 'Source Serif 4'; font-style: normal; font-weight: 400 800; font-display: swap; src: url("${origin}${ACCOUNT_EMAIL_FONT_PATHS.body}") format('woff2'); }
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; }
a { color: ${LIGHT.ink}; }
@supports (corner-shape: squircle) {
  .sj-button { border-radius: 14px; corner-shape: squircle; }
}
@media (prefers-color-scheme: dark) {
  .sj-page { background-color: ${DARK.page} !important; }
  .sj-ink, .sj-ink a { color: ${DARK.ink} !important; }
  .sj-soft, .sj-soft a { color: ${DARK.soft} !important; }
  .sj-brass, .sj-brass a { color: ${DARK.brass} !important; }
  .sj-rule { border-color: ${DARK.rule} !important; }
  .sj-button { background-color: ${DARK.action} !important; }
  .sj-button a { color: ${DARK.onAction} !important; }
}`;

export function renderAccountEmailHtml(content: AccountEmailContent, baseUrl: string): string {
  const origin = siteOrigin(baseUrl);
  const paragraph = (text: string) =>
    `<p class="sj-ink" style="margin:0 0 16px;font-family:${BODY};font-size:17px;line-height:1.55;color:${LIGHT.ink};">${escapeHtml(text)}</p>`;
  const smallPrint = (text: string) =>
    `<p class="sj-soft" style="margin:0 0 10px;font-family:${BODY};font-size:14px;line-height:1.5;color:${LIGHT.soft};">${escapeHtml(text)}</p>`;
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 14px;">
<tr><td class="sj-button" bgcolor="${LIGHT.action}" style="background-color:${LIGHT.action};">
<a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:14px 26px;font-family:${BODY};font-size:17px;font-weight:600;line-height:1;color:${LIGHT.onAction};text-decoration:none;">${escapeHtml(content.action.label)}</a>
</td></tr>
</table>
<p class="sj-soft" style="margin:0 0 24px;font-family:${UI};font-size:13px;line-height:1.5;color:${LIGHT.soft};">Or open <a href="${escapeHtml(content.action.url)}" style="color:${LIGHT.soft};">${escapeHtml(shortLink(content.action.url))}</a></p>`
    : "";
  const footer = (content.footer ?? []).map(smallPrint).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.heading)}</title>
<style>${style(origin)}
</style>
</head>
<body class="sj-page" style="margin:0;padding:0;background-color:${LIGHT.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preview)}</div>
<table role="presentation" class="sj-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT.page}" style="background-color:${LIGHT.page};">
<tr><td align="center" style="padding:32px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 0 28px;">
<a href="${origin}" style="text-decoration:none;"><img src="${origin}${ACCOUNT_EMAIL_MARK_PATH}" width="40" height="24" alt="" style="display:inline-block;vertical-align:middle;border:0;"><span class="sj-ink" style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:${DISPLAY};font-size:19px;font-weight:700;letter-spacing:0.06em;color:${LIGHT.ink};">SPOONJOY</span></a>
</td></tr>
<tr><td>
<h1 class="sj-ink" style="margin:0 0 18px;font-family:${DISPLAY};font-size:30px;font-weight:600;line-height:1.15;color:${LIGHT.ink};">${escapeHtml(content.heading)}</h1>
${content.body.map(paragraph).join("\n")}
${action}
${footer}
</td></tr>
<tr><td class="sj-rule" style="padding:20px 0 0;border-top:1px solid ${LIGHT.rule};">
<p class="sj-brass" style="margin:0;font-family:${UI};font-size:13px;line-height:1.5;color:${LIGHT.brass};">Spoonjoy · <a href="${origin}" style="color:${LIGHT.brass};text-decoration:none;">${escapeHtml(new URL(origin).host)}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Both parts of an account email, for the mail's `text` and `html`. */
export function renderAccountEmail(content: AccountEmailContent, baseUrl: string): RenderedAccountEmail {
  return { text: renderAccountEmailText(content), html: renderAccountEmailHtml(content, baseUrl) };
}
