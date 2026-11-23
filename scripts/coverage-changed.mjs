// Which of a pull request's changed files the full coverage run measures (vitest.config.ts's
// coverage include, less its exclude), so unit-changed can hold those files to the same 100% on the
// pull request instead of the merge queue finding a gap.
import { existsSync } from "node:fs";

/** A coverage glob as a whole-path pattern: `**` crosses folders, `*` and `?` don't, `{a,b}` is either. */
export function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (glob.startsWith("**/", i)) {
      pattern += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      pattern += ".*";
      i += 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else if (char === "{") pattern += "(?:";
    else if (char === "}") pattern += ")";
    else if (char === ",") pattern += "|";
    else pattern += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * The changed files, given as a list or as the comma-separated SPOONJOY_COVERAGE_CHANGED, that
 * exist and that `include` measures and `exclude` doesn't drop.
 */
export function changedCoverageFiles(changed, { include, exclude, exists = existsSync }) {
  const files = Array.isArray(changed) ? changed : (changed ?? "").split(",");
  const included = include.map(globToRegExp);
  const excluded = exclude.map(globToRegExp);
  return files.filter((file) => file && exists(file) && included.some((glob) => glob.test(file)) && !excluded.some((glob) => glob.test(file)));
}
