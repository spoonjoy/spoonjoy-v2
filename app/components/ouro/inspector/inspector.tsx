"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ouro/button/button";
import { frameClass, isPartOf, itemFor, layerClass, linkClass, listClass, outlineClass, pillClass, tagClass } from "~/components/ouro/inspector/inspector-styles";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

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
   * Without it they link to Ouro's public docs, `https://ourostack.github.io/ouro-ui/docs/<item>/`.
   * @claim "The address of an item's docs" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
   */
  docsHref?: ((item: string) => string) | undefined;
  /** The address of the source that renders a component, if you publish it: the list shows a Source link where this returns one. */
  sourceHref?: ((item: string, element: Element) => string | undefined) | undefined;
  /** What X-ray is called, on its bar and as its list's title. Translate it here. @default "X-ray" */
  label?: string | undefined;

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
 * one; X-ray's own list aside). A popover leaves the page alone, and an open combobox list (in a
 * popover too) hides the page from assistive technology but leaves it within reach.
 */
const modalOpen = (own: Element) =>
  !!own.closest(shutOff) &&
  [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (dialog) => !dialog.closest(shutOff) && !dialog.querySelector("[data-ouro-inspector-list]") && !!dialog.closest('[data-ouro$="-portal"]')?.querySelector(catcher),
  );

/**
 * Every visible Ouro component root in the page, in document order, but X-ray's own, one behind an
 * open dialog, and a part's root inside its own component (a Radio in its RadioGroup counts once).
 * @claim "Every visible Ouro component root in" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > outlines every Ouro component on the page, each tagged with its item and linked to its docs)
 * @claim "Every visible Ouro component root in" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline itself, an overlay's wrappers, a hidden component or a part apart from its component)
 */
function findComponents(own: Element, modal: boolean): Found[] {
  const found: Found[] = [];
  for (const element of document.querySelectorAll("[data-ouro]")) {
    if (own.contains(element) || element.closest('[data-ouro="sheet"]')?.querySelector("[data-ouro-inspector-list]")) continue;
    const name = element.getAttribute("data-ouro")!;
    const item = itemFor(name);
    if (item === null || isPartOf(name, element.parentElement?.closest("[data-ouro]")) || (modal && element.closest(shutOff))) continue;
    if (!element.checkVisibility({ visibilityProperty: true })) continue;
    const box = element.getBoundingClientRect();
    // A visually hidden root (`sr-only`, one pixel square) has nothing to outline; a one-pixel line (a Separator) has.
    if (box.width <= 1 && box.height <= 1) continue;
    found.push({ key: keyOf(element), item, element });
  }
  return found;
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
 * link); or, over the tag itself, an overlay's popup (a menu, a select list) the component is not in.
 */
function covered(root: Element, part: Edges, rtl: boolean, inside: boolean, own: Element): boolean {
  const start = (offset: number) => (rtl ? part.right - offset : part.left + offset);
  const corner = topAt(start(Math.min(4, (part.right - part.left) / 2)), part.top + Math.min(4, (part.bottom - part.top) / 2), own);
  if (corner && !root.contains(corner) && !corner.contains(root) && !ownerOf(corner)?.contains(root)) return true;
  const overlay = topAt(start(12), inside ? part.top + 8 : part.top - 8, own)?.closest('[data-ouro$="-portal"]');
  return !!overlay && !overlay.contains(root);
}

const sameComponents = (a: Found[], b: Found[]) => a.length === b.length && a.every((entry, index) => entry.key === b[index]!.key && entry.item === b[index]!.item);

/** Whether anything in the page outside X-ray is still moving, so its outline follows it frame by frame. */
const moving = (own: Element) =>
  document.getAnimations().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === "running" && Number.isFinite(animation.effect!.getComputedTiming().iterations) && !(target && own.contains(target));
  });

const noSubscription = () => () => {};

/** Ouro's public docs page for an item. */
const ouroDocs = (item: string) => `https://ourostack.github.io/ouro-ui/docs/${item}/`;

/**
 * X-ray for a page built with Ouro HX: outlines every Ouro component on the page with its name,
 * linked to its docs, and lists them all for keyboard and screen reader users. Each tag names the
 * component's registry item; the bar at the bottom opens the list (a `Sheet`), every component in
 * document order with its "Docs" and, from `sourceHref`, "Source" links. Outlines follow
 * their components through scrolling, resizing, overlays and changes to the page, measured once a
 * frame at most; they never take a pointer, so the page stays usable underneath, and only the tags
 * do. X-ray shows only what a person can see and reach: an outline is cut to the part a scrolling
 * box lets show, a tag hides while a menu or a list lies over it, the page behind an open modal
 * dialog is left alone, and a part (a Radio) counts with
 * its component (its RadioGroup). Escape or Close turns it off, once Escape has closed any other
 * overlay. It renders nothing on the server.
 *
 * Use your browser's developer tools instead when you need more than which component is where;
 * the `data-ouro`, `data-ouro-control` and `data-ouro-part` attributes X-ray reads are there too.
 *
 * @group App setup
 * @see https://ourostack.github.io/ouro-ui/docs/inspector
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
 */
