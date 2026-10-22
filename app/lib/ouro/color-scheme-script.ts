export { colorSchemeScript, COLOR_SCHEME_DEFAULTS };
export type { ColorScheme, ColorSchemeOptions, ResolvedColorScheme };

// Plain values with no hooks, so a Server Component (Next.js's root layout) can call
// colorSchemeScript; lib/ouro/color-scheme.ts holds the provider and the hook.

/** A person's choice of color scheme: light, dark, or whatever the system uses. */
type ColorScheme = "light" | "dark" | "system";

/** The scheme the page shows: `system` resolved through `prefers-color-scheme`. */
type ResolvedColorScheme = "light" | "dark";

/** Where the choice is kept and what holds before a person makes one. */
interface ColorSchemeOptions {
  /** The `localStorage` key that keeps the choice. @default "ouro-color-scheme" */
  storageKey?: string | undefined;
  /** The scheme before a person chooses one. @default "system" */
  defaultScheme?: ColorScheme | undefined;
}

/** @internal The defaults `ColorSchemeProvider` and `colorSchemeScript` share. */
const COLOR_SCHEME_DEFAULTS: { readonly storageKey: string; readonly defaultScheme: ColorScheme } = { storageKey: "ouro-color-scheme", defaultScheme: "system" };

/**
 * The script that sets the page's color scheme before it paints, so a reload in dark mode
 * never flashes light. It reads the choice `ColorSchemeProvider` keeps in `localStorage`,
 * resolves `system` through `prefers-color-scheme`, and sets the `.dark` class and the
 * `color-scheme` property on `<html>`. Put it in `<head>` as an inline script, with the
 * same options as the provider, and add `suppressHydrationWarning` to `<html>`, whose class
 * the script changes before React hydrates. It is plain text, so a Server Component can call it.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/color-scheme-toggle
 * @example
 * <html lang="en" suppressHydrationWarning>
 *   <head>
 *     <script dangerouslySetInnerHTML={{ __html: colorSchemeScript() }} />
 *   </head>
 *   <body>
 *     <ColorSchemeProvider>{children}</ColorSchemeProvider>
 *   </body>
 * </html>
 * @claim "The script that sets the page's" registry/ouro/lib/ouro/color-scheme.test.tsx verify:testExists(registry/ouro/lib/ouro/color-scheme.test.tsx::ColorSchemeProvider > keeps the head script's dark class through hydration)
 */
function colorSchemeScript(options: ColorSchemeOptions = {}): string {
  const key = JSON.stringify(options.storageKey ?? COLOR_SCHEME_DEFAULTS.storageKey);
  const fallback = JSON.stringify(options.defaultScheme ?? COLOR_SCHEME_DEFAULTS.defaultScheme);
  return (
    `(function(){var s;try{s=localStorage.getItem(${key})}catch(e){}` +
    `if(s!=="light"&&s!=="dark"&&s!=="system")s=${fallback};` +
    `var d=s==="dark"||(s==="system"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;` +
    `r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"})()`
  );
}
