/**
 * Static source scanner for Spoonjoy telemetry calls.
 *
 * Locates calls to the named telemetry emitters (see `contract.ts`) and, for
 * the low-level sinks (`captureException`/`captureEvent`), extracts the
 * top-level key names of the options-object literal so the error-context rule
 * can check that meaningful diagnostic context is attached.
 *
 * Deterministic and dependency-free: it walks the source string with a
 * balanced-delimiter scan rather than a brittle multi-line regex, so nested
 * object literals, arrays, and template strings inside a call do not confuse
 * the boundary detection.
 */

import {
  CONTEXT_SAFE_BY_CONSTRUCTION,
  TELEMETRY_FUNCTIONS,
  type TelemetryCall,
  type TelemetryFunction,
} from "./contract";

// A telemetry call is `name(`, either bare or in method form
// (`telemetry.captureException(`). A negative lookbehind rejects an
// identifier char immediately before the name, so `myCaptureEvent(` does not
// match `captureEvent` while `obj.captureEvent(` (preceded by `.`) does.
const FUNCTION_ALTERNATION = TELEMETRY_FUNCTIONS.join("|");
const CALL_RE = new RegExp(`(?<![A-Za-z0-9_$])(${FUNCTION_ALTERNATION})\\s*\\(`, "g");

/** Count newlines in `source` up to `index` to derive a 1-based line number. */
function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/**
 * Given the source and the index of the call's opening `(`, return the index
 * just past the matching `)`, accounting for nested brackets, strings, and
 * template literals. Returns -1 if no balanced close is found.
 */
function findMatchingParen(source: string, openParenIndex: number): number {
  let depth = 0;
  let i = openParenIndex;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Extract the top-level key names of the LAST object literal appearing at the
 * top level of an argument list. The argument body is the text strictly
 * between the call's outer parentheses.
 *
 * Returns `null` when no top-level `{ ... }` object literal is found (e.g. the
 * options arg is a variable or spread), signalling the call cannot be checked
 * for context and should be treated as context-safe-by-construction.
 */
export function extractObjectKeys(argBody: string): string[] | null {
  // Find the last top-level `{` ... matching `}` span.
  let depth = 0;
  let quote: string | null = null;
  let lastObjectStart = -1;
  let lastObjectEnd = -1;

  for (let i = 0; i < argBody.length; i++) {
    const ch = argBody[i];

    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      if (ch === "{" && depth === 0) lastObjectStart = i;
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (ch === "}" && depth === 0 && lastObjectStart !== -1) lastObjectEnd = i;
    }
  }

  if (lastObjectStart === -1 || lastObjectEnd === -1) return null;

  const inner = argBody.slice(lastObjectStart + 1, lastObjectEnd);
  return extractTopLevelKeys(inner);
}

/**
 * Parse the body of a single object literal (text between its braces) and
 * return its top-level property key names. Nested objects/arrays, strings, and
 * spreads are skipped. Handles `key:`, `"key":`, `'key':`, and shorthand
 * `key,` / `key}` forms.
 */
export function extractTopLevelKeys(inner: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let token = "";

  const flushShorthand = () => {
    const trimmed = token.trim();
    token = "";
    // A spread (`...base`) introduces no named key of its own; skip it.
    if (trimmed.startsWith("...")) return;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) keys.push(trimmed);
  };

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (quote) {
      if (ch === "\\") {
        token += inner[i] + (inner[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
      } else {
        token += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      // Only treat a quote as a key-name quote when at top level and the token
      // so far is empty (i.e. it begins a `"key":` entry). Otherwise it is a
      // value string we are skipping.
      quote = ch;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      token = "";
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      token = "";
      continue;
    }

    if (depth > 0) continue;

    if (ch === ":") {
      const name = token.trim().replace(/^['"`]|['"`]$/g, "");
      if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) keys.push(name);
      token = "";
      // Skip to the next top-level comma so the value (which may contain
      // colons, e.g. ternaries) is not parsed as keys.
      let vdepth = 0;
      let vquote: string | null = null;
      i++;
      for (; i < inner.length; i++) {
        const c = inner[i];
        if (vquote) {
          if (c === "\\") {
            i++;
            continue;
          }
          if (c === vquote) vquote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          vquote = c;
          continue;
        }
        if (c === "{" || c === "[" || c === "(") vdepth++;
        else if (c === "}" || c === "]" || c === ")") vdepth--;
        else if (c === "," && vdepth === 0) break;
      }
      continue;
    }

    if (ch === ",") {
      flushShorthand();
      continue;
    }

    token += ch;
  }

  flushShorthand();
  return keys;
}

/**
 * Scan a source file's content for telemetry calls. For sink calls
 * (`captureException`/`captureEvent`) the returned keys are the top-level keys
 * of the options literal; domain wrappers are flagged context-safe.
 */
export function scanSourceForTelemetryCalls(source: string): TelemetryCall[] {
  const calls: TelemetryCall[] = [];
  let match: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;

  while ((match = CALL_RE.exec(source)) !== null) {
    const fn = match[1] as TelemetryFunction;
    // The opening paren is the last char of the match.
    const openParenIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingParen(source, openParenIndex);
    const line = lineAt(source, match.index);

    if (CONTEXT_SAFE_BY_CONSTRUCTION.has(fn)) {
      calls.push({ fn, keys: [], line, contextSafeByConstruction: true });
      continue;
    }

    if (closeIndex === -1) {
      // Unbalanced — cannot inspect; treat as context-safe to avoid false fail.
      calls.push({ fn, keys: [], line, contextSafeByConstruction: true });
      continue;
    }

    const argBody = source.slice(openParenIndex + 1, closeIndex - 1);
    const keys = extractObjectKeys(argBody);
    if (keys === null) {
      calls.push({ fn, keys: [], line, contextSafeByConstruction: true });
    } else {
      calls.push({ fn, keys, line, contextSafeByConstruction: false });
    }
  }

  return calls;
}