export function Inspector(props: InspectorProps): JSX.Element | null {
  const {
    open,
    onOpenChange,
    docsHref = ouroDocs,
    sourceHref,
    label = "X-ray",
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
  return createPortal(<InspectorLayer onOpenChange={onOpenChange} docsHref={docsHref} sourceHref={sourceHref} label={label} />, document.body);
}

/** X-ray while it is on: the outlines, the bar and its list. */
function InspectorLayer({ onOpenChange, docsHref, sourceHref, label }: Pick<InspectorProps, "onOpenChange" | "sourceHref"> & { docsHref: (item: string) => string; label: string }): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const [outlines] = useState(() => new Map<number, HTMLElement>());
  const [found, setFound] = useState<Found[]>([]);
  const [entering, setEntering] = useState(true);
  // Focus goes back where it was when X-ray closes from its own bar or Escape.
  const [returnFocus] = useState(() => document.activeElement);

  /**
   * Puts each outline over its component, cut to the part of it that shows: every box read first,
   * then every outline written, so the page lays out once. An outline with nothing showing hides,
   * and so does its tag.
   * @claim "Puts each outline over its component" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out)
   * @claim "Puts each outline over its component" registry/ouro/components/ouro/inspector/inspector.tsx verify:fileLine(registry/ouro/components/ouro/inspector/inspector.tsx, /const\sboxes\s=\scomponents\.map\(\(component\)\s=>\scomponent\.element\.getBoundingClientRect\(\)\)/)
   */
  const place = (components: Found[]) => {
    const own = layer.current!;
    const ancestors = new Map<Element, Ancestor>();
    const boxes = components.map((component) => component.element.getBoundingClientRect());
    const parts = components.map((component, index) => visiblePart(component.element, boxes[index]!, ancestors));
    // The tag sits on the part that shows, inside it where there is no room above (the top of the screen, or a cut top edge).
    const inside = parts.map((part, index) => part.top < 16 || part.top > boxes[index]!.top);
    const covers = components.map((component, index) => covered(component.element, parts[index]!, ancestors.get(component.element)!.rtl, inside[index]!, own));
    components.forEach((component, index) => {
      const outline = outlines.get(component.key);
      if (!outline) return;
      const box = boxes[index]!;
      const part = parts[index]!;
      outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
      outline.style.width = `${box.width}px`;
      outline.style.height = `${box.height}px`;
      outline.toggleAttribute("data-clipped", part.right <= part.left || part.bottom <= part.top);
      const cut = [part.top - box.top, box.right - part.right, box.bottom - part.bottom, part.left - box.left];
      (outline.firstElementChild as HTMLElement).style.clipPath = cut.some(Boolean) ? `inset(${cut.join("px ")}px)` : "";
      const tag = outline.lastElementChild as HTMLElement;
      tag.toggleAttribute("data-inside", inside[index]!);
      tag.toggleAttribute("data-covered", covers[index]!);
      tag.style.setProperty("--ouro-inspector-top", `${cut[0]}px`);
      tag.style.setProperty("--ouro-inspector-left", `${cut[3]}px`);
      tag.style.setProperty("--ouro-inspector-right", `${-cut[1]!}px`);
    });
  };

  useEffect(() => {
    const own = layer.current!;
    let frame = 0;
    const observed = new Set<Element>();
    const resizes = new ResizeObserver(() => schedule());
    const update = () => {
      frame = 0;
      const modal = modalOpen(own);
      // While a dialog shuts off the page, the bar (shut off with it) steps aside so it never covers the dialog.
      own.toggleAttribute("data-modal", modal);
      const next = findComponents(own, modal);
      for (const component of next) {
        if (observed.has(component.element)) continue;
        observed.add(component.element);
        resizes.observe(component.element);
      }
      setFound((current) => (sameComponents(current, next) ? current : next));
      place(next);
      if (moving(own)) schedule();
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
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      removeEventListener("scroll", schedule, { capture: true });
      removeEventListener("resize", schedule);
    };
    // `place` reads only the outlines map, which lives as long as the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outlines React has just rendered are placed before the browser paints them.
  useLayoutEffect(() => place(found));

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
            className={outlineClass}
          >
            <div data-ouro-inspector-frame="" className={frameClass} />
            <a data-ouro-control="inspector" data-ouro-part="tag" href={docsHref(component.item)} target="_blank" rel="noreferrer" tabIndex={-1} className={tagClass}>
              {component.item}
            </a>
          </div>
        ))}
      </div>
      <div role="group" aria-label={label} className={pillClass}>
        <span aria-hidden="true" className="font-medium">
          {label}
        </span>
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
      </div>
    </div>
  );
}
