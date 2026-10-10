import {
  Apple,
  Beef,
  Carrot,
  Citrus,
  CookingPot,
  Droplets,
  Drumstick,
  Egg,
  Fish,
  Leaf,
  LucideIcon,
  Milk,
  Package,
  Sandwich,
  Wheat,
} from "lucide-react";

export type IngredientCategoryKey =
  | "produce"
  | "protein"
  | "dairy"
  | "pantry"
  | "bakery"
  | "frozen"
  | "spices"
  | "other";

export type IngredientIconKey =
  | "leaf"
  | "carrot"
  | "citrus"
  | "apple"
  | "drumstick"
  | "beef"
  | "fish"
  | "egg"
  | "milk"
  | "wheat"
  | "droplets"
  | "package"
  | "pot"
  | "sandwich";

export type IngredientAffordance = {
  categoryKey: IngredientCategoryKey;
  categoryLabel: string;
  iconKey: IngredientIconKey;
  iconLabel: string;
};

const CATEGORY_LABELS: Record<IngredientCategoryKey, string> = {
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  pantry: "Pantry",
  bakery: "Bakery",
  frozen: "Frozen",
  spices: "Spices",
  other: "Other",
};

const ICON_LABELS: Record<IngredientIconKey, string> = {
  leaf: "Leafy greens",
  carrot: "Vegetable",
  citrus: "Citrus",
  apple: "Fruit",
  drumstick: "Chicken",
  beef: "Red meat",
  fish: "Seafood",
  egg: "Egg",
  milk: "Dairy",
  wheat: "Grain",
  droplets: "Liquid",
  package: "Packaged",
  pot: "Spice",
  sandwich: "Bread",
};

const GENERIC_ICON_KEYS: IngredientIconKey[] = ["package"];

type KeywordRule = {
  keywords: string[];
  categoryKey: IngredientCategoryKey;
  iconKey: IngredientIconKey;
};

