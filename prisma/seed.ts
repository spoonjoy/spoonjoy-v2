/**
 * Database Seed Script for Spoonjoy v2
 *
 * Creates realistic sample data for development including:
 * - Users (password & OAuth authentication)
 * - Recipes with varying complexity
 * - Steps with ingredients and StepOutputUse relationships
 * - Cookbooks organizing recipes
 * - Shopping list items
 *
 * Run with: pnpm db:seed
 * Idempotent: safe to run multiple times
 */

import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";

let prisma: PrismaClient;
let platformDispose: (() => Promise<void>) | undefined;

async function initPrismaForLocalD1() {
  const platform = await getPlatformProxy<{ DB: D1Database }>();

  if (!platform.env?.DB) {
    throw new Error("Cloudflare D1 binding `DB` not found. Check wrangler.json d1_databases configuration.");
  }

  const adapter = new PrismaD1(platform.env.DB);
  prisma = new PrismaClient({ adapter });

  platformDispose = async () => {
    await prisma.$disconnect();
    if (typeof platform.dispose === "function") {
      await platform.dispose();
    }
  };
}

// Constants
const SALT_ROUNDS = 10;

// Logging helper
function log(emoji: string, message: string) {
  console.log(`${emoji}  ${message}`);
}

// ============================================================================
// UNITS
// ============================================================================

const UNITS = [
  "cup",
  "tablespoon",
  "teaspoon",
  "gram",
  "kilogram",
  "ounce",
  "pound",
  "milliliter",
  "liter",
  "piece",
  "slice",
  "clove",
  "pinch",
  "bunch",
  "sprig",
  "can",
  "jar",
  "package",
  "whole",
  "half",
];

async function seedUnits() {
  log("📏", "Seeding units...");

  const units: { id: string; name: string }[] = [];
  for (const name of UNITS) {
    const unit = await prisma.unit.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    units.push(unit);
  }

  log("✅", `Seeded ${units.length} units`);
  return units;
}

// ============================================================================
// INGREDIENT REFERENCES
// ============================================================================

const INGREDIENTS = [
  // Produce
  "onion",
  "garlic",
  "tomato",
  "carrot",
  "celery",
  "bell pepper",
  "jalapeño",
  "ginger",
  "lemon",
  "lime",
  "orange",
  "apple",
  "banana",
  "avocado",
  "spinach",
  "kale",
  "broccoli",
  "cauliflower",
  "zucchini",
  "mushroom",
  "potato",
  "sweet potato",
  "corn",
  "green beans",
  "asparagus",
  "cucumber",
  "lettuce",
  "cilantro",
  "parsley",
  "basil",
  "thyme",
  "rosemary",
  "mint",
  "scallion",
  "shallot",

  // Proteins
  "chicken breast",
  "chicken thigh",
  "ground beef",
  "beef steak",
  "pork chop",
  "bacon",
  "salmon fillet",
  "shrimp",
  "tofu",
  "egg",

  // Dairy
  "butter",
  "milk",
  "heavy cream",
  "sour cream",
  "cream cheese",
  "cheddar cheese",
  "parmesan cheese",
  "mozzarella cheese",
  "feta cheese",
  "yogurt",

  // Pantry
  "olive oil",
  "vegetable oil",
  "sesame oil",
  "flour",
  "sugar",
  "brown sugar",
  "honey",
  "maple syrup",
  "salt",
  "black pepper",
  "paprika",
  "cumin",
  "oregano",
  "chili powder",
  "cayenne pepper",
  "cinnamon",
  "nutmeg",
  "vanilla extract",
  "baking powder",
  "baking soda",
  "rice",
  "pasta",
  "bread",
  "panko breadcrumbs",
  "chicken broth",
  "beef broth",
  "vegetable broth",
  "soy sauce",
  "fish sauce",
  "worcestershire sauce",
  "hot sauce",
  "tomato paste",
  "coconut milk",
  "white wine",
  "red wine",
];

async function seedIngredientRefs() {
  log("🥕", "Seeding ingredient references...");

  const ingredientRefs: { id: string; name: string }[] = [];
  for (const name of INGREDIENTS) {
    const ref = await prisma.ingredientRef.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    ingredientRefs.push(ref);
  }

  log("✅", `Seeded ${ingredientRefs.length} ingredient references`);
  return ingredientRefs;
}

