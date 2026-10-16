"use client";

import type { ComponentType, HTMLAttributes, JSX, MouseEvent, ReactNode, Ref, SVGProps } from "react";
import { Button } from "~/components/ouro/button/button";
import { fontFor, toneFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { toneWarning, type ToneName } from "~/lib/ouro/tones";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** An icon component, such as one from `lucide-react` or `@heroicons/react`. */
export type AlertIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The props Alert adds to the `<div>` attributes it passes through. */
export interface AlertOwnProps {
  /**
   * What happened, in a few words: "Recipe saved", "Couldn't save". Required, so every
   * alert says what it is about.
   */
  title: ReactNode;
  /** More detail, or what to do next, under the title. */
  description?: ReactNode;
  /**
   * Color role from the theme, which also sets how urgently screen readers hear it:
   * `destructive` and `warning` are `role="alert"` (spoken at once), the others
   * `role="status"` (spoken politely). `primary` is for information, `secondary` for a
   * neutral note. shadcn's `variant="destructive"` is `tone="destructive"`.
   * @default "secondary"
   */
  tone?:
    | "primary"
    | "secondary"
    | "destructive"
    | "success"
    | "warning"
    | (string & { 'danger and error are "destructive"; info is "primary"; neutral is "secondary"': never })
    | undefined;
  /** A control under the description, usually a small Button: `action={<Button size="sm">Retry</Button>}`. */
  action?: ReactNode;
  /**
   * Shows a close button that calls this. Remove the alert from your state in it. When
   * the alert goes, keyboard focus moves to the next control after it, or to the one
   * before it when nothing follows, so it is not lost to the page.
   */
  onDismiss?: (() => void) | undefined;
  /** The close button's accessible name, for other languages. @default "Dismiss" */
  dismissLabel?: string | undefined;
  /**
   * The icon at the start, as a component: `icon={WifiOffIcon}`. Each tone has its own
   * by default; `null` shows none.
   */
  icon?: AlertIcon | null | undefined;
  /** Layout only: margins, width, grid placement (`mt-4`). Appearance classes warn in development; use `tone`. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `tone`: `<Alert tone="destructive">`. */
  variant?: { 'Use <Alert tone="destructive">': never };
  /** Not a prop. Ouro UI uses `tone`: `<Alert tone="destructive">`. */
  severity?: { 'Use <Alert tone="destructive">': never };
  /** Not a prop. Ouro UI uses `tone`: `<Alert tone="primary">`. */
  status?: { 'Use <Alert tone="primary">': never };
  /** Not a prop. Ouro UI uses `onDismiss`: `<Alert onDismiss={() => setOpen(false)}>`. */
  onClose?: { 'Use <Alert onDismiss={() => setOpen(false)}>': never };
  /** Not a prop. Alert takes `title` and `description`: `<Alert title="…" description="…">`. */
  children?: { 'Use <Alert title="..." description="...">': never };
}

/** Props for {@link Alert}: its own props and the `<div>` attributes it passes through. */
export type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, keyof AlertOwnProps | "role"> & AlertOwnProps;

const tones = {
  primary: {
    root: "border-primary/30 bg-primary/5",
    accent: "text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))]",
  },
  secondary: { root: "border-border bg-card", accent: "text-foreground" },
  destructive: {
    root: "border-destructive/30 bg-destructive/5",
    accent: "text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]",
  },
  success: {
    root: "border-success/30 bg-success/5",
    accent: "text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))]",
  },
  warning: {
    root: "border-warning/30 bg-warning/5",
    accent: "text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))]",
  },
} as const;

/** Tones a reader must hear at once. */
const urgent = new Set<ToneName>(["destructive", "warning"]);

function Glyph({ children, ...props }: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  );
}

function InfoIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.5v.01" />
    </Glyph>
  );
}

function SuccessIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m6.75 10.25 2.25 2.25 4.25-4.75" />
    </Glyph>
  );
}

function WarningIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M8.7 3.3a1.5 1.5 0 0 1 2.6 0l6 10.5a1.5 1.5 0 0 1-1.3 2.2H4a1.5 1.5 0 0 1-1.3-2.2z" />
      <path d="M10 8v3.5M10 13.75v.01" />
    </Glyph>
  );
}

function ErrorIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.5 7.5 5 5m0-5-5 5" />
    </Glyph>
  );
}

const icons: Record<ToneName, AlertIcon> = {
  primary: InfoIcon,
  secondary: InfoIcon,
  destructive: ErrorIcon,
  success: SuccessIcon,
  warning: WarningIcon,
};

function CloseIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </Glyph>
  );
}

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where focus goes when an alert is dismissed: the next control after it, where the reader
 * would continue, or else the last one before it.
 */
