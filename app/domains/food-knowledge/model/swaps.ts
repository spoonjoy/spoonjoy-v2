// Ingredient swaps: what a cook can use instead when a recipe's ingredient isn't in the kitchen.
//
// Each line is a common kitchen substitution, written for a cook mid-recipe: what to use and, where it matters, how much
// and when it works ("in baking"). A food is found by its name as a recipe writes it, ignoring case, a plural "s" and
// a word cooks put in front (large, unsalted, fresh). Only the whole name matches, so "peanut butter" is not butter.

interface SwapEntry {
  names: readonly string[];
  swaps: readonly string[];
}

const SWAPS: readonly SwapEntry[] = [
  {
    names: ["buttermilk"],
    swaps: ["milk with 1 tbsp lemon juice or vinegar per cup, left 5 minutes", "plain yogurt thinned with a little milk"],
  },
  { names: ["egg"], swaps: ["in baking, 1 tbsp ground flaxseed stirred into 3 tbsp water per egg"] },
  { names: ["butter"], swaps: ["in cooking, olive oil, ¾ as much"] },
  { names: ["sour cream"], swaps: ["plain Greek yogurt"] },
  { names: ["heavy cream", "double cream", "whipping cream"], swaps: ["in sauces, ¾ cup milk with ¼ cup melted butter per cup"] },
  { names: ["self-raising flour", "self-rising flour"], swaps: ["plain flour with 1 ½ tsp baking powder and ¼ tsp salt per cup"] },
  { names: ["cake flour"], swaps: ["plain flour less 2 tbsp per cup, made up with 2 tbsp cornstarch"] },
  { names: ["brown sugar"], swaps: ["white sugar with 1 tbsp molasses per cup"] },
  { names: ["honey"], swaps: ["maple syrup"] },
  { names: ["cornstarch", "cornflour"], swaps: ["to thicken, plain flour, twice as much"] },
  { names: ["baking powder"], swaps: ["¼ tsp baking soda with ½ tsp cream of tartar per tsp"] },
  { names: ["lemon juice"], swaps: ["lime juice", "white wine vinegar, half as much"] },
  { names: ["shallot"], swaps: ["red onion, a little less"] },
  { names: ["garlic clove", "clove garlic", "garlic"], swaps: ["⅛ tsp garlic powder per clove"] },
  { names: ["white wine"], swaps: ["in cooking, stock with a splash of white wine vinegar"] },
  { names: ["mayonnaise"], swaps: ["plain Greek yogurt"] },
  { names: ["breadcrumbs", "bread crumbs", "panko"], swaps: ["crushed crackers", "rolled oats"] },
];

// Words a cook writes before a food that don't change what it is.
const LEADING_WORDS = new Set(["large", "medium", "small", "fresh", "unsalted", "salted", "light", "dark", "packed", "full-fat", "whole", "plain", "dry"]);

function singular(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function normalize(name: string): string {
  return name.toLowerCase().trim().split(/\s+/).map(singular).join(" ");
}

const SWAPS_BY_NAME = new Map(SWAPS.flatMap((entry) => entry.names.map((name) => [normalize(name), entry.swaps] as const)));

/** What a cook can use instead of the ingredient named `name`, most useful first; none for a food Spoonjoy has no swap for. */
export function swapsFor(name: string | null | undefined): readonly string[] {
  const words = normalize(name ?? "").split(" ");
  while (words.length > 1 && LEADING_WORDS.has(words[0] as string)) words.shift();
  return SWAPS_BY_NAME.get(words.join(" ")) ?? [];
}