// ============================================================================
// USERS
// ============================================================================

interface SeedUser {
  email: string;
  username: string;
  password?: string;
  photoUrl?: string;
  oauth?: { provider: string; providerUserId: string; providerUsername: string };
}

const CHEF_RJ_AVATAR_URL = "/images/chef-rj.png";

function isGeneratedSeedAvatarUrl(photoUrl: string | null | undefined): boolean {
  return Boolean(photoUrl?.includes("api.dicebear.com"));
}

const SEED_USERS: SeedUser[] = [
  {
    email: "demo@spoonjoy.com",
    username: "demo_chef",
    password: "demo1234",
    photoUrl: CHEF_RJ_AVATAR_URL,
  },
  {
    email: "chef.julia@example.com",
    username: "chef_julia",
    password: "password123",
    photoUrl: CHEF_RJ_AVATAR_URL,
  },
  {
    email: "marco.rossi@example.com",
    username: "marco_rossi",
    password: "password123",
    photoUrl: CHEF_RJ_AVATAR_URL,
  },
  {
    email: "sarah.chen@example.com",
    username: "sarah_chen",
    password: "password123",
    photoUrl: CHEF_RJ_AVATAR_URL,
  },
  {
    email: "alex.google@example.com",
    username: "alex_gourmet",
    photoUrl: CHEF_RJ_AVATAR_URL,
    oauth: {
      provider: "google",
      providerUserId: "google_123456789",
      providerUsername: "alex.google@gmail.com",
    },
  },
  {
    email: "jamie.apple@example.com",
    username: "jamie_kitchen",
    photoUrl: CHEF_RJ_AVATAR_URL,
    oauth: {
      provider: "apple",
      providerUserId: "apple_987654321",
      providerUsername: "jamie.apple@icloud.com",
    },
  },
];

async function seedUsers() {
  log("👤", "Seeding users...");

  const users: { id: string; email: string; username: string }[] = [];

  for (const userData of SEED_USERS) {
    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existing) {
      if (isGeneratedSeedAvatarUrl(existing.photoUrl) && userData.photoUrl) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { photoUrl: userData.photoUrl },
        });
      }
      users.push({ id: existing.id, email: existing.email, username: existing.username });
      continue;
    }

    // Create user data
    const userCreateData: {
      email: string;
      username: string;
      hashedPassword?: string;
      salt?: string;
      photoUrl?: string;
    } = {
      email: userData.email,
      username: userData.username,
      photoUrl: userData.photoUrl,
    };

    if (userData.password) {
      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      const hashedPassword = await bcrypt.hash(userData.password, salt);
      userCreateData.hashedPassword = hashedPassword;
      userCreateData.salt = salt;
    }

    const user = await prisma.user.create({
      data: userCreateData,
    });

    // Create OAuth record if applicable
    if (userData.oauth) {
      await prisma.oAuth.create({
        data: {
          provider: userData.oauth.provider,
          providerUserId: userData.oauth.providerUserId,
          providerUsername: userData.oauth.providerUsername,
          userId: user.id,
        },
      });
    }

    users.push({ id: user.id, email: user.email, username: user.username });
  }

  log("✅", `Seeded ${users.length} users`);
  return users;
}

// ============================================================================
// RECIPES
// ============================================================================

interface RecipeData {
  title: string;
  description: string;
  servings: string;
  imageUrl?: string;
  steps: {
    stepTitle?: string;
    description: string;
    ingredients: { name: string; quantity: number; unit: string }[];
    usesOutputFrom?: number[]; // step numbers this step uses output from
  }[];
}

