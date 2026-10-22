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
