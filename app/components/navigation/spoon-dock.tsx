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
        "fixed bottom-0 left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))]",
        "mx-auto grid h-17 max-w-lg grid-cols-[minmax(0,0.9fr)_minmax(4.75rem,auto)_auto] items-center gap-2",
        "rounded-full border border-[var(--sj-photo-line)] bg-[color-mix(in_srgb,var(--sj-charcoal)_92%,transparent)] p-2 text-[var(--sj-on-photo)] shadow-[var(--sj-shadow)] backdrop-blur-xl",
        "z-50 mb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </nav>
  );
}
