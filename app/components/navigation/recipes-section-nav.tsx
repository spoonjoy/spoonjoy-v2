import clsx from "clsx";
import { useLocation } from "react-router";
import { Link } from "~/components/ui/link";

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

export function RecipesSectionNav({ className }: { className?: string }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Recipe lists" className={clsx("mb-6 lg:hidden", className)} data-testid="recipes-section-nav">
      <ul className="m-0 grid list-none grid-cols-3 gap-1 rounded-full border border-[var(--sj-border)] bg-[var(--sj-flour)] p-1">
        {sections.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex min-h-10 flex-1 items-center justify-center rounded-full font-sj-ui text-sm font-semibold no-underline transition duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-ink)]",
                  active
                    ? "bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                    : "text-[var(--sj-ink-soft)]",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
