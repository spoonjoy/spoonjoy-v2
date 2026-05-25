import clsx from "clsx";
import type { ReactNode } from "react";
import { ChefHat } from "lucide-react";
import { Link } from "~/components/ui/link";

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

export function CookbookHeader({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="sj-rule-block grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div>
        <p className="sj-eyebrow">{eyebrow}</p>
        <h1 className="font-sj-display mt-2 max-w-5xl text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-5xl/12 lg:text-6xl/14">
          {title}
        </h1>
        {children ? <div className="mt-3 max-w-2xl text-base/7 text-[var(--sj-ink-soft)]">{children}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2 md:justify-end">{action}</div> : null}
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

export function FoodHero({
  imageUrl,
  title,
  eyebrow = "Recipe",
  href,
  children,
  className,
}: {
  imageUrl?: string | null;
  title: string;
  eyebrow?: string;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const content = (
    <figure className={clsx("sj-food-photo relative -mx-5 overflow-hidden sm:-mx-6 lg:mx-0", className)}>
      <div className="aspect-[5/4] sm:aspect-[16/9] lg:aspect-[16/10]">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--sj-photo-charcoal)]">
            <ChefHat className="size-10 text-[var(--sj-on-photo-muted)]" aria-hidden="true" />
          </div>
        )}
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-7">
        <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-on-photo-muted)]">
          {eyebrow}
        </p>
        <h2 className="font-sj-display mt-1 max-w-3xl text-4xl/10 font-semibold text-[var(--sj-on-photo)] sm:text-5xl/12">
          {title}
        </h2>
        {children ? <div className="mt-3 max-w-2xl text-sm/6 text-[var(--sj-on-photo-muted)]">{children}</div> : null}
      </figcaption>
    </figure>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block no-underline">
      {content}
    </Link>
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

export function ObjectRow({
  href,
  imageUrl,
  title,
  subtitle,
  stamp,
}: {
  href: string;
  imageUrl?: string | null;
  title: string;
  subtitle?: string | null;
  stamp?: string;
}) {
  return (
    <Link href={href} className="group grid min-h-17 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 py-3 no-underline">
      <div className="aspect-square overflow-hidden border border-[var(--sj-border)] bg-[var(--sj-flour)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0">
        <span className="line-clamp-2 font-sj-ui text-base/5 font-bold text-[var(--sj-ink)] group-hover:text-[var(--sj-tomato)]">
          {title}
        </span>
        {subtitle ? <span className="mt-0.5 line-clamp-2 text-sm/5 text-[var(--sj-ink-soft)]">{subtitle}</span> : null}
      </div>
      {stamp ? (
        <span className="font-sj-ui text-xs font-bold uppercase tracking-[0.12em] text-[var(--sj-brass)]">{stamp}</span>
      ) : null}
    </Link>
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
