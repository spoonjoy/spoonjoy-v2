import type { ReactNode } from "react";
import { devWarn } from "~/lib/ouro/dev";
import type { ToneName } from "~/lib/ouro/tones";

/** A button in a toast: `{ label: "Undo", onClick: undo }`. Pressing it runs `onClick`, then dismisses the toast. */
export interface ToastAction {
  /** The button's text: a short verb, such as "Undo" or "View". */
  label: string;
  /** Runs when the button is pressed, before the toast is dismissed. */
  onClick: () => void;
}

/** Options for {@link toast}. */
export interface ToastOptions {
  /**
   * Color role from the theme, named after its token, shown as an icon: `success` for
   * a check, `warning` and `destructive` for a problem, `primary` for information.
   * `secondary`, the default, has no icon. Sonner's `error` is `destructive` and its
   * `info` is `primary`.
   * @default "secondary"
   * @claim "`secondary`, the default, has no icon" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > marks the tone and shows an icon for every tone but secondary)
   */
  tone?:
    | "primary"
    | "secondary"
    | "destructive"
    | "success"
    | "warning"
    | (string & { 'error is "destructive"; info is "primary"; danger is "destructive"': never })
    | undefined;
  /** A second line under the message. */
  description?: ReactNode;
  /** A button in the toast, such as Undo: `{ label: "Undo", onClick: undo }`. Pressing it dismisses the toast. */
  action?: ToastAction | undefined;
  /**
   * How long the toast stays once it shows, in milliseconds. Hovering or focusing the
   * toasts pauses the countdown. `0` or `Infinity` keeps it until it is dismissed.
   *
   * A toast with an `action` stays until it is dismissed unless you pass a duration: a
   * timed Undo can run out before a keyboard or screen reader user reaches it (WCAG 2.2.1).
   * @default 5000, or until dismissed with an action
   * @claim "or until dismissed with an action" registry/ouro/lib/ouro/toast.ts verify:fileLine(registry/ouro/lib/ouro/toast.ts, /const\sDEFAULT_DURATION\s=\s5000;/) verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps a toast that has an action until it is dismissed, unless duration is given)
   * @claim "A toast with an `action` stays" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps a toast that has an action until it is dismissed, unless duration is given)
   * @claim "A toast with an `action` stays" https://www.w3.org/TR/WCAG22/#timing-adjustable verify:urlOk(https://www.w3.org/TR/WCAG22/#timing-adjustable)
   */
  duration?: number | undefined;
  /** An id of your own. A toast with the id of one still showing replaces it in place. */
  id?: string | undefined;

  /** Not an option. Ouro UI uses `tone`: `toast("Saved", { tone: "success" })`. */
  type?: { 'Use toast("Saved", { tone: "success" })': never };
  /** Not an option. Ouro UI uses `tone`: `toast("Saved", { tone: "success" })`. */
  variant?: { 'Use toast("Saved", { tone: "success" })': never };
  /** Not an option. Ouro UI uses `duration`, in milliseconds: `toast("Saved", { duration: 8000 })`. */
  timeout?: { 'Use toast("Saved", { duration: 8000 })': never };
  /** Not an option. The message is the first argument: `toast("Saved", { description: "…" })`. */
  title?: { 'The message is the first argument: toast("Saved")': never };
}

/**
 * A toast as the Toaster receives it.
 *
 * @internal
 */
export interface ToastRecord {
  id: string;
  message: string;
  tone: ToneName;
  description: ReactNode;
  action: ToastAction | undefined;
  /**
   * Milliseconds; 0 keeps the toast until it is dismissed.
   *
   * @claim "Milliseconds; 0 keeps the toast until" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > dismisses itself after duration; 0 and Infinity keep it)
   */
  timeout: number;
}

/**
 * Where `toast()` sends toasts: the mounted Toaster.
 *
 * @internal
 */
export interface ToasterSink {
  add(record: ToastRecord): void;
  close(id?: string): void;
  /** Called when this Toaster starts showing toasts: at once, or when the one before it unmounts. */
  activate(): void;
}

const tones: readonly ToneName[] = ["primary", "secondary", "destructive", "success", "warning"];
/** Tone names from Sonner and other libraries, with the tone to use. */
const renamed: Readonly<Record<string, ToneName>> = { error: "destructive", danger: "destructive", info: "primary" };

/** How many toasts wait for a Toaster before the oldest is dropped. */
const MAX_PENDING = 20;
/**
 * How long a toast may wait for a Toaster before development warns that none is mounted.
 *
 * @claim "How long a toast may wait" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > warns when no Toaster mounts)
 */
