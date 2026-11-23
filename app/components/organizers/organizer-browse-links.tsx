// A row of links from a recipe list to the cook's tags, categories and tools.
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { ORGANIZER_KIND_COPY, ORGANIZER_KIND_ORDER } from "./organizer-kinds";

export function OrganizerBrowseLinks({ label }: { label: string }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Text size="sm" tone="muted" aria-hidden="true">Browse by</Text>
      {ORGANIZER_KIND_ORDER.map((kind) => (
        <Link key={kind} href={`/${ORGANIZER_KIND_COPY[kind].segment}`}>{ORGANIZER_KIND_COPY[kind].label}</Link>
      ))}
    </nav>
  );
}
