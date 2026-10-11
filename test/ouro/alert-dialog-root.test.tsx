import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { AlertDialogRoot } from "~/components/ouro/dialog/dialog-parts";

// dialog-parts.tsx exports AlertDialogRoot for Ouro UI's ConfirmDialog, which Spoonjoy has not
// installed, so no shipped test that Spoonjoy runs reaches it. This keeps the installed file at
// 100% coverage (vitest.ouro.config.ts).
it("renders a closed alert dialog root with nothing on the page", () => {
  expect(renderToString(<AlertDialogRoot open={false}>{null}</AlertDialogRoot>)).toBe("");
});
