import { describe, expect, it } from "vitest";
import { SOURCE_REPOSITORY, sourceHrefFor, type PageProvenance } from "~/lib/ouro-provenance";
import { OURO_PROVENANCE, pageProvenance } from "~/lib/ouro-provenance.server";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("sourceHrefFor", () => {
  const provenance: PageProvenance = {
    file: "app/routes/page.tsx",
    renders: { checklist: ["app/components/list.tsx"], button: ["app/routes/page.tsx", "app/components/list.tsx"] },
    root: { file: "app/root.tsx", renders: { toaster: ["app/root.tsx"], button: ["app/root.tsx"] } },
    sourceSha: SHA,
  };
  const href = sourceHrefFor(provenance);

  it("links the one file of the page that renders an item, at the running commit", () => {
    expect(href("checklist")).toBe(`${SOURCE_REPOSITORY}/blob/${SHA}/app/components/list.tsx`);
  });

  it("links the route when several of the page's files render an item", () => {
    expect(href("button")).toBe(`${SOURCE_REPOSITORY}/blob/${SHA}/app/routes/page.tsx`);
  });

  it("links the root layout for what only it renders", () => {
    expect(href("toaster")).toBe(`${SOURCE_REPOSITORY}/blob/${SHA}/app/root.tsx`);
  });

  it("links the route for an item rendered inside another HX component", () => {
    expect(href("popover")).toBe(`${SOURCE_REPOSITORY}/blob/${SHA}/app/routes/page.tsx`);
  });
});

describe("pageProvenance", () => {
  it("gives a page's record, the root's, and the commit it was built from", () => {
    const page = pageProvenance("app/routes/test-kitchen.tsx", SHA);
    expect(page.file).toBe("app/routes/test-kitchen.tsx");
    expect(page.renders.checklist).toEqual(["app/components/recipe/IngredientList.tsx"]);
    expect(page.root).toEqual({ file: "app/root.tsx", renders: OURO_PROVENANCE.root.renders });
    expect(page.sourceSha).toBe(SHA);
  });

  it("links main when the build does not know its commit", () => {
    expect(pageProvenance("app/routes/test-kitchen.tsx", "unknown").sourceSha).toBe("main");
    expect(pageProvenance("app/routes/test-kitchen.tsx").sourceSha).toBe("main");
  });

  it("fails for a file that is not a page", () => {
    expect(() => pageProvenance("app/routes/nowhere.tsx", SHA)).toThrow("app/routes/nowhere.tsx is not a page");
  });

  it("names the installed Ouro HX release", () => {
    expect(OURO_PROVENANCE.ouroTag).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
