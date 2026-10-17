import type { ComponentProps } from "react";
import { Text as OuroText } from "~/components/ouro/text/text";
import { cn } from "~/lib/ouro/cn";

/** Spoonjoy's body copy is secondary by default; status text can opt into a released tone. */
export function Text({ tone = "muted", size = "md", className, ...props }: ComponentProps<typeof OuroText>) {
  return <OuroText {...props} tone={tone} size={size} className={cn(size === "md" && "leading-6", className)} />;
}
