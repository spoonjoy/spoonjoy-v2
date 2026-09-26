import type { MouseEvent } from "react";

/**
 * "Skip to main content" link. It keeps `href="#main"` for no-JS, but with JS a plain click moves
 * focus to the main landmark without adding a `#main` history entry, so Back after skipping
 * still leaves the page instead of undoing the skip.
 */
export function SkipLink() {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    const main = document.getElementById("main");
    if (!main) return;
    event.preventDefault();
    main.focus();
    main.scrollIntoView();
  };

  return (
    <a className="sj-skip-link" href="#main" onClick={handleClick}>
      Skip to main content
    </a>
  );
}
