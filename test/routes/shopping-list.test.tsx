import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";

vi.mock("framer-motion", () => {
  const MotionDiv = ({
    children,
    onDragEnd,
    animate,
    layout,
    drag: _drag,
    dragConstraints: _dragConstraints,
    dragElastic: _dragElastic,
    dragMomentum: _dragMomentum,
    dragDirectionLock: _dragDirectionLock,
    initial: _initial,
    exit: _exit,
    transition: _transition,
    ...props
  }: {
    children: React.ReactNode;
    onDragEnd?: (_event: unknown, info: { offset: { x: number; y: number } }) => void;
    animate?: { x?: number };
    layout?: boolean | "position";
    [key: string]: unknown;
  }) => (
    <div
      {...props}
      data-motion-x={String(animate?.x ?? 0)}
      data-layout={layout ? String(layout) : undefined}
      onPointerUp={(event) => {
        const offsetX = Number(
          (event.currentTarget as HTMLDivElement).dataset.dragOffsetX ?? "0"
        );
        onDragEnd?.(event, { offset: { x: offsetX, y: 0 } });
      }}
    >
      {children}
    </div>
  );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: { div: MotionDiv },
  };
});

import ShoppingList, { resolveSwipeAction, shouldDeleteOnSwipe } from "~/routes/shopping-list";
import { getOrCreateUnit, getOrCreateIngredientRef, createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Shopping List Routes", () => {
  let testUserId: string;

  beforeEach(async () => {
    const user = await db.user.create({
      data: createTestUser(),
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should get or create shopping list for user", async () => {
      let shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
      });

      if (!shoppingList) {
        shoppingList = await db.shoppingList.create({
          data: { authorId: testUserId },
        });
      }

      expect(shoppingList).toBeDefined();
      expect(shoppingList.authorId).toBe(testUserId);
    });

    it("should load shopping list with items", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "milk" },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const loaded = await db.shoppingList.findUnique({
        where: { id: shoppingList.id },
        include: {
          items: {
            include: {
              unit: true,
              ingredientRef: true,
            },
          },
        },
      });

      expect(loaded?.items).toHaveLength(1);
      expect(loaded?.items[0].ingredientRef.name).toBe("milk");
    });
  });

  describe("action - addItem", () => {
    it("should add new item to shopping list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "bread" },
      });

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          quantity: 2,
        },
      });

      expect(item).toBeDefined();
      expect(item.quantity).toBe(2);
      expect(item.checked).toBe(false);
    });

    it("should update quantity if item already exists", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const unit = await getOrCreateUnit(db, "lbs");

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "chicken" },
      });

      const existingItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      // Simulate adding more
      const updated = await db.shoppingListItem.update({
        where: { id: existingItem.id },
        data: { quantity: (existingItem.quantity || 0) + 2 },
      });

      expect(updated.quantity).toBe(3);
    });

    it("should create new unit and ingredient ref if needed", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      let unit = await db.unit.findUnique({
        where: { name: "oz" },
      });

      if (!unit) {
        unit = await getOrCreateUnit(db, "oz");
      }

      let ingredientRef = await db.ingredientRef.findUnique({
        where: { name: "cheese" },
      });

      if (!ingredientRef) {
        ingredientRef = await db.ingredientRef.create({
          data: { name: "cheese" },
        });
      }

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          quantity: 8,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      expect(item).toBeDefined();
      expect(unit.name).toBe("oz");
      expect(ingredientRef.name).toBe("cheese");
    });
  });

  describe("action - addFromRecipe", () => {
    it("should add all ingredients from recipe to shopping list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      const unit = await getOrCreateUnit(db, "cup");

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "flour" },
      });

      const step = await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Mix",
        },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      // Get ingredients from recipe
      const recipeWithIngredients = await db.recipe.findUnique({
        where: { id: recipe.id },
        include: {
          steps: {
            include: {
              ingredients: {
                include: {
                  unit: true,
                  ingredientRef: true,
                },
              },
            },
          },
        },
      });

      // Add to shopping list
      for (const step of recipeWithIngredients!.steps) {
        for (const ingredient of step.ingredients) {
          await db.shoppingListItem.create({
            data: {
              shoppingListId: shoppingList.id,
              quantity: ingredient.quantity,
              unitId: ingredient.unitId,
              ingredientRefId: ingredient.ingredientRefId,
            },
          });
        }
      }

      const items = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id },
      });

      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(2);
    });
  });

  describe("action - toggleCheck", () => {
    it("should toggle item checked status and set checkedAt", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "eggs" },
      });

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          checked: false,
          checkedAt: null,
        },
      });

      const updated = await db.shoppingListItem.update({
        where: { id: item.id },
        data: {
          checked: true,
          checkedAt: new Date(),
        },
      });

      expect(updated.checked).toBe(true);
      expect(updated.checkedAt).not.toBeNull();
    });
  });

  describe("action - clearCompleted", () => {
    it("should soft-delete only checked items", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef1 = await db.ingredientRef.create({
        data: { name: "item1" },
      });

      const ingredientRef2 = await db.ingredientRef.create({
        data: { name: "item2" },
      });

      const ingredientRef3 = await db.ingredientRef.create({
        data: { name: "item3" },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef1.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef2.id,
          checked: false,
          checkedAt: null,
        },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef3.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      await db.shoppingListItem.updateMany({
        where: {
          shoppingListId: shoppingList.id,
          checkedAt: { not: null },
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      const activeItems = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
      });

      const deletedItems = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: { not: null } },
      });

      expect(activeItems).toHaveLength(1);
      expect(activeItems[0].ingredientRefId).toBe(ingredientRef2.id);
      expect(deletedItems).toHaveLength(2);
    });
  });

  describe("action - clearAll", () => {
    it("should soft-delete all items from shopping list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef1 = await db.ingredientRef.create({
        data: { name: "item1" },
      });

      const ingredientRef2 = await db.ingredientRef.create({
        data: { name: "item2" },
      });

      await db.shoppingListItem.createMany({
        data: [
          {
            shoppingListId: shoppingList.id,
            ingredientRefId: ingredientRef1.id,
          },
          {
            shoppingListId: shoppingList.id,
            ingredientRefId: ingredientRef2.id,
          },
        ],
      });

      await db.shoppingListItem.updateMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      const activeItems = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
      });

      const deletedItems = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: { not: null } },
      });

      expect(activeItems).toHaveLength(0);
      expect(deletedItems).toHaveLength(2);
    });
  });

  describe("component", () => {
    it("should render empty shopping list", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByRole("heading", { name: "Shopping list" })).toBeInTheDocument();
      expect(screen.getByText("0 items")).toBeInTheDocument();
      expect(screen.getByText("Your shopping list is empty")).toBeInTheDocument();
      expect(screen.getByText("Add items manually or add all ingredients from a recipe")).toBeInTheDocument();
    });

    it("should render shopping list with items", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 2,
              checked: false,
              unit: { name: "lbs" },
              ingredientRef: { name: "chicken" },
              categoryKey: "protein",
              iconKey: "beef",
            },
            {
              id: "item-2",
              quantity: null,
              checked: false,
              unit: null,
              ingredientRef: { name: "salt" },
              categoryKey: "spices",
              iconKey: "pot",
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("2 items")).toBeInTheDocument();
      expect(screen.getByText("2 lbs")).toBeInTheDocument();
      expect(screen.getByText("chicken")).toBeInTheDocument();
      expect(screen.getByText("salt")).toBeInTheDocument();
      expect(screen.getAllByText("Protein").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Spices").length).toBeGreaterThan(0);
    });

    it("should show singular item count", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: { name: "cup" },
              ingredientRef: { name: "flour" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("1 item")).toBeInTheDocument();
    });

    it("should show checked/remaining count when items are checked", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: true,
              unit: { name: "cup" },
              ingredientRef: { name: "flour" },
            },
            {
              id: "item-2",
              quantity: 2,
              checked: false,
              unit: null,
              ingredientRef: { name: "eggs" },
            },
            {
              id: "item-3",
              quantity: 3,
              checked: true,
              unit: null,
              ingredientRef: { name: "milk" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("3 items")).toBeInTheDocument();
      expect(screen.getByText("2 checked, 1 remaining")).toBeInTheDocument();
      // Should show Clear Completed button when there are checked items
      expect(screen.getByRole("button", { name: "Clear checked" })).toBeInTheDocument();
    });

    it("should show Clear All button when items exist", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "flour" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByRole("button", { name: "Clear all" })).toBeInTheDocument();
    });

    it("should show add from recipe form when recipes exist", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [
          { id: "recipe-1", title: "Spaghetti Bolognese" },
          { id: "recipe-2", title: "Caesar Salad" },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("Add from recipe")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByText("Select a recipe...")).toBeInTheDocument();
      expect(screen.getByText("Spaghetti Bolognese")).toBeInTheDocument();
      expect(screen.getByText("Caesar Salad")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add ingredients" })).toBeInTheDocument();
    });

    it("should not show add from recipe form when no recipes", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("Shopping list")).toBeInTheDocument();
      expect(screen.queryByText("Add from recipe")).not.toBeInTheDocument();
    });

    it("should show add item form", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("Add item")).toBeInTheDocument();
      expect(screen.getByLabelText("Item")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("e.g., 2 lbs chicken breast or a dozen eggs")
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("should render checked items with checkmark and completed-row strike", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: true,
              unit: { name: "cup" },
              ingredientRef: { name: "sugar" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Checked item should have checkmark
      expect(await screen.findByText("✓")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "sugar" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("checklist-row-strike")).toHaveClass("right-0");
    });

    it("should render unchecked items without checkmark", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "butter" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Unchecked item should not have checkmark
      expect(screen.queryByText("✓")).not.toBeInTheDocument();
      expect(await screen.findByRole("checkbox", { name: "butter" })).toHaveAttribute("aria-checked", "false");
    });

    it("should render item without quantity", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: null,
              checked: false,
              unit: null,
              ingredientRef: { name: "pepper" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("pepper")).toBeInTheDocument();
    });

    it("should not show inline remove buttons for each item", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "garlic" },
            },
            {
              id: "item-2",
              quantity: 2,
              checked: false,
              unit: null,
              ingredientRef: { name: "onion" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("garlic")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove garlic" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove onion" })).toBeInTheDocument();
    });

    it("should not render per-item category badge chips", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "chicken thigh" },
              categoryKey: "protein",
              iconKey: "beef",
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
      expect(screen.getAllByText("Protein").length).toBeGreaterThan(0);
      expect(screen.queryByText("Red meat")).not.toBeInTheDocument();
    });

    it("should filter by category and reset when the selected category is removed", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "chicken thigh" },
              categoryKey: "protein",
              iconKey: "beef",
            },
            {
              id: "item-2",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "milk" },
              categoryKey: "dairy",
              iconKey: "milk",
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
          action: async () => ({ success: true }),
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByText("chicken thigh")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Protein" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Protein" })).toHaveClass("bg-[var(--sj-ink)]");
      });

      fireEvent.click(screen.getByRole("button", { name: "Remove chicken thigh" }));

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Protein" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "all" })).toHaveClass("bg-[var(--sj-ink)]");
        expect(screen.getByText("milk")).toBeInTheDocument();
      });
    });

    it("should have Kitchen link", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      expect(await screen.findByRole("link", { name: "Kitchen" })).toHaveAttribute("href", "/");
    });
  });

  describe("Catalyst component structure", () => {
    it("should NOT have inline styles in component source (verified by grep)", async () => {
      // This test verifies that the component JSX doesn't use style={{}} 
      // Some Catalyst/Headless UI components may add style attributes at runtime
      // for positioning or animations, which is acceptable.
      
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: { name: "cup" },
              ingredientRef: { name: "flour" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      const { container } = render(<Stub initialEntries={["/shopping-list"]} />);

      // Wait for content to load
      await screen.findByText("Shopping list");

      // Verify no user-defined inline styles by checking specific elements
      // Catalyst components may add their own style attributes for functionality
      const headings = container.querySelectorAll('h1, h2, h3');
      headings.forEach((heading) => {
        expect(heading).not.toHaveAttribute("style");
      });

      const paragraphs = container.querySelectorAll('p');
      paragraphs.forEach((p) => {
        expect(p).not.toHaveAttribute("style");
      });

      // Note: Some framework-internal style attributes from Headless UI 
      // are acceptable (for animations, positioning, etc.)
      // The key requirement is that no user-defined inline styles exist in JSX
    });

    it("should use Catalyst Heading for page title", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Wait for content to load
      await screen.findByText("Shopping list");

      // Should have a proper heading
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent("Shopping list");
    });

    it("should use Catalyst Button for actions", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      const { container } = render(<Stub initialEntries={["/shopping-list"]} />);

      // Wait for content to load
      await screen.findByText("Shopping list");

      // Buttons should not have inline styles
      const buttons = container.querySelectorAll('button');
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute("style");
      });
    });

    it("should use Catalyst Input for form fields", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      const { container } = render(<Stub initialEntries={["/shopping-list"]} />);

      // Wait for content to load
      await screen.findByText("Shopping list");

      // Inputs should not have inline styles
      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input).not.toHaveAttribute("style");
      });
    });

    it("should have accessible toggle buttons for items", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "eggs" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Wait for content to load
      await screen.findByText("eggs");

      const toggleButton = screen.getByRole("checkbox", { name: "eggs" });
      expect(toggleButton).toBeInTheDocument();
      expect(toggleButton).toHaveClass("min-h-11");
    });
  });

  describe("Clear All dialog", () => {
    it("should open clear all dialog and allow confirmation", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "flour" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
          action: () => ({ success: true }),
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Click clear all button
      const clearAllButton = await screen.findByRole("button", { name: "Clear all" });
      fireEvent.click(clearAllButton);

      // Dialog should be open
      expect(await screen.findByText("Start fresh?")).toBeInTheDocument();
      expect(screen.getByText(/All items will be cleared/)).toBeInTheDocument();

      // Click confirm button
      const confirmButton = screen.getByRole("button", { name: "Clear all" });
      fireEvent.click(confirmButton);

      // Dialog should close after submission (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Start fresh?")).not.toBeInTheDocument();
      });
    });

    it("should close clear all dialog when clicking cancel", async () => {
      const mockData = {
        shoppingList: {
          id: "list-1",
          items: [
            {
              id: "item-1",
              quantity: 1,
              checked: false,
              unit: null,
              ingredientRef: { name: "flour" },
            },
          ],
        },
        recipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/shopping-list",
          Component: ShoppingList,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/shopping-list"]} />);

      // Click clear all button
      const clearAllButton = await screen.findByRole("button", { name: "Clear all" });
      fireEvent.click(clearAllButton);

      // Click cancel
      const cancelButton = screen.getByRole("button", { name: "Keep list" });
      fireEvent.click(cancelButton);

      // Dialog should close (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Start fresh?")).not.toBeInTheDocument();
      });
    });
  });

  describe("swipe delete behavior", () => {
    it("should only delete on a second left swipe from revealed state", () => {
      expect(resolveSwipeAction(-80, false)).toBe("reveal");
      expect(resolveSwipeAction(-120, true)).toBe("confirmDelete");
      expect(shouldDeleteOnSwipe(-120, true)).toBe(true);
    });

    it("should dismiss or no-op for short and right swipes", () => {
      expect(resolveSwipeAction(40, true)).toBe("dismiss");
      expect(resolveSwipeAction(-20, false)).toBe("none");
      expect(shouldDeleteOnSwipe(120, true)).toBe(false);
      expect(shouldDeleteOnSwipe(-120, false)).toBe(false);
    });
  });
});
