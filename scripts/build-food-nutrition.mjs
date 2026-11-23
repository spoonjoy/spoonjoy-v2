#!/usr/bin/env node
// Builds app/domains/food-knowledge/data/nutrition.generated.ts from USDA FoodData Central's SR Legacy CSV
// download (CC0; attribution requested: "U.S. Department of Agriculture, Agricultural Research Service.
// FoodData Central"). Run it with the unzipped folder of
// https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip:
//   node scripts/build-food-nutrition.mjs <folder>
// FOODS below names the foods a recipe's ingredients are matched to, each with its FDC id.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Ingredient names (lower case, singular) and the SR Legacy food each one reads as. */
export const FOODS = [
  [["rice", "white rice", "jasmine rice", "basmati rice", "long grain rice"], 168877],
  [["chicken stock", "chicken broth", "stock", "broth"], 172884],
  [["garlic", "garlic clove"], 169230],
  [["onion", "yellow onion", "white onion", "red onion"], 170000],
  [["butter", "salted butter"], 173410],
  [["unsalted butter"], 173430],
  [["egg", "large egg"], 171287],
  [["flour", "all-purpose flour", "all purpose flour", "plain flour"], 168894],
  [["sugar", "granulated sugar", "white sugar", "caster sugar"], 169655],
  [["brown sugar", "light brown sugar", "dark brown sugar"], 168833],
  [["milk", "whole milk"], 171265],
  [["2% milk"], 171267],
  [["olive oil", "extra virgin olive oil", "extra-virgin olive oil"], 171413],
  [["salt", "kosher salt", "sea salt", "table salt"], 173468],
  [["lemon"], 167746],
  [["lemon juice"], 167747],
  [["lime"], 168155],
  [["tomato"], 170457],
  [["canned tomato", "crushed tomato", "diced tomato", "whole peeled tomato"], 170051],
  [["potato"], 170026],
  [["sweet potato"], 168482],
  [["carrot"], 170393],
  [["celery", "celery stalk"], 169988],
  [["parsley", "fresh parsley", "flat-leaf parsley"], 170416],
  [["chicken breast", "boneless skinless chicken breast"], 171077],
  [["chicken thigh", "boneless skinless chicken thigh"], 173627],
  [["ground beef"], 174036],
  [["heavy cream", "heavy whipping cream", "whipping cream", "double cream"], 170859],
  [["cheddar", "cheddar cheese"], 173414],
  [["parmesan", "parmesan cheese", "parmigiano-reggiano"], 171247],
  [["mozzarella", "mozzarella cheese"], 170845],
  [["feta", "feta cheese"], 173420],
  [["cream cheese"], 173418],
  [["sour cream"], 171257],
  [["honey"], 169640],
  [["maple syrup"], 169661],
  [["baking soda"], 175040],
  [["baking powder"], 172803],
  [["vanilla extract", "vanilla"], 173471],
  [["black pepper", "pepper", "ground black pepper"], 170931],
  [["spinach", "baby spinach"], 168462],
  [["bell pepper", "red bell pepper"], 170108],
  [["broccoli"], 170379],
  [["buttermilk"], 170874],
  [["yogurt", "plain yogurt", "greek yogurt"], 171284],
  [["pasta", "spaghetti", "penne"], 169736],
  [["vegetable oil", "canola oil"], 172336],
  [["banana"], 173944],
  [["apple"], 171688],
  [["mushroom", "white mushroom", "button mushroom"], 169251],
  [["ginger", "fresh ginger"], 169231],
  [["basil", "fresh basil"], 172232],
  [["cilantro", "fresh cilantro"], 169997],
  [["avocado"], 171705],
  [["salmon", "salmon fillet"], 175167],
  [["bacon"], 168277],
  [["soy sauce", "tamari"], 174278],
  [["oats", "rolled oats", "old-fashioned oats"], 173904],
  [["black beans"], 175238],
  [["shrimp", "prawn"], 175179],
  [["tofu", "firm tofu"], 172475],
  [["cinnamon", "ground cinnamon"], 171320],
  [["cumin", "ground cumin"], 170923],
  [["paprika"], 171329],
  [["thyme", "fresh thyme"], 173470],
  [["rosemary", "fresh rosemary"], 173473],
  [["cabbage"], 169975],
  [["cucumber"], 168409],
  [["zucchini"], 169291],
  [["peas", "frozen peas", "green peas"], 170016],
  [["corn", "sweet corn"], 169998],
  [["chickpeas", "garbanzo beans"], 173800],
  [["lentils"], 172420],
  [["quinoa"], 168874],
  [["almonds"], 170567],
  [["walnuts"], 170187],
  [["peanut butter"], 172470],
  [["dark chocolate"], 170273],
  [["cocoa powder", "cocoa"], 169593],
  [["vinegar", "white vinegar"], 172237],
  [["apple cider vinegar", "cider vinegar"], 173469],
  [["mustard", "yellow mustard"], 172234],
  [["mayonnaise", "mayo"], 171009],
  [["ketchup"], 168556],
  [["scallion", "green onion", "spring onion"], 170005],
  [["shallot"], 170499],
  [["leek"], 169246],
  [["pork loin"], 167818],
  [["bread", "white bread"], 174924],
  [["cornstarch", "cornflour"], 169698],
  [["yeast", "active dry yeast"], 175043],
  [["coconut milk"], 170172],
  [["kale"], 168421],
  [["romaine", "romaine lettuce", "lettuce"], 169247],
  [["blueberries"], 171711],
  [["strawberries"], 167762],
  [["orange"], 169097],
  [["raisins"], 168165],
];

