"use client";

import type { HTMLAttributes, JSX, ReactNode, Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props AspectRatio adds to the HTML attributes it passes through. */
export interface AspectRatioOwnProps {
  /**
   * Width divided by height, as a number: `16 / 9` for video, `4 / 3` for a photo, `1` for
   * a square. The frame is as wide as its container and this much shorter.
   */
  ratio: number | (string & { "Use a number: ratio={16 / 9}": never });
  /**
   * How an image or video fills the frame: `cover` crops it to fill, `contain` shows all of
   * it with bars.
   * @default "cover"
   */
  fit?: "cover" | "contain" | (string & { 'Use "cover" or "contain"': never }) | undefined;
  /**
   * The media: one `<img>`, `<video>`, `<iframe>` or element, which fills the frame. Give an
   * image `alt` text, or `alt=""` when it is decoration.
   */
  children: ReactNode;
  /**
   * Layout only: width, margins, grid placement (`w-40`). Appearance classes warn in
   * development; put the frame in a `Card` for rounded corners.
   */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `ratio`: `<AspectRatio ratio={16 / 9}>`. */
  aspectRatio?: { "Use <AspectRatio ratio={16 / 9}>": never };
}

/** Props for {@link AspectRatio}: its own props and the div attributes it passes through. */
export type AspectRatioProps = Omit<HTMLAttributes<HTMLDivElement>, keyof AspectRatioOwnProps> & AspectRatioOwnProps;

const fits = { cover: "*:object-cover", contain: "*:object-contain" } as const;

/** `"16:9"` or `"16/9"` to `16 / 9`, for the fix; anything else to the video ratio. */
function ratioFix(ratio: string): string {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  return match ? `${match[1]} / ${match[2]}` : "16 / 9";
}

/**
 * A frame that keeps an image, video or map at a fixed shape while its width follows the
 * layout, so the page does not jump when the media loads. The media fills it and is
 * cropped to fit.
 *
 * Use `Card` with `media` instead for a photo at the top of a card (put the AspectRatio in
 * `media`), and `Item` with `media` for a thumbnail beside a row's title.
 *
 * @group Layout
 * @see https://ourostack.github.io/ouro-ui/docs/aspect-ratio
 *
 * @example
 * <AspectRatio ratio={16 / 9}>
 *   <img src={recipe.coverUrl} alt={recipe.title} />
 * </AspectRatio>
 */
export function AspectRatio(props: AspectRatioProps): JSX.Element {
  const { ratio: ratioProp, fit: fitProp = "cover", children, className, style, aspectRatio, ...rest } = props;
  const valid = typeof ratioProp === "number" && ratioProp > 0 && Number.isFinite(ratioProp);
  const ratio = valid ? ratioProp : 1;
  const fit = Object.hasOwn(fits, fitProp) ? (fitProp as keyof typeof fits) : "cover";
  useAppearanceClassNameCheck(
    "AspectRatio",
    className,
    process.env.NODE_ENV !== "production"
      ? "put the AspectRatio in a <Card media={…}>, which rounds it, or wrap it in an element of your own"
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "AspectRatio",
    process.env.NODE_ENV !== "production"
      ? () => [
          !valid &&
            (typeof ratioProp === "string"
              ? [`ratio="${ratioProp}" is not a number`, `<AspectRatio ratio={${ratioFix(ratioProp)}}>`]
              : [`ratio={${String(ratioProp)}} is not a positive number`, "<AspectRatio ratio={16 / 9}>"]),
          fit !== fitProp && [`fit="${String(fitProp)}" is not a fit; use "cover", "contain"`, '<AspectRatio fit="cover">'],
          aspectRatio !== undefined && ["aspectRatio is not a prop", `<AspectRatio ratio={${String(aspectRatio)}}>`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <div
      {...rest}
      data-ouro="aspect-ratio"
      style={{ ...style, aspectRatio: ratio }}
      className={cn("relative w-full overflow-hidden *:absolute *:inset-0 *:size-full", fits[fit], className)}
    >
      {children}
    </div>
  );
}
