import clsx from "clsx";

export interface SpoonDockProps {
  children?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  /**
   * Center the primary (middle child) in the dock. Symmetric side columns put
   * the place item at the far left and the tools at the far right with the
   * primary dead-center. Pass `false` when the tools cluster is too wide to
   * leave room (the 3-tool recipe view at 320px), which falls back to an
   * edge-to-edge `justify-between` distribution that still fills the width
   * without spilling. Defaults to centered.
   */
  centered?: boolean;
}

export function SpoonDock({
  children,
  className,
  "aria-label": ariaLabel = "Spoonjoy navigation",
  centered = true,
  ...props
}: SpoonDockProps) {
  return (
    <nav
      role="navigation"
      aria-label={ariaLabel}
      className={clsx(
        "fixed bottom-0 left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))]",
        "mx-auto flex h-17 max-w-lg items-center gap-2 max-[389px]:gap-1",
        // Centered: the place + tools zones grow (flex-1) to fill all the space
        // — no bare dock shows between items — and because both side zones are
        // equal, the primary lands dead-center. Fallback: when the tools
        // cluster is full (3) there's no room to grow+center without squishing
        // touch targets below 44px, so distribute edge-to-edge with equal gaps,
        // which still fills the width without spilling (guarded by
        // e2e/flows/spoondock-responsive.spec.ts). MobileNav grows the zones.
        centered ? null : "justify-between",
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
