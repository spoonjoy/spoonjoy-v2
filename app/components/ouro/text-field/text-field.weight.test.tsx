import { Profiler, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { TextField } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";

// A view of many items draws a TextField for each, so its count of elements and components is paid once per
// field. Each budget is what the variant draws now: a change that adds to one fails here, and a cut lowers it.

const RATIO = 50;

const variants: { variant: string; field: ReactElement; elements: number; components: number }[] = [
  { variant: "a plain field", field: <TextField label="Name" />, elements: 6, components: 15 },
  { variant: "a field with a description", field: <TextField label="Name" description="As on your card." />, elements: 7, components: 17 },
  { variant: "a field with an error", field: <TextField label="Name" error="Enter a name." />, elements: 7, components: 17 },
  { variant: "a required field", field: <TextField label="Name" required />, elements: 6, components: 17 },
  { variant: "a password field", field: <TextField label="Password" type="password" />, elements: 15, components: 20 },
];

/** The components React keeps for what the root draws: every fiber but the root, elements and text, context providers included. */
function componentsUnder(host: HTMLElement): number {
  const key = Object.keys(host).find((name) => name.startsWith("__reactContainer$"))!;
  // React's fibers: 3 is the root, 5 an element, 6 a text node; everything else is a component, provider or fragment.
  type Fiber = { tag: number; child: Fiber | null; sibling: Fiber | null; stateNode: { current: Fiber } };
  const count = (fiber: Fiber | null): number => (fiber === null ? 0 : (fiber.tag === 5 || fiber.tag === 6 ? 0 : 1) + count(fiber.child) + count(fiber.sibling));
  // The container keeps the root's first fiber; the tree on screen hangs from the root's current one.
  return count((host as unknown as Record<string, Fiber>)[key]!.stateNode.current.child);
}

describe("TextField's weight", () => {
  it.each(variants)("draws $variant in no more than $elements elements and $components components", async ({ field, elements, components }) => {
    const host = document.createElement("div");
    host.dataset["testHarness"] = "";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(field));
    const drawnElements = host.querySelectorAll("*").length;
    const drawnComponents = componentsUnder(host);
    await act(async () => root.unmount());
    host.remove();
    expect(drawnElements, "elements").toBeLessThanOrEqual(elements);
    expect(drawnComponents, "components").toBeLessThanOrEqual(components);
  });
});

// Mounting is timed per instance against bare elements drawn the same way, so the ratio holds on a slow or busy host.
// The bare side is drawn 5,000 times, so its time is tens of milliseconds or more rather than one, which a single
// scheduler pause would multiply.
async function mountMs(render: () => ReactElement, count: number): Promise<number> {
  const host = document.createElement("div");
  host.dataset["testHarness"] = "";
  document.body.append(host);
  const root = createRoot(host);
  const start = performance.now();
  await act(async () => root.render(<>{Array.from({ length: count }, (_, index) => <div key={index}>{render()}</div>)}</>));
  const took = performance.now() - start;
  await act(async () => root.unmount());
  host.remove();
  return took;
}

/**
 * The lowest of five ratios of an item's time per copy to a bare element's, each from an item mount and a bare
 * mount timed one after the other, after one of each to warm up. Timed in turn, the two sides of a ratio see the same
 * load: when all the item's runs came first, a runner that got busier or quieter in between moved the ratio (#2469).
 */
async function lowestRatio(item: () => ReactElement, items: number, bare: () => ReactElement, bares: number): Promise<{ ratio: number; item: number; bare: number }> {
  await mountMs(item, items);
  await mountMs(bare, bares);
  let best = { ratio: Infinity, item: 0, bare: 0 };
  for (let run = 0; run < 5; run++) {
    const each = (await mountMs(item, items)) / items;
    const plain = (await mountMs(bare, bares)) / bares;
    if (each / plain < best.ratio) best = { ratio: each / plain, item: each, bare: plain };
  }
  return best;
}

const constraints: { constraint: string; field: ReactElement }[] = [
  { constraint: "required", field: <TextField label="Name" required /> },
  { constraint: "email", field: <TextField label="Name" type="email" /> },
  { constraint: "url", field: <TextField label="Name" type="url" /> },
  { constraint: "pattern", field: <TextField label="Name" pattern="[a-z]+" /> },
  { constraint: "minLength", field: <TextField label="Name" minLength={2} /> },
  { constraint: "maxLength", field: <TextField label="Name" maxLength={9} /> },
  { constraint: "min", field: <TextField label="Name" type="date" min="2020-01-01" /> },
  { constraint: "max", field: <TextField label="Name" type="date" max="2030-01-01" /> },
  { constraint: "step", field: <TextField label="Name" type="date" step={2} /> },
];

describe("TextField's constraints", () => {
  it.each(constraints)("keeps the error slot for a field with $constraint", async ({ constraint, field }) => {
    const host = document.createElement("div");
    host.dataset["testHarness"] = "";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(field));
    const drawn = componentsUnder(host);
    await act(async () => root.unmount());
    host.remove();
    expect(drawn, `components with ${constraint}`).toBeGreaterThanOrEqual(17);
  });
});

// Base UI's Field.Root settles twice in layout effects as its control registers, so a field commits three times
// on mount. A shown error commits once more a frame later, when Base UI's FieldError ends its "starting"
// transition status (useTransitionStatus). The count is taken after two frames, so that commit is always in it
// rather than only when a slow host reaches a frame before the mount's act returns. A change that makes a field
// commit more fails here.
describe("TextField's commits on mount", () => {
  it.each([
    { variant: "a plain field", field: <TextField label="Name" />, budget: 3 },
    { variant: "a field with a description and an error", field: <TextField label="Name" description="As on your card." error="Enter a name." />, budget: 4 },
    { variant: "a required password field", field: <TextField label="Password" type="password" required />, budget: 3 },
  ])("commits $variant no more than $budget times, counted once its frames have run", async ({ field, budget }) => {
    const host = document.createElement("div");
    host.dataset["testHarness"] = "";
    document.body.append(host);
    const root = createRoot(host);
    let commits = 0;
    await act(async () => root.render(<Profiler id="field" onRender={() => commits++}>{field}</Profiler>));
    await act(() => new Promise<void>((settle) => requestAnimationFrame(() => requestAnimationFrame(() => settle()))));
    await act(async () => root.unmount());
    host.remove();
    expect(commits, "commits").toBeLessThanOrEqual(budget);
  });
});

describe("TextField's mount time", () => {
  // In WebKit on a shared CI runner, a passing run takes 10 to 12 s, close to Vitest's 15 s default:
  // give this test its own budget with real headroom rather than tightening the ratio it checks (#3518).
  it("mounts a plain field, one of 100, in a bounded multiple of the time a bare input takes, one of 5,000", async () => {
    const { ratio, item, bare } = await lowestRatio(() => <TextField label="Name" />, 100, () => <label>Name<input /></label>, 5000);
    expect(ratio, `ratio (field ${(item * 1000).toFixed(0)} µs, bare ${(bare * 1000).toFixed(0)} µs)`).toBeLessThan(RATIO);
  }, 30_000);
});