const MISSING_TOASTER_MS = 1000;
/**
 * How long a toast with no action stays, in milliseconds.
 *
 * @claim "How long a toast with no" registry/ouro/lib/ouro/toast.ts verify:fileLine(registry/ouro/lib/ouro/toast.ts, /const\sDEFAULT_DURATION\s=\s5000;/)
 * @claim "How long a toast with no" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > keeps a toast that has an action until it is dismissed, unless duration is given)
 */
const DEFAULT_DURATION = 5000;

/** The mounted Toasters, in mount order. The first shows toasts; the others wait to take over. */
let sinks: ToasterSink[] = [];
let pending: ToastRecord[] = [];
let count = 0;
let missingCheck: ReturnType<typeof setTimeout> | undefined;

/**
 * Shows a toast: a short message that appears at the bottom of the screen, is read to
 * screen readers once, and dismisses itself. Call it from anywhere, such as an event
 * handler or an action's result, after rendering `<Toaster />` once. Returns the toast's
 * id; `toast.dismiss(id)` closes it, and `toast.dismiss()` closes them all.
 *
 * A toast called before the Toaster mounts waits for it. Up to three show at once, the
 * newest in front; later ones wait their turn, a `destructive` toast ahead of the others,
 * and each one's countdown starts when it shows. Hovering or focusing them (or pressing F6) pauses the countdown, and a swipe down
 * or sideways dismisses one. A toast with an `action` stays until it is dismissed unless
 * you pass a `duration`.
 *
 * Use `Alert` instead when the message must stay on the page, such as a form's errors,
 * and `Dialog` when the user must answer before going on.
 *
 * @group Feedback
 * @see https://ui.ouro.bot/docs/toaster
 *
 * @example
 * toast("Recipe saved", { tone: "success" });
 * toast("Recipe deleted", { action: { label: "Undo", onClick: restore } });
 * toast("Couldn't save", { tone: "destructive", description: "Check your connection." });
 * @claim "Returns the toast's id; `toast.dismiss(id)` closes" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > closes one toast with toast.dismiss(id), and all with toast.dismiss())
 * @claim "Up to three show at once" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > closes one toast with toast.dismiss(id), and all with toast.dismiss())
 * @claim "Returns the toast's id; `toast.dismiss(id)` closes" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > queues: up to three show, and later ones wait, out of the page, until a slot frees)
 * @claim "Up to three show at once" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > queues: up to three show, and later ones wait, out of the page, until a slot frees)
 * @claim "Returns the toast's id; `toast.dismiss(id)` closes" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > starts a waiting toast's countdown only when it shows, so it shows for its full duration and is announced once)
 * @claim "Up to three show at once" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > starts a waiting toast's countdown only when it shows, so it shows for its full duration and is announced once)
 * @claim "Returns the toast's id; `toast.dismiss(id)` closes" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > moves a destructive toast ahead of other waiting toasts, without pushing out a shown one)
 * @claim "Up to three show at once" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > moves a destructive toast ahead of other waiting toasts, without pushing out a shown one)
 * @claim "Returns the toast's id; `toast.dismiss(id)` closes" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 * @claim "Up to three show at once" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 * @claim "Hovering or focusing them (or pressing" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::pausing > pauses while the pointer is over the toasts, and resumes after)
 */
export function toast(message: string, options: ToastOptions = {}): string {
  const { tone: toneOption = "secondary", description, action, duration: durationOption, id = `ouro-toast-${++count}` } = options;
  // A timed Undo can run out before a keyboard or screen reader user reaches it (WCAG 2.2.1).
  const fallback = action ? 0 : DEFAULT_DURATION;
  const valid = durationOption !== undefined && (durationOption === Infinity || (Number.isFinite(durationOption) && durationOption >= 0));
  const duration = valid ? durationOption : fallback;
  const tone = tones.includes(toneOption as ToneName) ? (toneOption as ToneName) : "secondary";
  /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
  if (process.env.NODE_ENV !== "production") {
    const bad = options as { type?: unknown; variant?: unknown; timeout?: unknown; title?: unknown };
    if (tone !== toneOption) {
      const name = String(toneOption);
      const fix = Object.hasOwn(renamed, name) ? renamed[name]! : "secondary";
      devWarn("toast", `tone: "${name}" is not a tone; use ${tones.map((item) => `"${item}"`).join(", ")}`, `toast("…", { tone: "${fix}" })`);
    }
    for (const key of ["type", "variant"] as const) {
      if (bad[key] !== undefined) devWarn("toast", `${key} is not an option`, `toast("…", { tone: "${toneFix(bad[key])}" })`);
    }
    if (durationOption !== undefined && !valid) {
      devWarn(
        "toast",
        `duration: ${String(durationOption)} is not a duration; use milliseconds, or 0 to keep the toast`,
        `toast("…", { duration: ${DEFAULT_DURATION} })`,
      );
    }
    if (bad.timeout !== undefined) devWarn("toast", "timeout is not an option", `toast("…", { duration: ${String(bad.timeout)} })`);
    if (bad.title !== undefined) devWarn("toast", "title is not an option; the message is the first argument", `toast(${JSON.stringify(String(bad.title))})`);
  }
  // A toast is for the person using the page; on the server there is no one to show it to,
  // and a module-level queue there would be shared between requests.
  /* istanbul ignore if @preserve -- server only */
  if (typeof window === "undefined") return id;
  const record: ToastRecord = {
    id,
    message,
    tone,
    description,
    action,
    timeout: duration === Infinity ? 0 : duration,
  };
  const sink = sinks[0];
  if (sink) {
    sink.add(record);
  } else {
    pending = [...pending.filter((item) => item.id !== id), record].slice(-MAX_PENDING);
    /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
    if (process.env.NODE_ENV !== "production") scheduleMissingCheck();
  }
  return id;
}

