export { currentHref };

/** The path of an `href` or a pathname: no query, no hash, no trailing slash (the root stays `/`). */
function pathOf(href: string): string {
  const path = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/**
 * Picks which of a navigation's `hrefs` is the current page for `currentPath` (your
 * router's pathname): the one with the same path, or else the longest one the path sits
 * under, so `/recipes/12` marks `/recipes`. The root `/` matches only itself. Returns
 * `undefined` when none matches or there is no `currentPath`.
 *
 * @internal Shared by Navbar, Sidebar and NavigationMenu; apps pass `currentPath`.
 * @example
 * currentHref(["/", "/recipes", "/settings"], "/recipes/12"); // "/recipes"
 */
function currentHref(hrefs: readonly string[], currentPath: string | undefined): string | undefined {
  if (currentPath === undefined) return undefined;
  const path = pathOf(currentPath);
  let best: string | undefined;
  let bestLength = -1;
  for (const href of hrefs) {
    const candidate = pathOf(href);
    if (candidate === path) return href;
    if (candidate !== "/" && path.startsWith(`${candidate}/`) && candidate.length > bestLength) {
      best = href;
      bestLength = candidate.length;
    }
  }
  return best;
}
