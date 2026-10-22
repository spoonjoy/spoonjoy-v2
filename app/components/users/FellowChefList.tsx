import { Avatar } from "~/components/ouro/avatar/avatar";
import { chefDisplayName } from "~/lib/username";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";
import type { FellowChefRow } from "~/lib/fellow-chefs.server";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";

export interface FellowChefListRow extends FellowChefRow {
  latestInteractionLabel: string;
}

export interface FellowChefListProps {
  /** The list's name for screen readers: the page's title already shows it. */
  label: string;
  rows: FellowChefListRow[];
  emptyStateText: string;
}

function summarizeInteractions(counts: {
  spoons: number;
  forks: number;
  cookbookSaves: number;
}): string {
  const parts: string[] = [];
  if (counts.spoons > 0) {
    parts.push(`${counts.spoons} ${counts.spoons === 1 ? "spoon" : "spoons"}`);
  }
  if (counts.forks > 0) {
    parts.push(`${counts.forks} ${counts.forks === 1 ? "fork" : "forks"}`);
  }
  if (counts.cookbookSaves > 0) {
    parts.push(
      `${counts.cookbookSaves} ${counts.cookbookSaves === 1 ? "save" : "saves"}`,
    );
  }
  return parts.join(" · ");
}

export function FellowChefList({ label, rows, emptyStateText }: FellowChefListProps) {
  return (
    <ItemGroup aria-label={label} variant="divided" empty={<Text tone="muted">{emptyStateText}</Text>}>
      {rows.map((row) => (
        <Item
          key={row.chefId}
          href={`/users/${row.username}`}
          title={chefDisplayName(row.username)}
          description={summarizeInteractions(row.interactionCounts) || undefined}
          media={
            <Avatar
              name={chefDisplayName(row.username)}
              src={resolveChefAvatarUrl(row.photoUrl)}
              alt=""
              initials={row.username.charAt(0).toUpperCase()}
              size="md"
            />
          }
          actions={<Text size="sm" tone="muted">{row.latestInteractionLabel}</Text>}
        />
      ))}
    </ItemGroup>
  );
}
