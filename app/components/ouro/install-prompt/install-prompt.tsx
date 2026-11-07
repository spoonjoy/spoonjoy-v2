"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps, type FocusEvent, type JSX, type ReactNode } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { useInstallPrompt } from "~/lib/ouro/use-install-prompt";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";

/** Props for {@link InstallPrompt}. */
export interface InstallPromptProps {
  /** The offer's title. @default "Install the app" */
  title?: string | undefined;
  /** What installing gives the person. @default "Add it to your home screen or dock and open it like any other app." */
  description?: ReactNode;
  /** A picture across the top, such as the app on a phone. */
  media?: ReactNode;
  /** The label of the button that opens the browser's install dialog. @default "Install" */
  installLabel?: string | undefined;
  /** The label of the button that puts the offer away. @default "Not now" */
  dismissLabel?: string | undefined;
  /** Days before offering again after Not now. @default 14 */
  remindAfterDays?: number | undefined;
  /** The `localStorage` key that keeps when the person said Not now. @default "ouro-install-dismissed" */
  storageKey?: string | undefined;
  /** Called with how the person answered the browser's install dialog. */
  onInstall?: ((outcome: "accepted" | "dismissed") => void) | undefined;
  /** The title's heading level. @default 2 */
  headingLevel?: ComponentProps<typeof Card>["headingLevel"];
  /** Layout only: margins, width (`mt-6`, `max-w-md`). Appearance classes warn in development. */
  className?: string | undefined;

  /** Not a prop. The offer shows itself when the browser can install the app; there is nothing to open. */
  open?: { 'InstallPrompt shows itself when the app can be installed': never };
  /** Not a prop. Ouro UI says `onInstall`: `<InstallPrompt onInstall={(outcome) => …} />`. */
  onAccept?: { 'Use onInstall={(outcome) => ...}': never };
}

const tabbable =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Where focus goes when the card leaves with it: back where it came from, else the next control, else the one before. */
function returnTarget(card: HTMLElement, cameFrom: HTMLElement | null): HTMLElement | null {
  if (cameFrom?.isConnected) return cameFrom;
  const outside = [...document.querySelectorAll<HTMLElement>(tabbable)].filter((element) => !card.contains(element) && element.checkVisibility());
  return outside.find((element) => card.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) ?? outside.at(-1) ?? null;
}

/**
 * A quiet offer to install the web app, shown only where the browser can install it (Chromium
 * on Android and desktops), never while it already runs installed, and not again for two weeks
 * after Not now. Install opens the browser's own install dialog. It renders nothing otherwise,
 * so it can sit in a layout unconditionally. The browser's install event is caught as soon as
 * the module loads, so an offer is never missed because the page mounted late. When Install or
 * Not now takes the card away while it has focus, focus goes back where it was before the card,
 * or to the next control on the page when that is gone.
 *
 * Use `useInstallPrompt` instead to offer installing from a control of your own, such as a menu item.
 *
 * @group Feedback
 * @see https://ui.ouro.bot/docs/install-prompt
 *
 * @example
 * <InstallPrompt className="mt-6" />
 * @claim "A quiet offer to install the" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is installed, and offers nothing, while the app runs standalone)
 * @claim "A quiet offer to install the" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > puts the offer away on dismiss(), and keeps it away for remindAfterDays)
 * @claim "A quiet offer to install the" registry/ouro/lib/ouro/use-install-prompt.ts verify:fileLine(registry/ouro/lib/ouro/use-install-prompt.ts, /remindAfterDays\s=\s14/)
 * @claim "A quiet offer to install the" registry/ouro/components/ouro/install-prompt/install-prompt.test.tsx verify:testExists(registry/ouro/components/ouro/install-prompt/install-prompt.test.tsx::InstallPrompt > shows a card with the offer, Not now and Install once the browser offers)
 * @claim "The browser's install event is caught" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is available to a component that mounts after the offer)
 */
export function InstallPrompt(props: InstallPromptProps): JSX.Element | null {
  const {
    title = "Install the app",
    description = "Add it to your home screen or dock and open it like any other app.",
    media,
    installLabel = "Install",
    dismissLabel = "Not now",
    remindAfterDays,
    storageKey,
    onInstall,
    headingLevel = 2,
    className,
    open,
    onAccept,
  } = props;
  useAppearanceClassNameCheck(
    "InstallPrompt",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; InstallPrompt sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "InstallPrompt",
    process.env.NODE_ENV !== "production"
      ? () => [
          open !== undefined && ["open is not a prop; the offer shows itself when the app can be installed", "<InstallPrompt />"],
          onAccept !== undefined && ["onAccept is not a prop", "<InstallPrompt onInstall={(outcome) => {}} />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const { available, install, dismiss } = useInstallPrompt({ remindAfterDays, storageKey });
  // The card leaves on its own answer. React detaches its ref before it removes the card, so
  // focus is still inside then; once the commit is done, focus goes to the target picked there.
  const cameFrom = useRef<HTMLElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // A ref that returns a cleanup is only ever called with the element.
  const cardRef = useCallback(
    (node: HTMLDivElement | null) => () => {
      returnTo.current = node!.contains(document.activeElement) ? returnTarget(node!, cameFrom.current) : null;
    },
    [],
  );
  useLayoutEffect(() => {
    const target = returnTo.current;
    returnTo.current = null;
    target?.focus();
  });
  const enter = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget;
    if (!event.currentTarget.contains(from)) cameFrom.current = from instanceof HTMLElement ? from : null;
  };
  if (!available) return null;
  const accept = async () => {
    const outcome = await install();
    if (outcome !== "unavailable") onInstall?.(outcome);
  };
  return (
    <div ref={cardRef} data-ouro="install-prompt" className={className} onFocus={enter}>
      <Card
        title={title}
        description={description}
        media={media}
        headingLevel={headingLevel}
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button data-ouro-control="install-prompt" data-ouro-part="dismiss" variant="plain" tone="secondary" onClick={dismiss}>
              {dismissLabel}
            </Button>
            <Button data-ouro-control="install-prompt" data-ouro-part="install" onClick={accept}>
              {installLabel}
            </Button>
          </div>
        }
      />
    </div>
  );
}
