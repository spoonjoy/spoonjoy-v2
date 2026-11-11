/**
 * Page titles written for search results: what the page answers first, the brand last, under ~60
 * characters where the content allows. A recipe search is "<dish> recipe", so a recipe's title says
 * "Recipe" unless the chef already did.
 */
export function recipePageTitle(title: string): string {
  const dish = title.trim();
  return /\brecipes?\b/i.test(dish) ? `${dish} - Spoonjoy` : `${dish} Recipe - Spoonjoy`;
}

export function kitchenPageTitle(username: string): string {
  return `${username}'s Kitchen: Recipes & Cookbooks - Spoonjoy`;
}

export const PUBLIC_RECIPES_TITLE = "Recipes From Real Home Kitchens - Spoonjoy";