const RECIPES: RecipeData[] = [
  {
    title: "Classic Margherita Pizza",
    description:
      "A traditional Italian pizza with fresh tomatoes, mozzarella, and basil. Simple ingredients, perfect execution.",
    servings: "2 pizzas",
    imageUrl: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80",
    steps: [
      {
        stepTitle: "Make the dough",
        description:
          "In a large bowl, combine flour, salt, and yeast. Add warm water and olive oil. Mix until a shaggy dough forms, then knead for 10 minutes until smooth and elastic. Let rise for 1 hour.",
        ingredients: [
          { name: "flour", quantity: 500, unit: "gram" },
          { name: "salt", quantity: 1, unit: "teaspoon" },
          { name: "olive oil", quantity: 2, unit: "tablespoon" },
        ],
      },
      {
        stepTitle: "Prepare the sauce",
        description:
          "Crush San Marzano tomatoes by hand. Add minced garlic, a drizzle of olive oil, salt, and fresh basil. Let sit for 30 minutes to develop flavor.",
        ingredients: [
          { name: "tomato", quantity: 400, unit: "gram" },
          { name: "garlic", quantity: 2, unit: "clove" },
          { name: "olive oil", quantity: 1, unit: "tablespoon" },
          { name: "basil", quantity: 5, unit: "sprig" },
          { name: "salt", quantity: 0.5, unit: "teaspoon" },
        ],
      },
      {
        stepTitle: "Shape and top",
        description:
          "Punch down the dough and divide in half. Stretch each piece into a 12-inch circle. Spread sauce evenly, leaving a 1-inch border. Top with torn mozzarella.",
        ingredients: [{ name: "mozzarella cheese", quantity: 200, unit: "gram" }],
        usesOutputFrom: [1, 2],
      },
      {
        stepTitle: "Bake",
        description:
          "Bake in a preheated 500°F oven for 10-12 minutes until the crust is golden and cheese is bubbling. Finish with fresh basil leaves and a drizzle of olive oil.",
        ingredients: [
          { name: "basil", quantity: 4, unit: "sprig" },
          { name: "olive oil", quantity: 1, unit: "tablespoon" },
        ],
        usesOutputFrom: [3],
      },
    ],
  },
  {
    title: "Chicken Stir-Fry with Vegetables",
    description:
      "A quick and healthy weeknight dinner loaded with colorful vegetables and tender chicken in a savory sauce.",
    servings: "4 servings",
    imageUrl: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=800&q=80",
    steps: [
      {
        stepTitle: "Make the sauce",
        description:
          "Whisk together soy sauce, sesame oil, honey, ginger, and garlic. Set aside.",
        ingredients: [
          { name: "soy sauce", quantity: 3, unit: "tablespoon" },
          { name: "sesame oil", quantity: 1, unit: "tablespoon" },
          { name: "honey", quantity: 2, unit: "tablespoon" },
          { name: "ginger", quantity: 1, unit: "tablespoon" },
          { name: "garlic", quantity: 3, unit: "clove" },
        ],
      },
      {
        stepTitle: "Prep the chicken",
        description:
          "Cut chicken breast into bite-sized pieces. Season with salt and pepper.",
        ingredients: [
          { name: "chicken breast", quantity: 500, unit: "gram" },
          { name: "salt", quantity: 0.5, unit: "teaspoon" },
          { name: "black pepper", quantity: 0.25, unit: "teaspoon" },
        ],
      },
      {
        stepTitle: "Cook the chicken",
        description:
          "Heat vegetable oil in a large wok over high heat. Add chicken and cook for 5-6 minutes until golden and cooked through. Remove and set aside.",
        ingredients: [{ name: "vegetable oil", quantity: 2, unit: "tablespoon" }],
        usesOutputFrom: [2],
      },
      {
        stepTitle: "Stir-fry vegetables",
        description:
          "Add more oil to the wok. Stir-fry bell peppers, broccoli, and carrots for 3-4 minutes until crisp-tender.",
        ingredients: [
          { name: "vegetable oil", quantity: 1, unit: "tablespoon" },
          { name: "bell pepper", quantity: 2, unit: "whole" },
          { name: "broccoli", quantity: 200, unit: "gram" },
          { name: "carrot", quantity: 2, unit: "whole" },
        ],
      },
      {
        stepTitle: "Combine and serve",
        description:
          "Return chicken to the wok. Pour sauce over everything and toss to coat. Cook for 2 minutes until sauce thickens. Serve over rice with scallions.",
        ingredients: [
          { name: "rice", quantity: 300, unit: "gram" },
          { name: "scallion", quantity: 3, unit: "whole" },
        ],
        usesOutputFrom: [1, 3, 4],
      },
    ],
  },
  {
    title: "Creamy Mushroom Risotto",
    description:
      "A luxurious Italian rice dish with earthy mushrooms, white wine, and plenty of parmesan cheese.",
    servings: "4 servings",
    imageUrl: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=800&q=80",
    steps: [
      {
        stepTitle: "Prep mushrooms",
        description:
          "Clean and slice mushrooms. Set aside a few whole ones for garnish.",
        ingredients: [{ name: "mushroom", quantity: 400, unit: "gram" }],
      },
      {
        stepTitle: "Sauté aromatics",
        description:
          "In a large pan, melt butter and sauté shallots until translucent. Add garlic and cook for 30 seconds until fragrant.",
        ingredients: [
          { name: "butter", quantity: 3, unit: "tablespoon" },
          { name: "shallot", quantity: 2, unit: "whole" },
          { name: "garlic", quantity: 2, unit: "clove" },
        ],
      },
      {
        stepTitle: "Toast rice and deglaze",
        description:
          "Add arborio rice and stir to coat with butter. Toast for 2 minutes. Pour in white wine and stir until absorbed.",
        ingredients: [
          { name: "rice", quantity: 300, unit: "gram" },
          { name: "white wine", quantity: 125, unit: "milliliter" },
        ],
        usesOutputFrom: [2],
      },
      {
        stepTitle: "Add broth gradually",
        description:
          "Add warm chicken broth one ladle at a time, stirring constantly and waiting for each addition to be absorbed before adding more. Continue for 18-20 minutes.",
        ingredients: [{ name: "chicken broth", quantity: 1, unit: "liter" }],
        usesOutputFrom: [3],
      },
      {
        stepTitle: "Cook mushrooms",
        description:
          "In a separate pan, sauté mushrooms in butter until golden and caramelized, about 8 minutes. Season with salt and thyme.",
        ingredients: [
          { name: "butter", quantity: 2, unit: "tablespoon" },
          { name: "salt", quantity: 0.5, unit: "teaspoon" },
          { name: "thyme", quantity: 2, unit: "sprig" },
        ],
        usesOutputFrom: [1],
      },
      {
        stepTitle: "Finish and serve",
        description:
          "Fold mushrooms and parmesan into the risotto. Add butter for extra creaminess. Season to taste and serve immediately with fresh parsley.",
        ingredients: [
          { name: "parmesan cheese", quantity: 100, unit: "gram" },
          { name: "butter", quantity: 2, unit: "tablespoon" },
          { name: "parsley", quantity: 2, unit: "tablespoon" },
        ],
        usesOutputFrom: [4, 5],
      },
    ],
  },
  {
    title: "Fresh Guacamole",
    description: "Classic Mexican avocado dip with lime, cilantro, and a kick of jalapeño.",
    servings: "6 servings",
    imageUrl: "https://images.unsplash.com/photo-1615870216519-2f9fa575fa5c?w=800&q=80",
    steps: [
      {
        stepTitle: "Prep ingredients",
        description:
          "Dice onion, mince garlic, seed and mince jalapeño, and chop cilantro. Dice tomatoes.",
        ingredients: [
          { name: "onion", quantity: 0.5, unit: "whole" },
          { name: "garlic", quantity: 1, unit: "clove" },
          { name: "jalapeño", quantity: 1, unit: "whole" },
          { name: "cilantro", quantity: 0.25, unit: "cup" },
          { name: "tomato", quantity: 1, unit: "whole" },
        ],
      },
      {
        stepTitle: "Mash and mix",
        description:
          "Cut avocados in half and remove pits. Scoop flesh into a bowl and mash to desired consistency. Add lime juice immediately to prevent browning.",
        ingredients: [
          { name: "avocado", quantity: 3, unit: "whole" },
          { name: "lime", quantity: 2, unit: "whole" },
        ],
      },
      {
        stepTitle: "Combine and season",
        description:
          "Fold in the prepped ingredients. Season with salt and cumin. Taste and adjust seasoning. Serve with tortilla chips.",
        ingredients: [
          { name: "salt", quantity: 0.5, unit: "teaspoon" },
          { name: "cumin", quantity: 0.25, unit: "teaspoon" },
        ],
        usesOutputFrom: [1, 2],
      },
    ],
  },
  {
    title: "Pan-Seared Salmon with Lemon Butter",
    description:
      "Restaurant-quality salmon with crispy skin and a bright, buttery sauce. Ready in 20 minutes.",
    servings: "2 servings",
    imageUrl: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800&q=80",
    steps: [
      {
        stepTitle: "Season salmon",
        description:
          "Pat salmon fillets dry with paper towels. Season generously with salt, pepper, and paprika on both sides.",
        ingredients: [
          { name: "salmon fillet", quantity: 2, unit: "piece" },
          { name: "salt", quantity: 1, unit: "teaspoon" },
          { name: "black pepper", quantity: 0.5, unit: "teaspoon" },
          { name: "paprika", quantity: 0.5, unit: "teaspoon" },
        ],
      },
      {
        stepTitle: "Sear salmon",
        description:
          "Heat olive oil in a cast iron skillet over high heat. Place salmon skin-side up and sear for 4 minutes until a golden crust forms. Flip and cook 3 more minutes. Remove and rest.",
        ingredients: [{ name: "olive oil", quantity: 2, unit: "tablespoon" }],
        usesOutputFrom: [1],
      },
      {
        stepTitle: "Make lemon butter sauce",
        description:
          "Reduce heat to medium. Add butter to the pan and let it foam. Add minced garlic and cook 30 seconds. Squeeze in lemon juice and swirl to combine.",
        ingredients: [
          { name: "butter", quantity: 3, unit: "tablespoon" },
          { name: "garlic", quantity: 2, unit: "clove" },
          { name: "lemon", quantity: 1, unit: "whole" },
        ],
      },
      {
        stepTitle: "Plate and serve",
        description:
          "Place salmon on plates. Spoon lemon butter sauce over each fillet. Garnish with fresh parsley and serve with asparagus or your favorite vegetable.",
        ingredients: [
          { name: "parsley", quantity: 1, unit: "tablespoon" },
          { name: "asparagus", quantity: 200, unit: "gram" },
        ],
        usesOutputFrom: [2, 3],
      },
    ],
  },
  {
    title: "Chocolate Chip Cookies",
    description:
      "Perfectly chewy cookies with crisp edges and gooey chocolate chips. A timeless classic.",
    servings: "24 cookies",
    imageUrl: "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=800&q=80",
    steps: [
      {
        stepTitle: "Cream butter and sugars",
        description:
          "In a large bowl, beat softened butter with white and brown sugar until light and fluffy, about 3 minutes. Add vanilla extract.",
        ingredients: [
          { name: "butter", quantity: 225, unit: "gram" },
          { name: "sugar", quantity: 100, unit: "gram" },
          { name: "brown sugar", quantity: 150, unit: "gram" },
          { name: "vanilla extract", quantity: 2, unit: "teaspoon" },
        ],
      },
      {
        stepTitle: "Add eggs",
        description: "Add eggs one at a time, beating well after each addition until fully incorporated.",
        ingredients: [{ name: "egg", quantity: 2, unit: "whole" }],
        usesOutputFrom: [1],
      },
      {
        stepTitle: "Mix dry ingredients",
        description:
          "In a separate bowl, whisk together flour, baking soda, and salt.",
        ingredients: [
          { name: "flour", quantity: 280, unit: "gram" },
          { name: "baking soda", quantity: 1, unit: "teaspoon" },
          { name: "salt", quantity: 1, unit: "teaspoon" },
        ],
      },
      {
        stepTitle: "Combine and add chocolate",
        description:
          "Gradually add dry ingredients to wet mixture, mixing until just combined. Fold in chocolate chips. Chill dough for 30 minutes.",
        ingredients: [],
        usesOutputFrom: [2, 3],
      },
      {
        stepTitle: "Bake",
        description:
          "Scoop dough into 2-tablespoon balls onto lined baking sheets. Bake at 375°F for 10-12 minutes until edges are golden but centers look slightly underdone. Cool on pan for 5 minutes before transferring.",
        ingredients: [],
        usesOutputFrom: [4],
      },
    ],
  },
  {
    title: "Thai Green Curry",
    description:
      "Aromatic coconut curry with tender chicken and vegetables. Restaurant-quality Thai food at home.",
    servings: "4 servings",
    imageUrl: "https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=800&q=80",
    steps: [
      {
        stepTitle: "Prep vegetables",
        description:
          "Slice bell peppers into strips, cut zucchini into half-moons, and prepare green beans.",
        ingredients: [
          { name: "bell pepper", quantity: 2, unit: "whole" },
          { name: "zucchini", quantity: 1, unit: "whole" },
          { name: "green beans", quantity: 100, unit: "gram" },
        ],
      },
      {
        stepTitle: "Bloom curry paste",
        description:
          "Heat vegetable oil in a wok. Add green curry paste and cook for 1 minute until fragrant.",
        ingredients: [{ name: "vegetable oil", quantity: 2, unit: "tablespoon" }],
      },
      {
        stepTitle: "Add coconut milk and chicken",
        description:
          "Pour in coconut milk and stir to combine. Add chicken thigh pieces and simmer for 10 minutes.",
        ingredients: [
          { name: "coconut milk", quantity: 400, unit: "milliliter" },
          { name: "chicken thigh", quantity: 500, unit: "gram" },
        ],
        usesOutputFrom: [2],
      },
      {
        stepTitle: "Add vegetables and season",
        description:
          "Add prepared vegetables. Season with fish sauce and sugar. Simmer for 5 more minutes until vegetables are tender.",
        ingredients: [
          { name: "fish sauce", quantity: 2, unit: "tablespoon" },
          { name: "sugar", quantity: 1, unit: "tablespoon" },
        ],
        usesOutputFrom: [1, 3],
      },
      {
        stepTitle: "Finish and serve",
        description:
          "Stir in Thai basil leaves. Serve over jasmine rice with lime wedges.",
        ingredients: [
          { name: "basil", quantity: 1, unit: "cup" },
          { name: "rice", quantity: 300, unit: "gram" },
          { name: "lime", quantity: 1, unit: "whole" },
        ],
        usesOutputFrom: [4],
      },
    ],
  },
  {
    title: "Eggs Benedict",
    description:
      "Brunch classic with poached eggs, Canadian bacon, and silky hollandaise on an English muffin.",
    servings: "4 servings",
    imageUrl: "https://images.unsplash.com/photo-1608039829572-9b0ba489e6ea?w=800&q=80",
    steps: [
      {
        stepTitle: "Make hollandaise",
        description:
          "Whisk egg yolks with lemon juice over a double boiler. Slowly drizzle in melted butter while whisking constantly. Season with salt and cayenne.",
        ingredients: [
          { name: "egg", quantity: 3, unit: "whole" },
          { name: "lemon", quantity: 1, unit: "whole" },
          { name: "butter", quantity: 170, unit: "gram" },
          { name: "salt", quantity: 0.25, unit: "teaspoon" },
          { name: "cayenne pepper", quantity: 1, unit: "pinch" },
        ],
      },
      {
        stepTitle: "Prepare base",
        description: "Toast English muffin halves and warm Canadian bacon in a pan.",
        ingredients: [{ name: "bread", quantity: 4, unit: "slice" }],
      },
      {
        stepTitle: "Poach eggs",
        description:
          "Bring water with a splash of vinegar to a gentle simmer. Create a vortex and slide eggs in one at a time. Cook for 3 minutes for runny yolks.",
        ingredients: [{ name: "egg", quantity: 4, unit: "whole" }],
      },
      {
        stepTitle: "Assemble",
        description:
          "Place bacon on muffin halves. Top with poached egg and spoon hollandaise over. Garnish with chives and paprika.",
        ingredients: [
          { name: "parsley", quantity: 1, unit: "tablespoon" },
          { name: "paprika", quantity: 0.25, unit: "teaspoon" },
        ],
        usesOutputFrom: [1, 2, 3],
      },
    ],
  },
];

