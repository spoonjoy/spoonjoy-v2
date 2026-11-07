export { acceptProblem, fileKey, formatSize, listClass, matchesAccept, nameClass, previewClass, promptClass, sizeClass, zoneClass };

// Class strings and helpers for FileField, apart from the component so its file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds them
// when it compiles.

/**
 * The drop zone: a dashed box at least 44px tall, in the primary tint while files are dragged
 * over it, outlined while the input inside it has keyboard focus. It fades with the field.
 *
 * @internal
 * @claim "The drop zone: a dashed box" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > outlines the zone while the input has keyboard focus)
 * @claim "The drop zone: a dashed box" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > highlights the zone while files are dragged over it)
 * @claim "The drop zone: a dashed box" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > is a labeled native file input inside a drop zone, on the Field contract)
 */
const zoneClass =
  "relative m-0 box-border flex min-h-11 w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-4 py-6 " +
  "rounded-lg border border-dashed border-input bg-transparent text-center text-muted-foreground " +
  "outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "transition-[border-color,background-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "not-data-disabled:pointer-fine:hover:border-ring not-data-disabled:active:bg-accent/60 data-dragging:border-primary data-dragging:bg-primary/10 " +
  "has-[input[aria-invalid=true]]:border-destructive " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/30";

/**
 * The text in the zone: 16px on phones, 14px from `sm` with a fine pointer.
 *
 * @internal
 * @claim "The text in the zone: 16px" registry/ouro/components/ouro/file-field/file-field.touch.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.touch.test.tsx::keeps 16px prompt text and a remove button with a 44px hit area on a landscape phone)
 */
const promptClass = "m-0 text-base leading-6 sm:pointer-fine:text-sm sm:pointer-fine:leading-5 [&_svg]:mx-auto [&_svg]:mb-1 [&_svg]:size-6";

/**
 * The chosen files, one row each.
 *
 * @internal
 * @claim "The chosen files, one row each" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > takes chosen files and lists them, with a preview for images)
 */
const listClass = "m-0 grid list-none gap-2 p-0";

/**
 * An image's thumbnail, or a file icon in its place.
 *
 * @internal
 */
const previewClass =
  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-solid border-border bg-muted text-muted-foreground object-cover [&_svg]:size-5";

/**
 * A file's name: one line, cut short with an ellipsis.
 *
 * @internal
 */
const nameClass = "m-0 block min-w-0 truncate text-sm leading-5 font-medium text-foreground";

/**
 * A file's size.
 *
 * @internal
 */
const sizeClass = "m-0 block text-sm leading-5 text-muted-foreground";

/**
 * A file's identity, to keep a file chosen twice in the list once: its name, size and type.
 *
 * @internal
 */
function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.type}`;
}

/**
 * Whether a file matches an `accept` list: an extension (`.pdf`, any case), a MIME type
 * (`image/png`) or a family (`image/*`). An empty list accepts everything.
 *
 * @internal
 * @claim "An empty list accepts everything" registry/ouro/components/ouro/file-field/file-field.test.tsx verify:testExists(registry/ouro/components/ouro/file-field/file-field.test.tsx::FileField > rejects files that do not match accept or exceed maxSize, and reports them)
 */
function matchesAccept(file: File, accept: string | undefined): boolean {
  const tokens = (accept ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) =>
    token.startsWith(".") ? name.endsWith(token) : token.endsWith("/*") ? type.startsWith(token.slice(0, -1)) : type === token,
  );
}

/**
 * The first `accept` entry that is neither an extension nor a MIME type, such as `pdf`, or
 * undefined. Development only.
 *
 * @internal
 */
function acceptProblem(accept: string | undefined): string | undefined {
  return (accept ?? "")
    .split(",")
    .map((token) => token.trim())
    .find((token) => token !== "" && !token.startsWith(".") && !token.includes("/"));
}

const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/**
 * A size in bytes for people: `2 kB`, `4.5 MB`, in the browser's language.
 *
 * @internal
 */
function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(undefined, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: 1 }).format(value);
}
