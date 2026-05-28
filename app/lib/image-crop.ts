export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

export interface CropPixels {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

/**
 * Minimum scale required for the image to fully cover a `viewport`×`viewport`
 * square. Guards against non-finite or zero natural dimensions by returning 1.
 */
export function coverScale(natural: Size, viewport: number): number {
  if (
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    natural.width <= 0 ||
    natural.height <= 0
  ) {
    return 1;
  }

  return Math.max(viewport / natural.width, viewport / natural.height);
}

/**
 * Clamp the pan offset so the scaled image always covers the square viewport.
 */
export function clampOffset(natural: Size, viewport: number, zoom: number, offset: Offset): Offset {
  const displayScale = coverScale(natural, viewport) * zoom;
  const maxX = Math.max(0, (natural.width * displayScale - viewport) / 2);
  const maxY = Math.max(0, (natural.height * displayScale - viewport) / 2);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/**
 * Map the on-screen viewport + zoom + offset to source pixel coordinates on the
 * natural image. Assumes the offset has already been clamped by the caller.
 */
export function getCropPixels(natural: Size, viewport: number, zoom: number, offset: Offset): CropPixels {
  const displayScale = coverScale(natural, viewport) * zoom;
  const sWidth = viewport / displayScale;
  const sHeight = viewport / displayScale;
  const sx = natural.width / 2 - sWidth / 2 - offset.x / displayScale;
  const sy = natural.height / 2 - sHeight / 2 - offset.y / displayScale;

  return { sx, sy, sWidth, sHeight };
}

/**
 * Draw the cropped region of `image` into an `output`×`output` canvas and
 * export it as a Blob. The canvas factory and encode options are injectable for
 * testing.
 */
export async function cropImageToBlob(
  image: CanvasImageSource,
  crop: CropPixels,
  output: number,
  opts?: { createCanvas?: () => HTMLCanvasElement; type?: string; quality?: number }
): Promise<Blob> {
  const canvas = (opts?.createCanvas ?? (() => document.createElement("canvas")))();
  canvas.width = output;
  canvas.height = output;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2d context");

  ctx.drawImage(image, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, output, output);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not export image"))),
      opts?.type ?? "image/jpeg",
      opts?.quality ?? 0.92
    )
  );
}
