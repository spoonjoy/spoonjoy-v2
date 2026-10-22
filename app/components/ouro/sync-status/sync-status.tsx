"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type HTMLAttributes, type JSX, type Ref } from "react";
import { announce } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** Where the person's changes are. */
export type SyncState = "saved" | "saving" | "offline" | "error";

/**
 * The words for each state, for apps in other languages or to say what is saved.
 *
 * @claim "The words for each state, for" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > takes words in another language, and keeps the defaults for the rest)
 */
export interface SyncStatusLabels {
  /** Once changes reached the server. @default "Saved" */
  saved?: string | undefined;
  /** While changes travel. @default "Saving…" */
  saving?: string | undefined;
  /** While changes wait on this device. @default "Offline: changes are kept on this device" */
  offline?: string | undefined;
  /** When the server refused the changes. @default "Couldn't save" */
  error?: string | undefined;
  /** The retry button's label. @default "Retry" */
  retry?: string | undefined;
}

/** The props SyncStatus adds to the `<div>` attributes it passes through. */
export interface SyncStatusOwnProps {
  /**
   * `saved` once changes reached the server, `saving` while they travel, `offline` while they
   * wait on this device, `error` when the server refused them.
   */
  status: SyncState | (string & { 'Use "saved", "saving", "offline" or "error"': never });
  /**
   * The words for each state.
   *
   * @claim "The words for each state" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > takes words in another language, and keeps the defaults for the rest)
   */
  labels?: SyncStatusLabels | undefined;
  /** Shows Retry while `offline` or `error`, and is called when it is pressed. */
  onRetry?: (() => void) | undefined;
  /** Layout only: margins, placement (`mt-3`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI says `status`: `<SyncStatus status="saving" />`. */
  state?: { 'Use status="saving"': never };
  /** Not a prop. Ouro UI says `status`: `<SyncStatus status="offline" />`. */
  online?: { 'Use status="offline" when the device is offline': never };
}

/** Props for {@link SyncStatus}: its own props and the `<div>` attributes it passes through. */
export type SyncStatusProps = Omit<HTMLAttributes<HTMLDivElement>, keyof SyncStatusOwnProps> & SyncStatusOwnProps;

const states: readonly SyncState[] = ["saved", "saving", "offline", "error"];
const words: Record<keyof SyncStatusLabels, string> = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline: changes are kept on this device",
  error: "Couldn't save",
  retry: "Retry",
};
const problems = new Set<SyncState>(["offline", "error"]);

const tones: Record<SyncState, string> = {
  saved: "text-[color-mix(in_oklab,var(--muted-foreground)_88%,var(--foreground))]",
  saving: "text-[color-mix(in_oklab,var(--muted-foreground)_88%,var(--foreground))]",
  offline: "text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]",
  error: "text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]",
};

const icons: Record<SyncState, JSX.Element> = {
  saved: <path d="M20 6 9 17l-5-5" />,
  saving: <path d="M21 12a9 9 0 1 1-6.22-8.56" />,
  offline: (
    <>
      <path d="m2 2 20 20" />
      <path d="M5.78 5.78A7 7 0 0 0 6.5 19H17" />
      <path d="M21.5 15.5A4.5 4.5 0 0 0 17.5 9h-1.79A7 7 0 0 0 9.5 5.08" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
};

function Line({
  state,
  label,
  retry,
  onRetry,
  retryRef,
}: {
  state: SyncState;
  label: string;
  retry: string;
  onRetry: (() => void) | undefined;
  retryRef?: Ref<HTMLButtonElement> | undefined;
}): JSX.Element {
  const hasRetry = onRetry !== undefined && problems.has(state);
  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("me-1.5 inline-block size-4 shrink-0 align-[-0.1875rem]", state === "saving" && "motion-safe:animate-[ouro-spin_1s_linear_infinite]")}
      >
        {icons[state]}
      </svg>
      <span>{label}</span>
      {hasRetry ? (
        <button
          ref={retryRef}
          type="button"
          data-ouro-control="sync-status"
          data-ouro-part="retry"
          onClick={onRetry}
          className="relative ms-2 cursor-pointer rounded-sm border-0 bg-transparent p-0 font-medium text-foreground underline underline-offset-4 outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid pointer-fine:hover:decoration-2"
        >
          <TouchTarget />
          {retry}
        </button>
      ) : null}
    </>
  );
}

