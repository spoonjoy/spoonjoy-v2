/**
 * Loading hints for <img> elements.
 *
 * React 19 emits a `<link rel="preload" as="image">` during SSR for every
 * `<img>` that is not `loading="lazy"`. On list pages that meant every card
 * image was fetched at preload priority before the user scrolled (42 images on
 * /recipes, 54 on a chef profile). These helpers keep only the first few cards
 * eager, give the likely Largest Contentful Paint image `fetchPriority="high"`,
 * and mark everything else lazy so React skips the preload and the browser
 * fetches it as it nears the viewport.
 */

export type ImageLoadingProps = {
  loading: "eager" | "lazy";
  decoding: "async";
  fetchPriority?: "high";
};

/** Cards rendered eagerly at the top of a list: roughly the first screen. */
export const LIST_EAGER_COUNT = 3;

/** The page's main image (recipe hero, cookbook cover, landing photo). */
export const HERO_IMAGE_PROPS: ImageLoadingProps = Object.freeze({
  loading: "eager",
  decoding: "async",
  fetchPriority: "high",
});

/** Any image that is never the first thing a visitor sees. */
export const LAZY_IMAGE_PROPS: ImageLoadingProps = Object.freeze({
  loading: "lazy",
  decoding: "async",
});

/**
 * Loading hints for the image of the card at `index` in a list.
 *
 * `prioritizeFirst` should be false when the page already has a hero image
 * above the list, so the list does not compete with it for bandwidth.
 */
export function listImageProps(
  index: number,
  { eagerCount = LIST_EAGER_COUNT, prioritizeFirst = true }: { eagerCount?: number; prioritizeFirst?: boolean } = {},
): ImageLoadingProps {
  if (index >= eagerCount) return LAZY_IMAGE_PROPS;
  if (index === 0 && prioritizeFirst) return HERO_IMAGE_PROPS;
  return { loading: "eager", decoding: "async" };
}
