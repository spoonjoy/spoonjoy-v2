import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "480px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, group: host.querySelector<HTMLElement>('[data-ouro="item-group"]')! };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const tokens = ["CLI", "Sync", "Backup"];

describe("ItemGroup", () => {
  it("is a list labelled by its label, with each Item a list item", async () => {
    await render(
      <ItemGroup label="Bearer credentials">
        {tokens.map((name) => (
          <Item key={name} title={name} />
        ))}
      </ItemGroup>,
    );
    const list = page.getByRole("list", { name: "Bearer credentials" });
    await expect.element(list).toBeVisible();
    expect(list.element().tagName).toBe("UL");
    const items = page.getByRole("listitem").elements();
    expect(items.map((item) => item.textContent)).toEqual(tokens);
    expect(getComputedStyle(list.element()).listStyleType).toBe("none");
    expect(getComputedStyle(list.element()).paddingInlineStart).toBe("0px");
  });

  it("draws a line between rows by default, not after the last", async () => {
    const { group } = await render(
      <ItemGroup aria-label="Tokens">
        {tokens.map((name) => (
          <Item key={name} title={name} />
        ))}
      </ItemGroup>,
    );
    const items = [...group.querySelectorAll("li")];
    expect(getComputedStyle(items[0]!).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(items[1]!).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(items[2]!).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(group.querySelector('[data-ouro="item"]')!).paddingInlineStart).toBe("0px");
  });

  it("frames the rows in a bordered surface and pads them with variant=outline", async () => {
    const { group } = await render(
      <ItemGroup aria-label="Tokens" variant="outline">
        {tokens.map((name) => (
          <Item key={name} title={name} variant="outline" />
        ))}
      </ItemGroup>,
    );
    const list = group.querySelector("ul")!;
    expect(getComputedStyle(list).borderTopWidth).toBe("1px");
    const item = group.querySelector<HTMLElement>('[data-ouro="item"]')!;
    expect(getComputedStyle(item).paddingInlineStart).toBe("16px");
    // An Item's own outline gives way to the group's frame.
    expect(getComputedStyle(item).borderTopWidth).toBe("0px");
  });

  it("has no lines with variant=plain", async () => {
    const { group } = await render(
      <ItemGroup aria-label="Tokens" variant="plain">
        <Item title="A" />
        <Item title="B" />
      </ItemGroup>,
    );
    expect(getComputedStyle(group.querySelector("li")!).borderBottomWidth).toBe("0px");
  });

  it("shows empty, outside any list, when there are no rows", async () => {
    const { group } = await render(
      <ItemGroup label="OAuth app connections" empty="No active OAuth app connections.">
        {[]}
      </ItemGroup>,
    );
    await expect.element(page.getByText("OAuth app connections", { exact: true })).toBeVisible();
    await expect.element(page.getByText("No active OAuth app connections.", { exact: true })).toBeVisible();
    expect(group.querySelector("ul")).toBeNull();
  });

  it("renders nothing for the list with no rows and no empty", async () => {
    const { group } = await render(<ItemGroup aria-label="x">{null}</ItemGroup>);
    expect(group.querySelector("ul")).toBeNull();
  });

  it("wraps a loose text child in a list item too", async () => {
    const { group } = await render(
      <ItemGroup aria-label="x">
        <Item title="A" />
        More soon
      </ItemGroup>,
    );
    expect([...group.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["A", "More soon"]);
  });

  it("renders an ordered list with ordered", async () => {
    const { group } = await render(
      <ItemGroup aria-label="Steps" ordered>
        <Item title="Sear" />
        <Item title="Braise" />
      </ItemGroup>,
    );
    expect(group.querySelector("ol")).not.toBeNull();
  });

  it("passes attributes and a ref to the wrapper, and lets layout classes win", async () => {
    let node: HTMLDivElement | null = null;
    const { group } = await render(
      <ItemGroup aria-label="x" id="tokens" className="mt-4" ref={(element) => void (node = element)}>
        <Item title="A" />
      </ItemGroup>,
    );
    expect(group.id).toBe("tokens");
    expect(node).toBe(group);
    expect(getComputedStyle(group).marginTop).toBe("16px");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ItemGroup development messages", () => {
  it.each([
    ["title", { title: "Tokens" }, "title is not a prop", '<ItemGroup label="Tokens">'],
    ["items", { items: [] }, "items is not a prop; ItemGroup takes Items as children", "<ItemGroup>{rows.map((row) => <Item key={row.id} title={row.name} />)}</ItemGroup>"],
    ["divided", { divided: true }, "divided is not a prop", '<ItemGroup variant="divided">'],
    ["variant", { variant: "separated" }, 'variant="separated" is not a variant; use "divided", "outline", "plain"', '<ItemGroup variant="divided">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const { group } = await render(
      <ItemGroup {...({ "aria-label": "x", ...extra } as unknown as Parameters<typeof ItemGroup>[0])}>
        <Item title="A" />
      </ItemGroup>,
    );
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ItemGroup: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["title", "items", "divided"]) expect(group.hasAttribute(attribute)).toBe(false);
  });

  it("warns when an Item inside renders its own <li>", async () => {
    // React reports the nested list item too.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render(
      <ItemGroup aria-label="x">
        <Item as="li" title="A" />
      </ItemGroup>,
    );
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ItemGroup: <Item as="li"> puts a list item inside the list item ItemGroup already wraps each row in. Fix: <Item title="…"> without as.');
  });

  it("warns when the list has no name", async () => {
    await render(
      <ItemGroup>
        <Item title="A" />
      </ItemGroup>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ItemGroup: the list has no name. Fix: <ItemGroup label="Bearer credentials">, or aria-label="…" to name it without showing a label.',
    );
  });

  it("checks the className", async () => {
    await render(
      <ItemGroup aria-label="x" className="divide-y border">
        <Item title="A" />
      </ItemGroup>,
    );
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ItemGroup: "border" sets appearance, and className is for layout only. Fix: <ItemGroup variant="outline">.');
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <ItemGroup label="Tokens">
        <Item title="A" />
      </ItemGroup>,
    );
    expect(html).toContain('data-ouro="item-group"');
    expect(html).toMatch(/<ul[^>]*aria-labelledby="[^"]+"/);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
