export { dialogSizes, dialogSizeWarning };
export type { DialogSize };

// Value lists and dev-message helpers shared by Dialog and its parts, apart from the
// components so each component file exports only components (React Fast Refresh). The
// export list comes first because the shadcn CLI drops comments before a file's first statement.

/**
 * A centered dialog's maximum width: `sm` 24rem, `md` 32rem, `lg` 40rem.
 *
 * @claim "A centered dialog's maximum width: `sm`" registry/ouro/components/ouro/dialog/dialog-parts.tsx verify:fileLine(registry/ouro/components/ouro/dialog/dialog-parts.tsx, /const\spopupSizes\s=\s\{\ssm:\s"max-w-\[24rem\]",\smd:\s"max-w-\[32rem\]",\slg:\s"max-w-\[40rem\]"\s\}/)
 */
type DialogSize = "sm" | "md" | "lg";

/**
 * The three sizes, for checking a `size` prop. Shared with `Dialog`.
 *
 * @internal
 * @claim "The three sizes, for checking a" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::Dialog parts > renders an md DialogPopup for a size that is not one of Ouro UI's, and warns once with the fix)
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
