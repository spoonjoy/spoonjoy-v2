import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";

type AppLinkProps = Omit<ComponentProps<typeof RouterLink>, "to"> & { href: string };

/** App-owned rich-row navigation, not a text-link visual. Preserve native protocol handling. */
export function Link({ href, target, rel, reloadDocument, ...props }: AppLinkProps) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
    const web = /^(?:https?:|\/\/)/i.test(href);
    const destination = target ?? (web ? "_blank" : undefined);
    return <a {...props} href={href} target={destination} rel={destination === "_blank" ? [...new Set(`${rel ?? ""} noopener noreferrer`.trim().split(/\s+/))].join(" ") : rel} />;
  }
  return <RouterLink {...props} to={href} target={target} rel={rel} reloadDocument={reloadDocument} />;
}
