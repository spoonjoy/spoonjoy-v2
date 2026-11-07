import clsx from "clsx";
import { useLocation } from "react-router";
import { Tabs } from "~/components/ouro/tabs/tabs";

/**
 * The switch at the top of the phone Recipes tab: your recipes, the ones you saved, and every
 * public recipe. The tab bar has one Recipes tab; this is how a phone reaches the other two
 * recipe lists. Desktop shows all three in its top navigation, so the switch is phone only.
 */
const sections = [
  { value: "mine", href: "/my-recipes", label: "Mine" },
  { value: "saved", href: "/saved-recipes", label: "Saved" },
  { value: "everyone", href: "/recipes", label: "Everyone" },
];

export function RecipesSectionNav({ className }: { className?: string }) {
  const { pathname } = useLocation();

  return (
    <div className={clsx("mb-6 lg:hidden", className)} data-testid="recipes-section-nav">
      <Tabs label="Recipe lists" currentPath={pathname} items={sections} />
    </div>
  );
}
