export { popoverCloseClass };

// Class strings for Popover and its parts, apart from the components so each component
// file exports only components (React Fast Refresh). The export list comes first because
// the shadcn CLI drops comments before a file's first statement.

/**
 * The popover's close button: always present for screen readers (a phone has no Escape
 * key), hidden from view until it has keyboard focus, then shown at the top corner.
 *
 * @internal
 */
const popoverCloseClass =
  "sr-only focus-visible:top-2 focus-visible:end-2 focus-visible:z-1 focus-visible:m-0 focus-visible:size-auto " +
  "focus-visible:overflow-visible focus-visible:[clip-path:none] focus-visible:px-2 focus-visible:py-1 " +
  "focus-visible:rounded-md focus-visible:bg-muted focus-visible:text-foreground focus-visible:text-xs focus-visible:leading-4 focus-visible:font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";
