// What a meal plan page says about its week, apart from the components that show it.
import type { PlanWeek } from "~/domains/planning";

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The page title for a week: "Week of Nov 2". */
export function weekTitle(start: string) {
  return `Week of ${shortDate.format(new Date(`${start}T00:00:00Z`))}`;
}

/** A key that changes after each add or remove, so a sheet left from the last add closes and its form starts fresh. */
export function weekFormKey(week: Pick<PlanWeek, "start" | "days">) {
  return `${week.start}-${week.days.reduce((count, day) => count + day.entries.length, 0)}`;
}
