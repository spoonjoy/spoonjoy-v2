import { Button as OuroButton, type ButtonProps as OuroButtonProps } from "~/components/ouro/button/button";
import { OuroProvider } from "~/lib/ouro/ouro-provider";

type ActionRole =
  | { plain: true; variant?: never; tone?: never }
  | { plain?: false; variant?: "default" | "destructive"; tone?: never };
type AppRole<T> = T extends unknown
  ? Omit<T, "variant" | "tone"> & ActionRole & (T extends { href: string } ? { reloadDocument?: boolean } : { reloadDocument?: never })
  : never;

/** App action roles; the installed component owns interaction, focus, loading and touch targets. */
export function Button({ plain, variant, reloadDocument, ...props }: AppRole<OuroButtonProps>) {
  const role = plain ? "quiet" : variant === "destructive" ? "destructive" : "primary";
  const button = <OuroButton
    {...props}
    data-sj-action={role}
    variant={plain ? "outline" : variant === "destructive" ? "soft" : "solid"}
    tone={variant === "destructive" ? "destructive" : plain ? "secondary" : "primary"}
  />;
  // OAuth start and downloads must make document requests, not Router data requests.
  // A local supported provider uses Ouro's native-anchor default; the app's provider stays intact.
  return reloadDocument ? <OuroProvider>{button}</OuroProvider> : button;
}
