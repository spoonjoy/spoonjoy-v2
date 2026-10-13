import type { ComponentProps } from "react";
import { Link } from "react-router";
import type { OuroLinkComponent } from "~/lib/ouro/use-ouro";

/**
 * Renders Ouro UI's internal `href`s (its Link, and a Button with `href`) through React Router, so
 * they navigate without a page load. The root layout gives it to `OuroProvider`.
 */
export function OuroRouterLink({ href, ...props }: ComponentProps<OuroLinkComponent>) {
  return <Link to={href} {...props} />;
}
