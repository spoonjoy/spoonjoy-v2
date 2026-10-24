import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { act } from "~/lib/ouro/testing/act";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { OuroRouterLink } from "~/components/navigation/ouro-router-link";
import ShoppingList from "~/routes/shopping-list";

/** Real app UI/controller and real Router; only the remote data store is a fixture.
 * The touch/browser files mock the server-only export module, never SwipeActions,
 * ConfirmDialog, Menu, Checklist, Motion or the app controller.
 */
export async function shoppingRemovalFixture(direction: "ltr" | "rtl" = "ltr") {
  await import("~/components/motion/motion-features");
  let items = [{
    id: "proof-1", quantity: 2, checked: false, unit: null,
    ingredientRef: { name: "lemons" }, categoryKey: "produce", iconKey: "apple",
  }];
  const writes: Array<Record<string, FormDataEntryValue>> = [];
  const host = document.createElement("div");
  host.dir = direction;
  document.body.append(host);
  const router = createMemoryRouter([{
    path: "/shopping-list", Component: ShoppingList, HydrateFallback: () => null,
    loader: () => ({ shoppingList: { id: "proof-list", items: items.map((item) => ({ ...item })) }, recipes: [] }),
    action: async ({ request }) => {
      const payload = Object.fromEntries(await request.formData());
      if (payload.itemId !== "proof-1" || !["removeItem", "toggleCheck"].includes(String(payload.intent))) {
        throw new Error(`Unexpected app mutation ${JSON.stringify(payload)}`);
      }
      writes.push(payload);
      if (payload.intent === "removeItem") items = [];
      else items = items.map((item) => ({ ...item, checked: payload.nextChecked === "true" }));
      return { success: true };
    },
  }], { initialEntries: ["/shopping-list"] });
  const root = createRoot(host);
  await act(async () => {
    root.render(<OuroProvider linkComponent={OuroRouterLink}><RouterProvider router={router} /><div style={{ height: 1600 }} /></OuroProvider>);
  });
  return {
    host, router, writes,
    row: () => host.querySelector<HTMLElement>('[data-shopping-item="proof-1"]')!,
    async dispose() {
      await act(async () => root.unmount());
      router.dispose();
      host.remove();
    },
  };
}
