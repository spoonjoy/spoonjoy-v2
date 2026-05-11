import { useState } from "react";
import { Link } from "react-router";

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
        className="text-xs underline text-stone-600 dark:text-stone-400"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

export function SpoonsStrip({ spoons, showRecipe = false }: SpoonsStripProps) {
  if (spoons.length === 0) {
    return (
      <p className="text-sm text-stone-600 dark:text-stone-400">
        No cooks yet — be the first.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {spoons.map((spoon) => (
        <li
          key={spoon.id}
          className="rounded-2xl border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-4 space-y-3"
        >
          <div className="flex items-center justify-between text-sm">
            <Link
              to={`/users/${spoon.chef.username}`}
              className="font-medium underline hover:text-stone-900 dark:hover:text-stone-100"
            >
              {spoon.chef.username}
            </Link>
            <span className="text-stone-500 dark:text-stone-400">
              {relativeTime(spoon.cookedAt)}
            </span>
          </div>
          {spoon.photoUrl ? (
            <img
              src={spoon.photoUrl}
              alt={`Cook by ${spoon.chef.username}`}
              className="aspect-square w-full rounded-xl object-cover"
            />
          ) : null}
          {spoon.note ? <NoteBlock note={spoon.note} /> : null}
          {spoon.nextTime ? (
            <p className="text-sm">
              <span className="font-semibold">Next time: </span>
              {spoon.nextTime}
            </p>
          ) : null}
          {showRecipe && spoon.recipe ? (
            <Link
              to={`/recipes/${spoon.recipe.id}`}
              className="flex items-center gap-3 rounded-xl border border-[var(--sj-border)] p-2 hover:bg-[var(--sj-flour)]"
            >
              {spoon.coverImageUrl ? (
                <img
                  src={spoon.coverImageUrl}
                  alt={`${spoon.recipe.title} cover`}
                  className="h-12 w-12 rounded-md object-cover"
                />
              ) : null}
              <span className="text-sm font-medium">{spoon.recipe.title}</span>
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
