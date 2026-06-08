import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type CookbookOgInput,
  type PageOgInput,
  type RecipeOgInput,
} from "~/lib/og-metadata";
export {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  PAGE_OG_CARDS,
  absoluteUrlFromPreferredBase,
  absoluteUrlFromRequest,
  cookbookOgPath,
  pageOgInput,
  pageOgPath,
  recipeOgPath,
} from "~/lib/og-metadata";
export type { CookbookOgInput, PageOgInput, RecipeOgInput } from "~/lib/og-metadata";

const COLORS = {
  paper: "#f8f5ee",
  flour: "#eee7da",
  ink: "#28231d",
  inkSoft: "#655f55",
  brass: "#a66b2e",
  tomato: "#a84f3c",
  action: "#b66134",
  charcoal: "#211d18",
  white: "#fffdf8",
} as const;

const OG_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};

const FALLBACK_EXECUTION_CONTEXT = {
  waitUntil() {
    return undefined;
  },
};

export interface OgExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type OgRuntime = typeof import("cf-workers-og/workerd");

async function loadOgRuntime(): Promise<OgRuntime> {
  return import("cf-workers-og/workerd");
}

export function recipeOgDescription(input: Pick<RecipeOgInput, "description" | "chefUsername">) {
  const description = input.description?.trim();
  return description && description.length > 0
    ? description
    : `A Spoonjoy recipe by ${input.chefUsername}.`;
}

export function cookbookRecipeLabel(recipeCount: number) {
  return `${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`;
}

function ogFonts(runtime: OgRuntime, text: string, ctx?: OgExecutionContext) {
  runtime.cache.setExecutionContext((ctx ?? FALLBACK_EXECUTION_CONTEXT) as ExecutionContext);
  const sampleText = `${text} SPOONJOY COOKBOOK RECIPE by servings`;

  return [
    new runtime.GoogleFont("Fraunces", { weight: 700, text: sampleText }),
    new runtime.GoogleFont("Fraunces", { weight: 500, text: sampleText }),
    new runtime.GoogleFont("IBM Plex Sans Condensed", { weight: 600, text: sampleText.toUpperCase() }),
  ];
}

export async function createRecipeOgImageResponse(input: RecipeOgInput, ctx?: OgExecutionContext) {
  const runtime = await loadOgRuntime();
  const description = recipeOgDescription(input);
  const text = [input.title, description, input.chefUsername, input.servingsLabel].filter(Boolean).join(" ");

  return runtime.ImageResponse.create(createRecipeOgElement(input, description), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: ogFonts(runtime, text, ctx),
    headers: OG_HEADERS,
  });
}

export async function createCookbookOgImageResponse(input: CookbookOgInput, ctx?: OgExecutionContext) {
  const runtime = await loadOgRuntime();
  const recipeLabel = cookbookRecipeLabel(input.recipeCount);
  const text = [input.title, input.authorUsername, recipeLabel].join(" ");

  return runtime.ImageResponse.create(createCookbookOgElement(input, recipeLabel), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: ogFonts(runtime, text, ctx),
    headers: OG_HEADERS,
  });
}

export async function createPageOgImageResponse(input: PageOgInput, ctx?: OgExecutionContext) {
  const runtime = await loadOgRuntime();
  const text = [input.eyebrow, input.title, input.description, ...input.highlights].join(" ");

  return runtime.ImageResponse.create(createPageOgElement(input), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: ogFonts(runtime, text, ctx),
    headers: OG_HEADERS,
  });
}