// Each keyword is matched as whole words (with an optional plural "s" or "es" on its last word),
// never as a substring, so "can" does not match "pecan" and "egg" does not match "eggplant".
const KEYWORD_RULES: KeywordRule[] = [
  // Pantry staples whose names start with a fresh ingredient.
  { keywords: ["tomato paste", "tomato sauce", "tomato puree", "crushed tomato", "diced tomato", "sun dried tomato", "sun-dried tomato", "peanut butter", "almond butter", "coconut milk", "coconut cream", "curry paste", "miso", "miso paste", "can", "canned", "jar", "breadcrumb", "panko"], categoryKey: "pantry", iconKey: "package" },
  { keywords: ["walnut", "pecan", "almond", "cashew", "pistachio", "peanut", "hazelnut", "pine nut", "sesame", "seed", "chia", "flaxseed", "raisin", "chocolate", "chocolate chip", "cocoa", "cocoa powder"], categoryKey: "pantry", iconKey: "package" },
  { keywords: ["flour", "rice", "oat", "oats", "pasta", "spaghetti", "penne", "noodle", "egg noodle", "quinoa", "couscous", "barley", "sugar", "brown sugar", "powdered sugar", "cornstarch", "corn starch", "baking soda", "baking powder", "yeast", "cornmeal", "polenta", "honey", "maple syrup", "molasses", "syrup"], categoryKey: "pantry", iconKey: "wheat" },
  { keywords: ["oil", "olive oil", "vinegar", "broth", "stock", "bouillon", "water", "soy sauce", "tamari", "sauce", "fish sauce", "hot sauce", "worcestershire", "ketchup", "mustard", "mayonnaise", "mayo", "wine", "mirin", "vanilla", "vanilla extract", "extract"], categoryKey: "pantry", iconKey: "droplets" },
  { keywords: ["beans", "black beans", "kidney beans", "lentil", "chickpea"], categoryKey: "pantry", iconKey: "package" },

  { keywords: ["basil", "cilantro", "parsley", "dill", "chive", "sage", "mint", "rosemary sprig", "lettuce", "spinach", "kale", "arugula", "herb", "fresh herb", "scallion", "green onion", "fresh thyme", "fresh rosemary", "fresh oregano", "fresh sage", "spring onion", "leek", "chard", "bok choy"], categoryKey: "produce", iconKey: "leaf" },
  { keywords: ["lime", "lemon", "orange", "grapefruit", "citrus", "lemon juice", "lime juice", "lemon zest", "lime zest"], categoryKey: "produce", iconKey: "citrus" },
  { keywords: ["carrot", "onion", "red onion", "shallot", "garlic", "garlic clove", "tomato", "cherry tomato", "potato", "sweet potato", "broccoli", "cauliflower", "zucchini", "cucumber", "celery", "fennel", "eggplant", "cabbage", "radicchio", "bell pepper", "red pepper", "green pepper", "jalapeno", "jalapeño", "chili", "chile", "mushroom", "corn", "pea", "green bean", "asparagus", "squash", "pumpkin", "beet", "radish", "fresh ginger", "ginger root", "ginger"], categoryKey: "produce", iconKey: "carrot" },
  { keywords: ["apple", "banana", "berry", "strawberry", "blueberry", "raspberry", "avocado", "mango", "pear", "peach", "grape", "pineapple", "cherry"], categoryKey: "produce", iconKey: "apple" },

  { keywords: ["chicken", "chicken breast", "chicken thigh", "thigh", "drumstick", "wing", "breast"], categoryKey: "protein", iconKey: "drumstick" },
  { keywords: ["beef", "steak", "ground beef", "pork", "pork chop", "bacon", "ham", "lamb", "sausage", "turkey", "ground turkey", "chorizo", "prosciutto"], categoryKey: "protein", iconKey: "beef" },
  { keywords: ["salmon", "tuna", "cod", "fish", "shrimp", "prawn", "scallop", "anchovy", "anchovies"], categoryKey: "protein", iconKey: "fish" },
  { keywords: ["egg", "egg white", "egg yolk"], categoryKey: "protein", iconKey: "egg" },
  { keywords: ["tofu", "tempeh"], categoryKey: "protein", iconKey: "package" },

  { keywords: ["milk", "cream", "heavy cream", "sour cream", "whipping cream", "yogurt", "greek yogurt", "cheese", "cream cheese", "butter", "half and half", "mozzarella", "ricotta", "feta", "parmesan", "cheddar", "buttermilk", "creme fraiche", "crème fraîche", "mascarpone", "ghee"], categoryKey: "dairy", iconKey: "milk" },

  { keywords: ["bread", "bun", "roll", "tortilla", "bagel", "pita", "baguette", "naan", "croissant"], categoryKey: "bakery", iconKey: "sandwich" },

  { keywords: ["salt", "kosher salt", "sea salt", "garlic salt", "pepper", "black pepper", "white pepper", "peppercorn", "red pepper flakes", "crushed red pepper", "chili flakes", "chili powder", "cayenne", "cumin", "paprika", "smoked paprika", "oregano", "thyme", "rosemary", "bay leaf", "spice", "seasoning", "powder", "garlic powder", "onion powder", "cinnamon", "ground cinnamon", "ground ginger", "nutmeg", "clove", "cardamom", "turmeric", "coriander", "curry powder", "allspice", "saffron", "star anise", "fennel seed", "cumin seed", "mustard seed", "za'atar", "sumac", "garam masala", "five spice", "italian seasoning", "dried herb", "dried oregano", "dried thyme", "dried basil"], categoryKey: "spices", iconKey: "pot" },
];

type CompiledKeyword = { words: string[]; rule: KeywordRule; length: number };

const COMPILED_KEYWORDS: CompiledKeyword[] = KEYWORD_RULES.flatMap((rule) =>
  rule.keywords.map((keyword) => ({ words: keyword.split(" "), rule, length: keyword.length })),
);

