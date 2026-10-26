import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createSampleImageRunner,
  SAMPLE_COVER_PREFIX,
  sampleIndex,
  usesSampleImages,
} from "~/lib/sample-cover-images.server";
import { SAMPLE_COVER_PREFIX as UPLOAD_PREFIX } from "../../scripts/qa-sample-covers.mjs";

function sampleBucket(objects: Record<string, Uint8Array | null>) {
  return {
    list: vi.fn(async () => ({ objects: Object.keys(objects).map((key) => ({ key })) })),
    get: vi.fn(async (key: string) => {
      const bytes = objects[key];
      return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
    }),
  };
}

function runnerFor(bucket: ReturnType<typeof sampleBucket>, seed: string) {
  return createSampleImageRunner({ bucket: bucket as unknown as R2Bucket, seed });
}

describe("sample-cover-images.server", () => {
  it("reads the prefix the upload script writes", () => {
    expect(SAMPLE_COVER_PREFIX).toBe(UPLOAD_PREFIX);
  });

  it("is QA's image provider, and never production's", () => {
    const config = JSON.parse(readFileSync("wrangler.json", "utf8"));
    // QA's shared Worker and every Journeys run's Worker deploy with env.qa's vars.
    expect(usesSampleImages(config.env.qa.vars)).toBe(true);
    // Production names no provider in its config, so it uses OpenAI first (OPENAI_API_KEY).
    expect(config.vars.IMAGE_PROVIDER_PRIMARY).toBeUndefined();
    expect(usesSampleImages(config.vars)).toBe(false);
  });

  it("is on only when IMAGE_PROVIDER_PRIMARY names the sample provider", () => {
    expect(usesSampleImages({ IMAGE_PROVIDER_PRIMARY: "sample" })).toBe(true);
    expect(usesSampleImages({ IMAGE_PROVIDER_PRIMARY: "  Sample " })).toBe(true);
    expect(usesSampleImages({ IMAGE_PROVIDER_PRIMARY: "openai" })).toBe(false);
    expect(usesSampleImages({})).toBe(false);
    expect(usesSampleImages(null)).toBe(false);
    expect(usesSampleImages(undefined)).toBe(false);
  });

  it("picks the same index for the same seed, within range", () => {
    expect(sampleIndex("recipe-a", 5)).toBe(sampleIndex("recipe-a", 5));
    for (const seed of ["", "recipe-a", "recipe-b", "cm6ft3hh7002wbzlqpsf8iq43"]) {
      const index = sampleIndex(seed, 5);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
    }
    const spread = new Set(Array.from({ length: 50 }, (_, n) => sampleIndex(`recipe-${n}`, 5)));
    expect(spread.size).toBe(5);
  });

  it("returns the seed's sample image for both generation and edits, with its content type", async () => {
    const keys = ["b.webp", "a.jpg", "c.png", "d.jpeg"].map((name) => `${SAMPLE_COVER_PREFIX}${name}`);
    const bytes = Object.fromEntries(keys.map((key, index) => [key, new Uint8Array([index + 1])]));
    const bucket = sampleBucket(bytes);
    const sorted = [...keys].sort();
    const seed = "recipe-1";
    const expectedKey = sorted[sampleIndex(seed, sorted.length)];
    const runner = runnerFor(bucket, seed);

    const generated = await runner.textToImage("a prompt", { model: "sample-bucket" });
    const edited = await runner.imageToImage(new File([new Uint8Array([9])], "spoon.png"), "a prompt", { model: "sample-bucket" });

    expect(bucket.list).toHaveBeenCalledWith({ prefix: SAMPLE_COVER_PREFIX });
    expect(bucket.get).toHaveBeenCalledWith(expectedKey);
    expect(generated.bytes).toEqual(bytes[expectedKey]);
    expect(edited).toEqual(generated);
  });

  it.each([
    ["a.jpg", "image/jpeg"],
    ["a.JPEG", "image/jpeg"],
    ["a.png", "image/png"],
    ["a.webp", "image/webp"],
  ])("labels %s as %s", async (name, contentType) => {
    const key = `${SAMPLE_COVER_PREFIX}${name}`;
    const runner = runnerFor(sampleBucket({ [key]: new Uint8Array([1]) }), "r");
    await expect(runner.textToImage("p", { model: "m" })).resolves.toMatchObject({ contentType });
  });

  it("fails when the bucket has no sample images", async () => {
    const runner = runnerFor(sampleBucket({}), "r");
    await expect(runner.textToImage("p", { model: "m" })).rejects.toThrow(
      `The photo bucket has no sample images under ${SAMPLE_COVER_PREFIX}`,
    );
  });

  it("fails on a sample that is not an image it can label", async () => {
    const key = `${SAMPLE_COVER_PREFIX}notes.txt`;
    const runner = runnerFor(sampleBucket({ [key]: new Uint8Array([1]) }), "r");
    await expect(runner.textToImage("p", { model: "m" })).rejects.toThrow(`Sample image ${key} is not a JPEG, PNG or WebP file`);
  });

  it("fails when a listed sample has gone from the bucket", async () => {
    const key = `${SAMPLE_COVER_PREFIX}gone.jpg`;
    const runner = runnerFor(sampleBucket({ [key]: null }), "r");
    await expect(runner.textToImage("p", { model: "m" })).rejects.toThrow(`Sample image ${key} is missing from the photo bucket`);
  });
});
