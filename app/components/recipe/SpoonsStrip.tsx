import type { ReactNode } from "react";
import { ChefHat } from "lucide-react";
import { ShowMore } from "~/components/ouro/collapsible/show-more";
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { LAZY_IMAGE_PROPS } from "~/lib/image-loading";

export interface SpoonsStripRecipe {
  id: string;
  title: string;
  chefId: string;
}

export interface SpoonsStripItem {
  id: string;
  cookedAt: string;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  chef: { id: string; username: string; photoUrl: string | null };
  recipe?: SpoonsStripRecipe | null;
  coverImageUrl?: string | null;
  coverProvenanceLabel?: string | null;
}

export interface SpoonsStripProps {
  spoons: SpoonsStripItem[];
  showRecipe?: boolean;
  emptyAction?: ReactNode;
  /**
   * The time the cooks' relative times are measured from, in epoch milliseconds: the loader's
   * render time, so the server and the hydrating browser render the same text. Defaults to the
   * clock, which only suits client-only renders.
   */
  now?: number;
}

function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.round(days / 365);
  return `${years} yr ago`;
}

function CookedAt({ iso, now }: { iso: string; now: number }) {
  return <time dateTime={iso}>{relativeTime(iso, now)}</time>;
}

function NextTime({ text }: { text: string }) {
  return <Text size="sm"><strong>Next time:</strong> {text}</Text>;
}

/** A chef's cooks across recipes: each an HX Item linked to the recipe, with the cook's photo or the recipe's cover. */
function CompactSpoonList({ spoons, now }: { spoons: SpoonsStripItem[]; now: number }) {
  return (
    <ItemGroup aria-label="Recent cooks" variant="divided">
      {spoons.map((spoon) => {
        const imageUrl = spoon.photoUrl ?? spoon.coverImageUrl;
        const alt = spoon.photoUrl ? `Cook by ${spoon.chef.username}` : spoon.recipe ? `${spoon.recipe.title} cover` : "";
        const description = (
          <>
            <Text size="sm">{spoon.chef.username} cooked this</Text>
            {spoon.note ? <Text size="sm" lines={2}>{spoon.note}</Text> : null}
            {spoon.nextTime ? <NextTime text={spoon.nextTime} /> : null}
          </>
        );
        const shared = {
          description,
          media: imageUrl ? <img src={imageUrl} alt={alt} {...LAZY_IMAGE_PROPS} /> : <ChefHat />,
          mediaSize: imageUrl ? ("md" as const) : ("icon" as const),
          actions: <Text size="sm" tone="muted"><CookedAt iso={spoon.cookedAt} now={now} /></Text>,
        };
        return spoon.recipe ? (
          <Item key={spoon.id} href={`/recipes/${spoon.recipe.id}`} title={spoon.recipe.title} {...shared} />
        ) : (
          <Item key={spoon.id} title={spoon.chef.username} {...shared} />
        );
      })}
    </ItemGroup>
  );
}

export function SpoonsStrip({ spoons, showRecipe = false, emptyAction, now = Date.now() }: SpoonsStripProps) {
  if (spoons.length === 0) {
    return <Empty title="No cooks yet." headingLevel={3} variant="plain" align="start" action={emptyAction} />;
  }

  if (showRecipe) {
    return <CompactSpoonList spoons={spoons} now={now} />;
  }

  return (
    <ItemGroup aria-label="Cooks" variant="divided">
      {spoons.map((spoon) => (
        <Item
          key={spoon.id}
          title={<Link href={`/users/${spoon.chef.username}`}>{spoon.chef.username}</Link>}
          description={
            spoon.note || spoon.nextTime ? (
              <>
                {spoon.note ? <ShowMore lines={4}><Text size="sm" className="whitespace-pre-wrap">{spoon.note}</Text></ShowMore> : null}
                {spoon.nextTime ? <NextTime text={spoon.nextTime} /> : null}
              </>
            ) : undefined
          }
          {...(spoon.photoUrl ? {
            media: <img src={spoon.photoUrl} alt={`Cook by ${spoon.chef.username}`} {...LAZY_IMAGE_PROPS} />,
            mediaSize: "lg" as const,
            mediaAbove: "always" as const,
          } : {})}
          actions={<Text size="sm" tone="muted"><CookedAt iso={spoon.cookedAt} now={now} /></Text>}
        />
      ))}
    </ItemGroup>
  );
}
