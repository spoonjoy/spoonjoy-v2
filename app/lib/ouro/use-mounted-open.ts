"use client";

import { useState } from "react";
import { lastInput } from "~/lib/ouro/last-input";

/**
 * Whether an overlay mounted already open after the person had pressed or typed on the page, as
 * `{editing && <Dialog open … />}` does. Its open and close transitions are skipped then: the
 * popup starts out open, and leaves with the element. Overlays read it for a development message.
 * One open at page load (a route such as `?edit=1`) is not counted, since nothing was pressed yet.
 *
 * Internal: Ouro UI components use it; apps don't need to.
 *
 * @example
 * const mountedOpen = useMountedOpen(open);
 * @claim "Whether an overlay mounted already open" registry/ouro/lib/ouro/use-mounted-open.test.tsx verify:testExists(registry/ouro/lib/ouro/use-mounted-open.test.tsx::useMountedOpen > counts an overlay mounted open after a press or a key)
 * @claim "One open at page load (a" registry/ouro/lib/ouro/use-mounted-open.test.tsx verify:testExists(registry/ouro/lib/ouro/use-mounted-open.test.tsx::useMountedOpen > does not count an overlay open before anything was pressed)
 */
export function useMountedOpen(open: boolean | undefined): boolean {
  const [mountedOpen] = useState(() => open === true && lastInput() !== "");
  return mountedOpen;
}
