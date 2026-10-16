import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ToastProvider, useToast } from "~/components/feedback/toast";
import { DockContextProvider } from "~/components/navigation/dock-context";
import { MobileNav } from "~/components/navigation/mobile-nav";
import { act } from "~/lib/ouro/testing/act";

function FeedbackTrigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast({ message: "Dock clearance measurement", durationMs: 0 })}>
      Measure feedback
    </button>
  );
}

// A factual diagnostic, not a claim that the dock clears the toast. The published
// Toaster has no offset API; retain measured evidence for the parent's API decision.
it("records real phone toast/dock rectangles and navigation hit targets for T11-M1", async ({ annotate }) => {
  await page.viewport(390, 844);
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/"]}>
        <DockContextProvider>
          <ToastProvider><FeedbackTrigger /><MobileNav /></ToastProvider>
        </DockContextProvider>
      </MemoryRouter>,
    ));
    await userEvent.click(page.getByRole("button", { name: "Measure feedback" }));
    const toast = () => document.querySelector<HTMLElement>('[data-ouro="toast"]');
    await expect.poll(() => {
      const element = toast();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    }).toBe(true);
    const nav = page.getByRole("navigation", { name: "Spoonjoy navigation" }).element();
    const toastBox = toast()!.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const links = [...nav.querySelectorAll("a")];
    expect(links).toHaveLength(5);
    expect(toastBox.width).toBeGreaterThan(0);
    expect(navBox.height).toBeGreaterThan(0);
    const hits = links.map((link) => {
      const box = link.getBoundingClientRect();
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const actual = document.elementFromPoint(point.x, point.y);
      return {
        href: link.getAttribute("href"),
        point,
        receivesCenterHit: actual !== null && link.contains(actual),
        centerHitInToast: Boolean(actual?.closest('[data-ouro="toast"]')),
      };
    });
    await annotate(`T11_M1_LAYOUT ${JSON.stringify({
      viewport: { width: innerWidth, height: innerHeight },
      toast: toastBox.toJSON(),
      dock: navBox.toJSON(),
      clearsDock: toastBox.bottom <= navBox.top,
      hits,
    })}`, "info");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
