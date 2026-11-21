"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type HTMLAttributes, type JSX, type Ref } from "react";
import { AFTER_ACTION_MS, announce } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useFocusHandoff } from "~/lib/ouro/focus-handoff";
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
  /** When the server refused the changes. @default "Not saved: the server refused the changes" */
  error?: string | undefined;
  /** The retry button's label. @default "Retry" */
  retry?: string | undefined;
  /** How many writes wait, with `{count}` where the number goes. @default "{count} waiting" */
  waiting?: string | undefined;
  /** A waiting write's cancel button, which also names the write. @default "Cancel" */
  cancel?: string | undefined;
}

/** A write that waits to be sent. */
export interface QueuedWrite {
  /** Names the write to `onCancel`. Unique within the queue. */
  id: string;
  /** What the write does, in the person's words (`Rename trail`). */
  label: string;
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
  /**
   * The writes that wait to be sent, which the app's data layer stores and sends. They show as a
   * count in the line and as a list of pending items under it, and the root carries `data-ouro-queued`
   * with the count, so an agent reads the same queue the person sees.
   */
  queue?: readonly QueuedWrite[] | undefined;
  /** Adds a Cancel button to the waiting writes and is called with the write's `id`. The app drops the write from its queue. */
  onCancel?: ((id: string) => void) | undefined;
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
  error: "Not saved: the server refused the changes",
  retry: "Retry",
  waiting: "{count} waiting",
  cancel: "Cancel",
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

function QueuedItem({ item, cancel, onCancel }: { item: QueuedWrite; cancel: string | undefined; onCancel: (id: string) => void }): JSX.Element {
  return (
    <li ref={useFocusHandoff<HTMLLIElement>()} data-slot="sync-status-queued" data-ouro-pending="" className="m-0 flex min-w-0 items-baseline gap-2 text-muted-foreground">
      <span data-slot="sync-status-queued-label" className="min-w-0 break-words">{item.label}</span>
      {cancel !== undefined ? (
        <button
          type="button"
          data-ouro-control="sync-status"
          data-ouro-part="cancel"
          data-slot="sync-status-cancel"
          onClick={() => onCancel(item.id)}
          className="relative cursor-pointer rounded-ouro-sm border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] leading-[inherit] font-medium text-foreground underline underline-offset-4 outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid pointer-fine:hover:decoration-2"
        >
          <TouchTarget />
          {cancel}
          <span data-slot="sync-status-cancel-name" className="sr-only"> {item.label}</span>
        </button>
      ) : null}
    </li>
  );
}

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
        className={cn("me-1.5 inline-block size-ouro-4 shrink-0 align-[-0.1875rem]", state === "saving" && "motion-safe:animate-[ouro-spin_1s_linear_infinite]")}
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
          className="relative ms-2 cursor-pointer rounded-ouro-sm border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] leading-[inherit] font-medium text-foreground underline underline-offset-4 outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid pointer-fine:hover:decoration-2"
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
 * device) or Not saved (the server refused the changes), each with its icon, and Retry while there is a problem. Screen
 * readers hear it only when a problem starts and when it clears, so every save is not
 * narrated. It keeps the height of its longest state, so a change never moves the page.
 * When Retry goes away while it has focus (the save it started is under way), focus moves to
 * the status line, so the person stays where they were rather than at the top of the page.
 *
 * Pass `queue` to show the writes that wait to be sent while the connection is away: the line counts them and a list of pending items
 * sits under it, each with Cancel when `onCancel` is given. The app's data layer stores and sends the writes, including across a reload.
 *
 * Use `toast()` instead to confirm a single action, and `Alert` for a problem that blocks the page.
 *
 * @group Feedback
 * @see https://ui.ouroboros.bot/docs/sync-status
 *
 * @example
 * <SyncStatus status={navigator.onLine ? (pending ? "saving" : "saved") : "offline"} onRetry={flush} />
 * @claim "a list of pending items" registry/ouro/components/ouro/sync-status/sync-status.queue.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.queue.test.tsx::SyncStatus queue > lists each waiting write as pending, with the count in the line and on the root)
 * @claim "each with Cancel when" registry/ouro/components/ouro/sync-status/sync-status.queue.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.queue.test.tsx::SyncStatus queue > offers Cancel only with onCancel, named after its write)
 * @claim "One line that says where the" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > speaks when a problem starts and when changes are saved again, and not for every save)
 * @claim "Screen readers hear it only when" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > speaks when a problem starts and when changes are saved again, and not for every save)
 * @claim "It keeps the height of its" registry/ouro/components/ouro/sync-status/sync-status.test.tsx verify:testExists(registry/ouro/components/ouro/sync-status/sync-status.test.tsx::SyncStatus > keeps one height whichever state it shows, so the page never moves)
 */
