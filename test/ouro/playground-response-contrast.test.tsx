import { afterEach, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import axe from "axe-core";
import { act } from "~/lib/ouro/testing/act";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { ResponsePanel } from "~/routes/developers.playground";

// The playground's Response panel is charcoal. Its HX controls (Copy response, a hidden value's
// copy button and Clear response) take photo-white tokens from the panel, under Spoonjoy's real
// stylesheet: WCAG 1.4.3 for their text, and 1.4.11 for their focus ring.
let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.documentElement.classList.remove("dark");
});

function rgb(value: string): [number, number, number] {
  const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value);
  expect(match, `${value} is an rgb colour`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

for (const theme of ["light", "dark"] as const) {
  it(`${theme}: the Response panel's controls pass contrast on its charcoal`, async () => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    host = document.createElement("main");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <OuroProvider>
          <ResponsePanel
            response={{
              status: 201,
              statusText: "Created",
              requestId: "req_1",
              headers: [{ name: "content-type", value: "application/json" }],
              body: "{\"token\":\"sj_...redacted\"}",
              method: "POST",
              path: "/api/v1/tokens",
              elapsedMs: 12,
              secrets: [{ label: "token", value: "sj_secret" }],
            }}
            onClear={() => {}}
          />
        </OuroProvider>,
      );
    });

    const panel = host.querySelector<HTMLElement>("section.sj-on-charcoal")!;
    const surface = getComputedStyle(panel).backgroundColor;
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(
      expect.arrayContaining(["Copy response", "Copy hidden token value", "Clear response"]),
    );
    for (const button of buttons) {
      expect(contrast(getComputedStyle(button).color, surface), button.textContent ?? "").toBeGreaterThanOrEqual(4.5);
      button.focus();
      expect(contrast(getComputedStyle(button).outlineColor, surface), `${button.textContent} focus ring`).toBeGreaterThanOrEqual(3);
    }

    const results = await axe.run(panel, { runOnly: { type: "rule", values: ["color-contrast"] } });
    expect(results.violations).toEqual([]);
  });
}
