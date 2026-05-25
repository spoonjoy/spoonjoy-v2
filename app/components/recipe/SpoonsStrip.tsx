import { useState } from "react";
import { Link } from "react-router";
import { ChefHat } from "lucide-react";

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
}

export interface SpoonsStripProps {
  spoons: SpoonsStripItem[];
  showRecipe?: boolean;
}

const NOTE_TRUNCATE_AT = 180;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
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

function NoteBlock({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  if (note.length <= NOTE_TRUNCATE_AT) {
    return <p className="whitespace-pre-wrap text-sm">{note}</p>;
  }
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap text-sm">
        {expanded ? note : `${note.slice(0, NOTE_TRUNCATE_AT)}…`}
      </p>
      <button
        type="button"
        className="inline-flex min-h-11 items-center text-xs underline text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)]"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function CompactCookVisual({ spoon }: { spoon: SpoonsStripItem }) {
  const imageUrl = spoon.photoUrl ?? spoon.coverImageUrl;
  const alt = spoon.photoUrl
    ? `Cook by ${spoon.chef.username}`
    : spoon.recipe
      ? `${spoon.recipe.title} cover`
      : "";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className="aspect-square w-16 border border-[var(--sj-border)] object-cover"
      />
    );
  }

  return (
    <div
      className="flex aspect-square w-16 items-center justify-center border border-[var(--sj-border)] bg-[var(--sj-flour)] text-[var(--sj-ink-soft)]"
      aria-hidden="true"
    >
      <ChefHat className="size-5" />
    </div>
  );
}

function CompactSpoonList({ spoons }: { spoons: SpoonsStripItem[] }) {
  return (
    <ul className="sj-list-ruled">
      {spoons.map((spoon) => (
        <li key={spoon.id} className="py-3">
          <div className="grid min-h-20 grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
            <CompactCookVisual spoon={spoon} />
            <div className="min-w-0">
              {spoon.recipe ? (
                <Link
                  to={`/recipes/${spoon.recipe.id}`}
                  className="font-sj-ui inline-flex min-h-11 items-center text-base/5 font-bold text-[var(--sj-ink)] no-underline hover:text-[var(--sj-tomato)]"
                >
                  {spoon.recipe.title}
                </Link>
              ) : null}
              <p className="text-sm/5 text-[var(--sj-ink-soft)]">
                <span className="font-sj-ui font-semibold text-[var(--sj-ink)]">
                  {spoon.chef.username}
                </span>
                {" cooked this "}
                <span className="sm:hidden">{relativeTime(spoon.cookedAt)}</span>
              </p>
              {spoon.note ? (
                <p className="mt-1 line-clamp-2 text-sm/5 text-[var(--sj-ink)]">
                  {spoon.note}
                </p>
              ) : null}
              {spoon.nextTime ? (
                <p className="mt-1 line-clamp-1 text-sm/5 text-[var(--sj-ink-soft)]">
                  <span className="font-semibold text-[var(--sj-ink)]">Next time: </span>
                  {spoon.nextTime}
                </p>
              ) : null}
            </div>
            <span className="hidden font-sj-ui text-xs font-bold uppercase tracking-[0.12em] text-[var(--sj-brass)] sm:block">
              {relativeTime(spoon.cookedAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SpoonsStrip({ spoons, showRecipe = false }: SpoonsStripProps) {
  if (spoons.length === 0) {
    return (
      <p className="text-sm text-[var(--sj-ink-soft)]">
        No cooks yet — be the first.
      </p>
    );
  }

  if (showRecipe) {
    return <CompactSpoonList spoons={spoons} />;
  }

  return (
    <ul className="sj-list-ruled">
      {spoons.map((spoon) => (
        <li
          key={spoon.id}
          className="space-y-3 py-4"
        >
          <div className="flex items-center justify-between text-sm">
            <Link
              to={`/users/${spoon.chef.username}`}
              className="font-medium underline hover:text-[var(--sj-tomato)]"
            >
              {spoon.chef.username}
            </Link>
            <span className="text-[var(--sj-ink-soft)]">
              {relativeTime(spoon.cookedAt)}
            </span>
          </div>
          {spoon.photoUrl ? (
            <img
              src={spoon.photoUrl}
              alt={`Cook by ${spoon.chef.username}`}
              className="aspect-square w-full object-cover"
            />
          ) : null}
          {spoon.note ? <NoteBlock note={spoon.note} /> : null}
          {spoon.nextTime ? (
            <p className="text-sm">
              <span className="font-semibold">Next time: </span>
              {spoon.nextTime}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
