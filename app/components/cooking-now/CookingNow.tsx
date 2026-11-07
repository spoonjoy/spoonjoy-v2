import { useEffect, useState } from "react";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { useCookingNow } from "~/hooks/use-cooking-now";
import { listImageProps } from "~/lib/image-loading";
import {
  cookingNowBannerEntry,
  cookingNowProgress,
  cookingNowStepLabel,
  type CookingNowEntry,
} from "~/lib/cooking-now";
import { soonestRunningCookTimerSeconds } from "~/lib/cook-timers";
import { formatDuration } from "~/lib/ouro/use-timer";

/** The id the strip is reached by, from the nav's "Cooking" pill. */
export const COOKING_NOW_ANCHOR = "cooking-now";

/**
 * The recipes the cook has in progress, one card each: the photo, the title, the step they are on,
 * how much is checked, and a running timer. Each card opens its recipe here or in a new window.
 * When exactly one recipe was touched in the last two hours, its card leads the strip as the
 * "Back to <recipe>" card, so the Kitchen never names the same recipe twice. Never a redirect.
 */
export function CookingNowStrip({ entries, now }: { entries: readonly CookingNowEntry[]; now: number }) {
  if (entries.length === 0) return null;
  const hero = cookingNowBannerEntry(entries, now);
  const rest = hero ? entries.filter((entry) => entry !== hero) : entries;

  return (
    <section
      id={COOKING_NOW_ANCHOR}
      aria-labelledby="cooking-now-heading"
      data-testid="cooking-now-strip"
      className="mb-10 scroll-mt-24 border-b border-[var(--sj-border-strong)] pb-8"
    >
      <div className="flex items-end justify-between gap-4 border-b border-[var(--sj-border)] pb-3">
        <div>
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[color-mix(in_srgb,var(--sj-brass)_80%,var(--sj-ink))]">On the stove</p>
          <h2 id="cooking-now-heading" className="font-sj-display mt-1 text-2xl/8 font-semibold text-[var(--sj-ink)]">
            Cooking now
          </h2>
        </div>
        <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
          {entries.length} {entries.length === 1 ? "recipe" : "recipes"}
        </p>
      </div>
      {hero ? <CookingNowHero entry={hero} /> : null}
      {rest.length > 0 ? (
        // A phone scrolls the cards sideways; a wider window lays them out in a grid.
        <ul data-fold-spread="" className="m-0 -mx-4 flex list-none snap-x snap-mandatory gap-6 overflow-x-auto px-4 pt-6 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-4">
          {rest.map((entry, index) => (
            <li key={entry.recipe.id} className="w-[min(17rem,78vw)] shrink-0 snap-start sm:w-auto">
              <CookingNowCard entry={entry} index={index} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The recipe's cover, or a quiet paper-toned plate with the dish's initial when it has none. */
function CookingNowCover({ entry, index, className }: { entry: CookingNowEntry; index: number; className: string }) {
  if (entry.recipe.coverImageUrl) {
    return (
      <div className={`sj-photo-tile overflow-hidden bg-[var(--sj-flour)] ${className}`}>
        <img src={entry.recipe.coverImageUrl} alt="" {...listImageProps(index)} className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="cooking-now-cover-placeholder"
      className={`flex items-center justify-center border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-brass)_9%,var(--sj-paper))] ${className}`}
    >
      <span className="font-sj-display text-5xl font-semibold text-[var(--sj-brass)]">
        {entry.recipe.title.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function CookingNowProgress({ entry }: { entry: CookingNowEntry }) {
  const stepLabel = cookingNowStepLabel(entry);
  const progress = cookingNowProgress(entry);
  return (
    <>
      <div className="font-sj-ui mt-2 flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
        {stepLabel ? <span data-testid="cooking-now-step">{stepLabel}</span> : <span />}
        <CookingNowTimer recipeId={entry.recipe.id} />
      </div>
      {entry.totalCount > 0 ? (
        <div className="mt-3">
          <div aria-hidden="true" className="h-1 w-full bg-[var(--sj-border)]">
            <div className="h-1 bg-[var(--sj-brass)]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="font-sj-ui mt-2 text-xs text-[var(--sj-ink-soft)]" data-testid="cooking-now-checked">
            {entry.checkedCount} of {entry.totalCount} checked
          </p>
        </div>
      ) : null}
    </>
  );
}

function NewWindowLink({ entry }: { entry: CookingNowEntry }) {
  return (
    <Link href={entry.recipe.href} external tone="secondary" aria-label={`Open in new window: ${entry.recipe.title}`}>
      Open in new window
    </Link>
  );
}

/** The one recipe just cooked, leading the strip with Back to it. */
function CookingNowHero({ entry }: { entry: CookingNowEntry }) {
  const titleId = `cooking-now-${entry.recipe.id}-title`;
  return (
    <article
      aria-labelledby={titleId}
      data-testid="cooking-now-hero"
      data-fold-spread=""
      className="grid gap-5 pt-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-8"
    >
      <CookingNowCover entry={entry} index={0} className="aspect-[3/2] max-h-60 w-full" />
      <div className="min-w-0">
        <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[color-mix(in_srgb,var(--sj-brass)_80%,var(--sj-ink))]">You were cooking</p>
        <h3 id={titleId} className="font-sj-display mt-2 line-clamp-2 text-3xl/9 font-semibold text-[var(--sj-ink)]">
          {entry.recipe.title}
        </h3>
        <div className="max-w-sm">
          <CookingNowProgress entry={entry} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button href={entry.recipe.href}>Back to {entry.recipe.title}</Button>
          <NewWindowLink entry={entry} />
        </div>
      </div>
    </article>
  );
}

function CookingNowCard({ entry, index }: { entry: CookingNowEntry; index: number }) {
  const titleId = `cooking-now-${entry.recipe.id}-title`;

  return (
    <article aria-labelledby={titleId} data-testid={`cooking-now-card-${entry.recipe.id}`} className="flex h-full flex-col">
      <CookingNowCover entry={entry} index={index} className="aspect-[3/2] max-h-44 w-full" />
      <h3 id={titleId} className="font-sj-display mt-4 line-clamp-2 text-xl/7 font-extrabold text-[var(--sj-ink)]">
        {entry.recipe.title}
      </h3>
      <CookingNowProgress entry={entry} />
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4">
        <Button href={entry.recipe.href} variant="plain" aria-label={`Open ${entry.recipe.title}`}>
          Open
        </Button>
        <NewWindowLink entry={entry} />
      </div>
    </article>
  );
}

/** The soonest running timer this browser has for the recipe, counting down; nothing when none runs. */
function CookingNowTimer({ recipeId }: { recipeId: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const seconds = soonestRunningCookTimerSeconds(recipeId, Date.now());
      setLabel(seconds === null ? null : formatDuration(seconds));
    };
    read();
    const interval = window.setInterval(read, 1000);
    return () => window.clearInterval(interval);
  }, [recipeId]);

  if (label === null) return null;
  return (
    <span data-testid="cooking-now-timer" className="tabular-nums text-[var(--sj-tomato)]">
      <span className="sr-only">Timer </span>
      {label}
    </span>
  );
}

/**
 * The signed-out home's Cooking now strip, read from this browser after hydration (the server has
 * no list for a signed-out cook).
 */
export function LocalCookingNow() {
  const { entries, now } = useCookingNow(false);
  const shown = entries.length > 0;
  // The Cooking pill links to /#cooking-now. This strip appears only after hydration, after the router
  // has looked for that id and found nothing, so it brings itself into view when it appears.
  useEffect(() => {
    if (shown && window.location.hash === `#${COOKING_NOW_ANCHOR}`) document.getElementById(COOKING_NOW_ANCHOR)?.scrollIntoView();
  }, [shown]);
  if (!shown) return null;

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 sm:px-8 lg:px-12" data-testid="local-cooking-now">
      <CookingNowStrip entries={entries} now={now} />
    </div>
  );
}

/** The nav's "Cooking · N" pill, which opens the Kitchen's Cooking now strip. */
export function CookingNowPill({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Button href={`/#${COOKING_NOW_ANCHOR}`} variant="plain" data-testid="cooking-now-pill">
      Cooking · {count}
    </Button>
  );
}
