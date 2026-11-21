export { isPictureReady, markPicturesReady, rememberPicture };

// Pictures an avatar on this page has loaded, each held by an image so the browser keeps it ready: an avatar
// of one draws it in its first render, with no second render to swap the initials for it. The oldest go
// past a few hundred.
const readyPictures = new Map<string, HTMLImageElement>();
const READY_PICTURES = 256;

/**
 * Whether the picture at this address is ready, so an avatar draws it on its first frame.
 * @internal
 */
function isPictureReady(src: string): boolean {
  return readyPictures.has(src);
}

/**
 * Keeps a picture the avatar has loaded ready under its address, dropping the oldest past the limit.
 * @internal
 */
function rememberPicture(src: string, image: HTMLImageElement): void {
  readyPictures.set(src, image);
  if (readyPictures.size > READY_PICTURES) readyPictures.delete(readyPictures.keys().next().value!);
}

/**
 * Marks pictures the app has already loaded and decoded as ready, so an `Avatar` with the same `src`
 * draws the picture on its first frame instead of its initials. An image that is not loaded, or
 * failed, is skipped. Give it images whose `src` attribute is the exact string you pass `Avatar` as `src`.
 *
 * Use it after warming pictures ahead of time, such as in a list's preload. Without it, an avatar
 * whose picture the browser holds may still draw its initials first.
 *
 * @group Display
 *
 * @example
 * const image = new Image();
 * image.src = "/people/ana.jpg";
 * await image.decode();
 * markPicturesReady([image]);
 * // <Avatar name="Ana Lind" src="/people/ana.jpg" /> now draws the picture on its first frame.
 */
function markPicturesReady(images: Iterable<HTMLImageElement>): void {
  for (const image of images) {
    // The string the app set as the image's src, which it gives Avatar too (an image's src property is the resolved URL).
    const src = image.getAttribute("src");
    // Stryker disable next-line ConditionalExpression: an image with no src attribute (srcset alone) would be kept under null, which no avatar looks up.
    if (src === null) continue;
    if (image.complete && image.naturalWidth > 0) rememberPicture(src, image);
  }
}
