import { expect, onTestFinished } from "vitest";

export { drawn, expectFirstFramesInPlace, placeFarBelow, recordPopupFrames };
export type { PopupFrame, PopupRecording };

// Records the frames a popup is drawn in, so a test can prove where it sits from its first visible frame.

/** One animation frame of a popup: where its positioner was, how opaque it was, and how it was placed. */
interface PopupFrame {
  top: number;
  left: number;
  opacity: number;
  position: string;
}

/** A recording started by {@link recordPopupFrames}. */
interface PopupRecording {
  /**
   * Stops recording. Returns the frames drawn, in order, and where the positioner is now, read
   * at the moment of the stop: once the popup has settled, that is where it belongs.
   */
  stop(): { frames: PopupFrame[]; settled: { top: number; left: number } };
}

/**
 * Records the positioner's box and opacity, frame by frame, until `stop()`. A frame counts as drawn once the
 * positioner is visible to the reader, and the box read on it gives the popup's place. Start it before the
 * press that opens the popup.
 *
 * @example
 * const recording = recordPopupFrames(() => document.querySelector('[data-ouro="popover-positioner"]'));
 */
function recordPopupFrames(positioner: () => Element | null): PopupRecording {
  const frames: PopupFrame[] = [];
  let handle = 0;
  let running = true;
  const sample = () => {
    const box = positioner();
    if (box) {
      const { top, left } = box.getBoundingClientRect();
      frames.push({ top, left, opacity: Number(getComputedStyle(box).opacity), position: getComputedStyle(box).position });
    }
    if (running) handle = requestAnimationFrame(sample);
  };
  handle = requestAnimationFrame(sample);
  return {
    stop() {
      running = false;
      cancelAnimationFrame(handle);
      const box = positioner()!.getBoundingClientRect();
      return { frames, settled: { top: box.top, left: box.left } };
    },
  };
}

/**
 * The positioner once it is drawn, else null. Pass it to `settled` to wait for a popup that has opened, so no read is
 * of the box before it is placed.
 *
 * @example
 * await settled(drawn(() => popup()?.parentElement ?? null));
 */
function drawn(positioner: () => Element | null): () => Element | null {
  return () => {
    const box = positioner();
    return box && Number(getComputedStyle(box).opacity) > 0 ? box : null;
  };
}

/**
 * Adds a block `px` tall after the page's content, to push a layer that portals to the end of the page below the
 * viewport. The block goes when the test finishes. Call it before the popup opens.
 */
function placeFarBelow(px = 3000): void {
  const spacer = document.createElement("div");
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.height = `${px}px`;
  document.body.append(spacer);
  onTestFinished(() => spacer.remove());
}

/**
 * Asserts that the frames drawn sat where the positioner settled, to within a pixel, and were placed fixed.
 */
function expectFirstFramesInPlace({ frames, settled }: ReturnType<PopupRecording["stop"]>): void {
  const visible = frames.filter((frame) => frame.opacity > 0);
  expect(visible.length, "the popup was never visible").toBeGreaterThan(0);
  const misplaced = visible.filter((frame) => Math.abs(frame.top - settled.top) > 1 || Math.abs(frame.left - settled.left) > 1);
  expect(misplaced, `settled at ${settled.top}, ${settled.left}`).toEqual([]);
  expect(
    visible.filter((frame) => frame.position !== "fixed"),
    "a drawn frame was not placed fixed",
  ).toEqual([]);
}
