import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ToastProvider, useToast } from "~/components/feedback/toast";
import { DockContextProvider, useDockSuppressed } from "~/components/navigation/dock-context";
import { MobileNav } from "~/components/navigation/mobile-nav";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

function FeedbackTrigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast({ message: "Dock clearance measurement", durationMs: 0 })}>
      Measure feedback
    </button>
  );
}

function SuppressedPage({ suppressed }: { suppressed: boolean }) {
  useDockSuppressed(suppressed);
  return <FeedbackTrigger />;
}

// Regression mutation: missing dock-aware placement overlays the real navigation
// at 390px and in the library-sm/app-lg mismatch band, intercepting its links.
const scenarios = [
  { width: 390, path: "/", authenticated: true, suppressed: false, direction: "ltr", dock: true, links: 5 },
  { width: 768, path: "/", authenticated: true, suppressed: false, direction: "ltr", dock: true, links: 5 },
  { width: 1023, path: "/", authenticated: true, suppressed: false, direction: "ltr", dock: true, links: 5 },
  { width: 1024, path: "/", authenticated: true, suppressed: false, direction: "ltr", dock: false, links: 0 },
  { width: 390, path: "/", authenticated: true, suppressed: false, direction: "rtl", dock: true, links: 5 },
  { width: 768, path: "/", authenticated: true, suppressed: false, direction: "rtl", dock: true, links: 5 },
  { width: 390, path: "/", authenticated: false, suppressed: false, direction: "ltr", dock: true, links: 4 },
  { width: 390, path: "/login", authenticated: false, suppressed: false, direction: "ltr", dock: false, links: 0 },
  { width: 768, path: "/signup", authenticated: false, suppressed: false, direction: "ltr", dock: false, links: 0 },
  { width: 390, path: "/recipes/new", authenticated: true, suppressed: false, direction: "ltr", dock: false, links: 0 },
  { width: 768, path: "/oauth/authorize", authenticated: true, suppressed: false, direction: "ltr", dock: false, links: 0 },
  { width: 390, path: "/", authenticated: true, suppressed: true, direction: "ltr", dock: false, links: 0 },
  { width: 768, path: "/", authenticated: true, suppressed: true, direction: "ltr", dock: false, links: 0 },
] as const;
for (const scenario of scenarios) {
it(`clears actual dock without unused clearance: ${scenario.width} ${scenario.path} auth=${scenario.authenticated} suppressed=${scenario.suppressed} ${scenario.direction}`, async ({ annotate }) => {
  await rotate(scenario.width, 844);
  expect(innerWidth).toBe(scenario.width);
  expect(innerHeight).toBe(844);
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const originalDirection = document.documentElement.dir;
  document.documentElement.dir = scenario.direction;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // Auth is the same root-loader signal passed to MobileNav. Before the app
  // integration this extra spread input is ignored, leaving the real regression.
  const feedbackProps = { isAuthenticated: scenario.authenticated };
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={[scenario.path]}>
        <DockContextProvider>
          <ToastProvider {...feedbackProps}>
            <SuppressedPage suppressed={scenario.suppressed} />
            <MobileNav isAuthenticated={scenario.authenticated} />
          </ToastProvider>
        </DockContextProvider>
      </MemoryRouter>,
    ));
    await userEvent.click(page.getByRole("button", { name: "Measure feedback" }));
    const toast = () => document.querySelector<HTMLElement>('[data-ouro="toast"]');
    await expect.poll(() => {
      const element = toast();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    }).toBe(true);
    const toastBox = toast()!.getBoundingClientRect();
    expect(toast()!.checkVisibility()).toBe(true);
    const nav = document.querySelector<HTMLElement>('[data-testid="mobile-tab-bar"]');
    const navBox = nav?.getBoundingClientRect();
    const links = nav ? [...nav.querySelectorAll("a")] : [];
    expect(toastBox.width).toBeGreaterThan(0);
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
      scenario,
      viewport: { width: innerWidth, height: innerHeight },
      toast: toastBox.toJSON(),
      dock: navBox?.toJSON() ?? null,
      clearsDock: navBox ? toastBox.bottom <= navBox.top : null,
      hits,
    })}`, "info");
    // A geometry annotation alone is not a clearance gate.
    if (scenario.dock) {
      expect(navBox!.height).toBeGreaterThan(0);
      expect(links).toHaveLength(scenario.links);
      expect.soft(toastBox.bottom, "toast must clear the actual dock").toBeLessThanOrEqual(navBox!.top);
      // Main's existing clearance leaves exactly 1.25rem beyond the 4rem dock.
      // Measuring from the real nav retains its actual safe-area bottom margin.
      expect.soft(navBox!.top - toastBox.bottom, "existing app clearance gap").toBe(20);
      for (const hit of hits) {
        expect.soft(hit.receivesCenterHit, `${hit.href} center must reach its link`).toBe(true);
        expect.soft(hit.centerHitInToast, `${hit.href} center must not hit toast`).toBe(false);
      }
    } else {
      expect(navBox?.height ?? 0).toBe(0);
      // Native browser safe-area is zero in these isolated desktop-emulated
      // phone projects. Keep the published 16px/24px defaults, not dock spacing.
      expect(toastBox.bottom).toBe(844 - (scenario.width < 640 ? 16 : 24));
    }
    // Published phone logical gutters / end-alignment remain untouched in RTL.
    if (scenario.width < 640) {
      expect(toastBox.left).toBe(16);
      expect(innerWidth - toastBox.right).toBe(16);
    } else {
      expect(toastBox.width).toBe(360);
      expect(scenario.direction === "rtl" ? toastBox.left : innerWidth - toastBox.right).toBe(24);
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.dir = originalDirection;
    await rotate(390, 844);
  }
});
}
