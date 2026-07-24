export const RECIPE_SCALE_MIN = 0.1;
export const RECIPE_SCALE_MAX = 100;

const REST_NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export class RecipeScaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeScaleError";
  }
}

function validateRecipeScale(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < RECIPE_SCALE_MIN ||
    value > RECIPE_SCALE_MAX
  ) {
    throw new RecipeScaleError("scale must be a finite number between 0.1 and 100");
  }
  return value;
}

export function parseRestRecipeScale(searchParams: URLSearchParams): number | undefined {
  const values = searchParams.getAll("scale");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !REST_NUMBER_PATTERN.test(values[0]!)) {
    throw new RecipeScaleError("scale must be a finite number between 0.1 and 100");
  }
  return validateRecipeScale(Number(values[0]));
}

export function parseMcpRecipeScale(args: Record<string, unknown>): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(args, "scale")) return undefined;
  return validateRecipeScale(args.scale);
}

type ScalableIngredient = {
  quantity: number;
};

type ScalableStep = {
  ingredients: ScalableIngredient[];
};

type ScalableRecipe = {
  steps: ScalableStep[];
};

export type RecipeScaleMetadata = {
  factor: number;
  appliedTo: "ingredient_quantities";
  decimalPlaces: 6;
};

export function applyRecipeScale<T extends ScalableRecipe>(
  recipe: T,
  factor: number | undefined,
): T | (T & { scale: RecipeScaleMetadata }) {
  if (factor === undefined) return recipe;
  const validatedFactor = validateRecipeScale(factor);
  const steps = recipe.steps.map((step) => ({
    ...step,
    ingredients: step.ingredients.map((ingredient) => {
      const product = ingredient.quantity * validatedFactor;
      if (!Number.isFinite(product)) {
        throw new RecipeScaleError("scale produced a non-finite ingredient quantity");
      }
      const rounded = Number(product.toFixed(6));
      if (!Number.isFinite(rounded)) {
        throw new RecipeScaleError("scale produced a non-finite ingredient quantity");
      }
      return {
        ...ingredient,
        quantity: rounded + 0,
      };
    }),
  }));

  return {
    ...recipe,
    steps,
    scale: {
      factor: validatedFactor,
      appliedTo: "ingredient_quantities",
      decimalPlaces: 6,
    },
  };
}
