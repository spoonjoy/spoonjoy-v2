import clsx from "clsx";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { HERO_IMAGE_PROPS, LAZY_IMAGE_PROPS } from "~/lib/image-loading";

export interface CookbookCoverImage {
  coverImageUrl: string | null;
  title: string;
  coverProvenanceLabel?: string | null;
}

export function cookbookCoverImages(images: CookbookCoverImage[]) {
  return images
    .filter((image): image is CookbookCoverImage & { coverImageUrl: string } =>
      Boolean(image.coverImageUrl && image.coverImageUrl.length > 0),
    )
    .slice(0, 4);
}

export function CookbookCoverArt({
  title,
  recipeCount,
  recipeImages = [],
  className,
  titleAsHeading = true,
  priority = false,
}: {
  title: string;
  recipeCount: number;
  recipeImages?: CookbookCoverImage[];
  className?: string;
  /**
   * Whether the cover caption's title renders as a heading (`h3`) in the document outline.
   * Defaults to `true`, matching every existing call site, where this caption is the only
   * heading naming the cookbook (e.g. a card in a grid). Pass `false` when a caller already
   * exposes this exact title as a heading elsewhere on the page — for example the cookbook
   * detail page, whose own `h1` already is this title — so the caption doesn't add a
   * duplicate heading or skip a level in the page's heading order.
   */
  titleAsHeading?: boolean;
  /**
   * Whether this cover is the page's main image (the cookbook detail page). Priority covers
   * load eagerly at high fetch priority; every other cover, such as a card on a shelf or in
   * a grid, loads lazily so React does not preload it during SSR.
   */
  priority?: boolean;
}) {
  const images = cookbookCoverImages(recipeImages);
  const recipeLabel = `${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`;
  const TitleTag = titleAsHeading ? "h3" : "p";

  return (
    <figure
      className={clsx(
        "relative isolate aspect-[3/4] overflow-hidden border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink)] shadow-[var(--sj-shadow-soft)]",
        className,
      )}
    >
      {images.length === 0 ? (
        <CookbookFallbackCover title={title} recipeLabel={recipeLabel} TitleTag={TitleTag} />
      ) : (
        <>
          <CookbookImageCover images={images} title={title} priority={priority} />
          <figcaption className="absolute inset-x-0 bottom-0 z-10 border-t border-[color-mix(in_srgb,var(--sj-paper)_18%,transparent)] bg-[color-mix(in_srgb,var(--sj-charcoal)_82%,transparent)] p-4 text-[var(--sj-paper)] backdrop-blur-sm">
        <TitleTag className="font-sj-display line-clamp-2 text-2xl/7 font-semibold tracking-normal">
          {title}
        </TitleTag>
        <p className="font-sj-ui mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--sj-paper)_72%,transparent)]">
          {recipeLabel}
        </p>
          </figcaption>
        </>
      )}
    </figure>
  );
}

function CookbookImageCover({
  images,
  title,
  priority,
}: {
  images: Array<CookbookCoverImage & { coverImageUrl: string }>;
  title: string;
  priority: boolean;
}) {
  const layoutClass = images.length === 1
    ? "grid-cols-1 grid-rows-1"
    : images.length === 2
      ? "grid-cols-2 grid-rows-1"
      : "grid-cols-2 grid-rows-2";

  return (
    <div className={clsx("sj-photo-tile grid h-full w-full", layoutClass)} aria-label={`${title} cover photos`}>
      {images.map((image) => (
        <span
          key={`${image.coverImageUrl}-${image.title}`}
          className="relative min-h-0 min-w-0 overflow-hidden"
        >
          <img
            src={image.coverImageUrl}
            alt={image.title}
            {...(priority ? HERO_IMAGE_PROPS : LAZY_IMAGE_PROPS)}
            className="h-full w-full object-cover text-[0px] text-transparent"
          />
          {images.length === 1 ? (
            <CoverProvenanceBadge
              label={image.coverProvenanceLabel}
              className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)]"
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}

/**
 * A photo-less cookbook reads like a printed cover: imprint at the top, the title set large,
 * and the recipe count at the foot. Nothing sits in the top-right corner, so callers can
 * overlay an action there (the Kitchen shelf's share button) without covering text.
 */
function CookbookFallbackCover({
  title,
  recipeLabel,
  TitleTag,
}: {
  title: string;
  recipeLabel: string;
  TitleTag: "h3" | "p";
}) {
  return (
    <div className="@container flex h-full w-full flex-col bg-[var(--sj-paper)] p-5">
      <div className="flex min-h-11 items-center border-b border-[var(--sj-border-strong)] pb-4">
        <span className="font-sj-ui text-[0.68rem]/4 font-bold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
          Spoonjoy
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <TitleTag className="font-sj-display line-clamp-4 text-[clamp(1.5rem,17cqi,2.75rem)] leading-[1.1] font-semibold tracking-normal text-balance hyphens-auto [overflow-wrap:anywhere] text-[var(--sj-ink)]">
          {title}
        </TitleTag>
        <div className="mt-8 space-y-3" aria-hidden="true">
          <span className="block h-px w-full bg-[var(--sj-border)]" />
          <span className="block h-px w-4/5 bg-[var(--sj-border)]" />
          <span className="block h-px w-2/3 bg-[var(--sj-border)]" />
        </div>
      </div>
      <p className="font-sj-ui border-t border-[var(--sj-border-strong)] pt-4 text-[0.68rem]/4 font-bold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        {recipeLabel}
      </p>
    </div>
  );
}
