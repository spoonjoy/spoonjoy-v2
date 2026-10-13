"use client";

import { useMediaQuery } from "~/lib/ouro/use-media-query";

/**
 * Whether an overlay with a `presentation` prop renders as a bottom sheet right now:
 * always for `"sheet"`, and below the `sm` breakpoint (640px) for `"auto"`. Any other
 * value (`"dialog"`, `"popover"`) never does. The server and hydration render the
 * wide form, and the client corrects it after, so there is no hydration mismatch.
 *
 * Internal: `Dialog` and `Popover` use it; apps don't need to.
 *
 * @example
 * const asSheet = useSheetPresentation(presentation);
 */
export function useSheetPresentation(presentation: string): boolean {
  const wide = useMediaQuery("(min-width: 640px)", true);
  return presentation === "sheet" || (presentation === "auto" && !wide);
}

/**
 * When a picker list that would be fiddly on a phone presents as a bottom sheet instead:
 * below the `sm` breakpoint (640px) on a coarse pointer. A narrow desktop window keeps the
 * popup, and so does a phone turned to landscape, past `sm`.
 *
 * @internal
 */
export const pickerSheetQuery = "(max-width: 639px) and (pointer: coarse)";

/**
 * Whether a picker (Combobox, Select) presents its list as a bottom sheet
 * ({@link pickerSheetQuery}). The server and hydration render the popup form, and the
 * client switches after.
 *
 * Internal: Ouro UI components use it; apps don't need to.
 *
 * @example
 * const sheet = usePickerSheet();
 */
export function usePickerSheet(): boolean {
  return useMediaQuery(pickerSheetQuery, false);
}
