import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form as RouterForm, data } from "react-router";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { renderToString } from "react-dom/server";
import { faker } from "@faker-js/faker";
import AccountSettings, { action as accountAction } from "~/routes/account.settings";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import { RECIPE_CHANGED_MESSAGE } from "~/lib/recipe-d1-edits.server";
import { createUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";

const SHORT_MESSAGE = "Password must be at least 8 characters";
const MODES = [
  { hasPassword: true, intent: "changePassword", button: "Change password" },
  { hasPassword: false, intent: "setPassword", button: "Set password" },
] as const;

describe("account password accepted answers", () => {
  let cookie: string;
  let loaderData: {
    user: { id: string; email: string; username: string; hasPassword: boolean; oauthAccounts: []; passkeys: []; photoUrl: null };
    notifications: { pushSubscribed: false };
  };

  beforeEach(async () => {
    await cleanupDatabase();
    const user = await createUser(db, faker.internet.email(), `pw_${faker.string.alphanumeric(10)}`, "original-password");
    const session = await sessionStorage.getSession();
    session.set("userId", user.id);
    cookie = (await sessionStorage.commitSession(session)).split(";")[0];
    loaderData = {
      user: { id: user.id, email: user.email, username: user.username, hasPassword: true, oauthAccounts: [], passkeys: [], photoUrl: null },
      notifications: { pushSubscribed: false },
    };
  });
  afterEach(cleanupDatabase);

  async function configure(hasPassword: boolean) {
    loaderData.user.hasPassword = hasPassword;
    if (!hasPassword) await db.user.update({ where: { id: loaderData.user.id }, data: { hashedPassword: null, salt: null } });
  }

  async function realPasswordAnswer(request: Request) {
    const posted = await request.formData();
    const body = new UndiciFormData();
    for (const [name, value] of posted) body.append(name, String(value));
    return accountAction({
      request: new UndiciRequest("http://localhost/account/settings", {
        method: "POST", headers: { Cookie: cookie }, body,
      }),
      params: {},
      context: { cloudflare: { env: null } },
    } as never);
  }

  it.each(MODES)("renders an initial untagged $intent refusal as an SSR display baseline without focus", async (mode) => {
    await configure(mode.hasPassword);
    const initial = {
      success: false, error: "password_too_short", message: SHORT_MESSAGE,
      fieldErrors: { newPassword: SHORT_MESSAGE },
    };
    const Stub = createTestRoutesStub([{
      id: "account",
      path: "/account/settings",
      loader: () => loaderData,
      Component: AccountSettings,
    }]);
    const tree = <Stub initialEntries={["/account/settings"]}
      hydrationData={{ loaderData: { account: loaderData }, actionData: { account: initial } }} />;
    const doc = new DOMParser().parseFromString(renderToString(tree), "text/html");
    const serverPassword = doc.querySelector<HTMLInputElement>('input[name="newPassword"]');
    expect(serverPassword).not.toBeNull();
    expect(serverPassword).toHaveAttribute("aria-invalid", "true");
    render(tree);
    const password = await screen.findByLabelText("New password", { exact: true });
    expect(password).toHaveAccessibleDescription(`Must be at least 8 characters ${SHORT_MESSAGE}`);
    expect(password).not.toHaveFocus();
  });

  it.each(MODES)("closes a successful $intent form and keeps its success feedback", async (mode) => {
    await configure(mode.hasPassword);
    const Stub = createTestRoutesStub([{
      id: "account",
      path: "/account/settings",
      loader: () => loaderData,
      Component: AccountSettings,
      action: async ({ request }) => {
        const posted = await request.formData();
        expect(posted.get("intent")).toBe(mode.intent);
        loaderData = { ...loaderData, user: { ...loaderData.user, hasPassword: true } };
        return { success: true, intent: mode.intent, message: "Password saved" };
      },
    }]);
    render(<Stub initialEntries={["/account/settings"]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: mode.button, exact: true }));
    const section = within(screen.getByTestId("password-section"));
    if (mode.hasPassword) await user.type(section.getByLabelText("Current password", { exact: true }), "original-password");
    await user.type(section.getByLabelText("New password", { exact: true }), "valid-password");
    await user.type(section.getByLabelText("Confirm password", { exact: true }), "valid-password");
    await user.click(section.getByRole("button", { name: mode.button, exact: true }));
    await screen.findByText("Password saved");
    await waitFor(() => expect(section.queryByLabelText("New password", { exact: true })).not.toBeInTheDocument());
  });

  it.each(MODES)("shows an actual untagged $intent refusal again after clearing, not for another answer", async (mode) => {
    await configure(mode.hasPassword);
    let calls = 0;
    let release: (() => void) | undefined;
    const answers: unknown[] = [];
    const Stub = createTestRoutesStub([{
      id: "account",
      path: "/account/settings",
      loader: () => loaderData,
      Component: () => <><AccountSettings /><RouterForm method="post">
        <input type="hidden" name="intent" value="renamePasskey" /><button>Other answer</button>
      </RouterForm></>,
      action: async ({ request }) => {
        const posted = await request.clone().formData();
        if (posted.get("intent") === "renamePasskey") return { success: false, intent: "renamePasskey", message: "Other action answered" };
        expect(posted.get("intent")).toBe(mode.intent);
        calls++;
        if (calls === 2) await new Promise<void>((resolve) => { release = resolve; });
        const answer = await realPasswordAnswer(request);
        answers.push(answer);
        return answer;
      },
    }]);
    render(<Stub initialEntries={["/account/settings"]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: mode.button, exact: true }));
    const section = within(screen.getByTestId("password-section"));
    if (mode.hasPassword) await user.type(section.getByLabelText("Current password", { exact: true }), "original-password");
    const password = section.getByLabelText("New password", { exact: true });
    await user.type(password, "bad");
    await user.type(section.getByLabelText("Confirm password", { exact: true }), "bad");
    await user.click(section.getByRole("button", { name: mode.button, exact: true }));
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(answers[0]).toEqual({
      success: false, error: "password_too_short", message: SHORT_MESSAGE,
      fieldErrors: { newPassword: SHORT_MESSAGE },
    });
    await waitFor(() => expect(password).toHaveAccessibleDescription(`Must be at least 8 characters ${SHORT_MESSAGE}`));
    // FieldError's accessible description arrives before its real-frame entrance
    // completion. Keep that state update in act, including under coverage load.
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(screen.getByText(SHORT_MESSAGE)).not.toHaveAttribute("data-starting-style");
    expect(password).toHaveFocus();
    await user.type(password, "x");
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(password).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(SHORT_MESSAGE)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Other answer", exact: true }));
    await screen.findByText("Other action answered");
    expect(password).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Other answer", exact: true })).toHaveFocus();
    await user.click(section.getByRole("button", { name: mode.button, exact: true }));
    await waitFor(() => expect(release).toBeDefined());
    expect(password).not.toHaveAttribute("aria-invalid", "true");
    await act(async () => release!());
    await waitFor(() => expect(password).toHaveAccessibleDescription(`Must be at least 8 characters ${SHORT_MESSAGE}`));
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    expect(screen.getByText(SHORT_MESSAGE)).not.toHaveAttribute("data-starting-style");
    expect(password).toHaveFocus();
    expect(answers).toHaveLength(2);
  });

  it.each(MODES)("cancels a held $intent without accepting its late refusal into a reopened form", async (mode) => {
    await configure(mode.hasPassword);
    let release: (() => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const Stub = createTestRoutesStub([{
      id: "account",
      path: "/account/settings",
      loader: () => loaderData,
      Component: AccountSettings,
      action: async ({ request }) => {
        requestSignal = request.signal;
        await new Promise<void>((resolve) => { release = resolve; });
        return realPasswordAnswer(request);
      },
    }]);
    render(<Stub initialEntries={["/account/settings"]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: mode.button, exact: true }));
    const section = within(screen.getByTestId("password-section"));
    if (mode.hasPassword) await user.type(section.getByLabelText("Current password", { exact: true }), "original-password");
    await user.type(section.getByLabelText("New password", { exact: true }), "bad");
    await user.type(section.getByLabelText("Confirm password", { exact: true }), "bad");
    await user.click(section.getByRole("button", { name: mode.button, exact: true }));
    await waitFor(() => expect(release).toBeDefined());
    await user.click(section.getByRole("button", { name: "Cancel", exact: true }));
    expect(requestSignal!.aborted).toBe(true);
    await user.click(section.getByRole("button", { name: mode.button, exact: true }));
    await act(async () => release!());
    expect(section.getByLabelText("New password", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    expect(section.queryByText(SHORT_MESSAGE)).not.toBeInTheDocument();
  });
});

it("shows the actual manual ingredient 409 separately from a cleared primary update refusal", async () => {
  const loaderData = {
    recipe: { id: "r", title: "Recipe" },
    step: { id: "s", stepNum: 1, stepTitle: "", description: "Cook", ingredients: [], usingSteps: [] },
    availableSteps: [],
  };
  let manualPosted: FormData | undefined;
  const Stub = createTestRoutesStub([{
    id: "step",
    path: "/recipes/r/steps/s/edit",
    loader: () => loaderData,
    Component: EditStep,
    action: async ({ request }) => {
      const posted = await request.formData();
      if (posted.get("intent") === "addIngredient") {
        manualPosted = posted;
        return data({ errors: { general: RECIPE_CHANGED_MESSAGE } }, { status: 409 });
      }
      return { errors: { description: "Primary refusal", general: "Primary message" } };
    },
  }]);
  render(<Stub initialEntries={["/recipes/r/steps/s/edit"]} />);
  const user = userEvent.setup();
  const description = await screen.findByRole("textbox", { name: "Description", exact: true });
  await user.click(screen.getByRole("button", { name: "Update", exact: true }));
  await waitFor(() => expect(description).toHaveAccessibleDescription("Primary refusal"));
  const primaryAlert = screen.getByRole("alert");
  await user.type(description, " again");
  expect(description).not.toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: "+ Add ingredient", exact: true }));
  await user.click(screen.getByRole("switch", { name: "AI Parse" }));
  fireEvent.change(screen.getByLabelText("Quantity", { exact: true }), { target: { value: "2" } });
  await user.type(screen.getByLabelText("Unit", { exact: true }), "cup");
  await user.type(screen.getByLabelText("Ingredient", { exact: true }), "flour");
  await user.click(screen.getByRole("button", { name: "Add ingredient", exact: true }));
  await waitFor(() => expect(manualPosted).toBeDefined());
  expect(manualPosted!.get("quantity")).toBe("2");
  expect(manualPosted!.get("unitName")).toBe("cup");
  expect(manualPosted!.get("ingredientName")).toBe("flour");
  await screen.findByText(RECIPE_CHANGED_MESSAGE);
  expect(primaryAlert).toHaveTextContent("Primary message");
  expect(primaryAlert).toBeInTheDocument();
  expect(description).not.toHaveAttribute("aria-invalid", "true");
  expect(description).not.toHaveFocus();
});
