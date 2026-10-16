import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import NewRecipe from "~/routes/recipes.new";
import { createTestRoutesStub } from "../utils";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let outside: HTMLButtonElement | undefined;
const originalAutofocus = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "autofocus");

beforeAll(() => {
  // Reflect the actual browser property that happy-dom omits (as in RecipeBuilder-hydration).
  Object.defineProperty(HTMLButtonElement.prototype, "autofocus", {
    configurable: true,
    get(this: HTMLButtonElement) { return this.hasAttribute("autofocus"); },
  });
});

afterAll(() => {
  if (originalAutofocus) Object.defineProperty(HTMLButtonElement.prototype, "autofocus", originalAutofocus);
  else Reflect.deleteProperty(HTMLButtonElement.prototype, "autofocus");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  outside?.remove();
});

it("server-renders a progressive-post refusal without initial focus and accepts an equal client answer after hydration", async () => {
  const initial = { errors: { title: "Taken", general: "Try again" } };
  const Stub = createTestRoutesStub([{
    id: "new",
    path: "/recipes/new",
    Component: NewRecipe,
    loader: () => null,
    action: () => ({ errors: { title: "Taken", general: "Try again" } }),
  }]);
  const tree = () => <Stub
    initialEntries={["/recipes/new"]}
    hydrationData={{ loaderData: { new: null }, actionData: { new: initial } }}
  />;
  host = document.createElement("div");
  host.innerHTML = renderToString(tree());
  outside = document.createElement("button");
  outside.textContent = "Outside";
  document.body.append(outside, host);
  outside.focus();
  const title = host.querySelector<HTMLInputElement>('input[name="title"]:not([type="hidden"])')!;
  expect(title.getAttribute("aria-invalid")).toBe("true");
  const describedBy = title.getAttribute("aria-describedby");
  title.value = "Typed before hydration";
  const recoverable = vi.fn();
  await act(async () => { root = hydrateRoot(host!, tree(), { onRecoverableError: recoverable }); });
  expect(recoverable).not.toHaveBeenCalled();
  expect(outside).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Title", exact: true })).toBe(title);
  expect(title).toHaveValue("Typed before hydration");
  expect(title.getAttribute("aria-describedby")).toBe(describedBy);
  expect(title).toHaveAccessibleDescription("Taken");
  const baselineAlert = screen.getByRole("alert");
  const user = userEvent.setup();
  await user.type(title, " changed");
  expect(title).not.toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: "Create recipe", exact: true }));
  await waitFor(() => expect(title).toHaveAccessibleDescription("Taken"));
  expect(title).toHaveFocus();
  expect(screen.getByRole("alert")).not.toBe(baselineAlert);
});
