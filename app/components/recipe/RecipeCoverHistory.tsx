import { Form } from "react-router";
import { Button } from "~/components/ui/button";

export type RecipeCoverHistoryVariant = {
  variant: "image" | "stylized";
  imageUrl: string;
  provenanceLabel: string;
  isActive: boolean;
};

export type RecipeCoverHistoryItem = {
  id: string;
  status: string;
  generationStatus: string;
  sourceType: string;
  sourceImageUrl?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  isActive: boolean;
  activeVariant: string | null;
  variants: RecipeCoverHistoryVariant[];
};

export type RecipeCoverSpoonImage = {
  id: string;
  photoUrl: string;
  cookedAt: string;
  chef: { username: string };
};

function statusLabel(status: string, generationStatus: string, archivedAt?: string | null) {
  if (status === "archived" || archivedAt) return "Archived";
  if (status === "failed") return "Failed";
  if (status === "processing" || generationStatus === "processing") return "Processing";
  if (generationStatus === "failed") return "Editorial failed";
  if (status !== "ready") return "Unavailable";
  return "Ready";
}

function variantName(variant: "image" | "stylized") {
  return variant === "stylized" ? "Editorial" : "Original";
}

function coverCanActivate(cover: RecipeCoverHistoryItem) {
  return (
    (cover.status === "ready" || cover.status === "processing") &&
    !cover.archivedAt
  );
}

function coverCanMutate(cover: RecipeCoverHistoryItem) {
  return (
    cover.status === "ready" ||
    cover.status === "processing" ||
    cover.status === "failed"
  ) && !cover.archivedAt;
}

function createdDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved cover";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function RecipeCoverHistory({
  covers,
  spoonImages = [],
}: {
  covers: RecipeCoverHistoryItem[];
  spoonImages?: RecipeCoverSpoonImage[];
}) {
  return (
    <section
      className="space-y-4 border-t border-[var(--sj-border)] pt-5"
      data-testid="recipe-cover-history"
      aria-labelledby="recipe-cover-history-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="recipe-cover-history-heading"
            className="font-sj-display text-xl font-semibold leading-7 text-[var(--sj-ink)]"
          >
            Recipe covers
          </h3>
          <p className="font-sj-ui text-sm leading-6 text-[var(--sj-ink-soft)]">
            Keep originals and editorial versions available for this recipe.
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="setRecipeNoCover" />
          <input type="hidden" name="confirmNoCover" value="true" />
          <Button type="submit" plain>
            Set no cover
          </Button>
        </Form>
      </div>

      <div className="flex items-center justify-between gap-3 border-y border-[var(--sj-border)] py-3">
        <span className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
          No cover selected
        </span>
        <span className="font-sj-ui text-xs uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
          Explicit empty state
        </span>
      </div>

      {covers.length === 0 ? (
        <p className="border-y border-[var(--sj-border)] py-6 font-sj-ui text-sm text-[var(--sj-ink-soft)]">
          No saved covers yet.
        </p>
      ) : (
        <div className="divide-y divide-[var(--sj-border)] border-y border-[var(--sj-border)]">
          {covers.map((cover) => {
            const thumbnail = cover.variants[0]?.imageUrl;
            const canQueueGeneration = coverCanMutate(cover);
            const canArchive = coverCanMutate(cover);
            const canActivate = coverCanActivate(cover);
            const replacementOptions = covers
              .filter((candidate) => candidate.id !== cover.id && coverCanActivate(candidate))
              .flatMap((candidate) =>
                candidate.variants.map((variant) => ({
                  coverId: candidate.id,
                  variant: variant.variant,
                  label: variant.provenanceLabel,
                })),
              );
            return (
              <article
                key={cover.id}
                className="grid gap-4 py-4 sm:grid-cols-[5rem_minmax(0,1fr)]"
              >
                <div className="aspect-square overflow-hidden bg-[var(--sj-photo-charcoal)]">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center px-2 text-center font-sj-ui text-xs text-[var(--sj-paper)]">
                      No image
                    </div>
                  )}
                </div>
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {cover.isActive ? (
                      <span className="inline-flex min-h-6 items-center border border-[var(--sj-brass)] px-2 font-sj-ui text-xs font-semibold text-[var(--sj-brass)]">
                        Current
                      </span>
                    ) : null}
                    <span className="font-sj-ui text-xs uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
                      {statusLabel(cover.status, cover.generationStatus, cover.archivedAt)}
                    </span>
                    <span className="font-sj-ui text-xs text-[var(--sj-ink-soft)]">
                      {createdDateLabel(cover.createdAt)}
                    </span>
                  </div>

                  {cover.variants.length === 0 ? (
                    <p className="font-sj-ui text-sm text-[var(--sj-ink-soft)]">
                      No usable image variants.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {cover.variants.map((variant) => (
                        <div
                          key={`${cover.id}-${variant.variant}`}
                          className="flex min-h-16 items-center justify-between gap-3 border border-[var(--sj-border)] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                              {variant.provenanceLabel}
                            </p>
                            <p className="font-sj-ui text-xs uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
                              {variantName(variant.variant)}
                            </p>
                          </div>
                          {variant.isActive ? (
                            <span className="shrink-0 font-sj-ui text-xs font-semibold text-[var(--sj-brass)]">
                              Active variant
                            </span>
                          ) : canActivate ? (
                            <Form method="post" className="shrink-0">
                              <input type="hidden" name="intent" value="setRecipeCover" />
                              <input type="hidden" name="coverId" value={cover.id} />
                              <input type="hidden" name="variant" value={variant.variant} />
                              <Button
                                type="submit"
                                plain
                                aria-label={`Use ${variant.provenanceLabel} cover`}
                              >
                                Use
                              </Button>
                            </Form>
                          ) : (
                            <span className="shrink-0 font-sj-ui text-xs font-semibold text-[var(--sj-ink-soft)]">
                              Unavailable
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {canQueueGeneration ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="regenerateRecipeCover" />
                        <input type="hidden" name="coverId" value={cover.id} />
                        <Button type="submit" plain>
                          Regenerate cover
                        </Button>
                      </Form>
                    ) : null}
                    {canArchive && cover.isActive ? (
                      <div className="flex flex-wrap gap-2" aria-label="Archive active cover options">
                        {replacementOptions.map((option) => (
                          <Form
                            key={`${cover.id}-${option.coverId}-${option.variant}`}
                            method="post"
                          >
                            <input type="hidden" name="intent" value="archiveRecipeCover" />
                            <input type="hidden" name="coverId" value={cover.id} />
                            <input type="hidden" name="replacementCoverId" value={option.coverId} />
                            <input type="hidden" name="replacementVariant" value={option.variant} />
                            <Button
                              type="submit"
                              plain
                              aria-label={`Archive and use ${option.label} ${variantName(option.variant)} cover`}
                            >
                              Archive + use {variantName(option.variant)}
                            </Button>
                          </Form>
                        ))}
                        <Form method="post">
                          <input type="hidden" name="intent" value="archiveRecipeCover" />
                          <input type="hidden" name="coverId" value={cover.id} />
                          <input type="hidden" name="confirmNoCover" value="true" />
                          <Button type="submit" plain>
                            Archive and set no cover
                          </Button>
                        </Form>
                      </div>
                    ) : canArchive ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="archiveRecipeCover" />
                        <input type="hidden" name="coverId" value={cover.id} />
                        <Button type="submit" plain>
                          Archive cover
                        </Button>
                      </Form>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {spoonImages.length > 0 ? (
        <div className="space-y-3 border-t border-[var(--sj-border)] pt-5">
          <div>
            <h4 className="font-sj-display text-lg font-semibold leading-7 text-[var(--sj-ink)]">
              Spoon photos
            </h4>
            <p className="font-sj-ui text-sm leading-6 text-[var(--sj-ink-soft)]">
              Create a saved cover candidate from a photo already posted to this recipe.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {spoonImages.map((spoon) => (
              <article
                key={spoon.id}
                className="grid min-h-28 grid-cols-[5rem_minmax(0,1fr)] gap-3 border-y border-[var(--sj-border)] py-3 sm:border"
              >
                <div className="aspect-square overflow-hidden bg-[var(--sj-photo-charcoal)]">
                  <img
                    src={spoon.photoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                      {spoon.chef.username}
                    </p>
                    <p className="font-sj-ui text-xs text-[var(--sj-ink-soft)]">
                      {createdDateLabel(spoon.cookedAt)}
                    </p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="createCoverFromSpoon" />
                    <input type="hidden" name="spoonId" value={spoon.id} />
                    <Button
                      type="submit"
                      plain
                      aria-label={`Create cover from spoon photo by ${spoon.chef.username}`}
                    >
                      Create cover
                    </Button>
                  </Form>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
