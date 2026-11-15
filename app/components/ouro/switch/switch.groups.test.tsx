import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckboxGroup } from "~/components/ouro/checkbox/checkbox-group";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
import { Switch } from "~/components/ouro/switch/switch";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
const mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
}

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  mounted.splice(0).forEach((node) => node.remove());
});

describe("Switch inside a group of choices", () => {
  it("throws with the fix inside a RadioGroup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <RadioGroup legend="Size">
          <Switch label="Small" />
        </RadioGroup>,
      ),
    ).rejects.toThrow('[ouro-ui] Switch: a RadioGroup takes Radio choices. Fix: <Radio value="small" label="Small" />, or put the Switch outside the group.');
    error.mockRestore();
  });

  it("throws with the fix inside a CheckboxGroup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <CheckboxGroup legend="Notify me">
          <Switch label="Comments" />
        </CheckboxGroup>,
      ),
    ).rejects.toThrow(
      '[ouro-ui] Switch: a CheckboxGroup takes Checkbox choices. Fix: <Checkbox value="comments" label="Comments" />, or put the Switch outside the group.',
    );
    error.mockRestore();
  });
});
