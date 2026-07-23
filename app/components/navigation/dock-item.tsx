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
  disabled?: boolean;
  ariaPressed?: boolean;
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
  disabled = false,
  ariaPressed,
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
    "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
    // Place item: label shown on wider phones; collapses to a centered
    // icon (min 48px touch target) at <=389px so the dock never crushes it
    // or spills the label on iPhone 13 mini / SE / 5 widths.
    isPlace && "flex min-w-0 items-center gap-2 overflow-hidden bg-[color-mix(in_srgb,var(--sj-on-photo)_10%,transparent)] px-3 text-left max-[389px]:w-12 max-[389px]:justify-center max-[389px]:gap-0 max-[389px]:px-0",
    isPrimary && [
      // A circular brass FAB — the hero. Same round language as the tools but
      // larger and brass-filled so it reads as the primary action. (Rendering a
      // text label in a wide pill turned a single "+" into a stretched oval next
      // to the round tools.) The dock is an always-dark glass surface, so the
      // fill uses an on-photo accent: `--sj-brass` reads on charcoal in both
      // themes, where `--sj-action` would be dark-on-dark in light mode.
      "grid size-14 place-items-center max-[389px]:size-13",
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
      <Icon
        className={clsx(
          "shrink-0",
          // Primary: a larger cream glyph centered in the brass circle. Others:
          // smaller, lower-contrast until active.
          isPrimary ? "h-6 w-6 text-[var(--sj-on-photo)]" : "h-5 w-5 text-[var(--sj-on-photo-soft)]",
          !isPrimary && active && "text-[var(--sj-on-photo)]",
          iconClassName,
        )}
        aria-hidden="true"
      />
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
      {isPrimary ? <span className={clsx("sr-only", labelClassName)}>{label}</span> : null}
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
    <button
      type="button"
      onClick={onClick}
      className={baseClassName}
      aria-label={ariaLabel}
      disabled={disabled}
      aria-disabled={disabled ? true : undefined}
      aria-pressed={ariaPressed}
    >
      {content}
    </button>
  );
}
