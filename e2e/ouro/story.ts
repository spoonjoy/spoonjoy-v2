import type { Locator, Page } from "@playwright/test";

/**
 * Opens one Storybook story on its own, by story id (for example
 * `"overlays-sheet--playground"`), and waits for it to render, its play function to finish, and for the app's web fonts
 * to load, so text no longer changes width under a spec that measures. A font first used by
 * content that appears later (an opened menu, a heavier weight) loads later: before measuring
 * such content, wait again with `await page.evaluate(() => document.fonts.ready.then(() => {}))`.
 * The Storybook comes from
 * the `OURO_E2E_URL` environment variable, default `http://localhost:6006`: the
 * Storybook that shows the Ouro UI stories installed in this app, compiled with the
 * app's own Tailwind and theme.
 */
export async function openStory(page: Page, id: string): Promise<void> {
  const base = process.env["OURO_E2E_URL"] ?? "http://localhost:6006";
  const url = new URL(`iframe.html?id=${id}&viewMode=story`, base.endsWith("/") ? base : `${base}/`);
  await page.goto(url.href);
  await page.locator("#storybook-root > *").first().waitFor();
  // The story's play function, done: it brings the story to the state it shows (a bar on a post, an open menu), and a
  // spec that acts while it still runs races it.
  const phase = await page.waitForFunction(() => {
    const render = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }).__STORYBOOK_PREVIEW__?.currentRender;
    return render === undefined || ["completed", "finished", "errored", "aborted"].includes(render.phase ?? "") ? (render?.phase ?? "finished") : null;
  });
  const ended = await phase.jsonValue();
  if (ended === "errored" || ended === "aborted") throw new Error(`openStory: ${id} did not finish rendering (${ended})`);
  // A font starts loading when a layout first uses it, so lay the story out before asking.
  await page.evaluate(() => {
    document.body.getBoundingClientRect();
    return document.fonts.ready.then(() => undefined);
  });
}

/**
 * Stops the page's clock where it is, so a state that lasts a set time (a confirmation, a toast,
 * a save in progress) stays until the spec moves the clock on with `page.clock.runFor(ms)` or lets
 * it run again with `page.clock.resume()`: a loaded runner can take longer than that time between
 * two steps. Call `page.clock.install()` before `openStory`, so the page's timers are the clock's.
 */
export async function holdClock(page: Page): Promise<void> {
  // pauseAt takes a time ahead of the page's clock, which runs on while the request travels: aim a
  // little ahead, and further each time the clock got there first.
  for (let ahead = 50; ; ahead *= 2) {
    const at = await page.evaluate((ms) => Date.now() + ms, ahead);
    try {
      await page.clock.pauseAt(at);
      return;
    } catch (error) {
      if (ahead >= 3200 || !String(error).includes("Cannot fast-forward to the past")) throw error;
    }
  }
}

/**
 * Waits for the transitions that move an element (opening, springing back) to finish, then returns its box: its own and
 * its contents', and those of what holds it, since a sheet sliding in carries its search input with it. A frame with none
 * running is waited out first, as a sheet mounts a frame before its slide starts (ourostack/ouro-ui#696). Endless and
 * paused animations, which never finish, move nothing here. It waits on frames, so not after `holdClock`, which holds
 * them; and it gives up after 5 s of animations starting again, naming what they move.
 */
export async function settledBox(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const restless = await element.evaluate(async (el) => {
    const moving = () =>
      el.ownerDocument.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && (target.contains(el) || el.contains(target)) && (animation.playState === "running" || animation.pending) && Number.isFinite(animation.effect?.getComputedTiming().endTime);
      });
    const until = performance.now() + 5000;
    while (performance.now() < until) {
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
      const running = moving();
      if (!running.length) return null;
      await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
    }
    // Past the deadline, what has finished in the meantime counts as settled: only what still moves fails it.
    await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
    const still = moving();
    if (!still.length) return null;
    return still.map((animation) => {
      const target = (animation.effect as KeyframeEffect).target!;
      return `${target.tagName.toLowerCase()}${target.getAttribute("data-ouro") ? `[data-ouro="${target.getAttribute("data-ouro")}"]` : ""}`;
    });
  });
  if (restless) throw new Error(`settledBox: animations kept starting again for 5 s, on ${restless.join(", ")}`);
  const box = await element.boundingBox();
  if (!box) throw new Error("settledBox: the element is not visible");
  return box;
}

/**
 * Films where the top edge of each of `parts` is on every frame while `act` runs (typing in a sheet's search, say), so a
 * jump that lasts a single frame is seen (ourostack/ouro-ui#746). It waits for each part to settle first (`settledBox`),
 * takes where each one is then, and films from the next frame. After `act` it waits for them to settle again and films
 * ten frames more, so a move that comes late, as results arrive, is seen too. It returns how many frames it filmed in
 * all and while `act` ran (a spec asks for enough of those that the film saw each step of it, not only the ten after),
 * and one line for each part that was 0.5 px or more off where it settled on any frame, or gone from the page: a spec
 * expects that list to be empty.
 */
