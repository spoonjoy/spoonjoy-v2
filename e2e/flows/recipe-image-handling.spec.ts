import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIENTATION_FIXTURE = path.resolve(__dirname, '../fixtures/asymmetric-exif-orientation.jpg');

type Rgb = [number, number, number];

function isNearColor(actual: Rgb, expected: Rgb, tolerance = 48) {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}

async function decodedImageSamples(page: Page, title: string) {
  const image = page.getByRole('img', { name: `Photo of ${title}` });
  await expect(image).toBeVisible({ timeout: 10_000 });

  return image.evaluate(async (img) => {
    const imageElement = img as HTMLImageElement;
    await imageElement.decode();

    const canvas = document.createElement('canvas');
    canvas.width = imageElement.naturalWidth;
    canvas.height = imageElement.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create canvas context');
    context.drawImage(imageElement, 0, 0);

    const pixel = (x: number, y: number): Rgb => {
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      return [r, g, b];
    };

    return {
      width: canvas.width,
      height: canvas.height,
      topLeft: pixel(2, 2),
      topRight: pixel(canvas.width - 3, 2),
      bottomLeft: pixel(2, canvas.height - 3),
      bottomRight: pixel(canvas.width - 3, canvas.height - 3),
    };
  });
}

test.describe('Recipe image handling', () => {
  test('uploaded EXIF-oriented recipe photos remain upright after save and reload', async ({ page }) => {
    const title = `e2e orientation recipe ${Date.now()}`;
    let recipePath: string | null = null;

    try {
      await page.goto('/recipes/new');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

      await page.getByRole('textbox', { name: 'Title' }).first().fill(title);
      await page.getByLabel('Upload recipe image').setInputFiles(ORIENTATION_FIXTURE);
      await expect(page.getByRole('img', { name: /recipe image preview/i })).toBeVisible();
      await page.getByRole('button', { name: /create recipe/i }).click();

      await expect(page).toHaveURL(/\/recipes\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 15_000 });
      recipePath = new URL(page.url()).pathname;
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });

      await page.reload();
      const samples = await decodedImageSamples(page, title);

      expect(samples.width).toBe(80);
      expect(samples.height).toBe(120);
      expect(isNearColor(samples.topLeft, [24, 165, 87])).toBe(true);
      expect(isNearColor(samples.topRight, [24, 165, 87])).toBe(true);
      expect(isNearColor(samples.bottomLeft, [26, 85, 225])).toBe(true);
      expect(isNearColor(samples.bottomRight, [224, 25, 44])).toBe(true);
    } finally {
      if (recipePath) {
        await page.request.post(recipePath, { form: { intent: 'delete' } });
      }
    }
  });
});
