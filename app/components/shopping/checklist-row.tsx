import clsx from "clsx";
import type { ReactNode } from "react";

export function ChecklistRow({
  checked = false,
  name,
  quantity,
  note,
  onToggle,
  onPress,
  pressAriaLabel,
  action,
  quantityTestId,
}: {
  checked?: boolean;
  name: string;
  quantity?: string | null;
  note?: string | null;
  onToggle?: () => void;
  onPress?: () => void;
  pressAriaLabel?: string;
  action?: ReactNode;
  quantityTestId?: string;
}) {
  const displayedQuantity = quantity && quantity.trim() ? quantity : "\u00A0";
  const strike = checked ? (
    <span
      aria-hidden="true"
      data-testid="checklist-row-strike"
      className="sj-checklist-strike pointer-events-none absolute left-0 right-0 top-[0.78rem] h-[2px] bg-[color-mix(in_srgb,var(--sj-ink-soft)_82%,transparent)]"
    />
  ) : null;

  const check = (
    <span
      aria-hidden="true"
      className={clsx(
        "grid size-6 place-items-center rounded-[var(--sj-radius-control)] border-2 font-sj-ui text-sm font-bold",
        checked
          ? "border-[var(--sj-ink)] bg-[var(--sj-ink)] text-[var(--sj-paper)]"
          : "border-[var(--sj-border-strong)] bg-transparent text-transparent",
      )}
    >
      {checked ? "✓" : ""}
    </span>
  );

  const labelContent = (
    <span className="min-w-0">
      <span
        className={clsx(
          "block truncate font-sj-ui text-base text-[var(--sj-ink)]",
          checked && "text-[var(--sj-ink-soft)]",
        )}
      >
        {name}
      </span>
      {note ? <span className="mt-0.5 block truncate text-xs text-[var(--sj-ink-soft)]">{note}</span> : null}
    </span>
  );

  const quantityContent = (
    <span
      data-testid={quantityTestId}
      className={clsx(
        "max-w-[8.5rem] break-words text-right font-sj-ui text-sm tabular-nums text-[var(--sj-ink)]",
        checked && "text-[var(--sj-ink-soft)]",
      )}
    >
      {displayedQuantity}
    </span>
  );

  const contentGroup = (includeAction: boolean) => (
    <span className="relative grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(3.75rem,auto)] items-start gap-3">
      {labelContent}
      <span className="flex items-start gap-2">
        {quantityContent}
        {includeAction ? action : null}
      </span>
      {strike}
    </span>
  );

  const rowContent = (
    <>
      {check}
      {contentGroup(true)}
    </>
  );

  const rowBaseClassName = clsx(
    "grid min-h-14 items-center gap-3 py-2",
    checked && "opacity-72",
  );
  const rowClassName = clsx(rowBaseClassName, "grid-cols-[2rem_minmax(0,1fr)]");

  if (onToggle) {
    if (action) {
      return (
        <div className={clsx(rowBaseClassName, "grid-cols-[minmax(0,1fr)_auto]")}>
          <button
            type="button"
            onClick={onToggle}
            className="grid min-h-11 min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 text-left"
            role="checkbox"
            aria-checked={checked}
            aria-label={name}
          >
            {check}
            {contentGroup(false)}
          </button>
          {action}
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={onToggle}
        className={clsx(rowClassName, "w-full text-left")}
        role="checkbox"
        aria-checked={checked}
        aria-label={name}
      >
        {rowContent}
      </button>
    );
  }

  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        className={clsx(rowClassName, "w-full text-left")}
        aria-label={pressAriaLabel ?? name}
      >
        {rowContent}
      </button>
    );
  }

  return (
    <div className={rowClassName}>
      {rowContent}
    </div>
  );
}
