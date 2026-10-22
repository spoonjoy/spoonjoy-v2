import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub, requiredLabel } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import NewRecipe, { action } from "~/routes/recipes.new";
import EditRecipe, { loader as editLoader } from "~/routes/recipes.$id.edit";
import * as sessionImport from "~/lib/recipe-import-session.server";
import { IMPORT_MESSAGES } from "~/lib/recipe-import-session.server";
import { ImportedRecipeNotice, RecipeImportPanel } from "~/components/recipe/RecipeImportPanel";

// HX FileField writes the files it keeps back into its input, which user-event's upload stub
// does not allow, so choose the file the way the system picker does: set the input's files and
// fire change.
function chooseFile(input: HTMLElement, file: File) {
  const data = new DataTransfer();
  data.items.add(file);
  (input as HTMLInputElement).files = data.files;
  fireEvent.change(input);
}

function extract(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  return { data: response, status: 200 };
}

async function cookieFor(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function importRequest(fields: Record<string, string>, userId?: string) {
  const formData = new UndiciFormData();
  formData.append("intent", "import");
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  const headers = new Headers();
  if (userId) headers.set("Cookie", await cookieFor(userId));
  return new UndiciRequest("http://localhost:3000/recipes/new", { method: "POST", body: formData, headers });
}

const IMPORT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("New Recipe import action", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    userId = (await createUser(db, faker.internet.email(), `imp_${faker.string.alphanumeric(10)}`, "testPassword123")).id;
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("asks a signed-out visitor to log in", async () => {
    const request = await importRequest({ importKind: "link", url: "https://example.com/r" });
    await expect(action({ request, context: { cloudflare: { env: null } }, params: {} } as any)).rejects.toSatisfy((error: any) => {
      expect(error.status).toBe(302);
      expect(error.headers.get("Location")).toContain("/login");
      return true;
    });
  });

  it("answers a malformed link next to the field", async () => {
    const request = await importRequest({ importKind: "link", importId: IMPORT_ID, url: "pasta" }, userId);
    const { data, status } = extract(await action({ request, context: { cloudflare: { env: null } }, params: {} } as any));
    expect(status).toBe(400);
    expect(data).toEqual({ importResult: { kind: "link", message: IMPORT_MESSAGES.linkInvalid } });
  });

  it("says import isn't switched on when the server has no model key, and writes nothing", async () => {
    const request = await importRequest({ importKind: "text", importId: IMPORT_ID, text: "Toast. Bread. Toast it." }, userId);
    const { data, status } = extract(await action({ request, context: { cloudflare: { env: {} } }, params: {} } as any));
    expect(status).toBe(200);
    expect(data).toEqual({ importResult: { kind: "text", message: IMPORT_MESSAGES.unavailable, existingRecipe: undefined } });
    expect(await db.recipe.count({ where: { chefId: userId } })).toBe(0);
  });

  it("opens the imported recipe in the editor for review", async () => {
    const spy = vi.spyOn(sessionImport, "importRecipeForSession").mockResolvedValue({ ok: true, recipeId: "recipe_import_abc" });
    const request = await importRequest({ importKind: "link", importId: IMPORT_ID, url: "https://example.com/r" }, userId);
    const response = await action({ request, context: { cloudflare: { env: { OPENAI_API_KEY: "k" } } }, params: {} } as any);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/recipes/recipe_import_abc/edit?imported=1");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      input: { kind: "link", importId: IMPORT_ID, url: "https://example.com/r" },
    }));
  });

  it("passes an earlier import of the same link back to the page", async () => {
    vi.spyOn(sessionImport, "importRecipeForSession").mockResolvedValue({
      ok: false,
      kind: "link",
      message: "You already brought this one in as “Pasta”.",
      existingRecipe: { id: "r1", title: "Pasta" },
    });
    const request = await importRequest({ importKind: "link", importId: IMPORT_ID, url: "https://example.com/r" }, userId);
    const { data } = extract(await action({ request, context: { cloudflare: { env: {} } }, params: {} } as any));
    expect(data.importResult).toEqual({
      kind: "link",
      message: "You already brought this one in as “Pasta”.",
      existingRecipe: { id: "r1", title: "Pasta" },
    });
  });
});

