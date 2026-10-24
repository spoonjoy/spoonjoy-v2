import { afterEach, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, type LoaderFunction } from "react-router";
import type { ComponentType } from "react";
import type { AccountSettingsLoaderData } from "~/lib/account-settings.server";
import { act } from "~/lib/ouro/testing/act";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { OuroRouterLink } from "~/components/navigation/ouro-router-link";
import { Toaster } from "~/components/ouro/toast/toaster";
import { Button } from "~/components/ouro/button/button";
import { StepCard } from "~/components/recipe/StepCard";
import { StepsSectionHeading } from "~/components/recipe/StepsSectionHeading";
import { StepOutputUseDisplay } from "~/components/StepOutputUseDisplay";
import Index from "~/routes/_index";
import RecipesIndex from "~/routes/recipes._index";
import AccountSettings from "~/routes/account.settings";
import Search from "~/routes/search";
import type { SearchResult } from "~/lib/search.server";

// Only server exports are replaced. These fixtures exercise actual route markup,
// the actual Router/root provider, and the real installed primitives/theme.
vi.mock("~/lib/route-platform.server", () => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/d1-read.server", () => ({ requestD1: vi.fn() }));
vi.mock("~/lib/session.server", () => ({ getUserId: vi.fn() }));
vi.mock("~/lib/kitchen-home.server", () => ({ readKitchenHomeFromD1: vi.fn(), readKitchenHomeWithPrisma: vi.fn() }));
vi.mock("~/lib/cooking-now-entries.server", () => ({ cookingNowEntry: vi.fn(), readCookingNowEntries: vi.fn() }));
vi.mock("~/lib/recipe-cover.server", () => ({ getRecipeCoverDisplay: vi.fn() }));
vi.mock("~/lib/collection-reads.server", () => ({ readPublicRecipesFromD1: vi.fn(), readPublicRecipesWithPrisma: vi.fn() }));
vi.mock("~/lib/account-settings.server", () => ({ loadAccountSettings: vi.fn(), handleAccountSettingsAction: vi.fn() }));
vi.mock("~/lib/search.server", () => ({ normalizeSearchScope: vi.fn(), searchSpoonjoy: vi.fn(), searchSpoonjoyFromD1: vi.fn() }));

const originalViewport = { width: innerWidth, height: innerHeight };
const originalDark = document.documentElement.classList.contains("dark");
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
  document.documentElement.classList.toggle("dark", originalDark);
  await commands.task21PrintMedia("screen");
  await page.viewport(originalViewport.width, originalViewport.height);
});

async function mount(Component: ComponentType, data: unknown = {}, path = "/", loader: LoaderFunction = () => data) {
  const host = document.createElement("div");
  document.body.append(host);
  const router = createMemoryRouter([{
    path, Component, loader, HydrateFallback: () => null,
  }], { initialEntries: [path] });
  const root = createRoot(host);
  await act(async () => {
    root.render(<OuroProvider linkComponent={OuroRouterLink}><><RouterProvider router={router} /><Toaster /></></OuroProvider>);
  });
  dispose = async () => {
    await act(async () => root.unmount());
    router.dispose();
    host.remove();
  };
  return host;
}

