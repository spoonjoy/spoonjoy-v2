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
  createdAt: string;
  isActive: boolean;
  activeVariant: string | null;
  variants: RecipeCoverHistoryVariant[];
};

function statusLabel(status: string, generationStatus: string) {
  if (status === "processing" || generationStatus === "processing") return "Processing";
  if (status === "failed" || generationStatus === "failed") return "Failed";
  if (status === "archived") return "Archived";
  return "Ready";
}

function variantName(variant: "image" | "stylized") {
  return variant === "stylized" ? "Editorial" : "Original";
}

function createdDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved cover";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function RecipeCoverHistory({
  covers,
}: {
  covers: RecipeCoverHistoryItem[];
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
            const canActivate =
              cover.status !== "failed" &&
              cover.status !== "archived" &&
              cover.generationStatus !== "failed";
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
                      {statusLabel(cover.status, cover.generationStatus)}
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
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
