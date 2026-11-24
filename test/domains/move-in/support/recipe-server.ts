// A stand-in for the other app's server in unit tests: a small kitchen of two recipes behind a token.
export const SERVER_KITCHEN = "092b8ed0-4f72-43b4-9ba2-dffc05dc8d47";
export const SERVER_TOKEN = "test-token";

const soupAndToast: Array<Record<string, unknown>> = [
  { id: "00000000-0000-4000-8000-0000000000d1", slug: "soup", name: "Soup", image: null, createdAt: "2026-11-23T16:00:00Z", groupId: SERVER_KITCHEN, recipeIngredient: [{ note: "water" }], recipeInstructions: [] },
  { id: "00000000-0000-4000-8000-0000000000d2", slug: "toast", name: "Toast", image: null, createdAt: "2026-11-23T16:01:00Z", groupId: SERVER_KITCHEN, recipeIngredient: [{ note: "bread" }], recipeInstructions: [] },
];

/** `fetch` for the server at https://recipes.example.com; `down` makes it unreachable. */
export function recipeServer({ down = false, kitchen = SERVER_KITCHEN, recipes = soupAndToast } = {}): typeof globalThis.fetch {
  const routes: Record<string, unknown> = {
    "/api/app/about": { version: "v3.31.0" },
    "/api/users/self": { group: "Home", groupId: kitchen },
    "/api/recipes": { items: recipes },
    "/api/organizers/tags": { items: [] },
    "/api/organizers/categories": { items: [] },
    "/api/organizers/tools": { items: [] },
    ...Object.fromEntries(recipes.map((recipe) => [`/api/recipes/${recipe.slug}`, recipe])),
  };
  return async (input, init) => {
    if (down) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    if (url.host !== "recipes.example.com") return new Response("not found", { status: 404 });
    if (url.pathname !== "/api/app/about" && new Headers(init?.headers).get("authorization") !== `Bearer ${SERVER_TOKEN}`) return new Response("no", { status: 401 });
    const body = routes[url.pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : Response.json(body);
  };
}