export function createRecipeOgElement(input: RecipeOgInput, description: string) {
  return (
    <div
      style={{
        width: `${OG_IMAGE_WIDTH}px`,
        height: `${OG_IMAGE_HEIGHT}px`,
        display: "flex",
        background: COLORS.paper,
        color: COLORS.ink,
        fontFamily: "Fraunces",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {MediaPanel({ imageUrl: input.coverImageUrl, title: input.title, fallbackLabel: "Recipe" })}
      <div
        style={{
          width: "48%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "58px 68px 60px 62px",
          background: COLORS.paper,
        }}
      >
        <div
          style={{
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: COLORS.brass,
          }}
        >
          Spoonjoy recipe
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 78,
            fontWeight: 700,
            lineHeight: 0.96,
            color: COLORS.ink,
            maxWidth: 480,
          }}
        >
          {input.title}
        </div>
        <div
          style={{
            marginTop: 28,
            paddingLeft: 18,
            borderLeft: `5px solid ${COLORS.action}`,
            fontSize: 28,
            lineHeight: 1.34,
            color: COLORS.inkSoft,
            maxWidth: 460,
            fontWeight: 500,
          }}
        >
          {description}
        </div>
        <div
          style={{
            marginTop: 36,
            display: "flex",
            gap: 18,
            alignItems: "center",
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: COLORS.inkSoft,
          }}
        >
          <span>By {input.chefUsername}</span>
          {input.servingsLabel ? <span style={{ color: COLORS.brass }}>{input.servingsLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function createCookbookOgElement(input: CookbookOgInput, recipeLabel: string) {
  const images = input.coverImageUrls
    .filter((url): url is string => Boolean(url && url.length > 0))
    .slice(0, 4);

  return (
    <div
      style={{
        width: `${OG_IMAGE_WIDTH}px`,
        height: `${OG_IMAGE_HEIGHT}px`,
        display: "flex",
        background: COLORS.paper,
        color: COLORS.ink,
        fontFamily: "Fraunces",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "52%",
          height: "100%",
          display: "flex",
          background: COLORS.charcoal,
          padding: 40,
        }}
      >
        {images.length > 0 ? CookbookPhotoGrid({ images }) : CookbookFallbackArt({ title: input.title })}
      </div>
      <div
        style={{
          width: "48%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px",
          background: COLORS.paper,
        }}
      >
        <div
          style={{
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: COLORS.brass,
          }}
        >
          Spoonjoy cookbook
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 82,
            fontWeight: 700,
            lineHeight: 0.96,
            color: COLORS.ink,
            maxWidth: 480,
          }}
        >
          {input.title}
        </div>
        <div
          style={{
            marginTop: 34,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: COLORS.inkSoft,
          }}
        >
          <span>By {input.authorUsername}</span>
          <span style={{ color: COLORS.brass }}>{recipeLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function createPageOgElement(input: PageOgInput) {
  const displayUrl = input.slug === "api" ? "spoonjoy.app/api" : "spoonjoy.app/api/playground";

  return (
    <div
      style={{
        width: `${OG_IMAGE_WIDTH}px`,
        height: `${OG_IMAGE_HEIGHT}px`,
        display: "flex",
        background: COLORS.paper,
        color: COLORS.ink,
        fontFamily: "Fraunces",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "44%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "54px 48px",
          background: COLORS.charcoal,
          color: COLORS.white,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontFamily: "IBM Plex Sans Condensed",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: COLORS.brass,
            }}
          >
            {input.eyebrow}
          </div>
          <div
            style={{
              width: 148,
              height: 148,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `2px solid ${COLORS.brass}`,
              fontSize: 86,
              lineHeight: 1,
              fontWeight: 700,
              color: COLORS.paper,
            }}
          >
            sj
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {input.highlights.map((highlight) => (
            <div
              key={highlight}
              style={{
                display: "flex",
                border: `1px solid ${COLORS.brass}`,
                padding: "10px 14px",
                fontFamily: "IBM Plex Sans Condensed",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: COLORS.white,
              }}
            >
              {highlight}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          width: "56%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 70px",
          background: COLORS.paper,
        }}
      >
        <div
          style={{
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: COLORS.brass,
          }}
        >
          Spoonjoy
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 80,
            fontWeight: 700,
            lineHeight: 0.96,
            color: COLORS.ink,
            maxWidth: 570,
          }}
        >
          {input.title}
        </div>
        <div
          style={{
            marginTop: 30,
            paddingLeft: 18,
            borderLeft: `5px solid ${COLORS.action}`,
            fontSize: 29,
            lineHeight: 1.32,
            color: COLORS.inkSoft,
            maxWidth: 540,
            fontWeight: 500,
          }}
        >
          {input.description}
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: "IBM Plex Sans Condensed",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: COLORS.brass,
          }}
        >
          {displayUrl}
        </div>
      </div>
    </div>
  );
}

function MediaPanel({
  imageUrl,
  title,
  fallbackLabel,
}: {
  imageUrl: string | null;
  title: string;
  fallbackLabel: string;
}) {
  return (
    <div
      style={{
        width: "52%",
        height: "100%",
        position: "relative",
        display: "flex",
        background: COLORS.charcoal,
        overflow: "hidden",
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: 58,
            background: COLORS.charcoal,
            color: COLORS.white,
          }}
        >
          <div style={{ fontFamily: "IBM Plex Sans Condensed", fontSize: 24, letterSpacing: "0.18em", textTransform: "uppercase", color: COLORS.brass }}>
            {fallbackLabel}
          </div>
          <div style={{ marginTop: 24, fontSize: 88, fontWeight: 700, lineHeight: 0.95 }}>{title}</div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 150,
          background: "rgba(33,29,24,0.52)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 42,
          bottom: 34,
          fontFamily: "IBM Plex Sans Condensed",
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: COLORS.white,
        }}
      >
        SPOONJOY
      </div>
    </div>
  );
}

function CookbookPhotoGrid({ images }: { images: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: "100%", height: "100%", border: `1px solid ${COLORS.brass}` }}>
      {images.map((imageUrl) => (
        <img
          key={imageUrl}
          src={imageUrl}
          alt=""
          style={{
            width: images.length === 1 ? "100%" : "50%",
            height: images.length <= 2 ? "100%" : "50%",
            objectFit: "cover",
          }}
        />
      ))}
    </div>
  );
}

function CookbookFallbackArt({ title }: { title: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        border: `1px solid ${COLORS.brass}`,
        padding: 44,
        background: COLORS.paper,
        color: COLORS.ink,
      }}
    >
      <div style={{ fontFamily: "IBM Plex Sans Condensed", fontSize: 26, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: COLORS.brass }}>
        Spoonjoy
      </div>
      <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 0.96 }}>{title}</div>
      <div style={{ height: 4, width: 220, background: COLORS.action }} />
    </div>
  );
}
