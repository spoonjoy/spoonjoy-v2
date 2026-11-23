// A small kitchen written the way the other app's backup writes database.json, for the move-in
// tests: GUIDs undashed (SQLite) or dashed (Postgres), and the tables of a 1.x, 2.x or 3.x server.
// Real exports from real servers are the move-in proof fixtures; this is the unit-test stand-in.

export type GuidStyle = "sqlite" | "postgres";
export type Major = 1 | 2 | 3;

const REVISIONS: Record<Major, string> = { 1: "32d69327997b", 2: "7cf3054cbbcc", 3: "f3a1ae61d772" };

export function guid(n: number, style: GuidStyle = "postgres"): string {
  const hex = n.toString(16).padStart(32, "0");
  if (style === "sqlite") return hex;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function dashed(n: number): string {
  return guid(n, "postgres");
}

export function mealieDatabase({ style = "sqlite", major = 3 }: { style?: GuidStyle; major?: Major } = {}) {
  const g = (n: number) => guid(n, style);
  const group = g(1);
  const otherGroup = g(2);
  const household = g(3);
  const owner = g(10);
  const member = g(11);
  const stranger = g(12);
  const [tagQuick, catDinner, toolPan] = [g(20), g(21), g(22)];
  const [food, unit] = [g(30), g(31)];
  const [pancakes, soup, untitled, elsewhere] = [g(100), g(101), g(102), g(103)];
  const [step1, step2, soupStep] = [g(200), g(201), g(202)];
  const [refFlour, refMilk, refSalt, refStock] = [g(300), g(301), g(302), g(303)];

  const tables: Record<string, Array<Record<string, unknown>>> = {
    alembic_version: [{ version_num: REVISIONS[major] }],
    groups: [
      { id: group, name: "Home", slug: "home" },
      { id: otherGroup, name: "Neighbours", slug: "neighbours" },
    ],
    users: [
      { id: owner, email: "Cook@Example.com", full_name: "Casey Cook", group_id: group, ...(major >= 2 ? { household_id: household } : {}) },
      { id: member, email: "sam@example.com", full_name: "Sam Cook", group_id: group, ...(major >= 2 ? { household_id: household } : {}) },
      { id: stranger, email: "pat@example.com", full_name: "Pat", group_id: otherGroup },
    ],
    tags: [{ id: tagQuick, group_id: group, name: "Quick", slug: "quick" }],
    categories: [{ id: catDinner, group_id: group, name: "Dinner", slug: "dinner" }],
    tools: [{ id: toolPan, group_id: group, name: "Skillet", slug: "skillet" }],
    ingredient_foods: [{ id: food, group_id: group, name: "flour", plural_name: null }],
    ingredient_units: [{ id: unit, group_id: group, name: "cup", plural_name: "cups", abbreviation: "c" }],
    recipes: [
      {
        id: pancakes, slug: "pancakes", group_id: group, user_id: owner, name: "Pancakes",
        description: "Fluffy ones.", recipe_yield: "4 servings", org_url: "https://example.com/pancakes",
        update_at: "2026-01-05T10:00:00.123456", image: "Xy7a",
      },
      {
        id: soup, slug: "soup", group_id: group, user_id: member, name: "Soup", description: null,
        recipe_yield: null, recipe_servings: 6, org_url: null, update_at: null,
      },
      { id: untitled, slug: "untitled", group_id: group, user_id: owner, name: "  ", description: "", recipe_yield: "" },
      { id: elsewhere, slug: "elsewhere", group_id: otherGroup, user_id: stranger, name: "Not ours" },
    ],
    recipe_settings: [
      { id: 1, recipe_id: pancakes, disable_amount: false },
      { id: 2, recipe_id: soup, disable_amount: true },
    ],
    recipe_instructions: [
      { id: step2, recipe_id: pancakes, position: 1, title: "", text: "Cook on the skillet.", summary: null },
      { id: step1, recipe_id: pancakes, position: 0, title: "Batter", text: "Whisk the flour and milk.", summary: "Mix" },
      { id: soupStep, recipe_id: soup, position: 0, title: null, text: "Simmer everything.", summary: null },
    ],
    recipes_ingredients: [
      { id: 1, recipe_id: pancakes, position: 0, title: "For the batter", food_id: food, unit_id: unit, quantity: 1.5, note: "sifted", original_text: "1 1/2 cups flour, sifted", reference_id: refFlour },
      { id: 2, recipe_id: pancakes, position: 1, title: null, food_id: null, unit_id: null, quantity: 0, note: "1 cup milk", original_text: null, reference_id: refMilk },
      { id: 3, recipe_id: pancakes, position: 2, title: "", food_id: null, unit_id: null, quantity: null, note: null, original_text: "salt to taste", reference_id: refSalt },
      { id: 4, recipe_id: soup, position: 0, title: null, food_id: null, unit_id: null, quantity: 1, note: "2 cups stock", original_text: null, reference_id: refStock },
      { id: 5, recipe_id: soup, position: 1, title: null, food_id: null, unit_id: null, quantity: 1, note: null, original_text: null, reference_id: null },
    ],
    recipe_ingredient_ref_link: [
      { id: g(400), instruction_id: step1, reference_id: refFlour },
      { id: g(401), instruction_id: step1, reference_id: refMilk },
      { id: g(402), instruction_id: step2, reference_id: refFlour },
      { id: g(403), instruction_id: step2, reference_id: g(999) },
    ],
    notes: [
      { id: 1, recipe_id: pancakes, title: "Storage", text: "Freezes well." },
      { id: 2, recipe_id: pancakes, title: null, text: null },
    ],
    recipes_to_tags: [{ recipe_id: pancakes, tag_id: tagQuick }, { recipe_id: pancakes, tag_id: g(998) }],
    recipes_to_categories: [{ recipe_id: pancakes, category_id: catDinner }],
    recipes_to_tools: [{ recipe_id: soup, tool_id: toolPan }],
    long_live_tokens: [{ id: 1, token: "secret-token", user_id: owner }],
  };
  if (major >= 2) tables.households = [{ id: household, name: "Family", group_id: group }];
  return {
    tables,
    keys: {
      group: dashed(1), otherGroup: dashed(2), owner: dashed(10), member: dashed(11),
      pancakes: dashed(100), soup: dashed(101), untitled: dashed(102), elsewhere: dashed(103),
      step1: dashed(200), step2: dashed(201), soupStep: dashed(202),
    },
  };
}