// Nutrient ids in FDC's nutrient.csv.
const NUTRIENTS = { kcal: "1008", protein: "1003", fat: "1004", carbs: "1005", fiber: "1079" };
// A portion counted one at a time, most telling first: "1 medium onion" weighs what a medium one does.
const EACH = ["medium", "large", "clove", "fruit", "whole", "stalk", "slice", "breast", "thigh", "fillet", "leek", "piece", "small"];
const CUP_PARTS = { cup: 1, tbsp: 16, tablespoon: 16, tsp: 48, teaspoon: 48 };

function readCsv(path) {
  const [header, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const split = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replace(/""/g, '"'));
  const names = split(header);
  return lines.map((line) => Object.fromEntries(split(line).map((value, index) => [names[index], value])));
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

function build(folder) {
  const ids = new Set(FOODS.map(([, id]) => String(id)));
  const descriptions = new Map(readCsv(join(folder, "food.csv")).filter((row) => ids.has(row.fdc_id)).map((row) => [row.fdc_id, row.description]));
  const nutrients = new Map();
  for (const row of readCsv(join(folder, "food_nutrient.csv"))) {
    if (!ids.has(row.fdc_id)) continue;
    const key = Object.entries(NUTRIENTS).find(([, id]) => id === row.nutrient_id)?.[0];
    if (key) nutrients.set(`${row.fdc_id}:${key}`, Number(row.amount));
  }
  const portions = new Map();
  for (const row of readCsv(join(folder, "food_portion.csv"))) {
    if (!ids.has(row.fdc_id)) continue;
    portions.set(row.fdc_id, [...(portions.get(row.fdc_id) ?? []), row]);
  }

  return FOODS.map(([names, id]) => {
    const fdcId = String(id);
    const description = descriptions.get(fdcId);
    if (!description) throw new Error(`No SR Legacy food ${fdcId} for ${names[0]}`);
    const per100g = Object.fromEntries(Object.keys(NUTRIENTS).map((key) => [key, round(nutrients.get(`${fdcId}:${key}`) ?? 0, 1)]));
    const rows = portions.get(fdcId) ?? [];
    const word = (row) => row.modifier.toLowerCase().split(/[\s,(]/)[0];
    const cup = rows.find((row) => word(row) in CUP_PARTS);
    const gramsPerCup = cup ? round((Number(cup.gram_weight) / Number(cup.amount)) * CUP_PARTS[word(cup)], 1) : undefined;
    const each = EACH.map((name) => rows.find((row) => word(row) === name)).find(Boolean);
    const gramsEach = each ? round(Number(each.gram_weight) / Number(each.amount), 1) : undefined;
    return { fdcId: id, description, names, per100g, ...(gramsPerCup ? { gramsPerCup } : {}), ...(gramsEach ? { gramsEach } : {}) };
  });
}

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/build-food-nutrition.mjs <unzipped SR Legacy CSV folder>");
  process.exit(1);
}
const foods = build(folder);
const out = `// Generated by scripts/build-food-nutrition.mjs from USDA FoodData Central's SR Legacy foods (CC0). Do not edit.
// Source: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov
// Nutrients are per 100 g; gramsPerCup turns a volume into grams and gramsEach a counted one ("2 onions").

export interface FoodNutrition {
  fdcId: number;
  description: string;
  names: readonly string[];
  per100g: { kcal: number; protein: number; fat: number; carbs: number; fiber: number };
  gramsPerCup?: number;
  gramsEach?: number;
}

export const FOOD_NUTRITION: readonly FoodNutrition[] = ${JSON.stringify(foods, null, 2)};
`;
writeFileSync("app/domains/food-knowledge/data/nutrition.generated.ts", out);
console.log(`Wrote ${foods.length} foods.`);
