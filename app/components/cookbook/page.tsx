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