export async function filmTops(parts: Record<string, Locator>, act: () => Promise<void>): Promise<{ frames: number; actFrames: number; moves: string[] }> {
  const named = Object.entries(parts);
  if (!named.length) throw new Error("filmTops: no parts to film");
  for (const [, part] of named) await settledBox(part);
  const handles = await Promise.all(
    named.map(async ([name, part]) => {
      const handle = await part.elementHandle();
      if (!handle) throw new Error(`filmTops: ${name} is not on the page`);
      return handle;
    }),
  );
  const film = await named[0]![1].page().evaluateHandle((elements) => {
    const state = { settled: elements.map((element) => element.getBoundingClientRect().y), frames: [] as number[][], filming: true };
    const frame = () => {
      if (!state.filming) return;
      state.frames.push(elements.map((element) => (element.isConnected ? element.getBoundingClientRect().y : Number.NaN)));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return state;
  }, handles);
  try {
    await act();
    const actFrames = await film.evaluate((state) => state.frames.length);
    // A part gone from the page or drawn anew has nothing to settle: its frames say so below, as moves.
    for (const [, part] of named) {
      if (!(await part.count())) continue;
      await settledBox(part).catch((error: unknown) => {
        if (!String(error).includes("not visible")) throw error;
      });
    }
    const { settled, frames } = await film.evaluate(async (state) => {
      await new Promise<void>((done) => {
        let count = 0;
        const tick = () => (++count >= 10 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      state.filming = false;
      return { settled: state.settled, frames: state.frames };
    });
    const round = (y: number) => Math.round(y * 100) / 100;
    const moves = named.flatMap(([name], index) => {
      // Not "≥ 0.5 off" but "not within 0.5", so a part gone from the page (NaN) counts as moved.
      const off = frames.map((each) => each[index]!).filter((y) => !(Math.abs(y - settled[index]!) < 0.5));
      return off.length ? [`${name}: ${off.length} of ${frames.length} frames off its settled y ${round(settled[index]!)}, at ${[...new Set(off.map(round))].slice(0, 8).join(", ")}`] : [];
    });
    return { frames: frames.length, actFrames, moves };
  } finally {
    // Stopped here too, so a film whose act failed does not run on for as long as the page does.
    await film.evaluate((state) => void (state.filming = false)).catch(() => undefined);
    await film.dispose();
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

/**
 * Drags vertically with the real mouse over `durationMs`, slowly enough that the release
 * velocity does not count as a flick (Playwright's own `steps` moves have no delay).
 */
export async function slowDrag(page: Page, x: number, fromY: number, toY: number, durationMs = 600): Promise<void> {
  const steps = 15;
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x, fromY + ((toY - fromY) * step) / steps);
    await page.waitForTimeout(durationMs / steps);
  }
  await page.mouse.up();
}

/**
 * Presses Tab, or Shift+Tab with `{ shift: true }`, so that focus moves to the next tab stop
 * in every browser. WebKit on a Mac follows the system's "Keyboard navigation" setting: with
 * it off, the default, Tab skips buttons, links and every control that is not a text field.
 * Option+Tab is WebKit's key for "every control, whatever the setting", so this presses that
 * there and plain Tab everywhere else. Use it instead of `page.keyboard.press("Tab")`.
 */
export async function pressTab(page: Page, { shift = false }: { shift?: boolean } = {}): Promise<void> {
  const webkitOnMac = process.platform === "darwin" && page.context().browser()?.browserType().name() === "webkit";
  await page.keyboard.press(`${shift ? "Shift+" : ""}${webkitOnMac ? "Alt+" : ""}Tab`);
}

/**
 * Whether a tap still raises a click on an element that cancels pointerdown, as a phone's browser
 * does (Base UI's list items cancel it to keep focus in their input). The WebKit that
 * Playwright drives before 1.65 drops that click: https://github.com/microsoft/playwright/issues/43569,
 * fixed from WebKit r2386 (Playwright 1.65 has r2388). This taps a probe that cancels
 * pointerdown, then a plain one: the plain tap's click comes after any click of the first, so once
 * it lands the answer is known, without waiting a set time for a click that may never come. Call
 * it after `openStory` and before the spec opens anything: the probes sit over the page's
 * top-left corner until it returns.
 */
export async function tapKeepsCancelledClick(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    for (const cancels of [true, false]) {
      const probe = document.createElement("button");
      probe.type = "button";
      probe.textContent = cancels ? "Cancelled probe" : "Plain probe";
      probe.dataset["ouroTapProbe"] = cancels ? "cancelled" : "plain";
      probe.dataset["clicks"] = "0";
      // Apart, so the two taps do not read as one double tap.
      Object.assign(probe.style, { position: "fixed", top: "0", ...(cancels ? { left: "0" } : { right: "0" }), width: "48px", height: "48px", zIndex: "2147483647" });
      if (cancels) probe.addEventListener("pointerdown", (event) => event.preventDefault());
      probe.addEventListener("click", (event) => {
        event.stopPropagation();
        probe.dataset["clicks"] = String(Number(probe.dataset["clicks"]) + 1);
      });
      document.body.append(probe);
    }
  });
  await page.locator('[data-ouro-tap-probe="cancelled"]').tap();
  await page.locator('[data-ouro-tap-probe="plain"]').tap();
  try {
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-ouro-tap-probe="plain"]')?.dataset["clicks"] === "1", undefined, { timeout: 5000 });
  } catch (error) {
    throw new Error("tapKeepsCancelledClick: the plain probe's tap raised no click, so the probe cannot tell", { cause: error });
  }
  return page.evaluate(() => {
    const probes = [...document.querySelectorAll<HTMLElement>("[data-ouro-tap-probe]")];
    const kept = probes.find((probe) => probe.dataset["ouroTapProbe"] === "cancelled")?.dataset["clicks"] === "1";
    for (const probe of probes) probe.remove();
    return kept;
  });
}
