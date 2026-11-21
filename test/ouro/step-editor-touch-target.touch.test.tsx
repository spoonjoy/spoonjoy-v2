import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { StepEditorCard } from "~/components/recipe/StepEditorCard";
import { act } from "~/lib/ouro/testing/act";

// The step editor's buttons on a touch phone: each one's touch target is at least 44 by 44, measured
// in Chromium as a 390x844 touch phone with app/styles/tailwind.css (vitest.ouro.config.ts). The
// unit test used to check this through Ouro UI's class names, which an Ouro release may rename
// (spoonjoy-v2#824).

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("gives each of the step editor's buttons a touch target of at least 44 by 44", async () => {
  const Stub = createRoutesStub([
    {
      path: "/recipes/:id/steps/edit",
      Component: () => <StepEditorCard stepNumber={1} recipeId="recipe-1" onSave={vi.fn()} onRemove={vi.fn()} />,
    },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Stub initialEntries={["/recipes/recipe-1/steps/edit"]} />));
  const buttons = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
  expect(buttons.map((button) => button.textContent?.trim())).toHaveLength(2);
  for (const button of buttons) {
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]")!;
    const box = target.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
