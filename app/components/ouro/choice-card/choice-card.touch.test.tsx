import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ChoiceCard } from "~/components/ouro/choice-card/choice-card";
import { ImageField } from "~/components/ouro/image-field/image-field";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("gives each card and each photo button a 44px target, and stacks the cards on a phone", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <ChoiceCard legend="Size" columns={2} items={[{ value: "s", label: "Small" }, { value: "l", label: "Large" }]} />
        <ImageField label="Photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" onRemove={() => {}} />
      </>,
    ),
  );
  const cards = [...host.querySelectorAll<HTMLElement>('[data-ouro-part="card"]')];
  for (const card of cards) expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(cards[1]!.getBoundingClientRect().top).toBeGreaterThan(cards[0]!.getBoundingClientRect().top);
  for (const button of host.querySelectorAll<HTMLElement>('[data-ouro="image-field"] button')) {
    const target = button.querySelector<HTMLElement>("[data-ouro-touch-target]")!.getBoundingClientRect();
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
});
