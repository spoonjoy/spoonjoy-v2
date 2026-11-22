// What differs between the source app's major versions, as far as seeding and exporting a kitchen
// goes. 1.x keeps cookbooks, meal plans and shopping lists under the group and filters cookbooks by
// organizer lists; 2.x moved them under the household and filters cookbooks with a query string;
// 3.x also dropped the per-recipe zip export and the recipe "disable amount" setting.
export const SOURCE_VERSIONS = Object.freeze(
  ["v1.12.0", "v2.8.0", "v3.31.0"].map((version) =>
    Object.freeze({ version, image: `ghcr.io/mealie-recipes/mealie:${version}` }),
  ),
);

export function sourceProfile(version) {
  const major = Number(/^v(\d+)\.\d+\.\d+$/.exec(version)?.[1]);
  if (![1, 2, 3].includes(major)) {
    throw new Error(`No source profile for "${version}"; supported majors are 1, 2 and 3.`);
  }
  const scope = major === 1 ? "groups" : "households";
  return {
    version,
    major,
    households: major >= 2,
    cookbookFilter: major === 1 ? "organizers" : "query",
    recipeZipExport: major <= 2,
    disableAmountSetting: major <= 2,
    paths: {
      cookbooks: `/api/${scope}/cookbooks`,
      mealPlans: `/api/${scope}/mealplans`,
      shoppingLists: `/api/${scope}/shopping/lists`,
      shoppingItems: `/api/${scope}/shopping/items`,
      labels: "/api/groups/labels",
    },
  };
}
