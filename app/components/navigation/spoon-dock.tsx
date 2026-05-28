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
        // Left column flexes (absorbing slack) while the primary and tools stay
        // auto-width, so the up-to-3 tool cluster never spills at the narrowest
        // phones. Symmetric side columns would center the primary but clip the
        // 3-tool worst case (see e2e/flows/spoondock-responsive.spec.ts).
        "mx-auto grid h-17 max-w-lg grid-cols-[minmax(3rem,0.9fr)_auto_auto] items-center gap-2 max-[389px]:gap-1",
        "rounded-full border border-[var(--sj-photo-line)] bg-[color-mix(in_srgb,var(--sj-charcoal)_92%,transparent)] p-2 max-[389px]:p-1.5 text-[var(--sj-on-photo)] shadow-[var(--sj-shadow)] backdrop-blur-xl",
        "z-50 mb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </nav>
  );
}
