import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "~/lib/ouro/testing/act";
import { TouchTarget } from "~/lib/ouro/touch-target";

const roots: Root[] = [];
const hosts: HTMLElement[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  hosts.splice(0).forEach((host) => host.remove());
});

/** A 28×20 control, a list row's more button's size, holding a TouchTarget; its hit area. */
async function hitArea(fine?: boolean) {
  const host = document.createElement("button");
  Object.assign(host.style, { position: "relative", width: "28px", height: "20px", padding: "0", margin: "40px", border: "0" });
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(fine === undefined ? <TouchTarget /> : <TouchTarget fine={fine} />));
  return host.querySelector<HTMLElement>("[data-ouro-touch-target]")!;
}

describe("TouchTarget with a mouse", () => {
  it("draws no box by default, so a dense layout keeps its exact hit areas", async () => {
    expect(getComputedStyle(await hitArea()).display).toBe("none");
  });

  it("with fine, covers at least 24px each way around a smaller control", async () => {
    const box = (await hitArea(true)).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});
