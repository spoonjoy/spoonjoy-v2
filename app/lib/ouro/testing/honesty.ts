export { honesty };

/**
 * The honesty check: among `elements`, nothing paints a gradient, every corner with a radius is a squircle (`corner-shape:
 * squircle`, which Chromium computes as `superellipse(2)`), and no shadow is blurred, since a blur reads as a gradient.
 * A flat ring (a box shadow with no blur) is allowed. Returns how many elements and rounded corners it looked at, and
 * each problem as a line naming the element.
 * @claim "The honesty check: among" registry/ouro/lib/ouro/testing/honesty.test.tsx verify:fileLine(registry/ouro/lib/ouro/testing/honesty.test.tsx, /finds a gradient, a round corner and a blurred shadow when one is added/)
 * @claim "A flat ring (a box shadow" registry/ouro/lib/ouro/testing/honesty.test.tsx verify:fileLine(registry/ouro/lib/ouro/testing/honesty.test.tsx, /passes a flat squircle with a flat ring/)
 * @claim "Returns how many elements and rounded" registry/ouro/lib/ouro/testing/honesty.test.tsx verify:fileLine(registry/ouro/lib/ouro/testing/honesty.test.tsx, /elements: 2, rounded: 8, problems: \[\]/)
 */
function honesty(elements: Iterable<Element>): { elements: number; rounded: number; problems: string[] } {
  const problems: string[] = [];
  let count = 0;
  let rounded = 0;
  for (const element of elements) {
    count++;
    const style = getComputedStyle(element);
    const name = describe(element);
    for (const property of ["background-image", "border-image-source", "mask-image", "list-style-image"]) {
      if (style.getPropertyValue(property).includes("gradient")) problems.push(`${name}: ${property} has a gradient`);
    }
    for (const corner of ["top-left", "top-right", "bottom-right", "bottom-left"]) {
      if (parseFloat(style.getPropertyValue(`border-${corner}-radius`)) > 0) {
        rounded++;
        const shape = (style.getPropertyValue(`corner-${corner}-shape`) || style.getPropertyValue("corner-shape")).replace(/\s/g, "");
        if (!(shape.includes("squircle") || shape === "superellipse(2)")) problems.push(`${name}: its ${corner} corner is "${shape || "unsupported"}", not a squircle`);
      }
    }
    const shadow = style.getPropertyValue("box-shadow");
    if (shadow && shadow !== "none") {
      for (const part of shadow.split(/,(?![^(]*\))/)) {
        const lengths = part
          .replace(/[a-z-]+\([^)]*\)/g, "")
          .trim()
          .split(/\s+/)
          .filter((token) => /px$/.test(token));
        if (lengths.length >= 3 && parseFloat(lengths[2]!) > 0) problems.push(`${name}: blurred box-shadow ${part.trim()}`);
      }
    }
  }
  return { elements: count, rounded, problems };
}

/** An element as a person can find it: its tag, its Ouro names and its first classes. */
function describe(element: Element): string {
  const ouro = ["data-ouro", "data-ouro-part", "data-preset", "data-theme"]
    .map((attribute) => element.getAttribute(attribute))
    .filter(Boolean)
    .map((value) => `[${value}]`)
    .join("");
  const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join("");
  return `${element.tagName.toLowerCase()}${ouro}${classes}`;
}