/** The tone a Sonner-style `type` or `variant` value means, for a development message. */
function toneFix(value: unknown): ToneName {
  const name = String(value);
  if (tones.includes(name as ToneName)) return name as ToneName;
  return Object.hasOwn(renamed, name) ? renamed[name]! : "secondary";
}

function scheduleMissingCheck(): void {
  if (missingCheck !== undefined) return;
  missingCheck = setTimeout(() => {
    missingCheck = undefined;
    const first = pending[0];
    if (sinks.length === 0 && first) {
      devWarn("toast", `no <Toaster /> is mounted, so "${first.message}" is not shown`, "render <Toaster /> once, at the root of your app");
    }
  }, MISSING_TOASTER_MS);
}

/**
 * Closes the toast with this id, or every toast with no id.
 * @claim "Closes the toast with this id" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::toast() > closes one toast with toast.dismiss(id), and all with toast.dismiss())
 */
toast.dismiss = function dismiss(id?: string): void {
  const sink = sinks[0];
  if (sink) sink.close(id);
  else pending = id === undefined ? [] : pending.filter((item) => item.id !== id);
};

/** A Sonner shortcut: it works, and warns in development with the Ouro UI call. */
function sonnerAlias(name: string, tone: ToneName) {
  return (message: string, options: ToastOptions = {}): string => {
    /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
    if (process.env.NODE_ENV !== "production") {
      devWarn("toast", `toast.${name} is not a function`, `toast(${JSON.stringify(message)}, { tone: "${tone}" })`);
    }
    return toast(message, { ...options, tone });
  };
}

// Sonner's shortcuts are type errors whose message names the call to use. At run time they
// still show the toast and warn in development.
toast.success = sonnerAlias("success", "success") as unknown as { 'Use toast("Saved", { tone: "success" })': never };
toast.error = sonnerAlias("error", "destructive") as unknown as { 'Use toast("Failed", { tone: "destructive" })': never };
toast.warning = sonnerAlias("warning", "warning") as unknown as { 'Use toast("Careful", { tone: "warning" })': never };
toast.info = sonnerAlias("info", "primary") as unknown as { 'Use toast("Heads up", { tone: "primary" })': never };

/**
 * Connects a mounted Toaster. The first one connected shows toasts: those that waited for
 * it, and every later one. Another waits, and takes over when the ones before it
 * disconnect (only one shows toasts, so each is announced once). Returns the disconnect
 * function and whether this Toaster is the one showing toasts.
 *
 * @internal
 * @claim "The first one connected shows toasts" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > hands toasts to the next Toaster after the first unmounts)
 * @claim "Another waits, and takes over when" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::Toaster > shows toasts in one Toaster only, warns when a second is rendered, and lets the second take over when the first unmounts)
 */
export function connectToaster(next: ToasterSink): { disconnect: () => void; active: boolean } {
  sinks = [...sinks, next];
  const active = sinks[0] === next;
  if (active) activate(next);
  return {
    active,
    disconnect: () => {
      const wasActive = sinks[0] === next;
      sinks = sinks.filter((item) => item !== next);
      const following = sinks[0];
      if (wasActive && following) activate(following);
    },
  };
}

function activate(next: ToasterSink): void {
  next.activate();
  const waiting = pending;
  pending = [];
  for (const record of waiting) next.add(record);
}
