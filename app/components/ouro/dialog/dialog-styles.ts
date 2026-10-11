export { dialogSizes, dialogSizeWarning };
export type { DialogSize };

// Value lists and dev-message helpers shared by Dialog and its parts, apart from the
// components so each component file exports only components (React Fast Refresh). The
// export list comes first because the shadcn CLI drops comments before a file's first statement.

/** A centered dialog's maximum width: `sm` 24rem, `md` 32rem, `lg` 40rem. */
type DialogSize = "sm" | "md" | "lg";

/**
 * The three sizes, for checking a `size` prop. Shared with `Dialog`.
 *
 * @internal
 */
const dialogSizes: readonly DialogSize[] = ["sm", "md", "lg"];

/**
 * The dev message for a size that is not one of {@link dialogSizes}. Development only.
 *
 * @internal
 */
function dialogSizeWarning(size: string, fix: string): readonly [string, string] {
  return [`size="${size}" is not a size; use ${dialogSizes.map((name) => `"${name}"`).join(", ")}`, fix];
}
