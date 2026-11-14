// The shopping list's actions, each declared once with Ouro UI's action model. The MCP tools keep the names and inputs
// agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail, searchLimit, searchQuery } from "./fields.mts";

/** The person's quick add on the shopping list, and the MCP tool agents already call by this name. */
export const addShoppingListItem = defineAction({
  id: "add_shopping_list_item",
  consent: "write",
  label: "Add to list",
  description: "Add an item to your shopping list.",
  agent: "Add or restore one item on the person's shopping list. It adds to the quantity of a matching item still on the list (same ingredient and unit); a removed or cleared matching item comes back at the added quantity, not on top of its old one.",
  input: {
    name: field.string({ label: "Item", description: "What to buy, such as eggs or flour.", arg: true, ask: "What should I add to your shopping list?" }),
    quantity: field.number({ label: "Quantity", description: "How many or how much, as a number above 0. Leave it out when it doesn't matter.", optional: true, min: 0 }),
    unit: field.string({ label: "Unit", description: "The unit for the quantity, such as grams, cups or cans. Leave it out for a plain count.", optional: true }),
    categoryKey: field.string({ label: "Category", description: "Optional. The aisle's category key, such as produce or pantry.", optional: true, protocolOnly: true }),
    iconKey: field.string({ label: "Icon", description: "Optional. The item's icon key, such as wheat or package.", optional: true, protocolOnly: true }),
    idempotencyKey: idempotencyKey("Optional. Send the same key again when retrying this exact call, such as after a timeout, and the item is added once."),
    ownerEmail: field.string({ label: "Owner", description: "Optional. Whose list, for a local server with no signed-in person; a signed-in caller always acts on their own list.", optional: true, protocolOnly: true }),
  },
  output: {},
  cli: "list add",
});

export const getShoppingList = defineAction({
  id: "get_shopping_list",
  consent: "read",
  label: "Get shopping list",
  description: "See your shopping list.",
  agent: "Fetch the configured owner shopping list.",
  input: { ownerEmail },
  output: {},
});

export const searchShoppingList = defineAction({
  id: "search_shopping_list",
  consent: "read",
  label: "Search shopping list",
  description: "Find items on your shopping list.",
  agent: "Full-text search the configured owner's private shopping list by ingredient, unit, category, icon, and checked state. Without commas every query word must match; commas separate alternatives, so a result matching any of them is returned, ordered by how many alternatives it matches, and at most 12 alternatives are used.",
  input: { ownerEmail, query: searchQuery, limit: searchLimit },
  output: {},
});

export const setShoppingListItemChecked = defineAction({
  id: "set_shopping_list_item_checked",
  consent: "write",
  label: "Check shopping-list item",
  description: "Tick an item off your shopping list, or put it back.",
  agent: "Set checked state for one active item on the configured owner shopping list.",
  input: {
    ownerEmail,
    itemId: field.string({ label: "Item", description: "The item's id, from get_shopping_list." }),
    checked: field.boolean({ label: "Checked", description: "True to check the item off, false to uncheck it." }),
  },
  output: {},
  idempotent: true,
});

export const removeShoppingListItem = defineAction({
  id: "remove_shopping_list_item",
  consent: "write",
  label: "Remove shopping-list item",
  description: "Take an item off your shopping list.",
  agent: "Soft-remove one item from the configured owner shopping list.",
  input: {
    ownerEmail,
    itemId: field.string({ label: "Item", description: "The item's id, from get_shopping_list." }),
  },
  output: {},
  destructive: true,
  idempotent: true,
});

export const addRecipeToShoppingList = defineAction({
  id: "add_recipe_to_shopping_list",
  consent: "write",
  label: "Add recipe to shopping list",
  description: "Add a recipe's ingredients to your shopping list.",
  agent: "Add all ingredients from a recipe to the configured owner shopping list. Each ingredient adds to the quantity of a matching item still on the list (same ingredient and unit); a removed or cleared matching item comes back at the added quantity, not on top of its old one.",
  input: {
    ownerEmail,
    recipeId: field.string({ label: "Recipe", description: "The recipe whose ingredients to add, by id." }),
    idempotencyKey: idempotencyKey("Optional. Send the same key again when retrying this exact call, such as after a timeout, and the items are added once."),
  },
  output: {},
});

export const shopping = [addShoppingListItem, getShoppingList, searchShoppingList, setShoppingListItemChecked, removeShoppingListItem, addRecipeToShoppingList];
