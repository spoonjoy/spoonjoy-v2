import clsx from "clsx";

export interface SpoonDockProps {
  children?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}

export function SpoonDock({
  children,
  className,
  "aria-label": ariaLabel = "Spoonjoy navigation",
  ...props
}: SpoonDockProps) {
  return (
    <nav
      role="navigation"
      aria-label={ariaLabel}
      className={clsx(
        "fixed bottom-0 left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))]",
        // Distribute place / primary / tools edge-to-edge with equal gaps so the
        // dock always fills its width with deliberate rhythm — never a lopsided
        // void, never crowded. `gap-*` is the minimum spacing; justify-between
        // spreads the remaining slack evenly. Items keep their natural width
        // (flex-shrink only) so the 3-tool worst case never spills at 320px
        // (guarded by e2e/flows/spoondock-responsive.spec.ts).
        "mx-auto flex h-17 max-w-lg items-center justify-between gap-2 max-[389px]:gap-1",
        // Solid dark fill (no backdrop-filter): a `backdrop-blur` on a
        // position:fixed element is a known iOS Safari bug that detaches/
        // mis-positions the element during scroll (the dock "not sticking to
        // the bottom"). A solid surface + border + shadow keeps it pinned and
        // still reads as an elevated dark pill.
        "rounded-full border border-[var(--sj-photo-line)] bg-[var(--sj-photo-charcoal)] p-2 max-[389px]:p-1.5 text-[var(--sj-on-photo)] shadow-[var(--sj-shadow)]",
        "z-50 mb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </nav>
  );
}