async function seedRecipes(
  users: { id: string; email: string; username: string }[],
  units: { id: string; name: string }[],
  ingredientRefs: { id: string; name: string }[]
) {
  log("🍳", "Seeding recipes...");

  const unitMap = new Map(units.map((u) => [u.name, u.id]));
  const ingredientMap = new Map(ingredientRefs.map((i) => [i.name, i.id]));

  const createdRecipes: {
    id: string;
    title: string;
    chefId: string;
  }[] = [];

  for (let i = 0; i < RECIPES.length; i++) {
    const recipeData = RECIPES[i];
    const chef = users[i % users.length];

    // Check if recipe exists
    const existing = await prisma.recipe.findFirst({
      where: {
        chefId: chef.id,
        title: recipeData.title,
        deletedAt: null,
      },
    });

    if (existing) {
      createdRecipes.push({ id: existing.id, title: existing.title, chefId: existing.chefId });
      continue;
    }

    // Create recipe
    const recipe = await prisma.recipe.create({
      data: {
        title: recipeData.title,
        description: recipeData.description,
        servings: recipeData.servings,
        chefId: chef.id,
      },
    });

    // Seed a chef-upload cover when an image URL is provided so the recipe renders
    // with the same artwork it had under the old Recipe.imageUrl field.
    if (recipeData.imageUrl) {
      await prisma.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: recipeData.imageUrl,
          sourceType: "chef-upload",
        },
      });
    }

    // Create steps with ingredients
    for (let stepIdx = 0; stepIdx < recipeData.steps.length; stepIdx++) {
      const stepData = recipeData.steps[stepIdx];
      const stepNum = stepIdx + 1;

      await prisma.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum,
          stepTitle: stepData.stepTitle,
          description: stepData.description,
        },
      });

      // Create ingredients for this step
      for (const ing of stepData.ingredients) {
        const unitId = unitMap.get(ing.unit);
        const ingredientRefId = ingredientMap.get(ing.name);

        if (!unitId || !ingredientRefId) {
          console.warn(`  ⚠️ Missing unit (${ing.unit}) or ingredient (${ing.name})`);
          continue;
        }

        await prisma.ingredient.create({
          data: {
            recipeId: recipe.id,
            stepNum,
            quantity: ing.quantity,
            unitId,
            ingredientRefId,
          },
        });
      }
    }

    // Create StepOutputUse relationships
    for (let stepIdx = 0; stepIdx < recipeData.steps.length; stepIdx++) {
      const stepData = recipeData.steps[stepIdx];
      const inputStepNum = stepIdx + 1;

      if (stepData.usesOutputFrom) {
        for (const outputStepNum of stepData.usesOutputFrom) {
          await prisma.stepOutputUse.create({
            data: {
              recipeId: recipe.id,
              outputStepNum,
              inputStepNum,
            },
          });
        }
      }
    }

    createdRecipes.push({ id: recipe.id, title: recipe.title, chefId: recipe.chefId });
    log("  📝", `Created: ${recipe.title} by ${chef.username}`);
  }

  log("✅", `Seeded ${createdRecipes.length} recipes`);
  return createdRecipes;
}

