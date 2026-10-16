import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "~/components/ouro/select/select";
import { SelectGroup, SelectItem } from "~/components/ouro/select/select-parts";

// In a Next.js build a Server Component passes `<SelectItem>` as an element whose `type` is a
// lazy reference to the client component, never the component itself. Select still has to
// find its items to show the chosen one's label in the server HTML.

const lazy = (value: unknown) => ({ $$typeof: Symbol.for("react.lazy"), _payload: value, _init: (payload: unknown) => payload });

/** `element` as a Server Component hands it over: its type a lazy reference. */
function fromServer<T extends ReactNode>(element: T): T {
  if (!isValidElement(element)) return element;
  return createElement(lazy(element.type) as unknown as ComponentType, { ...(element.props as object), key: element.key ?? undefined }) as T;
}

describe("Select items from a Server Component", () => {
  it("shows the chosen item's label when the items and their group have lazy types", () => {
    const items = (wrap: <T extends ReactNode>(element: T) => T) => (
      <Select label="Course" name="course" defaultValue="main">
        {wrap(
          <SelectGroup label="Meals">
            {wrap(<SelectItem value="starter">Starter</SelectItem>)}
            {wrap(<SelectItem value="main">Main</SelectItem>)}
          </SelectGroup>,
        )}
      </Select>
    );
    const html = renderToString(items(fromServer));
    expect(html).toBe(renderToString(items((element) => element)));
    expect(html).toContain(">Main</span>");
    expect(html).not.toContain(">main</span>");
  });
});