describe("RecipeImportPanel", () => {
  function renderPanel(actionImpl: (formData: FormData) => unknown) {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/new",
        Component: NewRecipe,
        loader: () => null,
        action: async ({ request }: { request: Request }) => actionImpl(await request.formData()),
      },
    ]);
    render(<Stub initialEntries={["/recipes/new"]} />);
  }

  it("leads New Recipe, above the manual recipe card", async () => {
    renderPanel(() => null);
    const importHeading = await screen.findByRole("heading", { name: "Start from a recipe you already have." });
    const cardHeading = screen.getByRole("heading", { name: "Give the dish a home." });
    expect(importHeading.compareDocumentPosition(cardHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("radio", { name: "From a link" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(requiredLabel("Recipe link"))).toHaveAttribute("type", "url");
  });

  it("switches to pasting the recipe, pointing paper recipes at the photo option", async () => {
    const user = userEvent.setup();
    renderPanel(() => null);
    await user.click(await screen.findByRole("radio", { name: "Paste text" }));
    expect(screen.getByRole("radio", { name: "Paste text" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText(requiredLabel("Recipe link"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(requiredLabel("Recipe text")).tagName).toBe("TEXTAREA");
    expect(screen.getByText("Paste the title, ingredients and steps. Have it on paper? Choose From a photo instead.")).toBeInTheDocument();
  });

  it("takes a photo of the recipe, posts it with an import id, and reuses the id only for the same photo", async () => {
    const user = userEvent.setup();
    const posts: Array<{ kind: string; importId: string }> = [];
    // The test router's request drops file bodies, so read the photo off the form as it submits.
    const submittedPhotos: string[] = [];
    const onSubmit = (event: Event) => {
      const field = (event.target as HTMLFormElement).elements.namedItem("photo") as HTMLInputElement | null;
      submittedPhotos.push(field?.files?.[0]?.name ?? "none");
    };
    document.addEventListener("submit", onSubmit, true);
    renderPanel((formData) => {
      posts.push({ kind: String(formData.get("importKind")), importId: String(formData.get("importId")) });
      return { importResult: { kind: "photo", message: "We couldn't read a recipe in that photo." } };
    });
    await user.click(await screen.findByRole("radio", { name: "From a photo" }));
    expect(screen.getByRole("radio", { name: "From a photo" })).toHaveAttribute("aria-checked", "true");
    const field = screen.getByLabelText(requiredLabel("Recipe photo"));
    expect(field).toHaveAttribute("type", "file");
    expect(field).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/gif");
    expect(field).toBeRequired();
    expect(screen.getByText(/A recipe card, a cookbook page or a screenshot/)).toBeInTheDocument();

    chooseFile(field, new File([new Uint8Array([1, 2, 3])], "card.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    // The answer shows under the field it is about, as that field's error.
    expect(await screen.findByText("We couldn't read a recipe in that photo.")).toBeInTheDocument();
    expect(screen.getByLabelText(requiredLabel("Recipe photo"))).toHaveAttribute("aria-invalid", "true");
    expect(posts[0].kind).toBe("photo");
    expect(posts[0].importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(submittedPhotos[0]).toBe("card.jpg");

    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].importId).toBe(posts[0].importId);

    await waitFor(() => expect(screen.getByRole("button", { name: "Import recipe" })).toBeEnabled());
    chooseFile(screen.getByLabelText(requiredLabel("Recipe photo")), new File([new Uint8Array([4, 5])], "page.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2].importId).not.toBe(posts[0].importId);
    expect(submittedPhotos).toEqual(["card.jpg", "card.jpg", "page.png"]);
    document.removeEventListener("submit", onSubmit, true);
  });

  it("posts the link with an import id, shows the answer, and reuses the id only for the same link", async () => {
    const user = userEvent.setup();
    const posts: Array<Record<string, string>> = [];
    renderPanel((formData) => {
      posts.push(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
      return { importResult: { kind: "link", message: "That site took too long to answer." } };
    });
    const field = await screen.findByLabelText(requiredLabel("Recipe link"));
    await user.type(field, "https://example.com/soup");
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    expect(await screen.findByText("That site took too long to answer.")).toBeInTheDocument();
    expect(posts[0]).toMatchObject({ intent: "import", importKind: "link", url: "https://example.com/soup" });
    expect(posts[0].importId).toMatch(/^[0-9a-f-]{36}$/);

    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].importId).toBe(posts[0].importId);
    await waitFor(() => expect(screen.getByLabelText(requiredLabel("Recipe link"))).toBeEnabled());

    await user.clear(screen.getByLabelText(requiredLabel("Recipe link")));
    await user.type(screen.getByLabelText(requiredLabel("Recipe link")), "https://example.com/stew");
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2].importId).not.toBe(posts[0].importId);
  });

  it("links to the recipe the cook already imported from that link, and hides a link answer while pasting", async () => {
    const user = userEvent.setup();
    renderPanel(() => ({
      importResult: { kind: "link", message: "You already brought this one in as “Soup”.", existingRecipe: { id: "r-soup", title: "Soup" } },
    }));
    await user.type(await screen.findByLabelText(requiredLabel("Recipe link")), "https://example.com/soup");
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    expect(await screen.findByText("You already brought this one in as “Soup”.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/recipes/r-soup");
    expect(screen.getByLabelText(requiredLabel("Recipe link"))).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(requiredLabel("Recipe link"))).toHaveAccessibleDescription("Any recipe page, or a YouTube or TikTok video with the recipe in its description. You already brought this one in as “Soup”. Open it");

    await user.click(screen.getByRole("radio", { name: "Paste text" }));
    expect(screen.queryByText("You already brought this one in as “Soup”.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open it" })).not.toBeInTheDocument();
  });

  it("leaves focus on the tab when the cook comes back to a kind whose answer is already shown", async () => {
    const user = userEvent.setup();
    renderPanel(() => ({ importResult: { kind: "link", message: "That site took too long to answer." } }));
    await user.type(await screen.findByLabelText(requiredLabel("Recipe link")), "https://example.com/soup");
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    expect(await screen.findByText("That site took too long to answer.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Paste text" }));
    const linkTab = screen.getByRole("radio", { name: "From a link" });
    await user.click(linkTab);

    // The answer is back under the link field, and it is not treated as a new one.
    expect(screen.getByText("That site took too long to answer.")).toBeInTheDocument();
    expect(screen.getByLabelText(requiredLabel("Recipe link"))).toHaveAttribute("aria-invalid", "true");
    expect(linkTab).toHaveFocus();
  });

  it("shows that it is reading while the import runs", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    renderPanel(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(await screen.findByRole("radio", { name: "Paste text" }));
    await user.type(screen.getByLabelText(requiredLabel("Recipe text")), "Toast");
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    const busy = await screen.findByRole("button", { name: "Reading the recipe…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    finish({ importResult: { kind: "text", message: "We couldn't find a recipe in that text." } });
    expect(await screen.findByText("We couldn't find a recipe in that text.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import recipe" })).toBeEnabled();
  });

  it("opens on the kind the last answer was about", async () => {
    const Stub = createTestRoutesStub([
      { path: "/", Component: () => <RecipeImportPanel result={{ kind: "text", message: "Paste the recipe: its title, ingredients and steps." }} /> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByLabelText(requiredLabel("Recipe text"))).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Paste the recipe: its title, ingredients and steps.")).toBeInTheDocument();
  });
});

describe("ImportedRecipeNotice", () => {
  it.each([
    ["https://www.seriouseats.com/pasta", "Imported from seriouseats.com"],
    ["not a url", "Imported"],
    [null, "Imported"],
  ])("names where %j came from", (sourceUrl, label) => {
    render(<ImportedRecipeNotice sourceUrl={sourceUrl} />);
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(label, { exact: true })).toBeInTheDocument();
    expect(notice).toHaveTextContent("Check the amounts and the steps");
  });
});

describe("Edit Recipe after an import", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    userId = (await createUser(db, faker.internet.email(), `imp_${faker.string.alphanumeric(10)}`, "testPassword123")).id;
  });

  afterEach(async () => {
    cleanup();
    await cleanupDatabase();
  });

  it("flags the review notice only when the editor is opened from an import", async () => {
    const recipe = await db.recipe.create({ data: { title: "Imported Soup", chefId: userId, sourceUrl: "https://example.com/soup" } });
    const headers = new Headers({ Cookie: await cookieFor(userId) });
    const fromImport = await editLoader({
      request: new UndiciRequest(`http://localhost:3000/recipes/${recipe.id}/edit?imported=1`, { headers }),
      params: { id: recipe.id },
      context: { cloudflare: { env: null } },
    } as any);
    const plain = await editLoader({
      request: new UndiciRequest(`http://localhost:3000/recipes/${recipe.id}/edit`, { headers }),
      params: { id: recipe.id },
      context: { cloudflare: { env: null } },
    } as any);
    expect(fromImport.imported).toBe(true);
    expect(plain.imported).toBe(false);
  });

  it("shows the notice above the editor", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id/edit",
        Component: EditRecipe,
        loader: () => ({
          recipe: { id: "r1", title: "Imported Soup", description: null, servings: null, steps: [], sourceUrl: "https://example.com/soup" },
          coverImageUrl: null,
          formattedSteps: [],
          imported: true,
        }),
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1/edit?imported=1"]} />);
    expect(await screen.findByText("Imported from example.com")).toBeInTheDocument();
  });
});