export function SyncStatus(props: SyncStatusProps): JSX.Element {
  const {
    status: statusProp,
    labels,
    onRetry,
    queue,
    onCancel,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    state,
    online,
    ...rest
  } = props;
  const status: SyncState = (states as readonly string[]).includes(statusProp) ? (statusProp as SyncState) : "saved";
  // Merged once per labels object, so an app that keeps its labels in a constant merges them once.
  const word = useMemo(() => ({ ...words, ...Object.fromEntries(Object.entries(labels ?? {}).filter(([, value]) => value !== undefined)) }) as Record<keyof SyncStatusLabels, string>, [labels]);
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
  // Spoken when a problem starts, after the triggering control's own state announcement (a switch's "off"), and when
  // changes are saved again after one. Recovery keeps the default delay: Retry's save moves focus to this line, and
  // VoiceOver's usage hint for it starts about then and swallows a later message.
  const troubled = useRef(false);
  useEffect(() => {
    if (problems.has(status)) {
      troubled.current = true;
      return announce(word[status], { delayMs: AFTER_ACTION_MS });
    } else if (status === "saved" && troubled.current) {
      return announce(word.saved, { onWrite: () => { troubled.current = false; } });
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

  const waiting = queue?.length ?? 0;
  const waitingText = word.waiting.replace("{count}", String(waiting));
  // The list goes when the last write leaves, cancelled or sent: if it held focus, the status line takes it.
  const listFocused = useRef(false);
  useLayoutEffect(() => {
    if (waiting === 0 && listFocused.current) {
      listFocused.current = false;
      line.current!.focus();
    }
  }, [waiting]);

  return (
    <div {...rest} data-ouro="sync-status" data-status={status} data-ouro-queued={waiting > 0 ? waiting : undefined} className={cn("grid min-w-0 text-sm leading-5", className)}>
      {states.map((reserved) => (
        <p key={reserved} aria-hidden="true" className="invisible m-0 [grid-area:1/1]">
          <Line state={reserved} label={word[reserved]} retry={word.retry} onRetry={undefined} />
          {onRetry && problems.has(reserved) ? <span className="ms-2 font-medium">{word.retry}</span> : null}
        </p>
      ))}
      <p
        ref={line}
        tabIndex={-1}
        className={cn("m-0 rounded-ouro-sm outline-ring outline-offset-2 [grid-area:1/1] focus-visible:outline-2 focus-visible:outline-solid", tones[status])}
      >
        <Line state={status} label={word[status]} retry={word.retry} onRetry={onRetry} retryRef={retryRef} />
        {waiting > 0 ? <span data-slot="sync-status-count" className="ms-2">{waitingText}</span> : null}
      </p>
      {waiting > 0 ? (
        <ul data-slot="sync-status-queue" onFocus={() => (listFocused.current = true)} onBlur={() => (listFocused.current = false)} aria-label={waitingText} className="m-0 grid list-none gap-1 p-0 pt-1">
          {queue!.map((item) => (
            <QueuedItem key={item.id} item={item} cancel={onCancel ? word.cancel : undefined} onCancel={onCancel!} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
