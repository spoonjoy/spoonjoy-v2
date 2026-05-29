import { describe, it, expect, vi } from "vitest";
import { coverScale, clampOffset, getCropPixels, cropImageToBlob } from "~/lib/image-crop";

describe("coverScale", () => {
  it("uses the height ratio for a wide image (height is the limiting dimension)", () => {
    // 400x200 into a 100 square: max(100/400, 100/200) = max(0.25, 0.5) = 0.5
    expect(coverScale({ width: 400, height: 200 }, 100)).toBe(0.5);
  });

  it("uses the width ratio for a tall image (width is the limiting dimension)", () => {
    // 200x400 into a 100 square: max(100/200, 100/400) = max(0.5, 0.25) = 0.5
    expect(coverScale({ width: 200, height: 400 }, 100)).toBe(0.5);
  });

  it("returns 1 when natural dimensions are zero", () => {
    expect(coverScale({ width: 0, height: 0 }, 100)).toBe(1);
  });

  it("returns 1 when natural dimensions are NaN", () => {
    expect(coverScale({ width: NaN, height: 100 }, 100)).toBe(1);
    expect(coverScale({ width: 100, height: NaN }, 100)).toBe(1);
  });

  it("returns 1 when natural dimensions are not finite", () => {
    expect(coverScale({ width: Infinity, height: 100 }, 100)).toBe(1);
  });

  it("returns 1 when a natural dimension is negative", () => {
    expect(coverScale({ width: -100, height: 100 }, 100)).toBe(1);
  });
});

describe("clampOffset", () => {
  it("clamps both axes when offset exceeds the maximum", () => {
    // 400x200, viewport 100, zoom 1 → coverScale 0.5
    // displayScale 0.5; maxX = (400*0.5 - 100)/2 = 50; maxY = (200*0.5 - 100)/2 = 0
    const result = clampOffset({ width: 400, height: 200 }, 100, 1, { x: 999, y: 999 });
    expect(result).toEqual({ x: 50, y: 0 });
  });

  it("clamps negative offsets to the negative maximum", () => {
    const result = clampOffset({ width: 400, height: 200 }, 100, 1, { x: -999, y: -999 });
    expect(result.x).toBe(-50);
    // maxY is 0 here, so y clamps to -0; normalize away the sign of zero.
    expect(result.y + 0).toBe(0);
  });

  it("passes through an offset that is within range", () => {
    const result = clampOffset({ width: 400, height: 200 }, 100, 1, { x: 10, y: 0 });
    expect(result).toEqual({ x: 10, y: 0 });
  });

  it("expands the clamp range when zoomed in", () => {
    // zoom 2 → displayScale 1.0; maxX = (400*1 - 100)/2 = 150; maxY = (200*1 - 100)/2 = 50
    const result = clampOffset({ width: 400, height: 200 }, 100, 2, { x: 999, y: 999 });
    expect(result).toEqual({ x: 150, y: 50 });
  });
});

describe("getCropPixels", () => {
  it("returns a centered crop when offset is zero", () => {
    // 400x200, viewport 100, zoom 1 → displayScale 0.5
    // sWidth = sHeight = 100/0.5 = 200
    // sx = 400/2 - 200/2 - 0 = 100; sy = 200/2 - 200/2 - 0 = 0
    const crop = getCropPixels({ width: 400, height: 200 }, 100, 1, { x: 0, y: 0 });
    expect(crop).toEqual({ sx: 100, sy: 0, sWidth: 200, sHeight: 200 });
  });

  it("shifts the source window for a non-zero offset", () => {
    // displayScale 0.5; offset.x 50 → sx shifts by -50/0.5 = -100
    const crop = getCropPixels({ width: 400, height: 200 }, 100, 1, { x: 50, y: 10 });
    expect(crop.sWidth).toBe(200);
    expect(crop.sHeight).toBe(200);
    expect(crop.sx).toBe(100 - 50 / 0.5);
    expect(crop.sy).toBe(0 - 10 / 0.5);
  });

  it("shrinks the source window when zoomed in", () => {
    // zoom 2 → displayScale 1.0; sWidth = sHeight = 100/1 = 100
    const crop = getCropPixels({ width: 400, height: 200 }, 100, 2, { x: 0, y: 0 });
    expect(crop.sWidth).toBe(100);
    expect(crop.sHeight).toBe(100);
    expect(crop.sx).toBe(400 / 2 - 100 / 2);
    expect(crop.sy).toBe(200 / 2 - 100 / 2);
  });
});

