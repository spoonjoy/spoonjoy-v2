"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type JSX, type MouseEvent, type Ref, type SVGProps } from "react";
import { announce } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { canShare, share, type ShareResult } from "~/lib/ouro/share";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Button } from "~/components/ouro/button/button";

/** The props ShareButton adds to the `<button>` attributes it passes through. */
export interface ShareButtonOwnProps {
  /** The address to share. @default the page's own address */
  url?: string | undefined;
  /** A title for the link, where the receiving app takes one. */
  title?: string | undefined;
  /** A line about the link, where the receiving app takes one. */
  text?: string | undefined;
  /** The button's label, and its name for screen readers with `hideLabel`. @default "Share" */
  label?: string | undefined;
  /**
   * What it says, and screen readers hear, when there was no share sheet and the link was copied instead. @default "Link copied"
   *
   * @claim "What it says, and screen readers" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > copies the link where there is no share sheet, says Link copied once, and reads Share again after two seconds)
   */
  copiedLabel?: string | undefined;
  /**
   * What it says for two seconds when neither sharing nor copying worked: short, so the button keeps its width.
   * @default "Browser blocked sharing" when the share sheet refused, "Browser blocked copying" where there is no share sheet
   * @claim "What it says for two seconds" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, when the share sheet refuses and copying is blocked, shows Browser blocked sharing and announces the whole sentence once) verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, where there is no share sheet, shows Browser blocked copying, with how to copy the link as its tooltip, and announces the whole sentence once) verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > keeps a 390px-wide page from scrolling sideways when it says the browser blocked sharing, at every size)
   * @claim "when the share sheet refused" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, when the share sheet refuses and copying is blocked, shows Browser blocked sharing and announces the whole sentence once) verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, where there is no share sheet, shows Browser blocked copying, with how to copy the link as its tooltip, and announces the whole sentence once)
   */
  failedLabel?: string | undefined;
  /**
   * What screen readers hear, and the button's tooltip says while it shows `failedLabel`, when
   * neither sharing nor copying worked: what happened and what to do instead.
   * @default "The browser refused the share and blocked copying the link. Copy the link by hand." when the share sheet refused, "This browser has no share sheet, and it blocked copying the link. Copy the link by hand." where there is none, or `failedLabel` when only that is given
   * @claim "when the share sheet refused" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, when the share sheet refuses and copying is blocked, shows Browser blocked sharing and announces the whole sentence once) verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, where there is no share sheet, shows Browser blocked copying, with how to copy the link as its tooltip, and announces the whole sentence once)
   */
  failedMessage?: string | undefined;
  /** Shows only the icon; the label stays the button's name for screen readers. */
  hideLabel?: boolean | undefined;
  /** Visual weight, as Button's. @default "outline" */
  variant?: "solid" | "soft" | "outline" | "plain" | (string & { 'Use "solid", "soft", "outline" or "plain"; ghost is "plain"': never }) | undefined;
  /** Control size, as Button's. @default "md" */
  size?: "sm" | "md" | "lg" | (string & { 'Use "sm", "md" or "lg"': never }) | undefined;
  /** Called with how the share ended: `shared`, `copied`, `cancelled` or `failed`. */
  onShare?: ((result: ShareResult) => void) | undefined;
  /** Layout only: margins, grid placement (`ms-auto`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;

  /** Not a prop. The address is `url`: `<ShareButton url={link} />`. */
  href?: { 'Use url={link}': never };
  /** Not a prop. The label is `label`: `<ShareButton label="Share recipe" />`. */
  children?: { 'Use label="Share"': never };
  /** Not a prop. ShareButton shares on click itself; to react to it, pass `onShare`. */
  onClick?: { 'Use onShare={(result) => ...}': never };
}

/** Props for {@link ShareButton}: its own props and the `<button>` attributes it passes through. */
export type ShareButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ShareButtonOwnProps | "type" | "color"> & ShareButtonOwnProps;

const variants = ["solid", "soft", "outline", "plain"] as const;
const sizes = ["sm", "md", "lg"] as const;
const CONFIRM_MS = 2000;

function ShareIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * A button that shares a link: through the system's share sheet where there is one (phones,
 * Safari), and by copying it where there is not, when it says "Link copied" for two seconds
 * and screen readers hear it once. It shares the page's own address unless given `url`. When
 * neither works, it says for two seconds which the browser blocked, "Browser blocked sharing"
 * or, where there is no share sheet, "Browser blocked copying", with the whole of
 * `failedMessage` as its tooltip, and screen readers hear that whole sentence once.
 *
 * Use `CopyButton` instead to copy any text without a share sheet, and the `share()` helper
 * for a share action inside a menu.
 *
 * @group Actions
 * @see https://ui.ouroboros.bot/docs/share-button
 *
 * @example
 * <ShareButton url={`https://example.com/notes/${note.id}`} title={note.title} />
 * @claim "A button that shares a link" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > copies the link where there is no share sheet, says Link copied once, and reads Share again after two seconds)
 * @claim "A button that shares a link" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > says its failedLabel, once, when neither sharing nor copying works)
 * @claim "When neither works, it says for" registry/ouro/components/ouro/share-button/share-button.test.tsx verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, where there is no share sheet, shows Browser blocked copying, with how to copy the link as its tooltip, and announces the whole sentence once) verify:testExists(registry/ouro/components/ouro/share-button/share-button.test.tsx::ShareButton > by default, when the share sheet refuses and copying is blocked, shows Browser blocked sharing and announces the whole sentence once)
 */
export function ShareButton(props: ShareButtonProps): JSX.Element {
  const {
    url,
    title,
    text,
    label = "Share",
    copiedLabel = "Link copied",
    failedLabel: failedLabelProp,
    failedMessage: failedMessageProp,
    hideLabel,
    variant: variantProp = "outline",
    size: sizeProp = "md",
    onShare,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    href,
    children,
    onClick,
    ...rest
  } = props;
  const variant = (variants as readonly string[]).includes(variantProp) ? (variantProp as (typeof variants)[number]) : "outline";
  const size = (sizes as readonly string[]).includes(sizeProp) ? (sizeProp as (typeof sizes)[number]) : "md";
  useAppearanceClassNameCheck(
    "ShareButton",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; use variant="plain" or size="sm"`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ShareButton",
    process.env.NODE_ENV !== "production"
      ? () => [
          variant !== variantProp && [`variant="${String(variantProp)}" is not a variant; use "solid", "soft", "outline" or "plain"`, '<ShareButton variant="plain" />'],
          size !== sizeProp && [`size="${String(sizeProp)}" is not a size; use "sm", "md" or "lg"`, '<ShareButton size="sm" />'],
          href !== undefined && ["href is not a prop", `<ShareButton url="${typeof href === "string" ? href : "https://example.com"}" />`],
          children !== undefined && ["ShareButton takes no children; its label is label", `<ShareButton label="${typeof children === "string" ? children : "Share"}" />`],
          onClick !== undefined && ["onClick is not a prop; ShareButton shares on click itself", "<ShareButton onShare={(result) => {}} />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  // Whether the browser had a share sheet at the last press, so a failure names what it blocked.
  const [sheet, setSheet] = useState<boolean>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** What a failure says: which the browser blocked, the share or the copy. */
  const failure = (hadSheet: boolean | undefined) => {
    const fallback = hadSheet
      ? { label: "Browser blocked sharing", message: "The browser refused the share and blocked copying the link. Copy the link by hand." }
      : { label: "Browser blocked copying", message: "This browser has no share sheet, and it blocked copying the link. Copy the link by hand." };
    return { label: failedLabelProp ?? fallback.label, message: failedMessageProp ?? failedLabelProp ?? fallback.message };
  };

  const go = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const data = { url: url ?? location.href, title, text };
    const hadSheet = canShare(data);
    const result = await share(data);
    onShare?.(result);
    if (result !== "copied" && result !== "failed") return;
    clearTimeout(timer.current);
    setStatus(result);
    setSheet(hadSheet);
    announce(result === "copied" ? copiedLabel : failure(hadSheet).message);
    timer.current = setTimeout(() => setStatus("idle"), CONFIRM_MS);
  };

  const failed = failure(sheet);
  const shown = status === "copied" ? copiedLabel : status === "failed" ? failed.label : label;
  const Icon = status === "copied" ? CheckIcon : ShareIcon;
  return (
    <span data-ouro="share-button" data-status={status} className={cn("inline-flex", className)}>
      <Button
        data-ouro-control="share-button"
        data-ouro-part="trigger"
        {...rest}
        ref={ref}
        variant={variant}
        size={size}
        tone="secondary"
        onClick={go}
        {...(status === "failed" ? { title: failed.message } : {})}
        {...(hideLabel ? { "aria-label": shown, className: "w-(--ouro-button-h) px-0" } : { startIcon: Icon })}
      >
        {hideLabel ? <Icon className="size-[1.25em] shrink-0" /> : shown}
      </Button>
    </span>
  );
}
