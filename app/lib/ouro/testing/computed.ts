export { computedValue };

/**
 * What this browser computes for a declaration, read from a probe element, so a test compares a
 * component's style with the browser's own spelling of the value. Browsers change how they write
 * some values: a newer Chromium writes `align-items: flex-start` back as `flow-start`.
 *
 * @example
 * expect(getComputedStyle(el).alignItems).toBe(computedValue("align-items", "flex-start"));
 */
function computedValue(property: string, value: string): string {
  const probe = document.createElement("div");
  probe.style.setProperty(property, value);
  document.body.append(probe);
  const computed = getComputedStyle(probe).getPropertyValue(property);
  probe.remove();
  return computed;
}
