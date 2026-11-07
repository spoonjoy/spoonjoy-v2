import type { RefCallback } from "react";

/**
 * A callback ref that marks an element Base UI renders on its own, such as the hidden input a
 * checkbox submits with, as one of a component's controls: `data-ouro-control` names the item
 * and `data-ouro-part` the part. Create it once, outside the component, so React keeps one ref.
 *
 * Internal: Ouro UI components use it; apps don't need to.
 *
 * @example
 * const markInput = controlRef("checkbox", "hidden-input");
 * <BaseCheckbox.Root inputRef={markInput} />
 */
export function controlRef(item: string, part: string): RefCallback<HTMLElement> {
  return (element) => {
    element?.setAttribute("data-ouro-control", item);
    element?.setAttribute("data-ouro-part", part);
  };
}