describe("cropImageToBlob", () => {
  function makeFakeCanvas(toBlobImpl: HTMLCanvasElement["toBlob"]) {
    const drawImage = vi.fn();
    const fakeCtx = { drawImage } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeCtx),
      toBlob: toBlobImpl,
    } as unknown as HTMLCanvasElement;
    return { canvas, drawImage, getContext: canvas.getContext };
  }

  const image = {} as CanvasImageSource;
  const crop = { sx: 10, sy: 20, sWidth: 30, sHeight: 40 };

  it("draws the crop region and resolves a blob with default type/quality", async () => {
    let capturedType: string | undefined;
    let capturedQuality: number | undefined;
    const { canvas, drawImage } = makeFakeCanvas(((cb, type, quality) => {
      capturedType = type;
      capturedQuality = quality;
      cb(new Blob(["x"], { type }));
    }) as HTMLCanvasElement["toBlob"]);

    const blob = await cropImageToBlob(image, crop, 512, { createCanvas: () => canvas });

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(drawImage).toHaveBeenCalledWith(image, 10, 20, 30, 40, 0, 0, 512, 512);
    expect(blob.type).toBe("image/jpeg");
    expect(capturedType).toBe("image/jpeg");
    expect(capturedQuality).toBe(0.92);
  });

  it("passes through a custom type and quality", async () => {
    let capturedType: string | undefined;
    let capturedQuality: number | undefined;
    const { canvas } = makeFakeCanvas(((cb, type, quality) => {
      capturedType = type;
      capturedQuality = quality;
      cb(new Blob(["x"], { type }));
    }) as HTMLCanvasElement["toBlob"]);

    const blob = await cropImageToBlob(image, crop, 256, {
      createCanvas: () => canvas,
      type: "image/png",
      quality: 0.5,
    });

    expect(capturedType).toBe("image/png");
    expect(capturedQuality).toBe(0.5);
    expect(blob.type).toBe("image/png");
  });

  it("falls back to document.createElement when no canvas factory is provided", async () => {
    let capturedType: string | undefined;
    const { canvas } = makeFakeCanvas(((cb, type) => {
      capturedType = type;
      cb(new Blob(["x"], { type }));
    }) as HTMLCanvasElement["toBlob"]);
    const createSpy = vi.spyOn(document, "createElement").mockReturnValue(canvas);

    const blob = await cropImageToBlob(image, crop, 128);

    expect(createSpy).toHaveBeenCalledWith("canvas");
    expect(capturedType).toBe("image/jpeg");
    expect(blob).toBeInstanceOf(Blob);
    createSpy.mockRestore();
  });

  it("rejects when the 2d context cannot be obtained", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toBlob: vi.fn(),
    } as unknown as HTMLCanvasElement;

    await expect(cropImageToBlob(image, crop, 512, { createCanvas: () => canvas })).rejects.toThrow(
      "Could not get 2d context"
    );
  });

  it("rejects when toBlob yields null", async () => {
    const { canvas } = makeFakeCanvas(((cb) => cb(null)) as HTMLCanvasElement["toBlob"]);

    await expect(cropImageToBlob(image, crop, 512, { createCanvas: () => canvas })).rejects.toThrow(
      "Could not export image"
    );
  });
});