function wordMatches(token: string, word: string, isLastWord: boolean): boolean {
  if (token === word) return true;
  // Plurals on the last word only: "lemons", "tomatoes", "berries".
  if (!isLastWord) return false;
  if (token === `${word}s` || token === `${word}es`) return true;
  return word.endsWith("y") && token === `${word.slice(0, -1)}ies`;
}

// The words an ingredient line names, without amounts, notes in parentheses, or anything after a
// comma ("chicken stock, low sodium" names "chicken stock").
export function ingredientNameTokens(name: string): string[] {
  const head = name.toLowerCase().replace(/\([^)]*\)/g, " ").split(",")[0];
  return head.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
}

// Finds the aisle for an ingredient. The most specific match wins: a keyword that ends on the
// ingredient's last word (its head noun, as in "chicken STOCK" or "garlic POWDER") beats one that
// doesn't, and a longer keyword beats a shorter one ("bell pepper" over "pepper"). Anything frozen
// goes to Frozen whatever it is.
function findRule(name: string): KeywordRule | null {
  const tokens = ingredientNameTokens(name);
  if (tokens.includes("frozen") || tokens.join(" ").includes("ice cream")) return FROZEN_RULE;

  let best: { rule: KeywordRule; endsOnHead: boolean; length: number } | null = null;
  for (const keyword of COMPILED_KEYWORDS) {
    const { words } = keyword;
    for (let start = 0; start + words.length <= tokens.length; start += 1) {
      const end = start + words.length - 1;
      const matches = words.every((word, offset) => wordMatches(tokens[start + offset], word, offset === words.length - 1));
      if (!matches) continue;
      const candidate = { rule: keyword.rule, endsOnHead: end === tokens.length - 1, length: keyword.length };
      if (
        !best ||
        (candidate.endsOnHead && !best.endsOnHead) ||
        (candidate.endsOnHead === best.endsOnHead && candidate.length > best.length)
      ) {
        best = candidate;
      }
    }
  }
  return best?.rule ?? null;
}

const FROZEN_RULE: KeywordRule = { keywords: ["frozen", "ice cream"], categoryKey: "frozen", iconKey: "package" };

export function inferIngredientAffordance(name: string): IngredientAffordance {
  const match = findRule(name);

  const categoryKey = match?.categoryKey ?? "other";
  const iconKey = match?.iconKey ?? "package";

  return {
    categoryKey,
    categoryLabel: CATEGORY_LABELS[categoryKey],
    iconKey,
    iconLabel: ICON_LABELS[iconKey],
  };
}

export function resolveIngredientAffordance(
  ingredientName: string,
  categoryKey: string | null | undefined,
  iconKey: string | null | undefined
): IngredientAffordance {
  const inferred = inferIngredientAffordance(ingredientName);
  const safeCategory = (categoryKey && categoryKey in CATEGORY_LABELS
    ? categoryKey
    : inferred.categoryKey) as IngredientCategoryKey;
  const submittedIcon = (iconKey && iconKey in ICON_LABELS ? iconKey : null) as IngredientIconKey | null;
  const safeIcon = submittedIcon && !GENERIC_ICON_KEYS.includes(submittedIcon)
    ? submittedIcon
    : inferred.iconKey;

  return {
    categoryKey: safeCategory,
    categoryLabel: CATEGORY_LABELS[safeCategory],
    iconKey: safeIcon,
    iconLabel: ICON_LABELS[safeIcon],
  };
}

export const INGREDIENT_ICON_COMPONENTS: Record<IngredientIconKey, LucideIcon> = {
  leaf: Leaf,
  carrot: Carrot,
  citrus: Citrus,
  apple: Apple,
  drumstick: Drumstick,
  beef: Beef,
  fish: Fish,
  egg: Egg,
  milk: Milk,
  wheat: Wheat,
  droplets: Droplets,
  package: Package,
  pot: CookingPot,
  sandwich: Sandwich,
};
