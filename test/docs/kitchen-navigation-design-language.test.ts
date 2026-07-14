import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(resolve(__dirname, "..", "..", path), "utf8");
}

describe("kitchen navigation design language", () => {
  it("documents the signed-in kitchen drawers and search posture", () => {
    const designLanguage = readProjectFile("docs/design-language.md");

    for (const marker of [
      "Main Kitchen Navigation",
      "`Kitchen` -> `/`",
      "`My Recipes` -> `/my-recipes`",
      "`Saved Recipes` -> `/saved-recipes`",
      "`Cookbooks` -> `/cookbooks`",
      "`Shopping List` -> `/shopping-list`",
      "`Chefs` -> `/chefs`",
      "`Kitchen Search` -> `/search`",
      "Saved Recipes are recipes saved through cookbooks owned by the signed-in cook",
      "Global search stays at `/search`",
      "personal drawer filters are local filters",
      "mobile dock",
      "Pantry drawer",
      "Recently Updated"
    ]) {
      expect(designLanguage).toContain(marker);
    }

    expect(designLanguage).not.toContain("Latest from the kitchen");
    expect(designLanguage).not.toContain("On the Counter");
  });
});
