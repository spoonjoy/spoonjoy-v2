import { Link } from "react-router";
import { chefDisplayName } from "~/lib/username";

export interface RecipeProvenanceSourceRecipe {
  id: string;
  title: string;
  /**
   * Present on full-recipe Prisma payloads but not on the loader-projected
   * `sourceRecipe` shape; optional here so both call sites typecheck.
   */
  chefId?: string;
  chef: { username: string };
  /**
   * When non-null, the source recipe has been soft-deleted; the provenance line
   * renders as plain text "[deleted recipe]" instead of a link. RRv7 serializes
   * Dates over the wire, so both Date and ISO strings are accepted.
   */
  deletedAt?: Date | string | null;
}

export interface RecipeProvenanceProps {
  sourceUrl?: string | null;
  sourceRecipe?: RecipeProvenanceSourceRecipe | null;
}

const TITLE_TRUNCATE_AT = 80;

function safeHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname || null;
  } catch {
    return null;
  }
}

function truncate(value: string, max = TITLE_TRUNCATE_AT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Renders origin attribution for a recipe. Both branches can render simultaneously:
 * - `sourceUrl`  → "originally from <hostname>" (links to the full URL in a new tab)
 * - `sourceRecipe` → "forked from <chef-username>'s <title>" (internal link)
 *
 * Returns null when neither prop is provided.
 */
export function RecipeProvenance({ sourceUrl, sourceRecipe }: RecipeProvenanceProps) {
  const hasUrl = typeof sourceUrl === "string" && sourceUrl.length > 0;
  const hasForked = sourceRecipe != null;
  if (!hasUrl && !hasForked) return null;

  const hostname = hasUrl ? safeHostname(sourceUrl!) : null;
  const title = hasForked ? sourceRecipe!.title : "";
  const displayTitle = truncate(title);

  return (
    <div className="space-y-1 text-sm text-[var(--sj-ink-soft)]">
      {hasUrl ? (
        <p>
          <span>originally from </span>
          <a
            href={sourceUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--sj-tomato)]"
          >
            {hostname ?? sourceUrl}
          </a>
        </p>
      ) : null}
      {hasForked ? (
        sourceRecipe!.deletedAt ? (
          <p>
            <span>forked from </span>
            <span>[deleted recipe]</span>
          </p>
        ) : (
          <p>
            <span>forked from </span>
            <Link
              to={`/recipes/${sourceRecipe!.id}`}
              className="underline hover:text-[var(--sj-tomato)]"
            >
              <span>{chefDisplayName(sourceRecipe!.chef.username)}</span>
              <span aria-hidden> · </span>
              <span title={title}>{displayTitle}</span>
            </Link>
          </p>
        )
      ) : null}
    </div>
  );
}