// ============================================================================
// COOKBOOKS
// ============================================================================

interface CookbookData {
  title: string;
  recipeIndices: number[]; // indices into RECIPES array
}

const COOKBOOKS: CookbookData[] = [
  {
    title: "Italian Favorites",
    recipeIndices: [0, 2], // Pizza and Risotto
  },
  {
    title: "Quick Weeknight Dinners",
    recipeIndices: [1, 4], // Stir-fry and Salmon
  },
  {
    title: "Party Appetizers",
    recipeIndices: [3], // Guacamole
  },
  {
    title: "Asian Cuisine",
    recipeIndices: [1, 6], // Stir-fry and Thai curry
  },
  {
    title: "Brunch Classics",
    recipeIndices: [7], // Eggs Benedict
  },
  {
    title: "Sweet Treats",
    recipeIndices: [5], // Chocolate chip cookies
  },
];

async function seedCookbooks(
  users: { id: string; email: string; username: string }[],
  recipes: { id: string; title: string; chefId: string }[]
) {
  log("📚", "Seeding cookbooks...");

  const createdCookbooks: { id: string; title: string }[] = [];

  for (let i = 0; i < COOKBOOKS.length; i++) {
    const cbData = COOKBOOKS[i];
    const author = users[i % users.length];

    // Check if cookbook exists
    const existing = await prisma.cookbook.findFirst({
      where: {
        authorId: author.id,
        title: cbData.title,
      },
    });

    if (existing) {
      createdCookbooks.push({ id: existing.id, title: existing.title });
      continue;
    }

    // Create cookbook
    const cookbook = await prisma.cookbook.create({
      data: {
        title: cbData.title,
        authorId: author.id,
      },
    });

    // Add recipes to cookbook
    for (const recipeIdx of cbData.recipeIndices) {
      if (recipeIdx < recipes.length) {
        const recipe = recipes[recipeIdx];
        await prisma.recipeInCookbook.create({
          data: {
            cookbookId: cookbook.id,
            recipeId: recipe.id,
            addedById: author.id,
          },
        });
      }
    }

    createdCookbooks.push({ id: cookbook.id, title: cookbook.title });
    log("  📖", `Created: ${cookbook.title} by ${author.username}`);
  }

  log("✅", `Seeded ${createdCookbooks.length} cookbooks`);
  return createdCookbooks;
}

