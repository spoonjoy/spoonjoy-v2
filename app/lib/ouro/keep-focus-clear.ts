export { keepFocusClear };
export type { FocusClearHandle };

/** Where a bottom toaster's stack is: at the bottom, or at the top edge. */
type Place = "bottom" | "top";

/** A box in the window's coordinates. */
interface Area {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What the stack covers: its column, its height, and the gap under it at the bottom. */
interface Size {
  left: number;
  right: number;
  height: number;
  gap: number;
}

/** What keepFocusClear returns: `refresh` measures the stack again, `release` lets go of the page and the window. */
interface FocusClearHandle {
  refresh(): void;
  release(): void;
}

/** How long the stack rests where it moved before focus may bring it back. */
const SETTLE_MS = 600;
/** The gap between the stack and the window's edge. */
const EDGE_GAP = 16;
/** How many frames after a focus change the browser's own scroll to the control may start: WebKit's starts on the second. */
const FOCUS_SCROLL_FRAMES = 3;
/** How long a move waits for its fade's end before it lands without it. */
const FADE_FALLBACK_MS = 300;
/** The places a stack may move to from its current place, in the order they are tried. */
const CANDIDATES: Record<Place, Place[]> = {
  bottom: ["top"],
  top: ["bottom"],
};

/**
 * Keeps the control keyboard focus is on out from under a bottom toaster's stack.
 * While toasts show, the page's scroll padding at the bottom is the stack's height, so the browser
 * scrolls a control it brings into view above the stack. When focus from the keyboard still lands
 * under the stack, the stack moves to the top edge, below the fixed or sticky header that touches the
 * window's top edge. If the top edge would cover that control too, the stack stays. When the browser scrolls the control
 * into view after the keeper has looked, as WebKit sometimes does, it looks again once that scroll has stopped. The stack moves back once focus has left the area it
 * covers and the stack has rested since its last move, provided the control focus is on is not covered
 * at the bottom. A pointer's focus does not move the stack to the top. A move
 * cross-fades in opacity in both motion settings, because the stack hangs from the other edge once it
 * has moved.
 *
 * @claim "Keeps the control keyboard focus is on out" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > moves the stack to the top when focus lands under it at the page's end, and back once focus has left and it has rested)
 * @claim "While toasts show, the page's scroll padding" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > sets the page's scroll padding to the stack's height while toasts show, and gives back the app's own value after)
 * @claim "so the browser scrolls a control it brings into view above the stack" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > lets the browser scroll a control above a stack in the middle of the page, and leaves the stack at the bottom)
 * @claim "the stack moves to the top edge" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > moves the stack to the top when focus lands under it at the page's end, and back once focus has left and it has rested)
 * @claim "If the top edge would cover that control too, the stack stays" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > leaves the stack where it is when the front toast covers the control and the top edge is out of reach)
 * @claim "When the browser scrolls the control" registry/ouro/lib/ouro/keep-focus-clear.test.ts verify:testExists(registry/ouro/lib/ouro/keep-focus-clear.test.ts::keepFocusClear > a scroll that brings focus into view late > looks again once the browser's scroll in %s has stopped, and moves the stack off the control it brought under it)
 * @claim "A pointer's focus does not move the stack to the top" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > does not move the stack for a pointer click on a control it covers)
 * @claim "A move cross-fades in opacity" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > cross-fades the move in opacity only under reduced motion)
 * @claim "The stack moves back once focus has left" registry/ouro/components/ouro/toast/toaster.test.tsx verify:testExists(registry/ouro/components/ouro/toast/toaster.test.tsx::keyboard focus under the stack > moves the stack back when focus leaves the page altogether, once it has rested)
 */
function keepFocusClear(viewport: HTMLElement): FocusClearHandle {
  const root = document.documentElement;
  let place: Place = "bottom";
  // Stryker disable next-line ObjectLiteral: every read of size follows a measure() that overwrites it, and a move only follows one.
  let size: Size = { left: 0, right: 0, height: 0, gap: 0 };
  // False from a move until it has rested SETTLE_MS; only a move back waits for it.
  // Stryker disable next-line BooleanLiteral: ready is read only once the stack has moved, and a move's land sets it false before anything else runs.
  let ready = false;
  let fading = false;
  let stopFade = () => {};
  let settle: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  // A press focuses a control, and :focus-visible shows a text field's focus as keyboard focus, so a
  // press is told apart by its pointerdown, and the next key press says the focus is the keyboard's again.
  let pointing = false;
  let padded = false;
  // Stryker disable next-line StringLiteral: restorePadding reads saved only once setPadding has stored the app's own value, which it does before padded is set.
  let saved = "";

  /** Whether the stack may move: it is at the bottom edge, or it has moved from there to the top. */
  const movable = () => place === "top" || viewport.getAttribute("data-edge") === "bottom";

  /**
   * Measures the stack's toasts: its column, its height, and the gap under
   * it while it is at the bottom. It reads the toasts' boxes, not the viewport's, which is an anchor
   * at the window's edge. Returns false when a toast is not laid out.
   */
  function measure(): boolean {
    const boxes = [...viewport.querySelectorAll<HTMLElement>('[data-ouro="toast"]')].filter((toast) => toast.offsetHeight > 0).map((toast) => toast.getBoundingClientRect());
    // A stack with no toast laid out (none shows yet, or all are hidden) measures nothing.
    if (boxes.length === 0) return false;
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    size = { left, right, height: bottom - top, gap: place === "top" ? size.gap : innerHeight - bottom };
    return true;
  }

  /** The top edge the stack moves to: below the fixed or sticky elements that touch the window's top edge over the stack's column, with the edge gap. */
  function clearance(): number {
    const { left, right } = size;
    const checked = new Set<Element>();
    let bottom = 0;
    for (const x of [left + 1, (left + right) / 2, right - 1]) {
      for (const y of [0, 1]) {
        for (const hit of document.elementsFromPoint(x, y)) {
          for (let node: Element | null = hit; node && !checked.has(node); node = node.parentElement) {
            checked.add(node);
            const { position } = getComputedStyle(node);
            if (viewport.contains(node) || (position !== "fixed" && position !== "sticky")) continue;
            // An element under the window's top edge, or one whose child reaches it, keeps the stack below its bottom.
            if (node.checkVisibility({ visibilityProperty: true })) bottom = Math.max(bottom, node.getBoundingClientRect().bottom);
          }
        }
      }
    }
    return bottom + EDGE_GAP;
  }

  /** The window area the stack covers in `next` place. */
  function zone(next: Place): Area {
    const { left, right, height, gap } = size;
    if (next === "top") {
      const top = clearance();
      return { left, right, top, bottom: top + height };
    }
    const bottom = innerHeight - gap;
    return { left, right, top: bottom - height, bottom };
  }

  /** Whether the box shares area with the window area. */
  const covers = (box: Area, area: Area) => box.left < area.right && box.right > area.left && box.top < area.bottom && box.bottom > area.top;

  /** Sets the page's scroll padding at the bottom to `value`, keeping the app's own value to give back. */
  function setPadding(value: string): void {
    if (!padded) {
      saved = root.style.scrollPaddingBottom;
      padded = true;
    }
    root.style.scrollPaddingBottom = value;
  }

  function restorePadding(): void {
    if (padded) {
      root.style.scrollPaddingBottom = saved;
      padded = false;
    }
  }

  /** Measures again and sets the scroll padding: the stack's height while it is at the bottom, the app's own value otherwise. */
  function refresh(): void {
    if (measure() && place !== "top" && movable()) setPadding(`${size.height + size.gap}px`);
    else restorePadding();
  }

  /** Puts the stack in `next` place and its state attributes; a stack at the top hangs from the top edge, as an app's top toaster does. */
  function apply(next: Place): void {
    place = next;
    if (next === "top") {
      viewport.setAttribute("data-ouro-toaster-moved", "top");
      viewport.style.setProperty("--ouro-toaster-moved-top", `${clearance()}px`);
    } else {
      viewport.removeAttribute("data-ouro-toaster-moved");
      viewport.style.removeProperty("--ouro-toaster-moved-top");
    }
    viewport.setAttribute("data-edge", next === "top" ? "top" : "bottom");
  }

  /** Cross-fades the stack out, moves it to `next` where it is invisible, and fades it back in. */
  function show(next: Place): void {
    fading = true;
    viewport.setAttribute("data-ouro-toaster-fading", "");
    const timer = setTimeout(() => land(next), FADE_FALLBACK_MS);
    // A fade that ends lands the move; so does one that never started (transitions off, or a style the browser had not
    // drawn yet), on the next frame, rather than after the fallback. A cancel is not one: a move that starts while the
    // last landing fades in cancels that fade-in, which is not this move's fade.
    const onEnd = (event: TransitionEvent) => {
      if (event.target === viewport && event.propertyName === "opacity") land(next);
    };
    const started = viewport.getAnimations().some((animation) => (animation as CSSTransition).transitionProperty === "opacity");
    const frame = started ? 0 : requestAnimationFrame(() => land(next));
    viewport.addEventListener("transitionend", onEnd);
    stopFade = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      viewport.removeEventListener("transitionend", onEnd);
    };
  }

