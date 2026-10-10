import { describe, expect, it } from "vitest";
import { inferIngredientAffordance, resolveIngredientAffordance } from "~/lib/ingredient-affordances";

describe("ingredient affordance mapping", () => {
  it("maps lime to produce", () => {
    const affordance = inferIngredientAffordance("lime");

    expect(affordance.categoryKey).toBe("produce");
    expect(affordance.iconKey).toBe("citrus");
  });

  it("maps coconut milk to pantry", () => {
    const affordance = inferIngredientAffordance("coconut milk");

    expect(affordance.categoryKey).toBe("pantry");
    expect(affordance.iconKey).toBe("package");
  });

  it.each([
    ["fresh mozzarella", "dairy", "milk"],
    ["pistachios", "pantry", "package"],
    ["miso paste", "pantry", "package"],
    ["dill", "produce", "leaf"],
    ["tomato paste", "pantry", "package"],
  ] as const)("maps realistic cookbook ingredient %s", (name, categoryKey, iconKey) => {
    const affordance = inferIngredientAffordance(name);

    expect(affordance.categoryKey).toBe(categoryKey);
    expect(affordance.iconKey).toBe(iconKey);
  });

  it("uses ingredient-specific icon intent for chicken thigh", () => {
    const affordance = resolveIngredientAffordance("chicken thigh", "protein", null);

    expect(affordance.categoryKey).toBe("protein");
    expect(affordance.iconKey).toBe("drumstick");
  });

  it("keeps a submitted specific icon over inferred defaults", () => {
    const affordance = resolveIngredientAffordance("mystery ingredient", "pantry", "citrus");

    expect(affordance.categoryKey).toBe("pantry");
    expect(affordance.iconKey).toBe("citrus");
    expect(affordance.iconLabel).toBe("Citrus");
  });

  it("falls back to inferred icon when submitted icon is generic", () => {
    const affordance = resolveIngredientAffordance("fresh basil", "produce", "package");

    expect(affordance.categoryKey).toBe("produce");
    expect(affordance.iconKey).toBe("leaf");
  });

  it("falls back to inferred category when submitted category is invalid", () => {
    const affordance = resolveIngredientAffordance("fresh basil", "not-a-category", "leaf");

    expect(affordance.categoryKey).toBe("produce");
    expect(affordance.categoryLabel).toBe("Produce");
    expect(affordance.iconKey).toBe("leaf");
  });
});

describe("aisle classifier: the most specific match wins", () => {
  // [ingredient, expected aisle, why]
  it.each([
    ["chicken stock", "pantry", "head noun stock beats chicken"],
    ["chicken stock, low sodium", "pantry", "notes after a comma are ignored"],
    ["low-sodium chicken broth", "pantry", "broth"],
    ["beef broth", "pantry", "broth beats beef"],
    ["vegetable stock (homemade)", "pantry", "parenthetical ignored"],
    ["chicken thighs", "protein", "plural head noun"],
    ["boneless chicken breast", "protein", "chicken breast"],
    ["chicken", "protein", "plain protein"],
    ["tomato sauce", "pantry", "sauce, not produce"],
    ["tomatoes", "produce", "plural tomato"],
    ["cherry tomatoes", "produce", "cherry tomato, not fruit"],
    ["garlic powder", "spices", "powder beats garlic"],
    ["garlic salt", "spices", "salt beats garlic"],
    ["garlic", "produce", "fresh garlic"],
    ["garlic cloves", "produce", "garlic clove beats clove"],
    ["ground cloves", "spices", "clove spice"],
    ["bell pepper", "produce", "bell pepper beats pepper"],
    ["red bell peppers", "produce", "plural bell pepper"],
    ["black pepper", "spices", "pepper spice"],
    ["red pepper flakes", "spices", "flakes"],
    ["crushed red pepper", "spices", "crushed red pepper beats red pepper"],
    ["ground cinnamon", "spices", "cinnamon"],
    ["cinnamon", "spices", "cinnamon"],
    ["ginger", "produce", "fresh ginger root"],
    ["ground ginger", "spices", "ground ginger beats ginger"],
    ["cardamom", "spices", "cardamom"],
    ["cornstarch", "pantry", "baking"],
    ["vanilla extract", "pantry", "baking"],
    ["vanilla", "pantry", "baking"],
    ["baking powder", "pantry", "baking powder beats powder"],
    ["cocoa powder", "pantry", "cocoa powder beats powder"],
    ["brown sugar", "pantry", "sugar"],
    ["eggplant", "produce", "not egg"],
    ["eggs", "protein", "plural egg"],
    ["egg noodles", "pantry", "noodle head"],
    ["pecans", "pantry", "not can"],
    ["canned chickpeas", "pantry", "chickpea"],
    ["goat cheese", "dairy", "not oat"],
    ["peanut butter", "pantry", "not dairy butter"],
    ["unsalted butter", "dairy", "butter"],
    ["sour cream", "dairy", "cream"],
    ["coconut milk", "pantry", "not dairy milk"],
    ["frozen peas", "frozen", "frozen wins"],
    ["vanilla ice cream", "frozen", "ice cream"],
    ["fresh thyme", "produce", "fresh herb"],
    ["thyme", "spices", "dried herb by default"],
    ["lemon juice", "produce", "citrus"],
    ["lemons", "produce", "plural lemon"],
    ["blueberries", "produce", "berries plural"],
    ["olive oil", "pantry", "oil"],
    ["fish sauce", "pantry", "sauce beats fish"],
    ["salmon fillet", "protein", "salmon when the head noun is unknown"],
    ["corn tortillas", "bakery", "tortilla head"],
    ["sourdough bread", "bakery", "bread"],
    ["saffron", "spices", "saffron"],
    ["mystery ingredient", "other", "nothing matches"],
    ["", "other", "empty name"],
  ] as const)("puts %s in %s (%s)", (name, categoryKey) => {
    expect(inferIngredientAffordance(name).categoryKey).toBe(categoryKey);
  });
});
