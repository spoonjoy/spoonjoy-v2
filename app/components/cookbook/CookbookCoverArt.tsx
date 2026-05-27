import clsx from "clsx";

export interface CookbookCoverImage {
  coverImageUrl: string | null;
  title: string;
}

export function cookbookCoverImages(images: CookbookCoverImage[]) {
  return images
    .filter((image): image is { coverImageUrl: string; title: string } =>
      Boolean(image.coverImageUrl && image.coverImageUrl.length > 0),
    )
    .slice(0, 4);
}

export function CookbookCoverArt({
  title,
  recipeCount,
  recipeImages = [],
  className,
}: {
  title: string;
  recipeCount: number;
  recipeImages?: CookbookCoverImage[];
  className?: string;
}) {
  const images = cookbookCoverImages(recipeImages);
  const recipeLabel = `${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`;

  return (
    <figure
      className={clsx(
        "relative isolate aspect-[3/4] overflow-hidden border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink)] shadow-[var(--sj-shadow-soft)]",
        className,
      )}
    >
      {images.length === 0 ? (
        <CookbookFallbackCover title={title} recipeLabel={recipeLabel} />
      ) : (
        <CookbookImageCover images={images} title={title} />
      )}

      <figcaption className="absolute inset-x-0 bottom-0 z-10 border-t border-[color-mix(in_srgb,var(--sj-paper)_18%,transparent)] bg-[color-mix(in_srgb,var(--sj-charcoal)_82%,transparent)] p-4 text-[var(--sj-paper)] backdrop-blur-sm">
        <p className="font-sj-ui text-[0.68rem]/4 font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--sj-paper)_72%,transparent)]">
          Spoonjoy cookbook
        </p>
        <h3 className="font-sj-display mt-2 line-clamp-2 text-2xl/7 font-semibold tracking-normal">
          {title}
        </h3>
        <p className="font-sj-ui mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--sj-paper)_72%,transparent)]">
          {recipeLabel}
        </p>
      </figcaption>
    </figure>
  );
}

function CookbookImageCover({
  images,
  title,
}: {
  images: Array<{ coverImageUrl: string; title: string }>;
  title: string;
}) {
  const layoutClass = images.length === 1
    ? "grid-cols-1 grid-rows-1"
    : images.length === 2
      ? "grid-cols-2 grid-rows-1"
      : "grid-cols-2 grid-rows-2";

  return (
    <div className={clsx("sj-photo-tile grid h-full w-full", layoutClass)} aria-label={`${title} cover photos`}>
      {images.map((image) => (
        <img
          key={`${image.coverImageUrl}-${image.title}`}
          src={image.coverImageUrl}
          alt={image.title}
          className="h-full w-full object-cover text-[0px] text-transparent"
        />
      ))}
    </div>
  );
}

function CookbookFallbackCover({
  title,
  recipeLabel,
}: {
  title: string;
  recipeLabel: string;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-[var(--sj-paper)] p-5">
      <div className="flex items-center justify-between border-b border-[var(--sj-border-strong)] pb-4">
        <span className="font-sj-ui text-[0.68rem]/4 font-bold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
          Spoonjoy
        </span>
        <span className="font-sj-ui text-[0.68rem]/4 font-bold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
          {recipeLabel}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <p className="font-sj-display text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)]">
          {title}
        </p>
        <div className="mt-8 space-y-3" aria-hidden="true">
          <span className="block h-px w-full bg-[var(--sj-border)]" />
          <span className="block h-px w-4/5 bg-[var(--sj-border)]" />
          <span className="block h-px w-2/3 bg-[var(--sj-border)]" />
        </div>
      </div>
    </div>
  );
}
