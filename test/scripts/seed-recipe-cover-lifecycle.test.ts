import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("prisma seed recipe cover lifecycle", () => {
  it("activates demo recipe covers when seeding image-backed recipes", async () => {
    const seedSource = await readFile("prisma/seed.ts", "utf8");

    expect(seedSource).toContain("async function upsertSeedRecipeCover");
    expect(seedSource).toContain("activeCoverId");
    expect(seedSource).toContain("activeCoverVariant");
    expect(seedSource).toContain("coverMode");
    expect(seedSource).toContain("sourceImageUrl: imageUrl");
    expect(seedSource).toContain('sourceType: "chef-upload"');
  });
});
