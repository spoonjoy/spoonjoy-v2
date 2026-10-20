import clsx from "clsx";
import { useLocation } from "react-router";
import { Button } from "~/components/button";

/**
 * The switch at the top of the phone Recipes tab: your recipes, the ones you saved, and every
 * public recipe. The tab bar has one Recipes tab; this is how a phone reaches the other two
 * recipe lists. Desktop shows all three in its top navigation, so the switch is phone only.
 */
const sections = [
  { href: "/my-recipes", label: "Mine" },
  { href: "/saved-recipes", label: "Saved" },
  { href: "/recipes", label: "Everyone" },
];

// TODO(ouro-hx: tabs link mode): The three lists become HX Tabs over links once Tabs can be links (ourostack/ouro-ui#128).
export function RecipesSectionNav({ className }: { className?: string }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Recipe lists" className={clsx("mb-6 grid grid-cols-3 gap-1 lg:hidden", className)} data-testid="recipes-section-nav">
      {sections.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Button key={href} href={href} plain={!active} aria-current={active ? "page" : undefined}>
            {label}
          </Button>
        );
      })}
    </nav>
  );
}
