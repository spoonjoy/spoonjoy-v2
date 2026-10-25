import { useFetcher } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";

export interface BlockedChefRow {
  id: string;
  username: string;
}

function BlockedChef({ chef }: { chef: BlockedChefRow }) {
  const fetcher = useFetcher();
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <Link href={`/users/${chef.username}`}>@{chef.username}</Link>
      <fetcher.Form method="post" action="/moderation">
        <input type="hidden" name="intent" value="unblock" />
        <input type="hidden" name="chefId" value={chef.id} />
        <Button type="submit" variant="outline" tone="secondary" disabled={fetcher.state !== "idle"}>
          Unblock
        </Button>
      </fetcher.Form>
    </li>
  );
}

/** Settings: the chefs this chef blocked, each with an Unblock button. */
export function BlockedChefsSection({ chefs }: { chefs: readonly BlockedChefRow[] }) {
  return (
    <div id="blocked-chefs">
      <Card as="section" headingLevel={2} stackBelow="sm" className="my-4" data-testid="blocked-chefs-section" title="Blocked chefs">
        {chefs.length > 0 ? (
          <ul className="divide-y divide-[var(--sj-border)]">
            {chefs.map((chef) => <BlockedChef key={chef.id} chef={chef} />)}
          </ul>
        ) : (
          <Text tone="muted">
            You haven't blocked anyone. To block a chef, choose Report on their recipe or profile.
          </Text>
        )}
      </Card>
    </div>
  );
}
