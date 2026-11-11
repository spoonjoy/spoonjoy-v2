import { describe, expect, it } from "vitest";
import { isRasterImageUrl, shareImageMeta, shareImageUrl, SOCIAL_CARD_PATH } from "~/lib/og-metadata";

const ORIGIN = "https://spoonjoy.app";

describe("share images that link previews can show", () => {
  it("accepts photos and refuses SVG and inline images, which iMessage, Slack and social cards don't render", () => {
    expect(isRasterImageUrl("/photos/legacy-cloudinary/abc.jpg")).toBe(true);
    expect(isRasterImageUrl("https://spoonjoy.app/photos/covers/x.webp?v=2")).toBe(true);
    expect(isRasterImageUrl("/og/recipes/r1.png")).toBe(false);
    expect(isRasterImageUrl("https://blog.example/og/dish.jpg")).toBe(true);
    expect(isRasterImageUrl("/photos/x.svg")).toBe(false);
    expect(isRasterImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isRasterImageUrl("")).toBe(false);
    expect(isRasterImageUrl(null)).toBe(false);
    expect(isRasterImageUrl(undefined)).toBe(false);
  });

  it("uses the dish's own photo, made absolute, when there is one", () => {
    expect(shareImageUrl(ORIGIN, ["/photos/a.jpg"])).toBe("https://spoonjoy.app/photos/a.jpg");
  });

  it("takes the first photo it can show, skipping placeholders", () => {
    expect(shareImageUrl(ORIGIN, [null, "data:image/svg+xml;base64,PHN2Zz4=", "/photos/b.png"])).toBe(
      "https://spoonjoy.app/photos/b.png",
    );
  });

  it("falls back to the Spoonjoy card when nothing can be shown", () => {
    expect(shareImageUrl(ORIGIN, [])).toBe(`https://spoonjoy.app${SOCIAL_CARD_PATH}`);
    expect(shareImageUrl(ORIGIN, [null])).toBe(`https://spoonjoy.app${SOCIAL_CARD_PATH}`);
  });

  it("describes the card's real size and type, and leaves a photo's size to the crawler", () => {
    expect(shareImageMeta(`https://spoonjoy.app${SOCIAL_CARD_PATH}`)).toEqual([
      { property: "og:image", content: `https://spoonjoy.app${SOCIAL_CARD_PATH}` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      { name: "twitter:image", content: `https://spoonjoy.app${SOCIAL_CARD_PATH}` },
    ]);
    expect(shareImageMeta("https://spoonjoy.app/photos/a.jpg")).toEqual([
      { property: "og:image", content: "https://spoonjoy.app/photos/a.jpg" },
      { name: "twitter:image", content: "https://spoonjoy.app/photos/a.jpg" },
    ]);
  });
});
