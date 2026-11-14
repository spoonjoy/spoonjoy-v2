"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ouro/button/button";
import { actionsClass, frameClass, isPartOf, itemFor, labelClass, layerClass, linkClass, listClass, outlineClass, pillClass, statusClass, tagClass } from "~/components/ouro/inspector/inspector-styles";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useReducedMotion } from "~/lib/ouro/use-reduced-motion";

/** Props for {@link Inspector}. */
export interface InspectorProps {
  /**
   * Whether X-ray is on: outlines over every Ouro component, and the bar with the list. Pair it with `onOpenChange`.
   *
   * @claim "Whether X-ray is on: outlines over" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
   */
  open: boolean;
  /** Called with `false` when the person closes X-ray (its Close button, or Escape). */
  onOpenChange: (open: boolean) => void;
  /**
   * The address of an item's docs page, from its registry name, where each tag and the list link.
   * Without it they link to Ouro's public docs, `https://ui.ouroboros.bot/docs/<item>/`.
   * @claim "The address of an item's docs" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
   */
  docsHref?: ((item: string) => string) | undefined;
  /** The address of the source that renders a component, if you publish it: the list shows a Source link where this returns one. */
  sourceHref?: ((item: string, element: Element) => string | undefined) | undefined;
  /** What X-ray is called, on its bar and as its list's title. Translate it here. @default "X-ray" */
  label?: string | undefined;
  /**
   * A registry item to point out, such as `"button"`: X-ray scrolls the first one in the page's `main` (or else the first anywhere) to the middle of the screen (at once with reduced motion) and draws its outline stronger, with its tag placed first. Its bar says which item it shows, or that the page has none, and points one out when it appears.
   *
   * @claim "A registry item to point out" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > points out the spotlit item: scrolls the first one into view, draws its outline stronger and names it on the bar)
   * @claim "A registry item to point out" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > scrolls to the spotlit item at once with reduced motion)
   * @claim "A registry item to point out" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > prefers the first spotlit item in the page's main content to one in its header)
   * @claim "A registry item to point out" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector geometry > places the spotlit component's tag first, so it takes the best place)
   * @claim "Its bar says which item it" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > says when the page has no spotlit item, and points one out when it appears)
   */
  spotlight?: string | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<Inspector open={xray} onOpenChange={setXray}>`. */
  isOpen?: { 'Use <Inspector open={xray} onOpenChange={setXray}>': never };
  /** Not a prop. `onOpenChange` gets `false` when X-ray closes: `onOpenChange={setXray}`. */
  onClose?: { 'Use onOpenChange={setXray}': never };
}

/** One component X-ray found: its root element, its registry item, and a key that stays with the element. */
interface Found {
  key: number;
  item: string;
  element: Element;
}

const keys = new WeakMap<Element, number>();
let lastKey = 0;
const keyOf = (element: Element) => {
  let key = keys.get(element);
  if (key === undefined) {
    key = ++lastKey;
    keys.set(element, key);
  }
  return key;
};

/** Whatever a modal dialog shuts off from the page while it is open: Base UI hides it from assistive technology, or makes it inert. */
const shutOff = '[aria-hidden="true"], [inert]';

/** The invisible backdrop Base UI lays over the page under a modal overlay, to catch a press outside it. Ouro's own backdrops carry a `data-ouro` name. */
const catcher = '[role="presentation"][data-base-ui-inert]:not([data-ouro])';

/**
 * Whether a modal dialog is open in front of the page, so what it shuts off is out of reach: X-ray's
 * own layer is shut off with the page, by a dialog whose portal holds Base UI's backdrop (a modal
 * one; X-ray's own list aside). A popover leaves the page alone, and so does an open combobox list.
 */
const modalOpen = (own: Element) =>
  !!own.closest(shutOff) &&
  [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (dialog) => !dialog.closest(shutOff) && !dialog.querySelector("[data-ouro-inspector-list]") && !!dialog.closest('[data-ouro$="-portal"]')?.querySelector(catcher),
  );

/**
 * Whether a person can see an element: it and everything around it are rendered, not `visibility: hidden`, and not fully transparent.
 * @claim "Whether a person can see an element" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline a component no one can see, and outlines it while hover or focus shows it)
 */
const seen = (element: Element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true });

/**
 * The box a component shows on the screen: its own, or, where its own box has no area (a fixed
 * region its content is placed in, as a Toaster's is), the box its visible content fills, leaving
 * out a visually hidden child (`sr-only`, one pixel square). `null` while nothing in it shows, as in
 * a Toaster with no toast.
 * @claim "where its own box has no area" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector geometry > outlines a component whose own box has no area by the box its visible content fills, and not at all while nothing in it shows)
 * @claim "`null` while nothing in it shows" test/inspector-toaster.test.tsx verify:testExists(test/inspector-toaster.test.tsx::Inspector over a Toaster > outlines a Toaster only while it shows a toast, around its toasts)
 */
function shownBox(element: Element): DOMRect | null {
  const box = element.getBoundingClientRect();
  if (box.width > 0 && box.height > 0) return box;
  // Stryker disable next-line ArrayDeclaration: anything put in place of a child with nothing showing has no width or height, so the filter after it drops it as it drops nothing.
  const inside = [...element.children].filter(seen).flatMap((child) => shownBox(child) ?? []).filter((inner) => inner.width > 1 || inner.height > 1);
  // Stryker disable next-line ConditionalExpression: with nothing inside, the box below spans from +Infinity to -Infinity, and every caller drops a box that small.
  if (inside.length === 0) return null;
  const left = Math.min(...inside.map((inner) => inner.left));
  const top = Math.min(...inside.map((inner) => inner.top));
  return new DOMRect(left, top, Math.max(...inside.map((inner) => inner.right)) - left, Math.max(...inside.map((inner) => inner.bottom)) - top);
}

/**
 * Every visible Ouro component root in the page, in document order, but X-ray's own, one behind an
 * open dialog, one no one can see (fully transparent, as an action shown only on hover is until
 * then, or with nothing in it showing), and a part's root inside its own component (a Radio in its
 * RadioGroup counts once).
 * @claim "Every visible Ouro component root in" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
 * @claim "Every visible Ouro component root in" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline itself, an overlay's wrappers, a hidden component or a part apart from its component)
 * @claim "one no one can see" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline a component no one can see, and outlines it while hover or focus shows it)
 * @claim "or with nothing in it showing" test/inspector-toaster.test.tsx verify:testExists(test/inspector-toaster.test.tsx::Inspector over a Toaster > outlines a Toaster only while it shows a toast, around its toasts)
 */
function findComponents(own: Element, modal: boolean): Found[] {
  const found: Found[] = [];
  for (const element of document.querySelectorAll("[data-ouro]")) {
    if (own.contains(element) || element.closest('[data-ouro="sheet"]')?.querySelector("[data-ouro-inspector-list]")) continue;
    const name = element.getAttribute("data-ouro")!;
    const item = itemFor(name);
    if (item === null || isPartOf(name, element.parentElement?.closest("[data-ouro]")) || (modal && element.closest(shutOff))) continue;
    if (!seen(element)) continue;
    const box = shownBox(element);
    // A visually hidden root (`sr-only`, one pixel square) has nothing to outline; a one-pixel line (a Separator) has.
    if (!box || (box.width <= 1 && box.height <= 1)) continue;
    found.push({ key: keyOf(element), item, element });
  }
  return found;
}

/**
 * The component X-ray points out: the first of the item in the page's main content, so a page's
 * own Switch comes before the one in its header, or else the first anywhere.
 */
function spotlitOf(components: Found[], spotlight: string | undefined): Found | undefined {
  const all = components.filter((component) => component.item === spotlight);
  return all.find((component) => component.element.closest("main")) ?? all[0];
}

/** A box's edges on the screen. */
interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * What X-ray reads once an update from a component or an ancestor: its position and direction, and the edges it clips its overflow to on each axis.
 *
 * @claim "What X-ray reads once an update" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > clips by each box a component's overflow belongs to, from the start edge on either axis)
 */
interface Ancestor {
  position: string;
  rtl: boolean;
  x: [number, number] | null;
  y: [number, number] | null;
}

const readAncestor = (element: Element, cache: Map<Element, Ancestor>): Ancestor => {
  let ancestor = cache.get(element);
  if (!ancestor) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    // Overflow clips to the padding box, inside the borders and any scrollbar.
    const left = box.left + element.clientLeft;
    const top = box.top + element.clientTop;
    ancestor = {
      position: style.position,
      rtl: style.direction === "rtl",
      x: style.overflowX === "visible" ? null : [left, left + element.clientWidth],
      y: style.overflowY === "visible" ? null : [top, top + element.clientHeight],
    };
    cache.set(element, ancestor);
  }
  return ancestor;
};

/**
 * The part of a component's box that its ancestors let show: the box cut to every ancestor up its
 * containing blocks that clips its overflow (a scrolling list, a card that hides its overflow).
 * A positioned box escapes the overflow of the ancestors between it and its containing block, and a
 * fixed one all of them.
 * @claim "The part of a component's box" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out)
 * @claim "The part of a component's box" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > clips by each box a component's overflow belongs to, from the start edge on either axis)
 * @claim "The part of a component's box" https://www.w3.org/TR/CSS2/visufx.html#overflow verify:urlOk(https://www.w3.org/TR/CSS2/visufx.html#overflow)
 * @claim "A positioned box escapes the overflow" https://www.w3.org/TR/CSS2/visufx.html#overflow verify:urlOk(https://www.w3.org/TR/CSS2/visufx.html#overflow)
 */
function visiblePart(element: Element, box: DOMRect, cache: Map<Element, Ancestor>): Edges {
  const part = { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
  let position = readAncestor(element, cache).position;
  for (let parent = element.parentElement; parent && parent !== document.body && position !== "fixed"; parent = parent.parentElement) {
    const ancestor = readAncestor(parent, cache);
    if (position === "absolute" && ancestor.position === "static") continue;
    position = ancestor.position;
    if (ancestor.x) {
      part.left = Math.max(part.left, ancestor.x[0]);
      part.right = Math.min(part.right, ancestor.x[1]);
    }
    if (ancestor.y) {
      part.top = Math.max(part.top, ancestor.y[0]);
      part.bottom = Math.min(part.bottom, ancestor.y[1]);
    }
  }
  return part;
}

/**
 * The topmost element at a point on the screen, X-ray's own aside, and the invisible backdrop Base
 * UI lays over the page under a modal menu or list, which covers nothing a person sees. Ouro's own
 * backdrops, which dim the page, count.
 */
const topAt = (x: number, y: number, own: Element) => document.elementsFromPoint(x, y).find((element) => !own.contains(element) && !element.matches(catcher));

/**
 * The component an element is part of: for a control, the component it is a control of (a linked
 * card's link, stretched over the card from inside its heading, is the card's), and otherwise the
 * nearest one around it.
 */
function ownerOf(element: Element): Element | null {
  const control = element.closest("[data-ouro-control]")?.getAttribute("data-ouro-control");
  let owner = element.closest("[data-ouro]");
  while (owner && control !== undefined && itemFor(owner.getAttribute("data-ouro")!) !== control) owner = owner.parentElement!.closest("[data-ouro]");
  return owner;
}

/**
 * Whether something lies over a component where its tag goes, so the tag would sit on that
 * instead: at the component's corner by the tag, an element that is neither the component's own,
 * nor the page around it showing through, nor part of a component around it (a linked card's
 * link); or, over the tag itself (its centre, `tag`), an overlay's popup (a menu, a select list)
 * the component is not in.
 */
function covered(root: Element, part: Edges, rtl: boolean, tag: [number, number], own: Element): boolean {
  const start = (offset: number) => (rtl ? part.right - offset : part.left + offset);
  const corner = topAt(start(Math.min(4, (part.right - part.left) / 2)), part.top + Math.min(4, (part.bottom - part.top) / 2), own);
  if (corner && !root.contains(corner) && !corner.contains(root) && !ownerOf(corner)?.contains(root)) return true;
  // The tag's centre is on the screen, where the root element at least lies.
  const overlay = topAt(tag[0], tag[1], own)!.closest('[data-ouro$="-portal"]');
  return !!overlay && !overlay.contains(root);
}

// Every line of text a person can see on the screen, but X-ray's own.
function textLines(own: Element): Edges[] {
  // Stryker disable next-line ArrayDeclaration: a string in the list has no edges, so it crosses no edge and lies over no place.
  const lines: Edges[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement!;
    if (!node.textContent!.trim() || own.contains(parent) || !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight) lines.push({ top: box.top, right: box.right, bottom: box.bottom, left: box.left });
    }
  }
  return lines;
}

// Whether two boxes share any area.
const overlap = (a: Edges, b: Edges) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The frame's four edges as an SVG path in the outline's own pixels, with a gap wherever a line of
// text crosses an edge, so a frame never draws over text and lowers its contrast.
function framePath(box: DOMRect, lines: Edges[]): string {
  const edges = [
    { across: true, at: box.top, from: box.left, to: box.right },
    { across: true, at: box.bottom - 1, from: box.left, to: box.right },
    { across: false, at: box.left, from: box.top, to: box.bottom },
    { across: false, at: box.right - 1, from: box.top, to: box.bottom },
  ];
  let path = "";
  for (const { across, at, from, to } of edges) {
    // The stretches of the edge a line of text crosses, a pixel wider on each side.
    const gaps = lines
      .filter((line) => (across ? line.top < at + 1 && line.bottom > at : line.left < at + 1 && line.right > at))
      .map((line) => (across ? [line.left - 1, line.right + 1] : [line.top - 1, line.bottom + 1]) as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let start = from;
    for (const [gapStart, gapEnd] of [...gaps, [to, to] as [number, number]]) {
      const end = Math.min(gapStart, to);
      if (end > start) path += across ? `M${start - box.left} ${at - box.top + 0.5}H${end - box.left}` : `M${at - box.left + 0.5} ${start - box.top}V${end - box.top}`;
      start = Math.max(start, gapEnd);
    }
  }
  return path;
}

// Where a tag goes: the first place by its component's visible part, in this order, that is on the
// screen and clear of text, of the tags placed before it and of X-ray's bar: above the start
// corner, inside it, above the end corner, inside it, inside the bottom start corner, below it.
// Above and below are only where a scrolling box does not cut that edge. `null` when nowhere is
// clear, and the tag hides.
function tagPlace(box: DOMRect, part: Edges, rtl: boolean, size: [number, number], clear: Edges[]): { x: number; y: number; inside: boolean } | null {
  const [width, height] = size;
  const start = rtl ? part.right - width : part.left;
  const end = rtl ? part.left : part.right - width;
  const above = part.top <= box.top;
  const below = part.bottom >= box.bottom;
  const places = [
    above && { x: start, y: part.top - height, inside: false },
    { x: start, y: part.top, inside: true },
    above && { x: end, y: part.top - height, inside: false },
    { x: end, y: part.top, inside: true },
    { x: start, y: part.bottom - height, inside: true },
    below && { x: start, y: part.bottom, inside: false },
  ];
  for (const place of places) {
    // Stryker disable next-line ConditionalExpression: a place left out is false, whose edges are undefined, and no check below passes them.
    if (!place) continue;
    const at = { top: place.y, right: place.x + width, bottom: place.y + height, left: place.x };
    if (at.left >= 0 && at.right <= innerWidth && at.top >= 0 && at.bottom <= innerHeight && !clear.some((other) => overlap(at, other))) return place;
  }
  return null;
}

const sameComponents = (a: Found[], b: Found[]) => a.length === b.length && a.every((entry, index) => entry.key === b[index]!.key && entry.item === b[index]!.item);

/** Whether anything in the page outside X-ray is still moving, so its outline follows it frame by frame. */
const moving = (own: Element) =>
  document.getAnimations().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === "running" && Number.isFinite(animation.effect!.getComputedTiming().iterations) && !(target && own.contains(target));
  });

/** The events after which something may show or hide though nothing in the page changed: a pointer moving onto an element, and focus coming or going. */
const reveals = ["pointerover", "focusin", "focusout"];

const noSubscription = () => () => {};

/** Ouro's public docs page for an item. */
const ouroDocs = (item: string) => `https://ui.ouroboros.bot/docs/${item}/`;

/**
 * X-ray for a page built with Ouro HX: outlines every Ouro component on the page with its name,
 * linked to its docs, and lists them all for keyboard and screen reader users. Each tag names the
 * component's registry item; the bar at the bottom opens the list (a `Sheet`), every component in
 * document order with its "Docs" and, from `sourceHref`, "Source" links. Outlines follow
 * their components through scrolling, resizing, overlays and changes to the page, measured once a
 * frame at most; they never take a pointer, so the page stays usable underneath, and only the tags
 * do. X-ray shows only what a person can see and reach: a component no one can see (fully
 * transparent, as an action shown only on hover or focus is until then, or a Toaster with no toast)
 * has no outline until it shows, an outline is cut to the part a scrolling
 * box lets show, a tag hides while a menu or a list lies over it, the page behind an open modal
 * dialog is left alone, and a part (a Radio) counts with
 * its component (its RadioGroup). X-ray never draws over the page's text: an outline's edge breaks
 * where a line of text crosses it, and a tag sits where it covers no text and no other tag, or
 * hides. Its bar is a landmark named by `label`. Escape or Close turns it off, once Escape has
 * closed any other overlay. It renders nothing on the server.
 *
 * The bar floats above the bottom of the screen and above a `TabBar` that shows. To keep it clear of
 * other chrome the app pins to the bottom, set `--ouro-inspector-bottom` to the distance to keep,
 * such as `:root { --ouro-inspector-bottom: 6rem; }`.
 *
 * Use your browser's developer tools instead when you need more than which component is where;
 * the `data-ouro`, `data-ouro-control` and `data-ouro-part` attributes X-ray reads are there too.
 *
 * @group App setup
 * @see https://ui.ouroboros.bot/docs/inspector
 *
 * @example
 * const [xray, setXray] = useState(false);
 * <Switch label="X-ray" checked={xray} onCheckedChange={setXray} />
 * <Inspector open={xray} onOpenChange={setXray} />
 * <Inspector open={xray} onOpenChange={setXray} sourceHref={(item) => sourceOf(item)} />
 * @claim "X-ray for a page built with" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
 * @claim "Each tag names the component's registry" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > lists every component in document order in its sheet, with docs and source links)
 * @claim "Outlines follow their components through scrolling" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > follows its components as the page scrolls and resizes)
 * @claim "Outlines follow their components through scrolling" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > lets a click through an outline reach the control underneath, and only the tags take a pointer)
 * @claim "a component no one can see" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline a component no one can see, and outlines it while hover or focus shows it)
 * @claim "a component no one can see" test/inspector-toaster.test.tsx verify:testExists(test/inspector-toaster.test.tsx::Inspector over a Toaster > outlines a Toaster only while it shows a toast, around its toasts)
 * @claim "X-ray never draws over the page's" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > leaves every line of the page's text as readable as it was, in light and dark: outlines step around text, and tags sit clear of text and of each other)
 * @claim "The bar floats above the bottom" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > sits above a TabBar that shows, and above the distance the app sets)
 * @claim "Its bar is a landmark named" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > puts its bar in a landmark named by its label)
 */
export function Inspector(props: InspectorProps): JSX.Element | null {
  const {
    open,
    onOpenChange,
    docsHref = ouroDocs,
    sourceHref,
    label = "X-ray",
    spotlight,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
  } = props;
  useDevWarnings(
    "Inspector",
    process.env.NODE_ENV !== "production"
      ? () => [
          !label && ["label is empty; it names the bar and its list", '<Inspector label="X-ray">'],
          isOpen !== undefined && ["isOpen is not a prop", "<Inspector open={xray} onOpenChange={setXray}>"],
          onClose !== undefined && ["onClose is not a prop; onOpenChange gets false when X-ray closes", "<Inspector open={xray} onOpenChange={setXray}>"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // The server has no page to measure, so X-ray appears once the page has hydrated.
  const client = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!open || !client) return null;
  return createPortal(<InspectorLayer onOpenChange={onOpenChange} docsHref={docsHref} sourceHref={sourceHref} label={label} spotlight={spotlight} />, document.body);
}

/** X-ray while it is on: the outlines, the bar and its list. */
function InspectorLayer({
  onOpenChange,
  docsHref,
  sourceHref,
  label,
  spotlight,
}: Pick<InspectorProps, "onOpenChange" | "sourceHref" | "spotlight"> & { docsHref: (item: string) => string; label: string }): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const [outlines] = useState(() => new Map<number, HTMLElement>());
  const [found, setFound] = useState<Found[]>([]);
  // Whether X-ray has read the page once, so its bar never says a spotlit item is missing before it has looked.
  const [measured, setMeasured] = useState(false);
  // The spotlit item, read by `place`, which the measuring effect keeps from the first render.
  const spotlightRef = useRef(spotlight);
  useLayoutEffect(() => {
    spotlightRef.current = spotlight;
  });
  const [entering, setEntering] = useState(true);
  // Focus goes back where it was when X-ray closes from its own bar or Escape.
  const [returnFocus] = useState(() => document.activeElement);

  /**
   * Puts each outline over its component, cut to the part of it that shows: every box read first,
   * then every outline written, so the page lays out once. An outline with nothing showing hides,
   * and so does its tag.
   * @claim "Puts each outline over its component" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out)
   * @claim "Puts each outline over its component" registry/ouro/components/ouro/inspector/inspector.tsx verify:fileLine(registry/ouro/components/ouro/inspector/inspector.tsx, /const\sboxes\s=\scomponents\.map\(\(component\)\s=>\sshownBox\(component\.element\)\s\?\?\snew\sDOMRect\(\)\)/)
   */
  const place = (all: Found[]) => {
    const own = layer.current!;
    // An outline React has yet to render is placed once it has, from the layout effect below.
    const components = all.filter((component) => outlines.has(component.key));
    const ancestors = new Map<Element, Ancestor>();
    // A component that stopped showing since it was found (a toast gone) has no box, and hides until the next measure drops it.
    const boxes = components.map((component) => shownBox(component.element) ?? new DOMRect());
    const parts = components.map((component, index) => visiblePart(component.element, boxes[index]!, ancestors));
    const shown = parts.map((part) => part.right > part.left && part.bottom > part.top);
    const lines = textLines(own);
    const tags = components.map((component) => outlines.get(component.key)!.lastElementChild as HTMLElement);
    const sizes = tags.map((tag): [number, number] => [tag.offsetWidth, tag.offsetHeight]);
    // Each tag keeps clear of the page's text, of the tags placed before it, and of the bar.
    const bar = own.querySelector("section")!.getBoundingClientRect();
    const clear: Edges[] = [...lines, { top: bar.top, right: bar.right, bottom: bar.bottom, left: bar.left }];
    // The spotlit component's tag is placed first, so it takes the best place.
    const chosen = spotlitOf(components, spotlightRef.current);
    const first = components.findIndex((component) => component === chosen);
    const order = components.map((_, index) => index);
    // Stryker disable next-line EqualityOperator: moving the first component to the front leaves the order as it was.
    if (first > 0) order.unshift(...order.splice(first, 1));
    // Stryker disable next-line ArrayDeclaration: every index is written below, over anything the list starts with.
    const places: ({ x: number; y: number; inside: boolean } | null)[] = [];
    for (const index of order) {
      const component = components[index]!;
      const spot = shown[index] ? tagPlace(boxes[index]!, parts[index]!, ancestors.get(component.element)!.rtl, sizes[index]!, clear) : null;
      if (spot) clear.push({ top: spot.y, right: spot.x + sizes[index]![0], bottom: spot.y + sizes[index]![1], left: spot.x });
      places[index] = spot;
    }
    const covers = components.map((component, index) => {
      const spot = places[index];
      return !!spot && covered(component.element, parts[index]!, ancestors.get(component.element)!.rtl, [spot.x + sizes[index]![0] / 2, spot.y + sizes[index]![1] / 2], own);
    });
    const paths = components.map((_, index) => framePath(boxes[index]!, lines));
    components.forEach((component, index) => {
      const outline = outlines.get(component.key)!;
      const box = boxes[index]!;
      const part = parts[index]!;
      outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
      outline.style.width = `${box.width}px`;
      outline.style.height = `${box.height}px`;
      outline.toggleAttribute("data-clipped", !shown[index]);
      const cut = [part.top - box.top, box.right - part.right, box.bottom - part.bottom, part.left - box.left];
      const frame = outline.firstElementChild as HTMLElement;
      frame.style.clipPath = cut.some(Boolean) ? `inset(${cut.join("px ")}px)` : "";
      frame.querySelector("path")!.setAttribute("d", paths[index]!);
      const tag = tags[index]!;
      const spot = places[index];
      tag.toggleAttribute("data-crowded", !spot);
      tag.toggleAttribute("data-inside", !!spot?.inside);
      tag.toggleAttribute("data-covered", covers[index]!);
      if (spot) tag.style.transform = `translate(${spot.x - box.left}px, ${spot.y - box.top}px)`;
    });
  };

  useEffect(() => {
    const own = layer.current!;
    let frame = 0;
    // Whether anything moved at the last measure.
    let moved: boolean | undefined;
    const observed = new Set<Element>();
    const resizes = new ResizeObserver(() => schedule());
    const update = () => {
      frame = 0;
      const modal = modalOpen(own);
      // While a dialog shuts off the page, the bar (shut off with it) steps aside so it never covers the dialog.
      own.toggleAttribute("data-modal", modal);
      // The bar sits a gap above a TabBar that shows, measured from the layer, which fills the screen.
      const tabBar = [...document.querySelectorAll('[data-ouro="tab-bar"] > nav:not([data-closed])')]
        .map((bar) => bar.getBoundingClientRect())
        .find((box) => box.height > 0);
      if (tabBar) own.style.setProperty("--ouro-inspector-tab-bar", `${own.getBoundingClientRect().bottom - tabBar.top + 8}px`);
      else own.style.removeProperty("--ouro-inspector-tab-bar");
      const next = findComponents(own, modal);
      for (const component of next) {
        if (observed.has(component.element)) continue;
        observed.add(component.element);
        resizes.observe(component.element);
      }
      setFound((current) => (sameComponents(current, next) ? current : next));
      setMeasured(true);
      place(next);
      // While anything moves, and once more the frame after: in the frame a transition ends, WebKit
      // can still read the element's style from before it ended, with no animation left running,
      // and nothing tells X-ray when the style catches up.
      const now = moving(own);
      if (now || moved) schedule();
      moved = now;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // X-ray's own writes (each outline's position) are no change to the page.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !own.contains(record.target))) schedule();
    });
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    addEventListener("scroll", schedule, { capture: true, passive: true });
    addEventListener("resize", schedule);
    // Hover and focus change what shows without changing the page: an action that appears on hover or focus.
    for (const type of reveals) addEventListener(type, schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      removeEventListener("scroll", schedule, { capture: true });
      removeEventListener("resize", schedule);
      for (const type of reveals) removeEventListener(type, schedule, true);
    };
    // `place` reads only the outlines map, which lives as long as the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outlines React has just rendered are placed before the browser paints them.
  useLayoutEffect(() => place(found));

  // The first spotlit component comes to the middle of the screen once per item, when X-ray first finds it.
  const spotlit = spotlitOf(found, spotlight);
  const pointedAt = useRef<string | undefined>(undefined);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!spotlit || pointedAt.current === spotlit.item) return;
    pointedAt.current = spotlit.item;
    spotlit.element.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "instant" : "smooth" });
  }, [spotlit, reduced]);

  // The layer fades in from `@starting-style` while it carries `data-starting-style`, then drops it.
  useEffect(() => {
    const own = layer.current!;
    let live = true;
    void (async () => {
      void getComputedStyle(own).opacity;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await Promise.allSettled(own.getAnimations().map((animation) => animation.finished));
      if (live) setEntering(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const close = () => {
    const active = document.activeElement;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected && (active === document.body || layer.current!.contains(active))) returnFocus.focus();
    onOpenChange(false);
  };
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });

  // Escape turns X-ray off, unless it closes something else first: X-ray's own list, or another
  // overlay. Overlays close on Escape as it bubbles to the document, and stop it or mark it handled,
  // so X-ray listens after them, on the window, and leaves an Escape anything has handled.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeRef.current();
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);

  const count = `${found.length} ${found.length === 1 ? "component" : "components"}`;
  return (
    <div ref={layer} data-ouro="inspector" data-ouro-part="layer" data-starting-style={entering ? "" : undefined} className={layerClass}>
      <div aria-hidden="true">
        {found.map((component) => (
          <div
            key={component.key}
            ref={(element) => {
              if (element) outlines.set(component.key, element);
              else outlines.delete(component.key);
            }}
            data-ouro-inspector-outline=""
            data-spotlight={component === spotlit ? "" : undefined}
            className={outlineClass}
          >
            <div data-ouro-inspector-frame="" className={frameClass}>
              <svg className="absolute inset-0 size-full overflow-visible">
                <path d="" />
              </svg>
            </div>
            <a data-ouro-control="inspector" data-ouro-part="tag" href={docsHref(component.item)} target="_blank" rel="noreferrer" tabIndex={-1} className={tagClass}>
              {component.item}
            </a>
          </div>
        ))}
      </div>
      <section aria-label={label} className={pillClass}>
        <span aria-hidden="true" className={labelClass}>
          {label}
        </span>
        {spotlight !== undefined && (
          <span role="status" className={statusClass}>
            {measured && (spotlit ? `Showing ${spotlight}` : `No ${spotlight} on this page`)}
          </span>
        )}
        <span className={actionsClass}>
          <Sheet
            title={label}
            description="Every Ouro HX component on this page, in order."
            trigger={
              <Button variant="plain" size="sm" data-ouro-control="inspector" data-ouro-part="list">
                {count}
              </Button>
            }
          >
            <ol data-ouro-inspector-list="" className={listClass}>
              {found.map((component) => {
                const source = sourceHref?.(component.item, component.element);
                return (
                  <li key={component.key} className="flex min-h-9 items-center justify-between gap-3">
                    <code className="font-mono text-sm leading-5 text-foreground">{component.item}</code>
                    <span className="flex shrink-0 items-center gap-2">
                      <a data-ouro-control="inspector" data-ouro-part="docs" href={docsHref(component.item)} target="_blank" rel="noreferrer" className={linkClass}>
                        Docs<span className="sr-only"> for {component.item} (opens in a new tab)</span>
                      </a>
                      {source !== undefined && (
                        <a data-ouro-control="inspector" data-ouro-part="source" href={source} target="_blank" rel="noreferrer" className={linkClass}>
                          Source<span className="sr-only"> of {component.item} (opens in a new tab)</span>
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Sheet>
          <Button variant="plain" size="sm" data-ouro-control="inspector" data-ouro-part="close" onClick={close}>
            Close
          </Button>
        </span>
      </section>
    </div>
  );
}
