export const LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN = "clbe7wr180009tkhggghtl1qd.png";

export interface V1User {
  id: string;
  email: string;
  username: string;
  hashedPassword: string | null;
  salt: string | null;
  resetToken: string | null;
  resetTokenExpiresAt: Date | string | null;
  webAuthnChallenge: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface V1UserCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  transports: string | null;
  counter: bigint | number | string;
}

export interface V1OAuth {
  provider: string;
  providerUserId: string;
  providerUsername: string;
  userId: string;
  createdAt: Date | string;
}

export interface V1Unit {
  id: string;
  name: string;
  updatedAt: Date | string;
}

export interface V1IngredientRef {
  id: string;
  name: string;
  updatedAt: Date | string;
}

export interface V1Recipe {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  servings: string | null;
  chefId: string;
  deletedAt: Date | string | null;
  sourceRecipeId: string | null;
  sourceUrl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface V1RecipeStep {
  id: string;
  recipeId: string;
  stepNum: number;
  stepTitle: string | null;
  description: string;
  updatedAt: Date | string;
}

export interface V1StepOutputUse {
  id: string;
  recipeId: string;
  outputStepNum: number;
  inputStepNum: number;
  updatedAt: Date | string;
}

export interface V1Ingredient {
  id: string;
  recipeId: string;
  stepNum: number;
  quantity: number;
  unitId: string;
  ingredientRefId: string;
  updatedAt: Date | string;
}

export interface V1Cookbook {
  id: string;
  title: string;
  authorId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface V1RecipeInCookbook {
  id: string;
  cookbookId: string;
  recipeId: string;
  addedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface V1ShoppingList {
  id: string;
  authorId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface V1ShoppingListItem {
  id: string;
  shoppingListId: string;
  quantity: number | null;
  unitId: string | null;
  ingredientRefId: string;
  updatedAt: Date | string;
}

export interface V1Export {
  users: V1User[];
  userCredentials: V1UserCredential[];
  oauthAccounts: V1OAuth[];
  units: V1Unit[];
  ingredientRefs: V1IngredientRef[];
  recipes: V1Recipe[];
  recipeSteps: V1RecipeStep[];
  stepOutputUses: V1StepOutputUse[];
  ingredients: V1Ingredient[];
  cookbooks: V1Cookbook[];
  recipeInCookbooks: V1RecipeInCookbook[];
  shoppingLists: V1ShoppingList[];
  shoppingListItems: V1ShoppingListItem[];
}

export interface MigrationBuildOptions {
  replaceTarget: boolean;
  generatedAt?: Date | string;
}

export interface SkipSummary {
  userCredentialsMissingUser: number;
  oauthMissingUser: number;
  recipesMissingChef: number;
  recipesMissingSource: number;
  recipeStepsMissingRecipe: number;
  stepOutputUsesMissingStep: number;
  ingredientsMissingStep: number;
  ingredientsMissingUnit: number;
  ingredientsMissingIngredientRef: number;
  cookbooksMissingAuthor: number;
  recipeInCookbooksMissingCookbook: number;
  recipeInCookbooksMissingRecipe: number;
  recipeInCookbooksMissingAddedBy: number;
  shoppingListsMissingAuthor: number;
  shoppingListItemsMissingList: number;
  shoppingListItemsMissingIngredientRef: number;
  shoppingListItemsMissingUnit: number;
}

export interface AuthSummary {
  users: number;
  passwordUsers: number;
  passkeyUsers: number;
  supportedOAuthUsers: number;
  unsupportedLoginUsers: number;
  oauthProviders: Record<string, number>;
}

export interface MigrationReport {
  sourceCounts: Record<string, number>;
  plannedInsertCounts: Record<string, number>;
  skipped: SkipSummary;
  auth: AuthSummary;
}

interface PlannedData {
  users: V1User[];
  userCredentials: V1UserCredential[];
  oauthAccounts: V1OAuth[];
  units: V1Unit[];
  ingredientRefs: V1IngredientRef[];
  recipes: V1Recipe[];
  recipeCovers: Array<{
    id: string;
    recipeId: string;
    imageUrl: string;
    sourceType: "chef-upload";
    createdAt: Date | string;
  }>;
  recipeSteps: V1RecipeStep[];
  stepOutputUses: V1StepOutputUse[];
  ingredients: V1Ingredient[];
  cookbooks: V1Cookbook[];
  recipeInCookbooks: V1RecipeInCookbook[];
  shoppingLists: V1ShoppingList[];
  shoppingListItems: Array<V1ShoppingListItem & { checked: false; sortIndex: number }>;
}

const EMPTY_SKIP_SUMMARY: SkipSummary = {
  userCredentialsMissingUser: 0,
  oauthMissingUser: 0,
  recipesMissingChef: 0,
  recipesMissingSource: 0,
  recipeStepsMissingRecipe: 0,
  stepOutputUsesMissingStep: 0,
  ingredientsMissingStep: 0,
  ingredientsMissingUnit: 0,
  ingredientsMissingIngredientRef: 0,
  cookbooksMissingAuthor: 0,
  recipeInCookbooksMissingCookbook: 0,
  recipeInCookbooksMissingRecipe: 0,
  recipeInCookbooksMissingAddedBy: 0,
  shoppingListsMissingAuthor: 0,
  shoppingListItemsMissingList: 0,
  shoppingListItemsMissingIngredientRef: 0,
  shoppingListItemsMissingUnit: 0,
};

const TARGET_DELETE_ORDER = [
  "SearchDocument",
  "SearchIndexMetadata",
  "NotificationPreference",
  "NotificationEvent",
  "PushSubscription",
  "ImageGenLedger",
  "RecipeCover",
  "RecipeSpoon",
  "ShoppingListItem",
  "ShoppingList",
  "StepOutputUse",
  "Ingredient",
  "RecipeStep",
  "RecipeInCookbook",
  "Cookbook",
  "Recipe",
  "IngredientRef",
  "Unit",
  "ApiCredential",
  "UserCredential",
  "OAuth",
  "User",
] as const;

function cloneSkipSummary(): SkipSummary {
  return { ...EMPTY_SKIP_SUMMARY };
}

function sourceCounts(source: V1Export): Record<string, number> {
  return {
    User: source.users.length,
    UserCredential: source.userCredentials.length,
    OAuth: source.oauthAccounts.length,
    Unit: source.units.length,
    IngredientRef: source.ingredientRefs.length,
    Recipe: source.recipes.length,
    RecipeStep: source.recipeSteps.length,
    StepOutputUse: source.stepOutputUses.length,
    Ingredient: source.ingredients.length,
    Cookbook: source.cookbooks.length,
    RecipeInCookbook: source.recipeInCookbooks.length,
    ShoppingList: source.shoppingLists.length,
    ShoppingListItem: source.shoppingListItems.length,
  };
}

function plannedInsertCounts(planned: PlannedData): Record<string, number> {
  return {
    User: planned.users.length,
    UserCredential: planned.userCredentials.length,
    OAuth: planned.oauthAccounts.length,
    Unit: planned.units.length,
    IngredientRef: planned.ingredientRefs.length,
    Recipe: planned.recipes.length,
    RecipeCover: planned.recipeCovers.length,
    RecipeStep: planned.recipeSteps.length,
    StepOutputUse: planned.stepOutputUses.length,
    Ingredient: planned.ingredients.length,
    Cookbook: planned.cookbooks.length,
    RecipeInCookbook: planned.recipeInCookbooks.length,
    ShoppingList: planned.shoppingLists.length,
    ShoppingListItem: planned.shoppingListItems.length,
  };
}

function makeRecipeStepKey(recipeId: string, stepNum: number): string {
  return `${recipeId}\u0000${stepNum}`;
}

function compareDateThenId(
  a: { updatedAt: Date | string; id: string },
  b: { updatedAt: Date | string; id: string },
): number {
  const aTime = dateToIso(a.updatedAt);
  const bTime = dateToIso(b.updatedAt);
  return aTime.localeCompare(bTime) || a.id.localeCompare(b.id);
}

function buildAuthSummary(source: V1Export): AuthSummary {
  const credentialsByUser = new Set(source.userCredentials.map((credential) => credential.userId));
  const oauthByUser = new Map<string, Set<string>>();
  const oauthProviders: Record<string, number> = {};

  for (const account of source.oauthAccounts) {
    oauthProviders[account.provider] = (oauthProviders[account.provider] ?? 0) + 1;
    const providers = oauthByUser.get(account.userId) ?? new Set<string>();
    providers.add(account.provider);
    oauthByUser.set(account.userId, providers);
  }

  const supportedOAuthProviders = new Set(["apple", "github", "google"]);
  let passwordUsers = 0;
  let passkeyUsers = 0;
  let supportedOAuthUsers = 0;
  let unsupportedLoginUsers = 0;

  for (const user of source.users) {
    const hasPassword = Boolean(user.hashedPassword);
    const hasPasskey = credentialsByUser.has(user.id);
    const providers = oauthByUser.get(user.id) ?? new Set<string>();
    const hasSupportedOAuth = [...providers].some((provider) => supportedOAuthProviders.has(provider));

    if (hasPassword) passwordUsers += 1;
    if (hasPasskey) passkeyUsers += 1;
    if (hasSupportedOAuth) supportedOAuthUsers += 1;
    if (!hasPassword && !hasPasskey && !hasSupportedOAuth) unsupportedLoginUsers += 1;
  }

  return {
    users: source.users.length,
    passwordUsers,
    passkeyUsers,
    supportedOAuthUsers,
    unsupportedLoginUsers,
    oauthProviders,
  };
}

function isCustomLegacyImageUrl(imageUrl: string): boolean {
  return imageUrl.length > 0 && !imageUrl.includes(LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN);
}

function planData(source: V1Export): { planned: PlannedData; skipped: SkipSummary } {
  const skipped = cloneSkipSummary();

  const userIds = new Set(source.users.map((user) => user.id));
  const unitIds = new Set(source.units.map((unit) => unit.id));
  const ingredientRefIds = new Set(source.ingredientRefs.map((ref) => ref.id));
  const sourceRecipeIds = new Set(source.recipes.map((recipe) => recipe.id));

  const recipes = source.recipes.filter((recipe) => {
    if (!userIds.has(recipe.chefId)) {
      skipped.recipesMissingChef += 1;
      return false;
    }
    if (recipe.sourceRecipeId && !sourceRecipeIds.has(recipe.sourceRecipeId)) {
      skipped.recipesMissingSource += 1;
      return false;
    }
    return true;
  });

  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  const recipeSteps = source.recipeSteps.filter((step) => {
    if (!recipeIds.has(step.recipeId)) {
      skipped.recipeStepsMissingRecipe += 1;
      return false;
    }
    return true;
  });

  const stepKeys = new Set(recipeSteps.map((step) => makeRecipeStepKey(step.recipeId, step.stepNum)));

  const stepOutputUses = source.stepOutputUses.filter((use) => {
    const outputExists = stepKeys.has(makeRecipeStepKey(use.recipeId, use.outputStepNum));
    const inputExists = stepKeys.has(makeRecipeStepKey(use.recipeId, use.inputStepNum));
    if (!outputExists || !inputExists) {
      skipped.stepOutputUsesMissingStep += 1;
      return false;
    }
    return true;
  });

  const ingredients = source.ingredients.filter((ingredient) => {
    if (!stepKeys.has(makeRecipeStepKey(ingredient.recipeId, ingredient.stepNum))) {
      skipped.ingredientsMissingStep += 1;
      return false;
    }
    if (!unitIds.has(ingredient.unitId)) {
      skipped.ingredientsMissingUnit += 1;
      return false;
    }
    if (!ingredientRefIds.has(ingredient.ingredientRefId)) {
      skipped.ingredientsMissingIngredientRef += 1;
      return false;
    }
    return true;
  });

  const userCredentials = source.userCredentials.filter((credential) => {
    if (!userIds.has(credential.userId)) {
      skipped.userCredentialsMissingUser += 1;
      return false;
    }
    return true;
  });

  const oauthAccounts = source.oauthAccounts.filter((account) => {
    if (!userIds.has(account.userId)) {
      skipped.oauthMissingUser += 1;
      return false;
    }
    return true;
  });

  const cookbooks = source.cookbooks.filter((cookbook) => {
    if (!userIds.has(cookbook.authorId)) {
      skipped.cookbooksMissingAuthor += 1;
      return false;
    }
    return true;
  });

  const cookbookIds = new Set(cookbooks.map((cookbook) => cookbook.id));
  const recipeInCookbooks = source.recipeInCookbooks.filter((item) => {
    let keep = true;
    if (!cookbookIds.has(item.cookbookId)) {
      skipped.recipeInCookbooksMissingCookbook += 1;
      keep = false;
    }
    if (!recipeIds.has(item.recipeId)) {
      skipped.recipeInCookbooksMissingRecipe += 1;
      keep = false;
    }
    if (!userIds.has(item.addedById)) {
      skipped.recipeInCookbooksMissingAddedBy += 1;
      keep = false;
    }
    return keep;
  });

  const shoppingLists = source.shoppingLists.filter((list) => {
    if (!userIds.has(list.authorId)) {
      skipped.shoppingListsMissingAuthor += 1;
      return false;
    }
    return true;
  });

  const shoppingListIds = new Set(shoppingLists.map((list) => list.id));
  const validShoppingListItems = source.shoppingListItems.filter((item) => {
    let keep = true;
    if (!shoppingListIds.has(item.shoppingListId)) {
      skipped.shoppingListItemsMissingList += 1;
      keep = false;
    }
    if (!ingredientRefIds.has(item.ingredientRefId)) {
      skipped.shoppingListItemsMissingIngredientRef += 1;
      keep = false;
    }
    if (item.unitId && !unitIds.has(item.unitId)) {
      skipped.shoppingListItemsMissingUnit += 1;
      keep = false;
    }
    return keep;
  });

  const shoppingListItems = validShoppingListItems
    .toSorted((a, b) => a.shoppingListId.localeCompare(b.shoppingListId) || compareDateThenId(a, b))
    .map((item, index, all) => {
      const previousSameListIndex = all.findIndex((candidate) => candidate.shoppingListId === item.shoppingListId);
      return {
        ...item,
        checked: false as const,
        sortIndex: index - previousSameListIndex,
      };
    });

  const recipeCovers = recipes
    .filter((recipe) => isCustomLegacyImageUrl(recipe.imageUrl))
    .map((recipe) => ({
      id: `v1cover_${recipe.id}`,
      recipeId: recipe.id,
      imageUrl: recipe.imageUrl,
      sourceType: "chef-upload" as const,
      createdAt: recipe.createdAt,
    }));

  return {
    planned: {
      users: source.users,
      userCredentials,
      oauthAccounts,
      units: source.units,
      ingredientRefs: source.ingredientRefs,
      recipes,
      recipeCovers,
      recipeSteps,
      stepOutputUses,
      ingredients,
      cookbooks,
      recipeInCookbooks,
      shoppingLists,
      shoppingListItems,
    },
    skipped,
  };
}

export function buildMigrationReport(source: V1Export): MigrationReport {
  const { planned, skipped } = planData(source);
  return {
    sourceCounts: sourceCounts(source),
    plannedInsertCounts: plannedInsertCounts(planned),
    skipped,
    auth: buildAuthSummary(source),
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function dateToIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function integerLiteral(value: bigint | number | string): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Unsafe integer value: ${value}`);
    }
    return String(value);
  }
  return BigInt(value).toString();
}

function sqlLiteral(value: Date | Uint8Array | boolean | number | string | null): string {
  if (value === null) return "NULL";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString("hex")}'`;
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Unsafe number value: ${value}`);
    }
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function dateLiteral(value: Date | string | null): string {
  return value === null ? "NULL" : sqlLiteral(dateToIso(value));
}

function insertStatement(table: string, columns: string[], values: string[]): string {
  const columnList = columns.map(quoteIdentifier).join(", ");
  return `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${values.join(", ")});`;
}

function deleteStatement(table: string): string {
  return `DELETE FROM ${quoteIdentifier(table)};`;
}

function buildInsertStatements(planned: PlannedData): string[] {
  return [
    ...planned.users.map((user) =>
      insertStatement(
        "User",
        [
          "id",
          "email",
          "username",
          "hashedPassword",
          "salt",
          "resetToken",
          "resetTokenExpiresAt",
          "webAuthnChallenge",
          "photoUrl",
          "createdAt",
          "updatedAt",
        ],
        [
          sqlLiteral(user.id),
          sqlLiteral(user.email),
          sqlLiteral(user.username),
          sqlLiteral(user.hashedPassword),
          sqlLiteral(user.salt),
          sqlLiteral(user.resetToken),
          dateLiteral(user.resetTokenExpiresAt),
          sqlLiteral(user.webAuthnChallenge),
          "NULL",
          dateLiteral(user.createdAt),
          dateLiteral(user.updatedAt),
        ],
      ),
    ),
    ...planned.units.map((unit) =>
      insertStatement(
        "Unit",
        ["id", "name", "updatedAt"],
        [sqlLiteral(unit.id), sqlLiteral(unit.name), dateLiteral(unit.updatedAt)],
      ),
    ),
    ...planned.ingredientRefs.map((ref) =>
      insertStatement(
        "IngredientRef",
        ["id", "name", "updatedAt"],
        [sqlLiteral(ref.id), sqlLiteral(ref.name), dateLiteral(ref.updatedAt)],
      ),
    ),
    ...planned.oauthAccounts.map((account) =>
      insertStatement(
        "OAuth",
        ["provider", "providerUserId", "providerUsername", "userId", "createdAt"],
        [
          sqlLiteral(account.provider),
          sqlLiteral(account.providerUserId),
          sqlLiteral(account.providerUsername),
          sqlLiteral(account.userId),
          dateLiteral(account.createdAt),
        ],
      ),
    ),
    ...planned.userCredentials.map((credential) =>
      insertStatement(
        "UserCredential",
        ["id", "userId", "publicKey", "transports", "counter"],
        [
          sqlLiteral(credential.id),
          sqlLiteral(credential.userId),
          sqlLiteral(credential.publicKey),
          sqlLiteral(credential.transports),
          integerLiteral(credential.counter),
        ],
      ),
    ),
    ...planned.recipes.map((recipe) =>
      insertStatement(
        "Recipe",
        [
          "id",
          "title",
          "description",
          "servings",
          "chefId",
          "deletedAt",
          "sourceRecipeId",
          "sourceUrl",
          "createdAt",
          "updatedAt",
        ],
        [
          sqlLiteral(recipe.id),
          sqlLiteral(recipe.title),
          sqlLiteral(recipe.description),
          sqlLiteral(recipe.servings),
          sqlLiteral(recipe.chefId),
          dateLiteral(recipe.deletedAt),
          sqlLiteral(recipe.sourceRecipeId),
          sqlLiteral(recipe.sourceUrl),
          dateLiteral(recipe.createdAt),
          dateLiteral(recipe.updatedAt),
        ],
      ),
    ),
    ...planned.recipeCovers.map((cover) =>
      insertStatement(
        "RecipeCover",
        ["id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "sourceSpoonId", "createdAt"],
        [
          sqlLiteral(cover.id),
          sqlLiteral(cover.recipeId),
          sqlLiteral(cover.imageUrl),
          "NULL",
          sqlLiteral(cover.sourceType),
          "NULL",
          dateLiteral(cover.createdAt),
        ],
      ),
    ),
    ...planned.recipeSteps.map((step) =>
      insertStatement(
        "RecipeStep",
        ["id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt"],
        [
          sqlLiteral(step.id),
          sqlLiteral(step.recipeId),
          sqlLiteral(step.stepNum),
          sqlLiteral(step.stepTitle),
          sqlLiteral(step.description),
          "NULL",
          dateLiteral(step.updatedAt),
        ],
      ),
    ),
    ...planned.stepOutputUses.map((use) =>
      insertStatement(
        "StepOutputUse",
        ["id", "recipeId", "outputStepNum", "inputStepNum", "updatedAt"],
        [
          sqlLiteral(use.id),
          sqlLiteral(use.recipeId),
          sqlLiteral(use.outputStepNum),
          sqlLiteral(use.inputStepNum),
          dateLiteral(use.updatedAt),
        ],
      ),
    ),
    ...planned.ingredients.map((ingredient) =>
      insertStatement(
        "Ingredient",
        ["id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"],
        [
          sqlLiteral(ingredient.id),
          sqlLiteral(ingredient.recipeId),
          sqlLiteral(ingredient.stepNum),
          sqlLiteral(ingredient.quantity),
          sqlLiteral(ingredient.unitId),
          sqlLiteral(ingredient.ingredientRefId),
          dateLiteral(ingredient.updatedAt),
        ],
      ),
    ),
    ...planned.cookbooks.map((cookbook) =>
      insertStatement(
        "Cookbook",
        ["id", "title", "authorId", "createdAt", "updatedAt"],
        [
          sqlLiteral(cookbook.id),
          sqlLiteral(cookbook.title),
          sqlLiteral(cookbook.authorId),
          dateLiteral(cookbook.createdAt),
          dateLiteral(cookbook.updatedAt),
        ],
      ),
    ),
    ...planned.recipeInCookbooks.map((item) =>
      insertStatement(
        "RecipeInCookbook",
        ["id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"],
        [
          sqlLiteral(item.id),
          sqlLiteral(item.cookbookId),
          sqlLiteral(item.recipeId),
          sqlLiteral(item.addedById),
          dateLiteral(item.createdAt),
          dateLiteral(item.updatedAt),
        ],
      ),
    ),
    ...planned.shoppingLists.map((list) =>
      insertStatement(
        "ShoppingList",
        ["id", "authorId", "createdAt", "updatedAt"],
        [sqlLiteral(list.id), sqlLiteral(list.authorId), dateLiteral(list.createdAt), dateLiteral(list.updatedAt)],
      ),
    ),
    ...planned.shoppingListItems.map((item) =>
      insertStatement(
        "ShoppingListItem",
        [
          "id",
          "shoppingListId",
          "quantity",
          "unitId",
          "ingredientRefId",
          "checked",
          "checkedAt",
          "deletedAt",
          "sortIndex",
          "categoryKey",
          "iconKey",
          "updatedAt",
        ],
        [
          sqlLiteral(item.id),
          sqlLiteral(item.shoppingListId),
          sqlLiteral(item.quantity),
          sqlLiteral(item.unitId),
          sqlLiteral(item.ingredientRefId),
          sqlLiteral(item.checked),
          "NULL",
          "NULL",
          sqlLiteral(item.sortIndex),
          "NULL",
          "NULL",
          dateLiteral(item.updatedAt),
        ],
      ),
    ),
  ];
}

export function buildD1ImportSql(source: V1Export, options: MigrationBuildOptions): string {
  const { planned } = planData(source);
  const generatedAt = dateToIso(options.generatedAt ?? new Date());
  const statements = [
    `-- Spoonjoy v1 Neon -> v2 D1 import generated at ${generatedAt}`,
    "-- Review the JSON report produced with this file before applying remotely.",
    "PRAGMA foreign_keys = OFF;",
    ...(options.replaceTarget ? TARGET_DELETE_ORDER.map(deleteStatement) : []),
    ...buildInsertStatements(planned),
    "PRAGMA foreign_keys = ON;",
    "",
  ];

  return statements.join("\n");
}