// ============================================================================
// SHOPPING LISTS
// ============================================================================

async function seedShoppingLists(
  users: { id: string; email: string; username: string }[],
  units: { id: string; name: string }[],
  ingredientRefs: { id: string; name: string }[]
) {
  log("🛒", "Seeding shopping lists...");

  const unitMap = new Map(units.map((u) => [u.name, u.id]));
  const ingredientMap = new Map(ingredientRefs.map((i) => [i.name, i.id]));

  // Sample shopping list items for different users
  const shoppingListData: { ingredients: { name: string; quantity: number; unit: string; checked: boolean }[] }[] = [
    {
      ingredients: [
        { name: "chicken breast", quantity: 500, unit: "gram", checked: false },
        { name: "broccoli", quantity: 1, unit: "bunch", checked: false },
        { name: "garlic", quantity: 1, unit: "whole", checked: true },
        { name: "soy sauce", quantity: 1, unit: "jar", checked: false },
        { name: "rice", quantity: 2, unit: "pound", checked: false },
      ],
    },
    {
      ingredients: [
        { name: "salmon fillet", quantity: 2, unit: "piece", checked: false },
        { name: "lemon", quantity: 3, unit: "whole", checked: false },
        { name: "butter", quantity: 1, unit: "package", checked: true },
        { name: "asparagus", quantity: 1, unit: "bunch", checked: false },
      ],
    },
    {
      ingredients: [
        { name: "avocado", quantity: 4, unit: "whole", checked: false },
        { name: "lime", quantity: 3, unit: "whole", checked: false },
        { name: "cilantro", quantity: 1, unit: "bunch", checked: false },
        { name: "jalapeño", quantity: 2, unit: "whole", checked: false },
        { name: "onion", quantity: 1, unit: "whole", checked: true },
        { name: "tomato", quantity: 2, unit: "whole", checked: false },
      ],
    },
  ];

  let createdCount = 0;

  for (let i = 0; i < Math.min(users.length, shoppingListData.length); i++) {
    const user = users[i];
    const listData = shoppingListData[i];

    // Check if shopping list exists
    let shoppingList = await prisma.shoppingList.findUnique({
      where: { authorId: user.id },
    });

    if (!shoppingList) {
      shoppingList = await prisma.shoppingList.create({
        data: {
          authorId: user.id,
        },
      });
    }

    // Add items (skip if any exist)
    const existingItems = await prisma.shoppingListItem.findMany({
      where: { shoppingListId: shoppingList.id },
    });

    if (existingItems.length === 0) {
      for (const item of listData.ingredients) {
        const unitId = unitMap.get(item.unit);
        const ingredientRefId = ingredientMap.get(item.name);

        if (!ingredientRefId) {
          console.warn(`  ⚠️ Missing ingredient: ${item.name}`);
          continue;
        }

        await prisma.shoppingListItem.create({
          data: {
            shoppingListId: shoppingList.id,
            quantity: item.quantity,
            unitId: unitId || null,
            ingredientRefId,
            checked: item.checked,
          },
        });
      }
      createdCount++;
      log("  📋", `Created shopping list for ${user.username}`);
    }
  }

  log("✅", `Seeded ${createdCount} shopping lists`);
}

// ============================================================================
// MAIN SEED FUNCTION
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🌱 Spoonjoy v2 Database Seeding");
  console.log("=".repeat(60) + "\n");

  const startTime = Date.now();

  try {
    await initPrismaForLocalD1();

    // Seed in order of dependencies
    const units = await seedUnits();
    const ingredientRefs = await seedIngredientRefs();
    const users = await seedUsers();
    const recipes = await seedRecipes(users, units, ingredientRefs);
    await seedCookbooks(users, recipes);
    await seedShoppingLists(users, units, ingredientRefs);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n" + "=".repeat(60));
    console.log(`✨ Seeding complete in ${elapsed}s`);
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (platformDispose) {
      await platformDispose();
    }
  });