  /** Ends a move: the stack is where it was sent, it rests SETTLE_MS, and focus is looked at again, as it may have moved while the stack faded. */
  function land(next: Place): void {
    stopFade();
    stopFade = () => {};
    apply(next);
    viewport.removeAttribute("data-ouro-toaster-fading");
    fading = false;
    ready = false;
    clearTimeout(settle);
    settle = setTimeout(() => {
      ready = true;
      decide();
    }, SETTLE_MS);
    refresh();
    decide();
  }

  /** Moves the stack to the first place that does not cover `box`, the control focus is on, and that fits. */
  function choose(box: DOMRect): void {
    // Leaving the bottom, the gap to come back to is the viewport's, where the toasts rest: a toast still sliding in hangs
    // below the window, and a gap read from it leaves no room to move back to (#1818).
    if (place !== "top") size.gap = innerHeight - viewport.getBoundingClientRect().bottom;
    const next = CANDIDATES[place].find((candidate) => {
      const area = zone(candidate);
      return area.bottom <= innerHeight && !covers(box, area);
    });
    if (next) show(next);
  }

  /** Moves the stack back to the bottom once it has rested, unless the control focus is on is covered in its place or at the bottom. */
  function relax(box?: DOMRect): void {
    if (!ready || place === "bottom") return;
    if (box && (covers(box, zone(place)) || covers(box, zone("bottom")))) return;
    show("bottom");
  }

