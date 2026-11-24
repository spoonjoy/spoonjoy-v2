import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "~/components/ouro/button/button";
import { act } from "~/lib/ouro/testing/act";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

describe("Button label", () => {
  it("is no containing block, so an absolutely placed child anchors to the button", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <Button>
          Places
          <span data-testid="pill" style={{ position: "absolute", top: 0, right: 0, width: 10, height: 10 }} />
        </Button>,
      ),
    );
    const button = host.querySelector<HTMLElement>('[data-ouro="button"]')!;
    const label = button.querySelector<HTMLElement>('[data-slot="button-label"]')!;
    const pill = host.querySelector<HTMLElement>('[data-testid="pill"]')!;
    expect(getComputedStyle(label).position).toBe("static");
    expect(pill.getBoundingClientRect().right).toBeCloseTo(button.getBoundingClientRect().right - parseFloat(getComputedStyle(button).borderRightWidth), 0);
    expect(getComputedStyle(label).isolation).toBe("isolate");
  });
});
