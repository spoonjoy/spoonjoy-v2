import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { act } from "~/lib/ouro/testing/act";

// spoonjoy-v2#678: the mouse a test leaves over the frame must not hover the next test's
// controls. The two tests run in order: the first leaves the mouse on a button at the top
// left, where the next test's first control renders.

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

it("leaves the mouse over a button at the top left of the frame", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Button>Earlier</Button>));
  await userEvent.hover(host.querySelector("button")!);
  expect(document.documentElement.matches(":hover")).toBe(true);
});

it("starts the next test with the mouse off the frame, so nothing in it is hovered", () => {
  expect(document.documentElement.matches(":hover")).toBe(false);
});
