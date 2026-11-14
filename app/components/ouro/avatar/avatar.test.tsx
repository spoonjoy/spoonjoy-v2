import { type CSSProperties, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { Avatar, AvatarGroup } from "~/components/ouro/avatar/avatar";
import { act } from "~/lib/ouro/testing/act";
import { audit, describeFindings } from "~/lib/ouro/testing/axe";

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

/** The letters an avatar or a group's count draws: its `::before` content, as the browser resolved it. */
function drawn(scope: Element): string {
  const letters = scope.querySelector("[data-ouro-avatar-initials], [data-ouro-avatar-count]");
  const content = letters ? getComputedStyle(letters, "::before").content : "none";
  return content.startsWith('"') ? (JSON.parse(content) as string) : "";
}

/**
 * Writes each drawn letter in `element` as text instead, in the same element with the same classes
 * but without the `::before` that draws it: the avatar as it was when its initials were text.
 */
function write(element: Element): void {
  for (const letters of element.querySelectorAll<HTMLElement>("[data-ouro-avatar-initials], [data-ouro-avatar-count]")) {
    const text = letters.dataset["ouroAvatarInitials"] ?? letters.dataset["ouroAvatarCount"]!;
    for (const name of [...letters.classList]) if (name.startsWith("before:")) letters.classList.remove(name);
    letters.textContent = text;
  }
}

/** A copy of `element` with its letters written as text ({@link write}). */
function written(element: HTMLElement): HTMLElement {
  const copy = element.cloneNode(true) as HTMLElement;
  write(copy);
  return copy;
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

describe("Avatar", () => {
  it("shows initials from the name, and the name to screen readers", async () => {
    const { avatar } = await render(<Avatar name="Ana Rae Lind" />);
    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Ana Rae Lind");
    expect(drawn(avatar)).toBe("AL");
    await expect.element(page.getByRole("img", { name: "Ana Rae Lind" })).toBeVisible();
  });

  it.each([
    ["Ana", "A"],
    ["  grace   hopper ", "GH"],
    ["Émile Zola", "ÉZ"],
    ["😀 Smile", "😀S"],
    ["", ""],
  ])("derives initials from %j as %j", async (name, initials) => {
    const { avatar } = await render(<Avatar name={name} />);
    expect(drawn(avatar)).toBe(initials);
  });

  it("takes initials and alt that override the name", async () => {
    const { avatar } = await render(<Avatar name="Ana Lind" initials="AnL" alt="Ana, the author" />);
    expect(drawn(avatar)).toBe("AnL");
    expect(avatar.getAttribute("aria-label")).toBe("Ana, the author");
  });

  it("is hidden from assistive technology with an empty alt", async () => {
    const { avatar } = await render(<Avatar name="Ana Lind" alt="" />);
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.hasAttribute("role")).toBe(false);
    expect(avatar.hasAttribute("aria-label")).toBe(false);
  });

  it("shows the image once it loads", async () => {
    const { avatar } = await render(<Avatar name="Ana Lind" src={photo} />);
    await expect.poll(() => avatar.querySelector("img")).not.toBeNull();
    const img = avatar.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(photo);
    expect(avatar.textContent).toBe("");
    expect(drawn(avatar)).toBe("");
    expect(avatar.getAttribute("aria-label")).toBe("Ana Lind");
    expect(getComputedStyle(img).objectFit).toBe("cover");
  });

  it("draws a picture already in the cache at full strength on its first frame, with no fade", async () => {
    const cached = new Image();
    await new Promise((resolve) => {
      cached.onload = resolve;
      cached.src = photo;
    });
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    // Read as the picture goes into the page, before the browser paints it.
    const inserted = new Promise<{ opacity: string; duration: string; animations: number }>((resolve) => {
      const watch = new MutationObserver(() => {
        const img = host.querySelector("img");
        if (!img) return;
        watch.disconnect();
        resolve({ opacity: getComputedStyle(img).opacity, duration: getComputedStyle(img).transitionDuration, animations: img.getAnimations().length });
      });
      watch.observe(host, { childList: true, subtree: true });
    });
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Avatar name="Ana Lind" src={photo} />));
    expect(await inserted).toEqual({ opacity: "1", duration: "0s", animations: 0 });
  });

  it("falls back to initials when the image fails", async () => {
    const { avatar } = await render(<Avatar name="Ana Lind" src={broken} />);
    await expect.poll(() => avatar.getAttribute("data-image")).toBe("error");
    expect(avatar.querySelector("img")).toBeNull();
    expect(drawn(avatar)).toBe("AL");
  });

  it("renders initials in server HTML and hydrates without a warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = <Avatar name="Ana Lind" src={photo} />;
    const html = renderToString(node);
    expect(html).toContain('aria-label="Ana Lind"');
    expect(html).toContain('data-ouro-avatar-initials="AL"');
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
          <Avatar key={size} name="Ana Lind" size={size} />
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
    const { avatar } = await render(<Avatar name="Ana" className="ms-2" ref={(node) => void (element = node)} />);
    expect(element).toBe(avatar);
    expect(getComputedStyle(avatar).marginInlineStart).toBe("8px");
  });

  it("keeps a loading avatar's edge in forced colours, in each shape", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      for (const shape of ["circle", "square", "agent"] as const) {
        const { avatar } = await render(<Avatar name={null} size="lg" shape={shape} />);
        const style = getComputedStyle(avatar.querySelector<HTMLElement>('[data-ouro="skeleton"]')!);
        expect(style.outlineStyle).toBe("solid");
        expect(style.outlineWidth).toBe("1px");
      }
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("shimmers in its own size and shape while the name loads, and says so", async () => {
    for (const shape of ["circle", "square", "agent"] as const) {
      const named = (await render(<Avatar name="Ana Lind" size="lg" shape={shape} />)).avatar.getBoundingClientRect();
      const { avatar } = await render(<Avatar name={null} size="lg" shape={shape} />);
      expect(avatar.getAttribute("aria-label")).toBe("Name loading");
      expect(avatar.getAttribute("data-name-loading")).toBe("");
      expect(avatar.querySelector('[data-ouro="skeleton"]')).not.toBeNull();
      expect(avatar.querySelector("[data-ouro-avatar-initials]")).toBeNull();
      const fallback = avatar.querySelector<HTMLElement>('[data-ouro="skeleton"]')!.parentElement!;
      expect(getComputedStyle(fallback).overflow).toBe("hidden");
      expect(getComputedStyle(fallback).borderTopLeftRadius).toBe(getComputedStyle(avatar).borderTopLeftRadius);
      const box = avatar.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([named.width, named.height]);
      expect(avatar.querySelector('[data-ouro="skeleton"]')!.getBoundingClientRect().width).toBe(box.width);
    }
    const busy = (await render(<Avatar name={null} nameLoadingLabel="Nom en cours" presence="busy" presenceLabel="Occupé" />)).avatar;
    expect(busy.getAttribute("aria-label")).toBe("Nom en cours, Occupé");
    // The presence dot stays whole: the same box as beside a name.
    const dot = (avatar: HTMLElement) => {
      const [box, at] = [avatar.querySelector("[data-ouro-avatar-presence]")!.getBoundingClientRect(), avatar.getBoundingClientRect()];
      return [box.left - at.left, box.top - at.top, box.width, box.height];
    };
    expect(dot(busy)).toEqual(dot((await render(<Avatar name="Ana Lind" presence="busy" presenceLabel="Busy" />)).avatar));
    expect(busy.querySelector("[data-ouro-avatar-presence]")!.checkVisibility()).toBe(true);
    expect((await render(<Avatar name={null} alt="" />)).avatar.getAttribute("aria-hidden")).toBe("true");
    expect(warn).not.toHaveBeenCalled();
  });
});

