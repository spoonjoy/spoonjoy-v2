export { loadFonts };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/**
 * Loads every font face the page's stylesheets declare and waits for each to settle. A face that
 * loads mid-test moves text between a test's layout reads; a face that fails to load settles
 * without rejecting, so a missing font does not fail a file's setup.
 *
 * @claim "Loads every font face the page's stylesheets declare" registry/ouro/lib/ouro/testing/fonts.test.ts verify:testExists(registry/ouro/lib/ouro/testing/fonts.test.ts::loadFonts > loads a declared font face, which the browser otherwise loads only once text uses it)
 */
async function loadFonts(): Promise<void> {
  await Promise.allSettled([...document.fonts].map((face) => face.load()));
  await document.fonts.ready;
}
