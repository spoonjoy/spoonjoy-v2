import { afterEach, describe, expect, it } from "vitest";
import { expectFirstFramesInPlace, recordPopupFrames } from "./popup-frames";

afterEach(() => document.body.replaceChildren());

describe("recordPopupFrames", () => {
  it("records the popup visible when the test stops as soon as it shows, before any frame has sampled it", async () => {
    const positioner = document.createElement("div");
    positioner.style.cssText = "position:fixed;top:40px;left:20px;width:100px;height:50px;opacity:0";
    document.body.append(positioner);
    const recording = recordPopupFrames(() => positioner);
    positioner.style.opacity = "1";
    const result = await recording.stop();
    expect(result.frames.some((frame) => frame.opacity > 0)).toBe(true);
    expect(result.settled).toEqual({ top: 40, left: 20 });
    expectFirstFramesInPlace(result);
  });
});
