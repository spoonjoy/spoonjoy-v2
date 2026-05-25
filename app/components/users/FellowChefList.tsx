import { Avatar } from "~/components/ui/avatar";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { formatRelativeTime } from "~/lib/time";
import type { FellowChefRow } from "~/lib/fellow-chefs.server";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";

export interface FellowChefListProps {
  rows: FellowChefRow[];
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

export function FellowChefList({ rows, emptyStateText }: FellowChefListProps) {
  if (rows.length === 0) {
    return <Text>{emptyStateText}</Text>;
  }

  return (
    <ul className="sj-list-ruled">
      {rows.map((row) => {
        const summary = summarizeInteractions(row.interactionCounts);
        const initials = row.username.charAt(0).toUpperCase();
        return (
          <li key={row.chefId}>
            <Link
              href={`/users/${row.username}`}
              className="grid min-h-17 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 no-underline"
            >
              <Avatar
                src={resolveChefAvatarUrl(row.photoUrl)}
                alt={row.username}
                initials={initials}
                className="size-10 border border-[var(--sj-border)] bg-[var(--sj-flour)] text-[var(--sj-ink)]"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="sj-link font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                  {row.username}
                </span>
              {summary ? (
                <Text className="text-xs text-[var(--sj-ink-soft)]">
                  {summary}
                </Text>
              ) : null}
              </div>
              <Text className="font-sj-ui text-xs uppercase tracking-[0.12em] text-[var(--sj-ink-soft)]">
                {formatRelativeTime(row.latestInteractionAt)}
              </Text>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
