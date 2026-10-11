export { axeExclude };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/**
 * What an axe scan leaves out while an Ouro UI Dialog, ConfirmDialog or Sheet is open:
 * Base UI's focus guards. In WebKit they take `role="button"` without a name on purpose,
 * so VoiceOver's virtual cursor stays trapped in the modal, and axe reports
 * `aria-command-name` on them. They are visually hidden and never reached by Tab.
 *
 * @example
 * // Playwright
 * new AxeBuilder({ page }).exclude(axeExclude)
 * // axe-core
 * axe.run({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) })
 */
const axeExclude: string[] = ["[data-base-ui-focus-guard]"];
