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
    // Place item: label shown on wider phones; collapses to a centered
    // icon (min 48px touch target) at <=389px so the dock never crushes it
    // or spills the label on iPhone 13 mini / SE / 5 widths.
    isPlace && "flex min-w-0 items-center gap-2 overflow-hidden bg-[color-mix(in_srgb,var(--sj-on-photo)_10%,transparent)] px-3 text-left max-[389px]:w-12 max-[389px]:justify-center max-[389px]:gap-0 max-[389px]:px-0",
    isPrimary && [
      "grid min-w-[4.75rem] place-items-center px-4 font-sj-ui text-sm font-bold max-[389px]:min-w-[3.5rem] max-[389px]:px-2.5",
      // The dock is an always-dark glass surface, so the primary fill must use
      // an on-photo accent. `--sj-brass` reads clearly on the charcoal in both
      // light and dark themes; `--sj-action` is dark in light mode and would
      // make this — the most important action — invisible (dark-on-dark).
      tone === "danger"
        ? "bg-[var(--sj-tomato)] text-[var(--sj-on-photo)]"
        : "bg-[var(--sj-brass)] text-[var(--sj-on-photo)]",
    ],
    variant === "tool" && "grid w-[50px] place-items-center bg-[color-mix(in_srgb,var(--sj-on-photo)_10%,transparent)] max-[389px]:w-11",
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
        <span className="min-w-0 max-[389px]:sr-only">
          <span
            className={clsx(
              "block truncate font-sj-ui text-sm font-bold leading-[1.05] text-[var(--sj-on-photo)]",
              labelClassName,
            )}
          >
            {label}
          </span>
          {sublabel ? (
            <span className="mt-1 block truncate font-sj-ui text-[0.62rem] font-bold uppercase leading-[1.05] tracking-[0.12em] text-[var(--sj-on-photo-soft)]">
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
