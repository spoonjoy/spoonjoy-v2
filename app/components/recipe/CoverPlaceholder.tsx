import type { HTMLAttributes } from "react";

export interface CoverPlaceholderProps extends HTMLAttributes<HTMLDivElement> {
  /** The recipe's title: its first letter is the tile's mark. */
  title: string;
  /** Copy for screen readers, such as "Cover coming soon". Without it the tile is decoration. */
  label?: string;
  /**
   * `tile` (the default) is a photo-radius plate, as in Cooking now. `bleed` is square, for a slot
   * whose cover photo runs edge to edge, such as the recipe header.
   */
  shape?: "tile" | "bleed";
}

/**
 * A recipe with no cover: native's initial tile (RecipeInitialTile in spoonjoy-apple's
 * RecipeIndexRow.swift), a photo-radius plate from vellum to brass with the title's first letter in
 * the display serif. `.sj-cover-placeholder` in tailwind.css draws it; the caller sets its size.
 */
export function CoverPlaceholder({ title, label, shape = "tile", className, ...rest }: CoverPlaceholderProps) {
  const initial = title.trim().charAt(0).toUpperCase() || "S";
  const classes = ["sj-cover-placeholder", shape === "bleed" ? "sj-cover-placeholder-bleed" : null, className].filter(Boolean).join(" ");
  return (
    <div {...rest} className={classes}>
      <span aria-hidden="true" className="sj-cover-placeholder-initial">
        {initial}
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
