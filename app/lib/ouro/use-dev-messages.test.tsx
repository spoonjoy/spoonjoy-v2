import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { act } from "~/lib/ouro/testing/act";

function Probe({ wrong = false }: { wrong?: boolean }) {
  useDevWarnings("Probe", () => [wrong && ["wrong is not a prop", "<Probe>"]]);
  return <span>probe</span>;
}

const root = document.documentElement;
const checkAgain = () => delete (window as unknown as Record<symbol, unknown>)[Symbol.for("ouro-ui.theme-checked")];
let mounted: Root | undefined;
let warn: ReturnType<typeof vi.spyOn>;

async function render(node: React.ReactNode) {
  mounted = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => mounted!.render(node));
}

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = undefined;
  vi.restoreAllMocks();
  root.style.removeProperty("--ouro-layer");
  document.body.replaceChildren();
});

describe("useDevWarnings", () => {
  it("logs each message a component collects once per instance, after render", async () => {
    await render(<Probe wrong />);
    await act(async () => mounted!.render(<Probe wrong />));
    expect(warn.mock.calls).toEqual([["[ouro-ui] Probe: wrong is not a prop. Fix: <Probe>."]]);
  });

  it("says nothing about the theme on a page that has ouro-base", async () => {
    checkAgain();
    await render(<Probe />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tells a page without ouro-base the command to add it, when the first component mounts and not again", async () => {
    checkAgain();
    root.style.setProperty("--ouro-layer", "initial");
    await render(<Probe />);
    await render(<Probe />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[ouro-ui\] theme: ouro-base is not in this page's CSS .+ Fix: npx shadcn@latest add ourostack\/ouro-ui\/ouro-base#v\d+\.\d+\.\d+\.$/);
  });
});