function typography(element: HTMLElement) {
  const css = getComputedStyle(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  return {
    fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight,
    lineHeight: css.lineHeight, letterSpacing: css.letterSpacing,
    color: css.color, backgroundColor: css.backgroundColor,
    textAlign: css.textAlign, textTransform: css.textTransform,
    whiteSpace: css.whiteSpace, overflowWrap: css.overflowWrap,
    borderColor: css.borderColor, borderWidth: css.borderWidth,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    lines: Array.from(range.getClientRects(), ({ width, height }) => ({ width, height })),
  };
}

/** Independent delivered witness: literal base ca829f3 callsite + old defaults.
 * Never derive its classes from the candidate. Share only the real containing
 * block/theme so line wrapping can be compared exactly, not with a tolerance.
 * This is test markup, not copied Catalyst runtime or a compatibility component.
 */
function compareDelivered(candidate: HTMLElement, deliveredClasses: string) {
  const parent = candidate.parentElement!;
  const parentStyle = getComputedStyle(parent);
  const witness = document.createElement("div");
  witness.style.position = "absolute";
  witness.style.visibility = "hidden";
  witness.style.width = `${parent.getBoundingClientRect().width - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)}px`;
  const baseline = document.createElement(candidate.tagName);
  baseline.className = deliveredClasses;
  baseline.textContent = candidate.textContent;
  witness.append(baseline);
  parent.append(witness);
  try {
    const actual = typography(candidate);
    expect(actual).toEqual(typography(baseline));
    return actual;
  } finally {
    witness.remove();
  }
}

// Exact delivered class lists from ca829f3 (base defaults are intentionally
// explicit). Conflicting duplicates are NOT normalized by assumed class order.
const heading = "font-sj-display text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)]";
const text = "text-base/6 text-[var(--sj-ink-soft)]";
const widths = [390, 639, 640, 768, 1023, 1024, 1280];
it("actual recipe Router/ShowMore holds one request, preserves rows/count and focuses the first accepted new link", async ({ annotate }) => {
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const recipe = (id: string, title: string) => ({
    id, title, description: null, servings: null, coverImageUrl: null,
    coverProvenanceLabel: null, chef: { id: "chef", username: "chef" },
  });
  const host = await mount(RecipesIndex, {}, "/recipes", async ({ request }) => {
    if (new URL(request.url).searchParams.has("after")) {
      requests++;
      await held;
      return { query: "", isAuthenticated: false, recipes: [recipe("b", "Rice")], after: "a", nextCursor: null };
    }
    return { query: "", isAuthenticated: false, recipes: [recipe("a", "Beans")], after: null, nextCursor: "a" };
  });
  try {
    await expect.poll(() => host.querySelector('a[href="/recipes/a"]')).toBeTruthy();
    expect(getComputedStyle(host.querySelector('a[href="/recipes/a"]')!.closest('[data-ouro="item"]')!).borderBottomWidth).toBe("1px");
    const more = Array.from(host.querySelectorAll("a")).find((link) => link.textContent?.includes("Show more recipes"))!;
    expect(more.getAttribute("href")).toBe("/recipes?after=a");
    await userEvent.dblClick(more);
    await expect.poll(() => requests).toBe(1);
    await expect.poll(() => more.getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    await expect.poll(() => host.querySelector('a[href="/recipes/b"]')).toBeTruthy();
    await expect.poll(() => document.activeElement).toBe(host.querySelector('a[href="/recipes/b"]'));
    expect(getComputedStyle(host.querySelector('a[href="/recipes/b"]')!.closest('[data-ouro="item"]')!).borderBottomWidth).toBe("1px");
    expect(host.querySelector('a[href="/recipes/a"]')).not.toBeNull();
    expect(host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Showing 2 recipes");
    expect(more.isConnected).toBe(false);
    await annotate(`T21_ROUTER_SHOW_MORE ${JSON.stringify({ requests, focusedHref: document.activeElement?.getAttribute("href"), status: host.querySelector("[data-ouro-show-more-status]")!.textContent })}`);
  } finally {
    await act(async () => release());
  }
});

for (const theme of ["light", "dark"] as const) {
  it(`${theme}: actual signed-in kitchen hero preserves delivered display scale`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(Index, { kitchenUser: { id: "chef", username: "chef_rowan", photoUrl: null }, isOwner: true, recipes: [], cookbooks: [] });
    await expect.poll(() => host.querySelector("h1")).toBeTruthy();
    const title = host.querySelector("h1")!;
    const measurements = [];
    for (const width of widths) {
      await page.viewport(width, 900);
      const actual = compareDelivered(title, `${heading} mt-3 text-5xl/12 sm:text-6xl/14 lg:text-7xl/16`);
      expect(actual.fontSize).toBe(width >= 1024 ? "72px" : width >= 640 ? "60px" : "48px");
      measurements.push({ width, title: actual });
    }
    await annotate(`T21_KITCHEN_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: actual search hero keeps its delivered display scale, and a result is an HX Item named by type and title`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const result: SearchResult = {
      type: "recipe", id: "type-proof", ownerId: "chef", ownerUsername: "chef",
      title: "Tomato soup for a crowded table", subtitle: "By chef",
      snippet: "A practical soup with garlic and basil.", href: "/recipes/type-proof",
      imageUrl: null, score: 1, metadata: {},
    };
    const host = await mount(Search, { query: "", scope: "all", isAuthenticated: false, results: [result] }, "/search");
    await expect.poll(() => host.querySelector("h1")).toBeTruthy();
    const title = host.querySelector("h1")!;
    const resultLink = host.querySelector<HTMLAnchorElement>('a[href="/recipes/type-proof"]')!;
    const measurements = [];
    for (const width of widths) {
      await page.viewport(width, 900);
      const actual = compareDelivered(title, `${heading} mt-3 text-5xl/12 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.05]`);
      expect(actual.fontSize).toBe(width >= 1024 ? "84px" : width >= 640 ? "72px" : "48px");
      measurements.push({ width, title: actual });
    }
    // The result is an HX Item; its title is the result's <h2>, inside the link that it names with
    // the type and the byline.
    expect(resultLink.closest('[data-ouro="item"]')).not.toBeNull();
    const resultTitle = resultLink.querySelector("h2")!;
    expect(resultTitle.tagName).toBe("H2");
    expect(resultTitle.textContent).toBe("Tomato soup for a crowded table");
    expect(resultLink.textContent).toMatch(/^Recipe\s*Tomato soup for a crowded table\s*By chef$/);
    await annotate(`T21_SEARCH_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: the 14px branded step-output heading keeps its level, ink and actual size`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(() => <main className="sj-page"><StepOutputUseDisplay usingSteps={[{ id: "use-1", outputStepNum: 1, outputOfStep: { stepNum: 1, stepTitle: "Prep" } }]} /></main>);
    await expect.poll(() => host.querySelector("h4")).toBeTruthy();
    const output = host.querySelector("h4")!;
    const base = "font-sj-display text-base/7 font-semibold tracking-normal text-[var(--sj-ink)]";
    const measurements = [];
    for (const width of [390, 640, 1024]) {
      await page.viewport(width, 900);
      const outputs = compareDelivered(output, `${base} m-0 mb-3 text-sm uppercase text-[var(--sj-ink-soft)]`);
      expect(outputs.fontSize).toBe("14px");
      measurements.push({ width, outputs });
    }
    await annotate(`T21_METADATA_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: actual responsive 84px recipe hero/copy equal the delivered witness on both sides of sm/lg`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(RecipesIndex, { query: "", isAuthenticated: false, recipes: [], after: null, nextCursor: null }, "/recipes");
    await expect.poll(() => host.querySelector("h1")).toBeTruthy();
    const title = host.querySelector("h1")!;
    const copy = title.nextElementSibling as HTMLElement;
    const measurements = [];
    for (const width of widths) {
      await page.viewport(width, 900);
      const actual = compareDelivered(title, `${heading} mt-3 max-w-4xl text-4xl/10 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.04]`);
      expect(actual.fontSize).toBe(width >= 1024 ? "84px" : width >= 640 ? "72px" : "36px");
      expect(title.tagName).toBe("H1");
      measurements.push({ width, title: actual, copy: compareDelivered(copy, `${text} mt-3 max-w-2xl text-base/7 sm:mt-5 sm:text-lg/8`) });
    }
    await annotate(`T21_RECIPE_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: actual photo-overlay hero/copy retain delivered responsive family/ink/wrapping`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(Index, { kitchenUser: null, isOwner: false, recipes: [], cookbooks: [] });
    await expect.poll(() => host.querySelector("h1")).toBeTruthy();
    const title = host.querySelector("h1")!;
    const copy = title.nextElementSibling as HTMLElement;
    const measurements = [];
    for (const width of widths) {
      await page.viewport(width, 900);
      const actual = compareDelivered(title, `${heading} mt-5 max-w-4xl text-4xl/10 text-[var(--sj-on-photo)] sm:text-6xl/14 lg:text-7xl/16 xl:text-8xl/20`);
      expect(actual.fontSize).toBe(width >= 1280 ? "96px" : width >= 1024 ? "72px" : width >= 640 ? "60px" : "36px");
      measurements.push({ width, title: actual, copy: compareDelivered(copy, `${text} mt-5 max-w-2xl text-lg/8 text-[var(--sj-on-photo-muted)]`) });
    }
    await annotate(`T21_PHOTO_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: actual account safety notice retains delivered surface/ink/size`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const data: AccountSettingsLoaderData = {
      user: { id: "type-proof", email: "chef@example.com", username: "chef", hasPassword: false, photoUrl: null, oauthAccounts: [{ provider: "github", providerUsername: "chef" }], passkeys: [] },
      notifications: { pushSubscribed: false, preferences: { notifySpoonOnMyRecipe: true, notifyForkOfMyRecipe: true, notifyCookbookSaveOfMine: true, notifyFellowChefOriginCook: true } },
    };
    const host = await mount(AccountSettings, data, "/account/settings");
    await expect.poll(() => Array.from(host.querySelectorAll("p")).find((node) => node.textContent?.includes("You cannot unlink your OAuth provider"))).toBeTruthy();
    const notice = Array.from(host.querySelectorAll("p")).find((node) => node.textContent?.includes("You cannot unlink your OAuth provider"))!;
    await annotate(`T21_NOTICE_TYPE ${JSON.stringify({ theme, actual: compareDelivered(notice, `${text} mt-3 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-3 text-sm text-[var(--sj-brass)]`) })}`);
  });

  it(`${theme}: real cook step content preserves delivered screen and print typography`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(() => <main className="sj-page"><StepsSectionHeading hasProgress={false} onClearProgress={() => {}} /><StepCard stepNumber={1} title="Build the base" description={"Warm the olive oil in a heavy pot.\nAdd onion, garlic and salt, then cook until softened."} ingredients={[]} stepOutputUses={[]} /></main>);
    await expect.poll(() => host.querySelector("h2")).toBeTruthy();
    const sectionTitle = host.querySelector("h2")!;
    const instructions = host.querySelector("article .mt-8 > p") as HTMLElement;
    const measurements = [];
    for (const media of ["screen", "print"] as const) {
      await commands.task21PrintMedia(media);
      for (const width of [390, 640, 1024]) {
        await page.viewport(width, 900);
        measurements.push({
          media, width,
          title: compareDelivered(sectionTitle, `${heading} mt-3 print:mt-0 text-3xl/9 font-semibold tracking-normal sm:text-4xl/11`),
          // The method is set in full ink: it used to carry both ink colours, and the softer one won by CSS order.
          instructions: compareDelivered(instructions, "font-sj-body m-0 whitespace-pre-wrap text-base leading-loose text-[var(--sj-ink)] sm:text-lg"),
        });
      }
      if (media === "print") {
        expect(getComputedStyle(document.body).backgroundColor).toBe("rgb(255, 255, 255)");
        expect(contrast(rgba(getComputedStyle(instructions).color), rgba(getComputedStyle(document.body).backgroundColor))).toBeGreaterThanOrEqual(4.5);
      }
    }
    await annotate(`T21_COOK_PRINT_TYPE ${JSON.stringify({ theme, measurements })}`);
  });

  it(`${theme}: compiled primary action keeps AA contrast at rest, focus, hover, press and disabled`, async ({ annotate }) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const host = await mount(() => <div className="p-8"><Button data-type-action>Checked action</Button><Button disabled>Disabled action</Button></div>);
    await expect.poll(() => host.querySelector("[data-type-action]")).toBeTruthy();
    const primary = host.querySelector<HTMLElement>("[data-type-action]")!;
    const disabled = host.querySelector<HTMLElement>("[data-disabled]")!;
    const measure = (element: HTMLElement) => {
      const css = getComputedStyle(element);
      const overlay = getComputedStyle(element, "::before");
      expect(css.fontFamily).toContain("IBM Plex Sans Condensed");
      expect(css.fontWeight).toBe("600");
      const fill = rgba(css.backgroundColor);
      const layer = rgba(overlay.backgroundColor);
      const alpha = Number(overlay.opacity) * layer[3];
      const painted = fill.map((channel, index) => index < 3 ? channel * (1 - alpha) + layer[index]! * alpha : 1);
      const ratio = contrast(rgba(css.color), painted);
      expect(css.opacity).toBe("1");
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      return { color: css.color, fill: css.backgroundColor, overlay: overlay.backgroundColor, opacity: overlay.opacity, ratio };
    };
    const states: Record<string, unknown> = { rest: measure(primary), disabled: measure(disabled) };
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => document.activeElement).toBe(primary);
    expect(primary.matches(":focus-visible")).toBe(true);
    const focus = getComputedStyle(primary);
    expect(focus.outlineStyle).toBe("solid");
    expect(focus.outlineWidth).toBe("2px");
    expect(focus.outlineOffset).toBe("2px");
    expect(contrast(rgba(focus.outlineColor), rgba(getComputedStyle(document.body).backgroundColor))).toBeGreaterThanOrEqual(3);
    states.focus = measure(primary);
    await userEvent.hover(primary);
    await expect.poll(() => getComputedStyle(primary, "::before").opacity).toBe("0.08");
    states.hover = measure(primary);
    await commands.pointerPress({ selector: "[data-type-action]", action: "down" });
    try {
      await expect.poll(() => getComputedStyle(primary, "::before").opacity).toBe("0.14");
      states.pressed = measure(primary);
    } finally {
      await commands.pointerPress({ action: "up" });
    }
    await annotate(`T21_ACTION_CONTRAST ${JSON.stringify({ theme, states, ring: focus.outlineColor })}`);
  });
}

// Ask the browser's sRGB canvas to resolve its actual computed CSS colors,
// including color-mix(), rather than assuming every engine serializes rgb().
function rgba(color: string): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data, (value) => value / 255);
}
function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => {
    const channels = rgb.slice(0, 3).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light! + .05) / (dark! + .05);
}
