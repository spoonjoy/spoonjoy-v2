// What a meal plan page says about its week, apart from the components that show it.
import { scaleToList, type PlanWeek } from "~/domains/planning";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The page title for a week: "Week of Nov 2". */
export function weekTitle(start: string) {
  return `Week of ${shortDate.format(new Date(`${start}T00:00:00Z`))}`;
}

/** A key that changes after each add or remove, so a sheet left from the last add closes and its form starts fresh. */
export function weekFormKey(week: Pick<PlanWeek, "start" | "days">) {
  return `${week.start}-${week.days.reduce((count, day) => count + day.entries.length, 0)}`;
}

/** How many recipes the week plans, and how many of them still have something to put on the shopping list. */
export function weekToList(week: Pick<PlanWeek, "days">) {
  const meals = week.days.flatMap((day) => day.entries).filter((entry) => entry.kind === "recipe" && entry.recipeId !== null);
  return { planned: meals.length, left: meals.filter((meal) => scaleToList(meal) > 0).length };
}