/**
 * One line that says where the person's changes are: Saved, Saving…, Offline (kept on this
 * device) or Couldn't save, each with its icon, and Retry while there is a problem. Screen
 * readers hear it only when a problem starts and when it clears, so every save is not
 * narrated. It keeps the height of its longest state, so a change never moves the page.
 * When Retry goes away while it has focus (the save it started is under way), focus moves to
 * the status line, so the person stays where they were rather than at the top of the page.
 *
 * Use `toast()` instead to confirm a single action, and `Alert` for a problem that blocks the page.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/sync-status
 *
 * @example
 * <SyncStatus status={navigator.onLine ? (pending ? "saving" : "saved") : "offline"} onRetry={flush} />
 * @claim "One line that says where the" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > speaks when a problem starts and when changes are saved again, and not for every save)
 * @claim "Screen readers hear it only when" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > speaks when a problem starts and when changes are saved again, and not for every save)
 * @claim "It keeps the height of its" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > keeps one height whichever state it shows, so the page never moves)
 */
export function SyncStatus(props: SyncStatusProps): JSX.Element {
  const {
    status: statusProp,
    labels,
    onRetry,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    state,
    online,
    ...rest
  } = props;
  const status: SyncState = (states as readonly string[]).includes(statusProp) ? (statusProp as SyncState) : "saved";
  const word = { ...words, ...Object.fromEntries(Object.entries(labels ?? {}).filter(([, value]) => value !== undefined)) } as Record<keyof SyncStatusLabels, string>;
  useAppearanceClassNameCheck(
    "SyncStatus",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; SyncStatus takes its colors from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "SyncStatus",
    process.env.NODE_ENV !== "production"
      ? () => [
          status !== statusProp && [`status="${String(statusProp)}" is not a status; use "saved", "saving", "offline" or "error"`, '<SyncStatus status="saving" />'],
          state !== undefined && ["state is not a prop", `<SyncStatus status="${typeof state === "string" ? state : "saving"}" />`],
          online !== undefined && ["online is not a prop", '<SyncStatus status="offline" />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Spoken when a problem starts, and when changes are saved again after one.
  const troubled = useRef(false);
  useEffect(() => {
    if (problems.has(status)) {
      troubled.current = true;
      announce(word[status]);
    } else if (status === "saved" && troubled.current) {
      troubled.current = false;
      announce(word.saved);
    }
    // The words change with the status; a new translation alone is not news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Retry leaves with its problem. React detaches its ref before it removes the button, so focus
  // is still on it then; once the commit is done, focus moves to the line instead of the page.
  const line = useRef<HTMLParagraphElement>(null);
  const retryHadFocus = useRef(false);
  // A ref that returns a cleanup is only ever called with the element.
  const retryRef = useCallback(
    (node: HTMLButtonElement | null) => () => {
      retryHadFocus.current = node === document.activeElement;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!retryHadFocus.current) return;
    retryHadFocus.current = false;
    line.current!.focus();
  });

  return (
    <div {...rest} data-ouro="sync-status" data-status={status} className={cn("grid min-w-0 text-sm leading-5", className)}>
      {states.map((reserved) => (
        <p key={reserved} aria-hidden="true" className="invisible m-0 [grid-area:1/1]">
          <Line state={reserved} label={word[reserved]} retry={word.retry} onRetry={undefined} />
          {onRetry && problems.has(reserved) ? <span className="ms-2 font-medium">{word.retry}</span> : null}
        </p>
      ))}
      <p
        ref={line}
        tabIndex={-1}
        className={cn("m-0 rounded-sm outline-ring outline-offset-2 [grid-area:1/1] focus-visible:outline-2 focus-visible:outline-solid", tones[status])}
      >
        <Line state={status} label={word[status]} retry={word.retry} onRetry={onRetry} retryRef={retryRef} />
      </p>
    </div>
  );
}