  /** Looks at the control focus is on: a covered one from the keyboard moves the stack, and a stack that may rest comes back. */
  function decide(): void {
    const active = document.activeElement;
    if (fading || !active || viewport.contains(active) || !movable() || !measure()) return;
    const box = active === document.body ? undefined : active.getBoundingClientRect();
    if (box && !pointing && active.matches(":focus-visible") && covers(box, zone(place))) choose(box);
    relax(box);
  }

  // A browser that scrolls a focused control into view mostly does it as the focus moves, so the check waits
  // for the next frame, after the control is where the browser left it. Focus that falls to nothing
  // waits too: a press blurs a control before it focuses the next one, which can land in the same task.
  const later = () => {
    // Stryker disable next-line CallExpression: two checks in one frame decide the same, and the second finds the first's move already made or nothing to move.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(decide);
  };
  // WebKit sometimes scrolls the control into view a frame after that check (#1818), so a scroll that starts within
  // FOCUS_SCROLL_FRAMES of a focus change, before a key press or the wheel, is the browser's: once it has stopped for a
  // frame, focus is looked at again. Any other scroll is the person's (a screen reader's, the scrollbar's), and leaves the
  // stack where it is, as before.
  let focusScroll = false;
  // Stryker disable next-line BooleanLiteral: a wait for the scroll to stop starts only from a scroll, which sets scrolled first.
  let scrolled = false;
  let scrollFrame = 0;
  let focusFrame = 0;
  /** Ends the browser's turn to scroll `left` frames from now, unless its scroll has started by then. */
  const awaitScroll = (left: number) => {
    focusFrame = requestAnimationFrame(() => {
      if (scrollFrame !== 0) return;
      if (left > 1) awaitScroll(left - 1);
      else focusScroll = false;
    });
  };
  const afterScroll = () => {
    scrollFrame = 0;
    if (scrolled) {
      scrolled = false;
      scrollFrame = requestAnimationFrame(afterScroll);
    } else {
      focusScroll = false;
      decide();
    }
  };
  const onScroll = () => {
    if (!focusScroll) return;
    scrolled = true;
    if (!scrollFrame) scrollFrame = requestAnimationFrame(afterScroll);
  };
  // A focus change takes the turn over: an earlier control's scroll still being waited out is not this one's.
  const onFocusIn = () => {
    focusScroll = true;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    cancelAnimationFrame(focusFrame);
    awaitScroll(FOCUS_SCROLL_FRAMES);
    later();
  };
  // Focus that falls to nothing (a blur, a click on the page) is a move away from every control.
  const onFocusOut = (event: FocusEvent) => {
    if (!event.relatedTarget) later();
  };
  const onPointerDown = () => {
    pointing = true;
  };
  const onKeyDown = () => {
    pointing = false;
    focusScroll = false;
  };
  const onWheel = () => {
    focusScroll = false;
  };
  document.addEventListener("focusin", onFocusIn);
  // Scroll events do not bubble, so a scroll container's reaches the document only while capturing.
  document.addEventListener("scroll", onScroll, true);
  // Captured, so a part of the page that keeps its wheel to itself (a map, a carousel) still says the scroll is the person's.
  // A wheel listener on the document is passive unless it says otherwise.
  document.addEventListener("wheel", onWheel, true);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  addEventListener("resize", refresh);
  viewport.addEventListener("transitionend", refresh);
  refresh();
  decide();

  return {
    refresh,
    release() {
      stopFade();
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      // Stryker disable next-line CallExpression: a released keeper's countdown only clears a flag that nothing reads once the scroll listener is gone.
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("scroll", onScroll, true);
      // Stryker disable next-line CallExpression,StringLiteral,BooleanLiteral: a released keeper's wheel listener only clears a flag that nothing reads once the scroll listener is gone.
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      removeEventListener("resize", refresh);
      viewport.removeEventListener("transitionend", refresh);
      restorePadding();
      if (place !== "bottom") apply("bottom");
      viewport.removeAttribute("data-ouro-toaster-fading");
      viewport.style.removeProperty("--ouro-toaster-moved-top");
    },
  };
}