// Colors as the browser resolves them, through a 1px canvas, as in the theme's contrast test.
type Rgb = [number, number, number];
const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
const context = canvas.getContext("2d", { willReadFrequently: true })!;
function toRgb(color: string): Rgb {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}
const luminance = ([r, g, b]: Rgb) => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** A theme variable's color, as the page resolves it. */
function token(name: string): string {
  const probe = document.createElement("i");
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

const names = Array.from({ length: 48 }, (_, index) => `Person ${index} Example`);

describe("Avatar colors", () => {
  afterEach(() => document.documentElement.classList.remove("dark"));

  it("picks the same hue for the same name, and spreads names across the hues", async () => {
    const { host } = await render(
      <>
        {names.map((name) => (
          <Avatar key={name} name={name} />
        ))}
        <Avatar name="Ana Lind" />
        <Avatar name="  ana lind " />
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    const backgrounds = avatars.map((avatar) => getComputedStyle(avatar).backgroundColor);
    expect(new Set(backgrounds.slice(0, names.length)).size).toBe(8);
    expect(backgrounds.at(-1)).toBe(backgrounds.at(-2));
    expect(backgrounds).not.toContain(token("secondary"));
  });

  it("maps each name to its hue, the same in every browser and on the server", async () => {
    // FNV-1a over the trimmed, lowercased name, mixed by MurmurHash3's finalizer, scaled from its top bits to the eight hues.
    const expected = [
      ["Jean Sammet", 1],
      ["Ana Lind", 2],
      ["Alan Turing", 3],
      ["Dennis Ritchie", 4],
      ["Grace Hopper", 5],
      ["Radia Perlman", 6],
      ["Katherine Johnson", 7],
      ["Ken Thompson", 8],
      ["Lynn Conway", 1],
      ["Edsger Dijkstra", 5],
      ["Sophie Wilson", 3],
      ["😀 Smile", 4],
      ["Émile Zola", 6],
    ] as const;
    const { host } = await render(
      <>
        {expected.map(([name]) => (
          <Avatar key={name} name={name} />
        ))}
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    for (const [index, [, hue]] of expected.entries()) {
      const probe = document.createElement("i");
      probe.style.backgroundColor = `color-mix(in oklab, var(--avatar-${hue}) 18%, var(--background))`;
      probe.style.color = `color-mix(in oklab, var(--avatar-${hue}) 70%, var(--foreground))`;
      document.body.append(probe);
      const want = getComputedStyle(probe);
      expect(getComputedStyle(avatars[index]!).backgroundColor).toBe(want.backgroundColor);
      expect(getComputedStyle(avatars[index]!).color).toBe(want.color);
      probe.remove();
    }
  });

  it("spreads ids that differ only in their last character across the hues", async () => {
    const sequential = Array.from({ length: 16 }, (_, index) => `user-${String(index).padStart(4, "0")}`);
    const hex = Array.from({ length: 16 }, (_, index) => `8f14e45f-ceea-467f-a0e6-00000000000${index.toString(16)}`);
    const { host } = await render(
      <>
        {[...sequential, ...hex].map((id) => (
          <Avatar key={id} name="Jo Park" idForColor={id} />
        ))}
      </>,
    );
    const backgrounds = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')].map((avatar) => getComputedStyle(avatar).backgroundColor);
    expect(new Set(backgrounds.slice(0, 16)).size).toBe(8);
    expect(new Set(backgrounds.slice(16)).size).toBe(6);
  });

  it("picks the hue from idForColor when given, so one name can take two colors", async () => {
    const { host } = await render(
      <>
        {names.slice(0, 8).map((name) => (
          <Avatar key={name} name="Jo Park" idForColor={name} />
        ))}
      </>,
    );
    const backgrounds = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')].map((avatar) => getComputedStyle(avatar).backgroundColor);
    expect(new Set(backgrounds).size).toBeGreaterThan(1);
  });

  it.each(["light", "dark"] as const)("keeps the initials at least 4.5:1 on every hue and on brand (%s)", async (scheme) => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    const { host } = await render(
      <>
        {names.map((name) => (
          <Avatar key={name} name={name} />
        ))}
        <Avatar name="Ana Lind" color="brand" />
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    for (const avatar of avatars) {
      const style = getComputedStyle(avatar);
      expect(ratio(toRgb(style.color), toRgb(style.backgroundColor))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("tints with the theme's primary for brand, and uses the secondary surface for neutral", async () => {
    const { host } = await render(
      <>
        <Avatar name="Ana Lind" color="brand" />
        <Avatar name="Ana Lind" color="neutral" />
      </>,
    );
    const [brand, neutral] = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')].map((avatar) => getComputedStyle(avatar));
    const probe = document.createElement("i");
    probe.style.backgroundColor = "color-mix(in oklab, var(--primary) 18%, var(--background))";
    probe.style.color = "color-mix(in oklab, var(--primary) 70%, var(--foreground))";
    document.body.append(probe);
    expect(brand!.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    expect(brand!.color).toBe(getComputedStyle(probe).color);
    probe.remove();
    expect(neutral!.backgroundColor).toBe(token("secondary"));
    expect(neutral!.color).toBe(token("secondary-foreground"));
  });
});

describe("Avatar shapes and icons", () => {
  it("draws a team's second edge and an agent's hairline, and the agent's glyph takes only the tint's ink", async () => {
    const { host } = await render(
      <>
        <Avatar name="Design reviews" shape="square" size="lg" />
        <Avatar name="Halden" shape="agent" color="brand" size="lg" />
        <Avatar name="Halden" shape="circle" color="brand" size="lg" />
        <Avatar name={null} shape="agent" color="brand" size="lg" />
      </>,
    );
    const [square, agent, circle, loading] = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    expect(getComputedStyle(square!, "::before").content).toBe('""');
    expect(getComputedStyle(agent!, "::after").content).toBe('""');
    expect(getComputedStyle(agent!).color).toBe(getComputedStyle(circle!).color);
    expect(getComputedStyle(agent!).backgroundColor).not.toBe(getComputedStyle(circle!).backgroundColor);
    expect(getComputedStyle(loading!).color).not.toBe(getComputedStyle(agent!).color);
  });

  it("is a circle by default and a rounded square for a team", async () => {
    const { host } = await render(
      <>
        <Avatar name="Ana Lind" size="lg" />
        <Avatar name="Design reviews" shape="square" size="lg" />
      </>,
    );
    const [circle, square] = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    expect(circle!.getAttribute("data-shape")).toBe("circle");
    expect(square!.getAttribute("data-shape")).toBe("square");
    expect(parseFloat(getComputedStyle(circle!).borderTopLeftRadius)).toBeGreaterThanOrEqual(24);
    const corner = parseFloat(getComputedStyle(square!).borderTopLeftRadius);
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeLessThan(34);
    expect(getComputedStyle(circle!).borderTopLeftRadius).toBe("34%");
    expect(getComputedStyle(square!).borderTopLeftRadius).toBe("24%");
    for (const plain of [circle!, square!]) {
      expect(getComputedStyle(plain, "::after").borderTopWidth).not.toBe("1px");
      expect(getComputedStyle(plain).backgroundColor).not.toBe("rgb(255, 255, 255)");
    }
  });

  it("draws an agent as a tile at every size, its initials and picture inside it", async () => {
    const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
    const { host } = await render(
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {sizes.map((size) => (
          <Avatar key={size} name="Halden Agent" shape="agent" size={size} />
        ))}
        <Avatar name="Halden Agent" shape="agent" size="xl" src={photo} />
      </div>,
    );
    await expect.poll(() => host.querySelector("img")).not.toBeNull();
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    for (const avatar of avatars) {
      expect(avatar.getAttribute("data-shape")).toBe("agent");
      expect(getComputedStyle(avatar).borderTopLeftRadius).toBe("24%");
    }
    for (const avatar of avatars.slice(0, -1)) {
      const box = avatar.getBoundingClientRect();
      const letters = avatar.querySelector<HTMLElement>("[data-ouro-avatar-initials]")!.getBoundingClientRect();
      expect(drawn(avatar)).toBe("HA");
      expect(Math.abs(letters.left + letters.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(letters.top + letters.height / 2 - (box.top + box.height / 2))).toBeLessThanOrEqual(0.5);
    }
    const picture = avatars.at(-1)!;
    expect(picture.querySelector("img")!.getBoundingClientRect().width).toBe(picture.getBoundingClientRect().width);
  });

  it("shows no presence on a square, and names the fix", async () => {
    const { avatar } = await render(<Avatar name="Design reviews" shape="square" presence="available" presenceLabel="Available" />);
    expect(avatar.querySelector("[data-ouro-avatar-presence]")).toBeNull();
    expect(avatar.hasAttribute("data-presence")).toBe(false);
    expect(avatar.getAttribute("aria-label")).toBe("Design reviews");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Avatar: a team shows no presence, so a square draws no dot. Fix: <Avatar name="Design reviews" shape="square" />.');
  });

  it("gives an agent a presence dot, like a person", async () => {
    const { avatar } = await render(<Avatar name="Halden" shape="agent" presence="busy" presenceLabel="Busy" />);
    expect(avatar.querySelector("[data-ouro-avatar-presence]")).not.toBeNull();
    expect(avatar.getAttribute("aria-label")).toBe("Halden, Busy");
    expect(warn).not.toHaveBeenCalled();
  });

  it("asks nothing of a square without presence, or of an agent or a circle with it", async () => {
    await render(
      <>
        <Avatar name="Design reviews" shape="square" />
        <Avatar name="Ana Lind" presence="busy" presenceLabel="Busy" />
        <Avatar name="Halden" shape="agent" presence="away" presenceLabel="Away" />
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("clips a square's picture to its corners", async () => {
    const { avatar } = await render(<Avatar name="Design reviews" shape="square" src={photo} />);
    await expect.poll(() => avatar.querySelector("img")).not.toBeNull();
    expect(getComputedStyle(avatar.querySelector("img")!).borderTopLeftRadius).toBe(getComputedStyle(avatar).borderTopLeftRadius);
  });

  it("shows an icon instead of initials, keeping the name for screen readers", async () => {
    const { avatar } = await render(
      <Avatar
        name="Weekly sync"
        color="brand"
        icon={
          <svg data-testid="calendar" viewBox="0 0 20 20">
            <rect width="20" height="20" />
          </svg>
        }
      />,
    );
    expect(avatar.textContent).toBe("");
    expect(drawn(avatar)).toBe("");
    expect(avatar.getAttribute("aria-label")).toBe("Weekly sync");
    const icon = avatar.querySelector<SVGElement>('[data-testid="calendar"]')!;
    expect(icon.getBoundingClientRect().width).toBe(22);
    // Centered in the avatar.
    const box = avatar.getBoundingClientRect();
    const mark = icon.getBoundingClientRect();
    expect(mark.left - box.left).toBeCloseTo(box.right - mark.right, 0);
    expect(mark.top - box.top).toBeCloseTo(box.bottom - mark.bottom, 0);
  });

  it("shows the initials when the icon is null", async () => {
    const { avatar } = await render(<Avatar name="Weekly sync" icon={null} />);
    expect(drawn(avatar)).toBe("WS");
    expect(avatar.querySelector("[data-ouro-avatar-initials]")).not.toBeNull();
  });
});

describe("Avatar presence", () => {
  it.each(["light", "dark"] as const)("keeps the initials 4.5:1 beside every presence dot at every size, wherever the avatar lands on the pixel grid (%s)", async (scheme) => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    const { host } = await render(
      <>
        {[0, 0.25, 0.5, 0.75].map((offset) => (
          <div key={offset} style={{ display: "flex", gap: 12, alignItems: "center", paddingTop: offset, paddingLeft: offset }}>
            {(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const).flatMap((size) =>
              (["available", "away", "busy", "out-of-office"] as const).map((presence) => (
                <Avatar key={size + presence} name="Mona Example" initials="MW" idForColor="person-0101" size={size} presence={presence} presenceLabel={presence} />
              )),
            )}
          </div>
        ))}
      </>,
    );
    // axe measures the contrast of text, and the initials are drawn, so it measures them written
    // as text: "draws its letters exactly as written text" proves the two paint the same pixels.
    const copy = written(host);
    host.after(copy);
    mounted.push(copy);
    host.hidden = true;
    expect(copy.querySelectorAll("[data-ouro-avatar-initials]").length).toBe(4 * 7 * 4);
    try {
      expect(describeFindings(await audit({ include: [copy] }))).toBe("");
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it.each(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const)("keeps the initials in the middle with or without a dot, and the dot off them (%s)", async (size) => {
    const { host } = await render(
      <>
        {["CN", "PA", "NL", "C", "MW", "WW"].flatMap((initials) => [
          <Avatar key={initials} name="Mona Example" initials={initials} size={size} />,
          <Avatar key={`${initials} busy`} name="Mona Example" initials={initials} size={size} presence="busy" presenceLabel="Busy" />,
        ])}
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    expect(avatars.filter((avatar) => avatar.hasAttribute("data-presence"))).toHaveLength(6);
    const fontSize = parseFloat(getComputedStyle(avatars[0]!).fontSize);
    for (const avatar of avatars) {
      const box = avatar.getBoundingClientRect();
      const letters = avatar.querySelector<HTMLElement>("[data-ouro-avatar-initials]")!.getBoundingClientRect();
      const where = `${size} ${drawn(avatar)}${avatar.dataset["presence"] ? " with a dot" : ""}: letters ${JSON.stringify(letters)} avatar ${JSON.stringify(box)}`;
      // The initials' box runs from the top of the capitals to the baseline (a cap height, under
      // 0.8em in any font, where the line would be at least 1em), so its middle is the letters' own.
      expect(letters.height / fontSize, where).toBeGreaterThan(0.6);
      expect(letters.height / fontSize, where).toBeLessThan(0.8);
      expect(Math.abs(letters.left + letters.width / 2 - (box.left + box.width / 2)), where).toBeLessThanOrEqual(0.5);
      expect(Math.abs(letters.top + letters.height / 2 - (box.top + box.height / 2)), where).toBeLessThanOrEqual(0.5);
      const dot = avatar.querySelector("[data-ouro-avatar-presence]")?.getBoundingClientRect();
      if (dot) expect(dot.top, where).toBeGreaterThanOrEqual(letters.bottom);
    }
  });

  it("keeps an icon and a picture in the middle with a dot, as without one", async () => {
    const icon = (
      <svg viewBox="0 0 20 20">
        <rect width="20" height="20" />
      </svg>
    );
    const { host } = await render(
      <>
        <Avatar name="Weekly sync" icon={icon} size="lg" />
        <Avatar name="Weekly sync" icon={icon} size="lg" presence="away" presenceLabel="Away" />
        <Avatar name="Ana Lind" src={photo} size="lg" />
        <Avatar name="Ana Lind" src={photo} size="lg" presence="away" presenceLabel="Away" />
      </>,
    );
    await expect.poll(() => host.querySelectorAll('[data-ouro="avatar"][data-image="loaded"]').length).toBe(2);
    const [plainIcon, dotIcon, plainPhoto, dotPhoto] = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')].map((avatar) => {
      const box = avatar.getBoundingClientRect();
      const mark = avatar.querySelector("svg, img")!.getBoundingClientRect();
      return { left: mark.left - box.left, top: mark.top - box.top, width: mark.width, height: mark.height };
    });
    expect(dotIcon).toEqual(plainIcon);
    expect(plainIcon!.left).toBeCloseTo((48 - plainIcon!.width) / 2, 1);
    expect(plainIcon!.top).toBeCloseTo((48 - plainIcon!.height) / 2, 1);
    expect(dotPhoto).toEqual(plainPhoto);
    expect(plainPhoto).toEqual({ left: 0, top: 0, width: 48, height: 48 });
  });

  const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;

  it("says the presence after the name, and alone when the name is written beside it", async () => {
    const { host } = await render(
      <>
        <Avatar name="Ana Lind" presence="busy" presenceLabel="In a meeting" />
        <Avatar name="Ana Lind" alt="" presence="busy" presenceLabel="In a meeting" />
      </>,
    );
    const [named, beside] = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    expect(named!.getAttribute("aria-label")).toBe("Ana Lind, In a meeting");
    expect(named!.getAttribute("data-presence")).toBe("busy");
    expect(beside!.getAttribute("role")).toBe("img");
    expect(beside!.getAttribute("aria-label")).toBe("In a meeting");
    await expect.element(page.getByRole("img", { name: "Ana Lind, In a meeting" })).toBeVisible();
  });

  it("sits on the lower end corner at every size, with a ring in the surface's color", async () => {
    const { host } = await render(
      <>
        {sizes.map((size) => (
          <Avatar key={size} name="Ana Lind" size={size} presence="available" presenceLabel="Available" />
        ))}
      </>,
    );
    const avatars = [...host.querySelectorAll<HTMLElement>('[data-ouro="avatar"]')];
    const dots = avatars.map((avatar) => avatar.querySelector<HTMLElement>("[data-ouro-avatar-presence]")!);
    const widths = dots.map((dot) => dot.getBoundingClientRect().width);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    for (const [index, avatar] of avatars.entries()) {
      const box = avatar.getBoundingClientRect();
      const dot = dots[index]!.getBoundingClientRect();
      // A third to a sixth of the avatar, its center near the circle's edge at the corner.
      expect(dot.width / box.width).toBeGreaterThan(0.24);
      expect(dot.width / box.width).toBeLessThan(0.42);
      expect(dot.height).toBe(dot.width);
      const radius = box.width / 2;
      const center = { x: dot.left + dot.width / 2 - (box.left + radius), y: dot.top + dot.height / 2 - (box.top + radius) };
      expect(Math.abs(Math.hypot(center.x, center.y) - radius)).toBeLessThan(radius * 0.25);
      expect(center.x).toBeGreaterThan(0);
      expect(center.y).toBeGreaterThan(0);
      expect(getComputedStyle(dots[index]!).backgroundColor).toBe(token("background"));
      // The glyph fills the dot inside the ring.
      const glyph = dots[index]!.querySelector("svg")!.getBoundingClientRect();
      expect(glyph.width).toBeLessThan(dot.width);
      expect(glyph.width).toBeGreaterThanOrEqual(dot.width - 6);
    }
  });

  it("takes the ring's color from --ouro-avatar-ring, as on a card", async () => {
    const { host } = await render(
      <div style={{ "--ouro-avatar-ring": "var(--card)" } as CSSProperties}>
        <Avatar name="Ana Lind" presence="away" presenceLabel="Away" />
      </div>,
    );
    expect(getComputedStyle(host.querySelector<HTMLElement>("[data-ouro-avatar-presence]")!).backgroundColor).toBe(token("card"));
  });

  it("moves to the other corner right to left", async () => {
    const { host } = await render(
      <div dir="rtl">
        <Avatar name="Ana Lind" presence="available" presenceLabel="Available" />
      </div>,
    );
    const box = host.querySelector<HTMLElement>('[data-ouro="avatar"]')!.getBoundingClientRect();
    const dot = host.querySelector<HTMLElement>("[data-ouro-avatar-presence]")!.getBoundingClientRect();
    expect(dot.left + dot.width / 2).toBeLessThan(box.left + box.width / 2);
  });

  it("draws each state in its own shape and tone", async () => {
    const states = [
      ["available", "success"],
      ["busy", "destructive"],
      ["do-not-disturb", "destructive"],
      ["away", "warning"],
      ["offline", "muted-foreground"],
      ["out-of-office", "primary"],
    ] as const;
    const { host } = await render(
      <>
        {states.map(([presence]) => (
          <Avatar key={presence} name="Ana Lind" presence={presence} presenceLabel={presence} />
        ))}
      </>,
    );
    const glyphs = [...host.querySelectorAll<HTMLElement>("[data-ouro-avatar-presence] svg")];
    expect(glyphs).toHaveLength(states.length);
    // Every state draws different marks, so none relies on color alone.
    expect(new Set(glyphs.map((glyph) => glyph.innerHTML.replace(/ class="[^"]*"/g, ""))).size).toBe(states.length);
    for (const [index, [presence, tone]] of states.entries()) {
      const glyph = glyphs[index]!;
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.getAttribute("focusable")).toBe("false");
      const circle = glyph.querySelector("circle")!;
      const style = getComputedStyle(circle);
      const ring = style.fill === "none";
      expect(ring).toBe(presence === "offline" || presence === "out-of-office");
      expect(ring ? style.stroke : style.fill).toBe(token(tone));
      // The circle fills the glyph's box: the drawing is scaled to the dot.
      const disc = circle.getBoundingClientRect();
      const frame = glyph.getBoundingClientRect();
      expect(disc.width).toBeGreaterThan(frame.width * (ring ? 0.8 : 0.95));
      // The marks on it are rounded strokes in the tone's foreground (or the tone, on a ring), never filled.
      for (const mark of glyph.querySelectorAll("path")) {
        const line = getComputedStyle(mark);
        expect(line.fill).toBe("none");
        expect(line.strokeLinecap).toBe("round");
        expect(line.strokeLinejoin).toBe("round");
        expect(line.stroke).toBe(token(ring ? tone : `${tone}-foreground`));
        const drawn = mark.getBBox();
        expect(Math.max(drawn.width, drawn.height)).toBeGreaterThan(4);
      }
      expect(glyph.querySelectorAll("path")).toHaveLength(presence === "busy" ? 0 : 1);
    }
  });

  it("renders the dot in server HTML", () => {
    const html = renderToString(<Avatar name="Ana Lind" presence="do-not-disturb" presenceLabel="Do not disturb" shape="agent" />);
    expect(html).toContain('aria-label="Ana Lind, Do not disturb"');
    expect(html).toContain('data-presence="do-not-disturb"');
    expect(html).toContain("data-ouro-avatar-presence");
  });
});

describe("AvatarGroup", () => {
  const cooks = ["Ana Lind", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Edsger Dijkstra"];

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
    expect(more.textContent).toBe("2 more");
    expect(drawn(more)).toBe("+2");
    expect(more.querySelector("[aria-hidden]")!.textContent).toBe("");
    await expect.element(page.getByRole("group", { name: "Cooks" })).toBeVisible();
  });

  it("counts from total when more people exist than avatars passed", async () => {
    const { group } = await render(
      <AvatarGroup label="Members" total={120} moreLabel={(count) => `${count} weitere`}>
        <Avatar name="Ana Lind" />
        <Avatar name="Grace Hopper" />
      </AvatarGroup>,
    );
    const more = group.querySelector<HTMLElement>("[data-ouro-avatar-more]")!;
    expect(more.textContent).toBe("118 weitere");
    expect(drawn(more)).toBe("+118");
  });

  it("passes its size to every avatar and the count", async () => {
    const { group } = await render(
      <AvatarGroup label="Cooks" size="lg" max={1}>
        <Avatar name="Ana Lind" />
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
        <Avatar name="Ana" />
      </AvatarGroup>,
    );
    expect(element).toBe(group);
    expect(getComputedStyle(group).marginTop).toBe("16px");
  });
});

describe("Avatar development messages", () => {
  it.each([
    ["children", { children: "AL" }, "Avatar takes name and initials, not children", '<Avatar name="Ana Lind" initials="AL" />'],
    ["fallback", { fallback: "AL" }, "fallback is not a prop", '<Avatar name="Ana Lind" initials="AL" />'],
    ["size", { size: "4xl" }, 'size="4xl" is not a size; use "xs", "sm", "md", "lg", "xl", "2xl", "3xl"', '<Avatar size="3xl">'],
    ["a numeric size", { size: 40 }, "size={40} is not a size; use \"xs\", \"sm\", \"md\", \"lg\", \"xl\", \"2xl\", \"3xl\"", '<Avatar size="md">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { name: "Ana Lind", ...extra } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Avatar: ${problem}. Fix: ${fix}.`);
    expect(drawn(avatar)).toBe("AL");
    expect(avatar.getBoundingClientRect().width).toBe(40);
  });

  it.each([
    ["shape", { shape: "rounded" }, 'shape="rounded" is not a shape; use "circle", "square", "agent"', '<Avatar shape="square">'],
    ["hexagon shape", { shape: "hexagon" }, 'shape="hexagon" is not a shape; use "circle", "square", "agent"', '<Avatar shape="agent">'],
    ["color", { color: "blue" }, 'color="blue" is not a color; use "colorful", "brand", "neutral"', '<Avatar color="colorful">'],
    [
      "presence",
      { presence: "dnd", presenceLabel: "Do not disturb" },
      'presence="dnd" is not a presence; use "available", "busy", "away", "do-not-disturb", "offline", "out-of-office"',
      '<Avatar presence="do-not-disturb" presenceLabel="Do not disturb">',
    ],
  ])("renders the default for an unknown %s, with the fix", async (_name, extra, problem, fix) => {
    const props = { name: "Ana Lind", ...extra } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Avatar: ${problem}. Fix: ${fix}.`);
    expect(avatar.getAttribute("data-shape")).toBe("circle");
    expect(avatar.hasAttribute("data-presence")).toBe(false);
    expect(avatar.querySelector("[data-ouro-avatar-presence]")).toBeNull();
    expect(avatar.getAttribute("aria-label")).toBe("Ana Lind");
  });

  it("names the presence label when it is missing, and still speaks the presence", async () => {
    const props = { name: "Ana Lind", presence: "out-of-office" } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Avatar: presenceLabel is missing, so screen readers hear no presence. Fix: <Avatar presence="out-of-office" presenceLabel="Out of office">.',
    );
    expect(avatar.getAttribute("aria-label")).toBe("Ana Lind, out of office");
  });

  it("warns once when name is missing", async () => {
    const props = { src: photo } as unknown as Parameters<typeof Avatar>[0];
    const { avatar } = await render(<Avatar {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Avatar: name is missing, so screen readers hear nothing. Fix: <Avatar name="Ana Lind" src={url} />.');
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["max", { max: 0 }, "max={0} hides every avatar", "<AvatarGroup max={3}>"],
    ["total", { total: 0, children: [<Avatar key="a" name="Ana Lind" />, <Avatar key="g" name="Grace Hopper" />] }, "total={0} is less than the 2 avatars passed", "<AvatarGroup total={2}>"],
    ["children", { children: "Ana" }, "AvatarGroup holds Avatars", '<AvatarGroup label="Cooks"><Avatar name="Ana Lind" /></AvatarGroup>'],
    ["size", { size: "huge" }, 'size="huge" is not a size; use "xs", "sm", "md", "lg", "xl", "2xl", "3xl"', '<AvatarGroup size="md">'],
  ])("warns for an AvatarGroup %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Cooks", children: <Avatar name="Ana Lind" />, ...extra } as unknown as Parameters<typeof AvatarGroup>[0];
    await render(<AvatarGroup {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] AvatarGroup: ${problem}. Fix: ${fix}.`);
  });

  it.each([
    ["rounded-md", 'shape="square"'],
    ["rounded-none", 'shape="square"'],
    ["bg-blue-500", 'remove "bg-blue-500"; Avatar colors its initials from the name, or pass color="neutral"'],
    ["text-lg", 'size="lg"'],
    ["size-12", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Avatar name="Ana" className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Avatar: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("checks the AvatarGroup className", async () => {
    await render(
      <AvatarGroup label="Cooks" className="bg-muted">
        <Avatar name="Ana" />
      </AvatarGroup>,
    );
    expect(warn).toHaveBeenCalledWith('[ouro-ui] AvatarGroup: "bg-muted" sets appearance, and className is for layout only. Fix: <div className="bg-muted"><AvatarGroup /></div>.');
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <AvatarGroup label="Cooks" max={1} className="bg-muted">
        <Avatar name="Ana Lind" className="bg-red-500" />
        <Avatar name="Grace Hopper" />
      </AvatarGroup>,
    );
    expect(html).toContain('data-ouro="avatar-group"');
    expect(html).toContain("+1");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

const people = ["Ana Lind", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Edsger Dijkstra"];

describe("Avatar inside a link or button that has its own name", () => {
  // What a speech-input user can say to press a control must be in its name (WCAG 2.5.3, Label in
  // Name). axe's label-content-name-mismatch reads every text node a control shows, aria-hidden
  // ones and SVG text included, so the initials are drawn, not written.
  async function labelInName(node: Element): Promise<string[]> {
    const result = await axe.run({ include: [node] }, { runOnly: ["label-content-name-mismatch"], resultTypes: ["violations", "incomplete"] });
    return [...result.violations, ...result.incomplete].flatMap((rule) => rule.nodes.map(() => rule.id));
  }

  it.each([
    ["its initials", <Avatar key="a" name="Ana Lind" />],
    ["its initials with alt=\"\"", <Avatar key="a" name="Ana Lind" alt="" />],
    ["initials it is given", <Avatar key="a" name="Ana Lind" initials="AnL" />],
    ["its initials and a presence dot", <Avatar key="a" name="Ana Lind" presence="busy" presenceLabel="In a meeting" />],
    ["a square's initials", <Avatar key="a" name="Ana Lind" shape="square" />],
    ["an agent's tile and initials", <Avatar key="a" name="Ana Lind" shape="agent" />],
    ["its initials after the picture fails", <Avatar key="a" name="Ana Lind" src={broken} />],
  ])("a link named \"Ana Lind's profile\" around %s has no label-content-name-mismatch", async (_case, avatar) => {
    const { host } = await render(
      <a href="#ana" aria-label="Ana Lind's profile">
        {avatar}
      </a>,
    );
    await expect.poll(() => host.querySelector('[data-ouro="avatar"]')!.getAttribute("data-image")).not.toBe("loading");
    expect(drawn(host)).not.toBe("");
    expect(await labelInName(host)).toEqual([]);
  });

  it("a button named for the group around an AvatarGroup and its +N count has no label-content-name-mismatch", async () => {
    const { host } = await render(
      <button type="button" aria-label="See the 5 cooks">
        <AvatarGroup label="Cooks" max={3}>
          {people.map((name) => (
            <Avatar key={name} name={name} />
          ))}
        </AvatarGroup>
      </button>,
    );
    expect(drawn(host.querySelector("[data-ouro-avatar-more]")!)).toBe("+2");
    expect(await labelInName(host)).toEqual([]);
  });

  it("the same link around initials written as text fails the rule, so the check can fail", async () => {
    const { host } = await render(
      <a href="#ana" aria-label="Ana Lind's profile">
        <Avatar name="Ana Lind" />
      </a>,
    );
    expect(await labelInName(host)).toEqual([]);
    const copy = written(host);
    host.after(copy);
    mounted.push(copy);
    expect(await labelInName(copy)).toEqual(["label-content-name-mismatch"]);
  });

  it("names a link with no label of its own by the person's name, not the letters", async () => {
    await render(
      <a href="#ana">
        <Avatar name="Ana Lind" />
      </a>,
    );
    await expect.element(page.getByRole("link", { name: "Ana Lind", exact: true })).toBeVisible();
  });
});

describe("Avatar's drawn letters", () => {
  async function pixels(element: Element): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = new Image();
    image.src = `data:image/png;base64,${await page.screenshot({ save: false, element, animations: "disabled", caret: "initial" })}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  it.each(["light", "dark", "forced colours"] as const)("look exactly as written text did, in every size, shape, color and the group's count (%s)", async (scheme) => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    if (scheme === "forced colours") await commands.emulateMedia({ forcedColors: "active" });
    try {
      const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
      const { host } = await render(
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 4, width: 600, alignItems: "center", background: "var(--background)" }}>
          {sizes.map((size) => (
            <Avatar key={size} name="Grace Hopper" size={size} />
          ))}
          <Avatar name="Ana Lind" shape="square" color="brand" />
          <Avatar name="Halden Agent" shape="agent" color="neutral" size="lg" />
          <Avatar name="Émile Zola" presence="away" presenceLabel="Away" size="xl" />
          <Avatar name="😀 Smile" size="lg" />
          <AvatarGroup label="Cooks" max={2}>
            {people.map((name) => (
              <Avatar key={name} name={name} />
            ))}
          </AvatarGroup>
        </div>,
      );
      // The same element, in the same place, drawn and then written: a copy elsewhere on the page
      // can land its anti-aliasing differently.
      const row = host.firstElementChild!;
      const drawnPixels = await pixels(row);
      write(row);
      expect(row.textContent).toContain("GH");
      const writtenPixels = await pixels(row);
      expect([drawnPixels.width, drawnPixels.height]).toEqual([writtenPixels.width, writtenPixels.height]);
      expect(drawnPixels.data.filter((value, index) => value !== writtenPixels.data[index]).length).toBe(0);
      // And the letters are there to see: the row is not one flat colour.
      expect(new Set(drawnPixels.data.filter((_, index) => index % 4 === 0)).size).toBeGreaterThan(8);
    } finally {
      document.documentElement.classList.remove("dark");
      if (scheme === "forced colours") await commands.emulateMedia({ forcedColors: "none" });
    }
  });
});
