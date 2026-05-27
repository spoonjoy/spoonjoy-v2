import clsx from "clsx";
import type { ElementType } from "react";
import { Link } from "~/components/ui/link";

export interface DockItemProps {
  icon: ElementType;
  label: string;
  sublabel?: string;
  ariaLabel?: string;
  href?: string;
  active?: boolean;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  onClick?: () => void;
  variant?: "place" | "primary" | "tool";
  tone?: "default" | "primary" | "danger" | "quiet";
}

export function DockItem({
  icon: Icon,
  label,
  sublabel,
  ariaLabel,
  href,
  active = false,
  className,
  iconClassName,
  labelClassName,
  onClick,
  variant = "tool",
  tone = "default",
}: DockItemProps) {
  const isPlace = variant === "place";
  const isPrimary = variant === "primary";

  const baseClassName = clsx(
    "min-h-[50px] rounded-full border-0 no-underline transition duration-150 active:scale-95",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-on-photo)]",
    isPlace && "flex min-w-0 items-center gap-2.5 bg-[color-mix(in_srgb,var(--sj-on-photo)_10%,transparent)] px-3 text-left",
    isPrimary && [
      "grid min-w-[4.75rem] place-items-center px-4 font-sj-ui text-sm font-bold",
      tone === "danger"
        ? "bg-[var(--sj-tomato)] text-[var(--sj-on-photo)]"
        : "bg-[var(--sj-action)] text-[var(--sj-on-photo)]",
    ],
    variant === "tool" && "grid w-[50px] place-items-center bg-[color-mix(in_srgb,var(--sj-on-photo)_10%,transparent)]",
    active && "dock-item-active",
    className,
  );

  const content = (
    <>
      {!isPrimary && (
        <Icon
          className={clsx(
            "h-5 w-5 shrink-0 text-[var(--sj-on-photo-soft)]",
            active && "text-[var(--sj-on-photo)]",
            iconClassName,
          )}
          aria-hidden="true"
        />
      )}
      {isPlace ? (
        <span className="min-w-0">
          <span
            className={clsx(
              "block whitespace-nowrap font-sj-ui text-sm font-bold leading-[1.05] text-[var(--sj-on-photo)]",
              labelClassName,
            )}
          >
            {label}
          </span>
          {sublabel ? (
            <span className="mt-1 block whitespace-nowrap font-sj-ui text-[0.62rem] font-bold uppercase leading-[1.05] tracking-[0.12em] text-[var(--sj-on-photo-soft)]">
              {sublabel}
            </span>
          ) : null}
        </span>
      ) : null}
      {isPrimary ? <span className={labelClassName}>{label}</span> : null}
      {variant === "tool" ? <span className="sr-only">{label}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={baseClassName}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={baseClassName} aria-label={ariaLabel}>
      {content}
    </button>
  );
}
