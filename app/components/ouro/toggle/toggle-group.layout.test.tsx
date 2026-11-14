import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ToggleGroup } from "~/components/ouro/toggle/toggle-group";
import { act } from "~/lib/ouro/testing/act";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";

const roots: Root[] = [];
const hosts: Element[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  hosts.splice(0).forEach((host) => host.remove());
});

describe("ToggleGroup layout reads", () => {
  const chat = ["all", "mine", "unread", "pinned", "archived", "muted"].map((value) => ({ value, label: value }));

  it("reads no computed style while its items mount or its value changes", async () => {
    // The development theme check reads a style once per page, on the first component to mount.
    const warm = createRoot(document.createElement("div"));
    await act(async () => warm.render(<ToggleGroup label="Warm" items={chat} value="all" onValueChange={() => {}} />));
    await act(async () => warm.unmount());
    const watch = watchLayoutReads();
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ToggleGroup label="Chat filter" items={chat} value="all" onValueChange={() => {}} />));
    await act(async () => root.render(<ToggleGroup label="Chat filter" items={chat} value="mine" onValueChange={() => {}} />));
    expect(watch.names().filter((name) => name === "getComputedStyle")).toEqual([]);
  });
});
