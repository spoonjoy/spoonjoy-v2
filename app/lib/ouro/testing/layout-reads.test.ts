import { describe, expect, it, onTestFinished } from "vitest";
import { layoutReadNames, watchLayoutReads } from "~/lib/ouro/testing/layout-reads";

const own = (owner: object, name: string) => Object.getOwnPropertyDescriptor(owner, name);
const before = {
  offsetHeight: own(HTMLElement.prototype, "offsetHeight"),
  clientWidth: own(Element.prototype, "clientWidth"),
  rects: own(Element.prototype, "getBoundingClientRect"),
  rangeRects: own(Range.prototype, "getClientRects"),
  style: own(window, "getComputedStyle"),
};

describe("watchLayoutReads", () => {
  it("records each read that lays the page out, with what it was read from, in order", () => {
    const box = document.createElement("div");
    box.textContent = "words";
    box.tabIndex = -1;
    document.body.append(box);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    svg.append(shape);
    document.body.append(svg);
    const range = document.createRange();
    range.selectNodeContents(box);
    const reads = watchLayoutReads();
    const height = box.offsetHeight;
    void [box.offsetWidth, box.offsetTop, box.offsetLeft, box.offsetParent, box.innerText];
    void [box.clientHeight, box.clientWidth, box.clientTop, box.clientLeft, box.scrollHeight, box.scrollWidth, box.scrollTop, box.scrollLeft];
    box.getBoundingClientRect();
    box.getClientRects();
    box.computedStyleMap();
    box.scrollIntoView({ block: "nearest" });
    range.getBoundingClientRect();
    range.getClientRects();
    shape.getBBox();
    box.focus({ preventScroll: true });
    svg.focus({ preventScroll: true });
    document.elementFromPoint(0, 0);
    document.elementsFromPoint(0, 0);
    void [scrollX, scrollY, innerWidth, innerHeight];
    const style = getComputedStyle(box).display;
    reads.stop();
    box.remove();
    svg.remove();
    expect(height).toBeGreaterThan(0);
    expect(style).toBe("block");
    expect(reads.names()).toEqual([...layoutReadNames.slice(0, 18), "getBoundingClientRect", "getClientRects", "getBBox", "focus", "focus", "elementFromPoint", "elementsFromPoint", "scrollX", "scrollY", "innerWidth", "innerHeight", "getComputedStyle"]);
    expect(reads.reads.map((read) => read.target)).toEqual([
      ...Array<unknown>(18).fill(box),
      range,
      range,
      shape,
      box,
      svg,
      document,
      document,
      window,
      window,
      window,
      window,
      box,
    ]);
  });

  it("nests: each watch records from its own start to its own stop, in either order, and the last puts the browser's reads back", () => {
    const outer = watchLayoutReads();
    void document.body.offsetHeight;
    const inner = watchLayoutReads();
    void document.body.clientWidth;
    outer.stop();
    void document.body.scrollHeight;
    expect(own(HTMLElement.prototype, "offsetHeight")).not.toEqual(before.offsetHeight);
    inner.stop();
    void document.body.offsetWidth;
    expect(outer.names()).toEqual(["offsetHeight", "clientWidth"]);
    expect(inner.names()).toEqual(["clientWidth", "scrollHeight"]);
    expect(own(HTMLElement.prototype, "offsetHeight")).toEqual(before.offsetHeight);
    expect(own(Element.prototype, "clientWidth")).toEqual(before.clientWidth);
    expect(own(window, "getComputedStyle")).toEqual(before.style);
    // A new watch after both records again, from the browser's own reads.
    const again = watchLayoutReads();
    void document.body.offsetHeight;
    again.stop();
    expect(again.names()).toEqual(["offsetHeight"]);
  });


  it("reads a size changed a moment ago at once, which the browser can answer only by laying the page out first", () => {
    const box = document.createElement("div");
    box.style.width = "40px";
    document.body.append(box);
    void box.offsetWidth;
    box.style.width = "120px";
    const reads = watchLayoutReads();
    expect(box.offsetWidth).toBe(120);
    reads.stop();
    box.remove();
    expect(reads.names()).toEqual(["offsetWidth"]);
  });

  it("records nothing once stopped, and stops once", () => {
    const reads = watchLayoutReads();
    reads.stop();
    reads.stop();
    void document.body.offsetHeight;
    expect(reads.names()).toEqual([]);
  });

  it("puts the browser's own reads back on stop, and at the end of the test", () => {
    const reads = watchLayoutReads();
    expect(own(HTMLElement.prototype, "offsetHeight")).not.toEqual(before.offsetHeight);
    reads.stop();
    expect(own(HTMLElement.prototype, "offsetHeight")).toEqual(before.offsetHeight);
    expect(own(Element.prototype, "clientWidth")).toEqual(before.clientWidth);
    expect(own(Element.prototype, "getBoundingClientRect")).toEqual(before.rects);
    expect(own(Range.prototype, "getClientRects")).toEqual(before.rangeRects);
    expect(own(window, "getComputedStyle")).toEqual(before.style);
    // onTestFinished runs its callbacks last first, so this runs after the watch below has stopped itself.
    onTestFinished(() => {
      expect(own(HTMLElement.prototype, "offsetHeight")).toEqual(before.offsetHeight);
      expect(own(window, "getComputedStyle")).toEqual(before.style);
    });
    watchLayoutReads();
  });
});
