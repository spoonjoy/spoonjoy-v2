import {
  ImageGenError,
  type GeneratedImageOutput,
  type ImageGenEnv,
  type ImageGenRunner,
} from "~/lib/image-gen.server";

/**
 * The image provider that answers from sample images instead of a paid generation call. QA sets
 * `IMAGE_PROVIDER_PRIMARY` to it (wrangler.json's `env.qa`), so the shared QA Worker, every
 * Journeys run's Worker and the QA Image Cover Smoke never pay for a cover no person will see.
 */
export const SAMPLE_IMAGE_PROVIDER = "sample";
export const SAMPLE_IMAGE_MODEL = "sample-bucket";

/** Where the sample images live in the photo bucket; scripts/qa-sample-covers.mjs puts them there. */
export const SAMPLE_COVER_PREFIX = "samples/covers/";

const SAMPLE_CONTENT_TYPES: Record<string, NonNullable<GeneratedImageOutput["contentType"]>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** True when the environment asks for sample images. Sample mode never falls back to a paid provider. */
export function usesSampleImages(env: Pick<ImageGenEnv, "IMAGE_PROVIDER_PRIMARY"> | null | undefined): boolean {
  return (env?.IMAGE_PROVIDER_PRIMARY ?? "").trim().toLowerCase() === SAMPLE_IMAGE_PROVIDER;
}

/** FNV-1a over the seed, so a recipe always gets the same sample. */
export function sampleIndex(seed: string, count: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % count;
}

function sampleContentType(key: string): NonNullable<GeneratedImageOutput["contentType"]> {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const contentType = SAMPLE_CONTENT_TYPES[extension];
  if (!contentType) throw new ImageGenError(`Sample image ${key} is not a JPEG, PNG or WebP file`);
  return contentType;
}

/**
 * The parts of the photo bucket the sample runner reads. The Workers R2 binding has them; the app's
 * own `R2Bucket` declaration (app/cloudflare-env.d.ts) lists only get, put and delete.
 */
interface SampleImageBucket {
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

/**
 * A runner that returns one of the bucket's sample images, chosen by `seed` (the recipe's id), for
 * both text-to-image and image edits. Its output goes through the same storage and cover updates
 * as a generated image.
 */
export function createSampleImageRunner({ bucket, seed }: { bucket: R2Bucket; seed: string }): ImageGenRunner {
  const samples = bucket as unknown as SampleImageBucket;
  async function sample(): Promise<GeneratedImageOutput> {
    const listing = await samples.list({ prefix: SAMPLE_COVER_PREFIX });
    const keys = listing.objects.map((object) => object.key).sort();
    if (keys.length === 0) {
      throw new ImageGenError(`The photo bucket has no sample images under ${SAMPLE_COVER_PREFIX}`);
    }
    const key = keys[sampleIndex(seed, keys.length)];
    const contentType = sampleContentType(key);
    const object = await samples.get(key);
    if (!object) throw new ImageGenError(`Sample image ${key} is missing from the photo bucket`);
    return { bytes: new Uint8Array(await object.arrayBuffer()), contentType };
  }
  return {
    textToImage: () => sample(),
    imageToImage: () => sample(),
  };
}
