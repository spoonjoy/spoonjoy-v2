import { describe, expect, it } from "vitest";
import { shouldRevalidate as newRecipeShouldRevalidate } from "~/routes/recipes.new";
import { shouldRevalidate as newStepShouldRevalidate } from "~/routes/recipes.$id.steps.new";
import { shouldRevalidate as editStepShouldRevalidate } from "~/routes/recipes.$id.steps.$stepId.edit";

// The AI ingredient box posts intent=parseIngredients to these three pages. Parsing changes no
// data, and since a failed parse answers 200, React Router would otherwise reload every loader on
// the page after each parse. Everything else keeps React Router's default.
function formData(intent?: string) {
  const data = new FormData();
  if (intent) data.set("intent", intent);
  return data;
}

describe.each([
  ["/recipes/new", newRecipeShouldRevalidate],
  ["/recipes/:id/steps/new", newStepShouldRevalidate],
  ["/recipes/:id/steps/:stepId/edit", editStepShouldRevalidate],
])("shouldRevalidate on %s", (_route, shouldRevalidate) => {
  it("skips revalidation after an ingredient parse", () => {
    expect(shouldRevalidate({ formData: formData("parseIngredients"), defaultShouldRevalidate: true } as never)).toBe(false);
  });

  it.each([true, false])("keeps the default (%s) after any other submission", (defaultShouldRevalidate) => {
    expect(shouldRevalidate({ formData: formData("addIngredient"), defaultShouldRevalidate } as never)).toBe(defaultShouldRevalidate);
    expect(shouldRevalidate({ formData: formData(), defaultShouldRevalidate } as never)).toBe(defaultShouldRevalidate);
  });

  it.each([true, false])("keeps the default (%s) for navigations without a submission", (defaultShouldRevalidate) => {
    expect(shouldRevalidate({ defaultShouldRevalidate } as never)).toBe(defaultShouldRevalidate);
  });
});
