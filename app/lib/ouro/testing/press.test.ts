import { afterEach, expect, it } from "vitest";
import { pressAndLetGo, pressDuringScroll } from "~/lib/ouro/testing/press";

let host: HTMLElement | undefined;

/** A long page with a button far taller than any scroll here goes, so a press at its top-left lands on it wherever the page is. */
function tallPage() {
  host = document.createElement("div");
  host.style.height = "30000px";
  const button = document.createElement("button");
  button.setAttribute("data-press-here", "");
  button.style.cssText = "position: fixed; top: 0; left: 0; width: 200px; height: 200px";
  host.append(button);
  document.body.append(host);
  return button;
}

afterEach(() => {
  host?.remove();
  host = undefined;
  document.documentElement.removeAttribute("style");
  window.scrollTo({ top: 0, behavior: "instant" });
});

it("pressAndLetGo runs a timer set to run at once before the release, and one set for later only once the release has landed", async () => {
  tallPage();
  const ran: string[] = [];
  let pressedAt = 0;
  let atRelease: string[] = [];
  let heldFor = 0;
  window.addEventListener(
    "pointerdown",
    () => {
      pressedAt = performance.now();
      setTimeout(() => ran.push("at once"), 0);
      setTimeout(() => ran.push("later"), 50);
    },
    { once: true },
  );
  window.addEventListener(
    "pointerup",
    () => {
      heldFor = performance.now() - pressedAt;
      atRelease = [...ran];
    },
    { once: true },
  );
  await pressAndLetGo("[data-press-here]");
  // More than the later timer's 50ms passed on the real clock between the press and the release.
  expect(heldFor).toBeGreaterThan(50);
  expect(atRelease).toEqual(["at once"]);
  expect(ran).toEqual(["at once", "later"]);
});

it("pressDuringScroll presses as a smooth scroll begins, and while one is under way", async () => {
  tallPage();
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  // Nothing on this page holds it, so the scroll the press found goes on.
  const begins = await pressDuringScroll("[data-press-here]", { from: 2000, to: 4000, scroll: "begins" });
  expect(begins).toEqual({ pressedAt: 2000, heading: 4000, moving: false, behaviorAtPress: "smooth" });
  await expect.poll(() => window.scrollY).toBe(4000);
  await frame();
  const underway = await pressDuringScroll("[data-press-here]", { from: 2000, to: 14000, scroll: "underway" });
  expect(underway.moving).toBe(true);
  expect(window.scrollY).not.toBe(underway.pressedAt);
  await expect.poll(() => window.scrollY).toBe(underway.heading);
});
