// The app's theme as the browser reads it: Spoonjoy's tokens (app/styles/sj-tokens.css, generated
// from ouro-ui-core's Cookbook theme) and then tailwind.css, which imports them first. Where
// tailwind.css imports ouro-base's own file (app/styles/ouro/ouro-base.css, which Ouro Current
// writes from each Ouro UI release), that file's rules stand in place of the import, as the browser
// reads them.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const TAILWIND = resolve(ROOT, "app/styles/tailwind.css");

/** tailwind.css with ouro-base's file in place of the line that imports it, when it does. */
export function readStylesheet(path = TAILWIND): string {
  return readFileSync(path, "utf8").replace(/^@import\s+["'](\.{1,2}\/[^"']*ouro-base\.css)["'];[^\n]*$/gm, (line, file: string) => {
    const imported = resolve(dirname(path), file);
    return existsSync(imported) ? readFileSync(imported, "utf8") : line;
  });
}

export const APP_CSS = readStylesheet();

export const THEME_CSS = [readFileSync(resolve(ROOT, "app/styles/sj-tokens.css"), "utf8"), APP_CSS].join("\n");
