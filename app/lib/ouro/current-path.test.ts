import { describe, expect, it } from "vitest";
import { currentHref } from "~/lib/ouro/current-path";

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
