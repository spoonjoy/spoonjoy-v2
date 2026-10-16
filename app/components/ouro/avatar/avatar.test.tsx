import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Avatar, AvatarGroup } from "~/components/ouro/avatar/avatar";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get avatar() {
      return host.querySelector<HTMLElement>('[data-ouro="avatar"]')!;
    },
    get group() {
      return host.querySelector<HTMLElement>('[data-ouro="avatar-group"]')!;
    },
  };
}

// A 2x2 PNG that always loads, and an address that never does.
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4AWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const broken = "data:image/png;base64,broken";

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

describe("Avatar", () => {
  it("shows initials from the name, and the name to screen readers", async () => {
    const { avatar } = await render(<Avatar name="Ada King Lovelace" />);
    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Ada King Lovelace");
    expect(avatar.textContent).toBe("AL");
    await expect.element(page.getByRole("img", { name: "Ada King Lovelace" })).toBeVisible();
  });

  it.each([
    ["Ada", "A"],
    ["  grace   hopper ", "GH"],
    ["Émile Zola", "ÉZ"],
    ["😀 Smile", "😀S"],
    ["", ""],
  ])("derives initials from %j as %j", async (name, initials) => {
    const { avatar } = await render(<Avatar name={name} />);
    expect(avatar.textContent).toBe(initials);
  });

  it("takes initials and alt that override the name", async () => {
    const { avatar } = await render(<Avatar name="Ada Lovelace" initials="AdL" alt="Ada, the author" />);
    expect(avatar.textContent).toBe("AdL");
    expect(avatar.getAttribute("aria-label")).toBe("Ada, the author");
  });

  it("is hidden from assistive technology with an empty alt", async () => {
    const { avatar } = await render(<Avatar name="Ada Lovelace" alt="" />);
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.hasAttribute("role")).toBe(false);
    expect(avatar.hasAttribute("aria-label")).toBe(false);
  });

  it("shows the image once it loads", async () => {
    const { avatar } = await render(<Avatar name="Ada Lovelace" src={photo} />);
    await expect.poll(() => avatar.querySelector("img")).not.toBeNull();
    const img = avatar.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(photo);
    expect(avatar.textContent).toBe("");
    expect(avatar.getAttribute("aria-label")).toBe("Ada Lovelace");
    expect(getComputedStyle(img).objectFit).toBe("cover");
  });

  it("falls back to initials when the image fails", async () => {
    const { avatar } = await render(<Avatar name="Ada Lovelace" src={broken} />);
    await expect.poll(() => avatar.getAttribute("data-image")).toBe("error");
    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.textContent).toBe("AL");
  });

  it("renders initials in server HTML and hydrates without a warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = <Avatar name="Ada Lovelace" src={photo} />;
    const html = renderToString(node);
    expect(html).toContain('aria-label="Ada Lovelace"');
    expect(html).toContain(">AL<");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    await expect.poll(() => host.querySelector("img")).not.toBeNull();
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("comes in sizes that grow in order, as circles", async () => {
    const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
    const { host } = await render(
      <>
        {sizes.map((size) => (
          <Avatar key={size} name="Ada Lovelace" size={size} />
        ))}
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    const widths = avatars.map((avatar) => avatar.getBoundingClientRect().width);
    expect(widths).toEqual([24, 32, 40, 48, 64, 72, 112]);
    const fonts = avatars.map((avatar) => parseFloat(getComputedStyle(avatar).fontSize));
    expect([...fonts].sort((a, b) => a - b)).toEqual(fonts);
    // The initials keep roughly the same share of the circle at every size.
    for (const index of widths.keys()) expect(fonts[index]! / widths[index]!).toBeGreaterThan(0.29);

    for (const avatar of avatars) expect(avatar.getBoundingClientRect().height).toBe(avatar.getBoundingClientRect().width);
    expect(getComputedStyle(avatars[0]!).borderRadius).not.toBe("0px");
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLElement | null = null;
    const { avatar } = await render(<Avatar name="Ada" className="ms-2" ref={(node) => void (element = node)} />);
    expect(element).toBe(avatar);
    expect(getComputedStyle(avatar).marginInlineStart).toBe("8px");
  });
});

