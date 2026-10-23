export { canShare, copyText, share };
export type { ShareContent, ShareResult };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/** What {@link share} hands on. */
interface ShareContent {
  /** The address to share. */
  url: string;
  /** A title for it, where the receiving app takes one. */
  title?: string | undefined;
  /** A line about it, where the receiving app takes one. */
  text?: string | undefined;
}

/**
 * How a share ended: `shared` through the system's share sheet, `copied` to the clipboard
 * where there is no share sheet, `cancelled` when the person closed the sheet, `failed` when
 * neither worked.
 * @claim "How a share ended: `shared` through" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::share > says failed when neither the sheet nor the clipboard works)
 * @claim "How a share ended: `shared` through" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::share > says cancelled when the person closes the sheet, and copies nothing)
 * @claim "How a share ended: `shared` through" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::share > copies the link where there is no share sheet)
 */
type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Whether the browser has a share sheet for this data: most phones and Safari do, most
 * desktop browsers do not.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/share-button
 *
 * @example
 * const label = canShare({ url }) ? "Share" : "Copy link";
 * @claim "Whether the browser has a share" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::canShare > asks the browser whether it can share the data, without the empty fields)
 * @claim "Whether the browser has a share" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::canShare > is false when the browser says it cannot share the data)
 * @claim "Whether the browser has a share" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::canShare > is true with a share sheet that has no canShare to ask)
 * @claim "Whether the browser has a share" https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share verify:urlOk(https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
 */
function canShare(data: ShareContent): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  return typeof navigator.canShare !== "function" || navigator.canShare(native(data));
}

/** The data as the browser's share sheet takes it, without empty fields. */
function native({ url, title, text }: ShareContent): ShareData {
  return { url, ...(title ? { title } : {}), ...(text ? { text } : {}) };
}

/** Copies through a hidden text area, for pages the Clipboard API is not open to. */
function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
  const focused = document.activeElement as HTMLElement;
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  focused.focus({ preventScroll: true });
  return copied;
}

/**
 * Puts text on the clipboard: through the Clipboard API, or a text selection where the page
 * may not use it (plain http, an older browser). Resolves whether it worked; never throws.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/share-button
 *
 * @example
 * if (await copyText(url)) toast("Link copied");
 * @claim "Resolves whether it worked; never throws" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::copyText > resolves false, without throwing, when the selection copy throws)
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, the page not focused): a selection may still copy.
    }
  }
  return copyWithSelection(text);
}

/**
 * Shares a link through the system's share sheet, or copies it where there is none, and says
 * which happened. Call it from a click: browsers open the share sheet only for one. It never
 * throws.
 *
 * Use `ShareButton` instead for the whole button, with its "Link copied" confirmation.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/share-button
 *
 * @example
 * const result = await share({ url: location.href, title: document.title });
 * if (result === "copied") toast("Link copied");
 * @claim "Shares a link through the system's" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::share > copies the link where there is no share sheet)
 * @claim "Shares a link through the system's" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::share > says cancelled when the person closes the sheet, and copies nothing)
 * @claim "It never throws" registry/ouro/lib/ouro/share.test.ts verify:testExists(registry/ouro/lib/ouro/share.test.ts::copyText > resolves false, without throwing, when the selection copy throws)
 */
async function share(data: ShareContent): Promise<ShareResult> {
  if (canShare(data)) {
    try {
      await navigator.share(native(data));
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Any other refusal (no permission, a sheet already open) falls back to the clipboard.
    }
  }
  return (await copyText(data.url)) ? "copied" : "failed";
}