function focusTarget(alert: Element): HTMLElement | undefined {
  const candidates = [...document.querySelectorAll<HTMLElement>(focusable)].filter(
    (element) => !alert.contains(element) && element.getClientRects().length > 0,
  );
  const after = candidates.find((element) => alert.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after ?? candidates.filter((element) => alert.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING).at(-1);
}

function alertHint(token: string): string {
  if (/^text-(xs|sm|base|lg|xl|\dxl)$/.test(token)) return `remove "${token}"; Alert sets its own size`;
  if (token.startsWith("font-")) return fontFor("Alert", token);
  return `tone="${toneFor(token)}"`;
}

/** The tone another library's severity or status names. Development only. */
function toneFromSeverity(value: unknown): ToneName {
  const name = String(value);
  if (/error|danger/.test(name)) return "destructive";
  if (/warn/.test(name)) return "warning";
  if (/success/.test(name)) return "success";
  return "primary";
}

/**
 * An inline message in the page: something saved, something failed, something to know
 * before going on. It has a title, an optional description and action, and a close
 * button when you pass `onDismiss`. Destructive and warning alerts are spoken at once
 * (`role="alert"`); the others politely (`role="status"`).
 *
 * In and around forms, Alert is the component for a message that belongs to no field and
 * to no form as a whole: a reorder or a deletion the server refused, a step that could not
 * be parsed. Render it where the action was taken, with `action` for the way out.
 *
 * Use `Toast` instead for a brief message that disappears by itself, `ConfirmDialog` to
 * ask before a destructive action, and `Field`'s `error` for a message about one field.
 * Use `Form`'s `errors` instead for what a submit returned: a field's name as the key puts
 * the message under that field, and the `form` key shows it at the top of the form.
 *
 * @group Display
 * @see https://ourostack.github.io/ouro-ui/docs/alert
 *
 * @example
 * <Alert tone="success" title="Recipe saved" />
 * <Alert
 *   tone="destructive"
 *   title="Couldn't save"
 *   description="Check your connection and try again."
 *   action={<Button size="sm" onClick={retry}>Try again</Button>}
 *   onDismiss={() => setError(null)}
 * />
 */
export function Alert(props: AlertProps): JSX.Element {
  const {
    title,
    description,
    tone: toneProp = "secondary",
    action,
    onDismiss,
    dismissLabel = "Dismiss",
    icon,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    variant,
    severity,
    status,
    onClose,
    children,
    ...rest
  } = props;
  // A tone that is not one of Ouro UI's (a type error) warns and renders the default.
  const tone = Object.hasOwn(tones, toneProp) ? (toneProp as ToneName) : "secondary";
  useAppearanceClassNameCheck(
    "Alert",
    className,
    process.env.NODE_ENV !== "production" ? alertHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Alert",
    process.env.NODE_ENV !== "production"
      ? () => [
          tone !== toneProp &&
            (/^(info|error)$/.test(String(toneProp))
              ? [`tone="${toneProp}" is not a tone; use "primary", "secondary", "destructive", "success", "warning"`, `<Alert tone="${toneFromSeverity(toneProp)}">`]
              : toneWarning("Alert", String(toneProp), Object.keys(tones))),
          variant !== undefined && [`variant="${String(variant)}" is not a prop`, `<Alert tone="${String(variant) === "destructive" ? "destructive" : "secondary"}">`],
          severity !== undefined && ["severity is not a prop", `<Alert tone="${toneFromSeverity(severity)}">`],
          status !== undefined && ["status is not a prop", `<Alert tone="${toneFromSeverity(status)}">`],
          onClose !== undefined && ["onClose is not a prop", "<Alert onDismiss={() => setOpen(false)}>"],
          children !== undefined && ["Alert takes no children", '<Alert title="…" description="…">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const Icon = icon === undefined ? icons[tone] : icon;
  const accent = tones[tone].accent;
  return (
    <div
      {...rest}
      role={urgent.has(tone) ? "alert" : "status"}
      data-ouro="alert"
      data-tone={tone}
      className={cn(
        "box-border flex w-full items-start gap-3 rounded-lg border border-solid p-4 text-foreground",
        tones[tone].root,
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" data-ouro-alert-icon="" className={cn("mt-0.5 size-5 shrink-0", accent)} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div data-ouro-alert-title="" data-ouro-text="" className={cn("text-base/6 font-medium sm:pointer-fine:text-sm/5", accent)}>
          {title}
        </div>
        {description !== undefined && (
          <div data-ouro-alert-description="" data-ouro-text="" className="text-base/6 sm:pointer-fine:text-sm/5">
            {description}
          </div>
        )}
        {action !== undefined && (
          <div data-ouro-alert-action="" className="mt-2 flex flex-wrap gap-2">
            {action}
          </div>
        )}
      </div>
      {onDismiss && (
        <Button
          variant="plain"
          tone="secondary"
          size="sm"
          aria-label={dismissLabel}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            const button = event.currentTarget;
            const target = focusTarget(button.closest('[data-ouro="alert"]')!);
            onDismiss();
            // Once the app has removed the alert, the close button's focus would fall to <body>.
            requestAnimationFrame(() => {
              if (!button.isConnected && (document.activeElement === null || document.activeElement === document.body)) target?.focus();
            });
          }}
          className="-my-1.5 -me-2 w-(--ouro-button-h) px-0"
        >
          <CloseIcon aria-hidden="true" className="size-4" />
        </Button>
      )}
    </div>
  );
}