describe("AvatarGroup", () => {
  const cooks = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Edsger Dijkstra"];

  it("stacks avatars in a labeled group, overlapping", async () => {
    const { group } = await render(
      <AvatarGroup label="Cooks">
        {cooks.slice(0, 3).map((name) => (
          <Avatar key={name} name={name} />
        ))}
      </AvatarGroup>,
    );
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Cooks");
    const avatars = [...group.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    expect(avatars).toHaveLength(3);
    const [first, second] = avatars.map((avatar) => avatar.getBoundingClientRect());
    expect(second!.left).toBeLessThan(first!.right);
    expect(getComputedStyle(avatars[1]!).boxShadow).not.toBe("none");
    expect(group.querySelector("[data-ouro-avatar-more]")).toBeNull();
  });

  it("shows max avatars and a +N count with a spoken label", async () => {
    const { group } = await render(
      <AvatarGroup label="Cooks" max={3}>
        {cooks.map((name) => (
          <Avatar key={name} name={name} />
        ))}
      </AvatarGroup>,
    );
    expect(group.querySelectorAll('[data-ouro="avatar"]')).toHaveLength(3);
    const more = group.querySelector<HTMLElement>("[data-ouro-avatar-more]")!;
    expect(more.textContent).toBe("+22 more");
    expect(more.querySelector("[aria-hidden]")!.textContent).toBe("+2");
    await expect.element(page.getByRole("group", { name: "Cooks" })).toBeVisible();
  });

  it("counts from total when more people exist than avatars passed", async () => {
    const { group } = await render(
      <AvatarGroup label="Members" total={120} moreLabel={(count) => `${count} weitere`}>
        <Avatar name="Ada Lovelace" />
        <Avatar name="Grace Hopper" />
      </AvatarGroup>,
    );
    const more = group.querySelector<HTMLElement>("[data-ouro-avatar-more]")!;
    expect(more.textContent).toBe("+118118 weitere");
  });

  it("passes its size to every avatar and the count", async () => {
    const { group } = await render(
      <AvatarGroup label="Cooks" size="lg" max={1}>
        <Avatar name="Ada Lovelace" />
        <Avatar name="Grace Hopper" size="xs" />
      </AvatarGroup>,
    );
    const avatar = group.querySelector<HTMLElement>('[data-ouro="avatar"]')!;
    const more = group.querySelector<HTMLElement>("[data-ouro-avatar-more]")!;
    expect(avatar.getBoundingClientRect().width).toBe(48);
    expect(more.getBoundingClientRect().width).toBe(48);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { group } = await render(
      <AvatarGroup label="Cooks" className="mt-4" ref={(node) => void (element = node)}>
        <Avatar name="Ada" />
      </AvatarGroup>,
    );
    expect(element).toBe(group);
    expect(getComputedStyle(group).marginTop).toBe("16px");
  });
});

describe("Avatar development messages", () => {
  it.each([
    ["children", { children: "AL" }, "Avatar takes name and initials, not children", '<Avatar name="Ada Lovelace" initials="AL" />'],
    ["fallback", { fallback: "AL" }, "fallback is not a prop", '<Avatar name="Ada Lovelace" initials="AL" />'],
    ["size", { size: "4xl" }, 'size="4xl" is not a size; use "xs", "sm", "md", "lg", "xl", "2xl", "3xl"', '<Avatar size="3xl">'],
    ["a numeric size", { size: 40 }, "size={40} is not a size; use \"xs\", \"sm\", \"md\", \"lg\", \"xl\", \"2xl\", \"3xl\"", '<Avatar size="md">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { name: "Ada Lovelace", ...extra } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Avatar: ${problem}. Fix: ${fix}.`);
    expect(avatar.textContent).toBe("AL");
    expect(avatar.getBoundingClientRect().width).toBe(40);
  });

  it("warns once when name is missing", async () => {
    const props = { src: photo } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Avatar: name is missing, so screen readers hear nothing. Fix: <Avatar name="Ada Lovelace" src={url} />.');
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["max", { max: 0 }, "max={0} hides every avatar", "<AvatarGroup max={3}>"],
    ["total", { total: 0, children: [<Avatar key="a" name="Ada Lovelace" />, <Avatar key="g" name="Grace Hopper" />] }, "total={0} is less than the 2 avatars passed", "<AvatarGroup total={2}>"],
    ["children", { children: "Ada" }, "AvatarGroup holds Avatars", '<AvatarGroup label="Cooks"><Avatar name="Ada Lovelace" /></AvatarGroup>'],
    ["size", { size: "huge" }, 'size="huge" is not a size; use "xs", "sm", "md", "lg", "xl", "2xl", "3xl"', '<AvatarGroup size="md">'],
  ])("warns for an AvatarGroup %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Cooks", children: <Avatar name="Ada Lovelace" />, ...extra } as unknown as Parameters<typeof AvatarGroup>[0];
    await render(<AvatarGroup {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] AvatarGroup: ${problem}. Fix: ${fix}.`);
  });

  it.each([
    ["rounded-md", 'remove "rounded-md"; Avatar is always a circle'],
    ["rounded-none", 'remove "rounded-none"; Avatar is always a circle'],
    ["bg-blue-500", 'remove "bg-blue-500"; Avatar colors its initials from the theme'],
    ["text-lg", 'size="lg"'],
    ["size-12", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Avatar name="Ada" className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Avatar: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("checks the AvatarGroup className", async () => {
    await render(
      <AvatarGroup label="Cooks" className="bg-muted">
        <Avatar name="Ada" />
      </AvatarGroup>,
    );
    expect(warn).toHaveBeenCalledWith('[ouro-ui] AvatarGroup: "bg-muted" sets appearance, and className is for layout only. Fix: <div className="bg-muted"><AvatarGroup /></div>.');
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <AvatarGroup label="Cooks" max={1} className="bg-muted">
        <Avatar name="Ada Lovelace" className="bg-red-500" />
        <Avatar name="Grace Hopper" />
      </AvatarGroup>,
    );
    expect(html).toContain('data-ouro="avatar-group"');
    expect(html).toContain("+1");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
