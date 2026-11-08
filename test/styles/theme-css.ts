// The app's theme as the browser reads it: Spoonjoy's tokens (app/styles/sj-tokens.css, generated
// from ouro-ui-core's Cookbook theme) and then tailwind.css, which imports them first.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

export const THEME_CSS = [
  readFileSync(resolve(ROOT, "app/styles/sj-tokens.css"), "utf8"),
  readFileSync(resolve(ROOT, "app/styles/tailwind.css"), "utf8"),
].join("\n");
