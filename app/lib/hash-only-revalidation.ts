import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * `shouldRevalidate` for routes whose data does not depend on the URL hash. React Router
 * treats leaving a hash (`/recipes/x#cook` -> `/recipes/x`) as a same-URL navigation and
 * re-runs every loader, so closing cook mode would wait on (or, offline, fail on) a data
 * fetch. A navigation that changes only the hash, with no form submission, keeps the loaded
 * data; everything else, including an explicit `revalidator.revalidate()` (same URL and hash),
 * keeps React Router's default.
 */
export function revalidateUnlessHashOnly({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  const hashOnly =
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search &&
    currentUrl.hash !== nextUrl.hash;
  return hashOnly ? false : defaultShouldRevalidate;
}
