import clsx from "clsx";
import type { ReactNode } from "react";

export function CookbookPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("sj-page", className)}>
      <div className="sj-page-frame">{children}</div>
    </div>
  );
}

// TODO(ouro-hx: page-header, spoonjoy/spoonjoy-v2#570): A page's title area with its eyebrow, actions and media becomes HX's PageHeader in #570.
export function CookbookHeader({
  eyebrow,
  title,
  children,
  action,
  ruled = true,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  ruled?: boolean;
}) {
  return (
    <header
      className={clsx(
        ruled ? "sj-rule-block" : null,
        "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
      )}
    >
      <div className="min-w-0">
        <p className="sj-eyebrow">{eyebrow}</p>
        <h1 className="font-sj-display mt-2 max-w-5xl text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-5xl/12 lg:text-6xl/14">
          {title}
        </h1>
        {children ? <div className="mt-3 max-w-2xl text-base/7 text-[var(--sj-ink-soft)]">{children}</div> : null}
      </div>
      {action ? <div className="flex min-w-0 flex-wrap gap-2 md:justify-end">{action}</div> : null}
    </header>
  );
}

export function CookbookSectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={clsx(
        "font-sj-display my-5 flex items-center gap-3 text-2xl/7 font-semibold text-[var(--sj-ink)] after:flex-1 after:border-t after:border-[var(--sj-border)]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function RuledEmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-y border-dashed border-[var(--sj-border-strong)] py-8">
      <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{title}</h2>
      {children ? <div className="mt-2 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SettingsPanel({
  title,
  children,
  action,
  testId,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="border-b border-[var(--sj-border)] py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
