import { describe, expect, it } from "vitest";
import { currentHref, currentTabHref } from "~/lib/ouro/current-path";

describe("currentHref", () => {
  const hrefs = ["/", "/recipes", "/recipes/drafts", "/settings"];

  it("returns nothing without a current path", () => {
    expect(currentHref(hrefs, undefined)).toBeUndefined();
  });

  it("matches the same path, ignoring a trailing slash, a query and a hash", () => {
    expect(currentHref(hrefs, "/recipes")).toBe("/recipes");
    expect(currentHref(hrefs, "/recipes/")).toBe("/recipes");
    expect(currentHref(hrefs, "/settings?tab=profile#name")).toBe("/settings");
    expect(currentHref(["/recipes?sort=new"], "/recipes")).toBe("/recipes?sort=new");
  });

  it("marks the longest href the path sits under", () => {
    expect(currentHref(hrefs, "/recipes/12")).toBe("/recipes");
    expect(currentHref(hrefs, "/recipes/drafts/3")).toBe("/recipes/drafts");
    expect(currentHref(["/recipes/drafts", "/recipes"], "/recipes/drafts/3")).toBe("/recipes/drafts");
  });

  it("matches the root only for the root itself", () => {
    expect(currentHref(hrefs, "/")).toBe("/");
    expect(currentHref(hrefs, "")).toBe("/");
    expect(currentHref(hrefs, "/cookbooks")).toBeUndefined();
  });

  it("does not match a path that only shares a prefix of a segment", () => {
    expect(currentHref(hrefs, "/recipes-archive")).toBeUndefined();
  });
});

describe("currentTabHref", () => {
  const scopes = ["/search", "/search?scope=recipes", "/search?scope=chefs", "/search?scope=recipes&sort=new"];

  it("returns nothing without a current path", () => {
    expect(currentTabHref(scopes, undefined)).toBeUndefined();
  });

  it("marks the tab whose every parameter the current path carries, the most parameters winning", () => {
    expect(currentTabHref(scopes, "/search?scope=recipes&q=soup")).toBe("/search?scope=recipes");
    expect(currentTabHref(scopes, "/search?q=soup&scope=chefs")).toBe("/search?scope=chefs");
    expect(currentTabHref(scopes, "/search?sort=new&scope=recipes")).toBe("/search?scope=recipes&sort=new");
    expect(currentTabHref(scopes, "/search?q=soup")).toBe("/search");
    expect(currentTabHref(scopes, "/search/")).toBe("/search");
    // A parameter given twice matches either value; a hash on either side is ignored.
    expect(currentTabHref(scopes, "/search?scope=all&scope=chefs#top")).toBe("/search?scope=chefs");
    expect(currentTabHref(["/search?scope=chefs#results"], "/search?scope=chefs")).toBe("/search?scope=chefs#results");
  });

  it("marks the first of two tabs with as many matching parameters", () => {
    expect(currentTabHref(["/search?scope=recipes", "/search?sort=new"], "/search?scope=recipes&sort=new")).toBe("/search?scope=recipes");
  });

  it("marks nothing when the tabs at the path all ask for other parameters", () => {
    expect(currentTabHref(["/search?scope=recipes", "/search?scope=chefs"], "/search?q=soup")).toBeUndefined();
    expect(currentTabHref(["/search?scope=recipes", "/recipes"], "/search?scope=chefs")).toBeUndefined();
  });

  it("falls back to the longest tab the path sits under when none is at its path", () => {
    expect(currentTabHref(["/recipes", "/my-recipes", "/saved-recipes"], "/my-recipes/12?tab=notes")).toBe("/my-recipes");
    expect(currentTabHref(["/recipes", "/my-recipes"], "/cookbooks")).toBeUndefined();
  });
});
