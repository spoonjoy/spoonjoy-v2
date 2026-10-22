import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { parseClaimCheck, parseClaimSource } from "./claims.ts";

// ---------------------------------------------------------------------------------------
// Configuration

/** Verbs an instruction starts with: "Run pnpm test", "Don't add a class". */
export const INSTRUCTION_VERBS =
  "add allow apply ask avoid build call change check choose clear click close commit compare compose configure copy cover create declare delete describe disable do don't download drag draw edit enable ensure export fill find fix follow give go hide import include install keep leave let link list load look make mark merge move name never note open pass pick pin place prefer press put raise read rebase record refresh regenerate release remove rename render replace report request reset restart return review run score see select set show skip sort start stop swap switch tag tap tell test translate try turn type update upgrade use wait wrap write".split(" ");

/**
 * What an app gets without a claims.config.json: Markdown files and the copy under src/
 * are linted, and a test counts once it exists and is not skipped.
 */
export const DEFAULT_CONFIG = {
  surfaces: [
    { match: "\\.(md|mdx|txt)$", mode: "markdown" },
    { match: "^src/.*\\.(ts|tsx|js|jsx)$", exclude: "\\.(test|spec|stories)\\.|\\.d\\.ts$|/lib/ouro/", mode: "copy" },
  ],
  notLinted: [{ match: "(^|/)(LICENSE|CHANGELOG)(\\.\\w+)?$", mode: "input", reason: "license text and generated release notes" }],
  generated: [],
  generators: [],
  allowed: [],
  instructionVerbs: INSTRUCTION_VERBS,
  requiredTests: null,
  requiredChecks: ".github/required-checks.json",
  urlCache: "claims-urls.json",
  // `--network` fails on a committed answer older than this, so the cache is refreshed and committed.
  urlMaxAgeDays: 30,
};

/** A file's text at a git ref, or undefined. */
function gitShow(root, ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/** claims.config.json over the defaults, from the working tree or, with `ref`, from that commit. */
export function loadConfig(root, { ref } = {}) {
  const text = ref ? gitShow(root, ref, "claims.config.json") : existsSync(join(root, "claims.config.json")) ? readFileSync(join(root, "claims.config.json"), "utf8") : undefined;
  return { ...DEFAULT_CONFIG, ...(text ? JSON.parse(text) : {}) };
}

/** How a file is read: { mode: "lint", kind } for a surface, { mode, reason } for an exempt one, or undefined for a file that is not prose. */
export function classify(file, config) {
  const surface = config.surfaces.find((entry) => new RegExp(entry.match).test(file) && !(entry.exclude && new RegExp(entry.exclude).test(file)));
  if (!surface) return undefined;
  const exempt = config.notLinted.find((entry) => new RegExp(entry.match).test(file));
  return exempt ? { mode: exempt.mode, reason: exempt.reason } : { mode: "lint", kind: surface.mode };
}

// ---------------------------------------------------------------------------------------
// What makes a sentence a factual claim

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE = new RegExp(`\\b(?:19|20)\\d\\d-\\d\\d-\\d\\d\\b|\\b(?:${MONTH})(?:\\s+\\d{1,2},?)?\\s+(?:19|20)\\d\\d\\b|\\b\\d{1,2}\\s+(?:${MONTH})\\s+(?:19|20)\\d\\d\\b`, "g");
const VERSION = /\bv?\d+\.\d+(?:\.\d+)*\b(?![:\d])/g;

/** Numbers in words: "three themes", "a dozen helpers". Not "one", which mostly means "a" ("in one app"). */
const NUMBER_WORDS = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|dozens?)\b/gi;

/** The words that make a sentence factual, in report order, after numbers, versions and dates. */
const WORDS = [
  ["tested", /\btested\b/i],
  ["accessible", /\baccessib(?:le|ility)\b(?!\s+(?:names?|descriptions?|labels?)\b)/i],
  ["every", /\bevery(?:thing|one|where)?\b/i],
  ["all", /\ball\b/i],
  ["each", /\beach\b/i],
  ["no", /\b(?:no|zero|none)\b/i],
  ["always", /\b(?:always|never)\b/i],
  ["fully", /\bfully\b/i],
  ["works with", /\bworks?\s+with\b/i],
  ["supports", /\bsupport(?:s|ed)?\b/i],
  ["superlative", /\b(?<!\bat\s)(?:best|worst|fastest|slowest|quickest|smallest|largest|biggest|lightest|heaviest|easiest|simplest|safest|highest|lowest|strongest|newest|most|least|fewest)\b/i],
];

/** What a kind of claim needs, said so an agent can supply it. */
const NEEDS = {
  date: "dates an event. Cite the commit, release, CI run or evidence file that records it, checked with verify:fileLine(<file>, /<date>/)",
  version: "names a version. Cite the file that pins it, checked with verify:equals(<file>#<field path>)=<version> or verify:fileLine(<file>, /<version>/)",
  number: "states a number. Cite where it comes from, checked with verify:count(<file>#<field path>)=<n> (or dir:<path>, registry:<type>), verify:equals(<file>#<field path>)=<value> or verify:fileLine(<file>, /<pattern>/)",
  tested: "says something is tested. Cite the test, test:<file>::<full test name> with verify:testExists(<file>::<full test name>), or a required CI check, verify:ciJob(<job>)",
  accessible: "claims accessibility. Cite the axe or screen-reader test that checks it, with verify:testExists(<file>::<full test name>)",
  every: "makes a universal claim. Cite the test or script that checks every case, with verify:testExists(<file>::<full test name>) or verify:fileLine(<file>, /<pattern>/)",
  all: "makes a universal claim. Cite the test or script that checks every case, with verify:testExists(<file>::<full test name>) or verify:fileLine(<file>, /<pattern>/)",
  each: "makes a universal claim. Cite the test or script that checks each case, with verify:testExists(<file>::<full test name>) or verify:fileLine(<file>, /<pattern>/)",
  no: "makes a universal negative. Cite the test or script that proves none does, with verify:testExists(<file>::<full test name>) or verify:fileLine(<file>, /<pattern>/)",
  always: "says something always or never happens. Cite the test that proves it, with verify:testExists(<file>::<full test name>), or say when it happens instead",
  fully: "claims completeness. Cite the test that proves it, with verify:testExists(<file>::<full test name>), or say what it does instead",
  "works with": "claims compatibility. Cite the install test, required CI check or specification that proves it, with verify:ciJob(<job>), verify:testExists(<file>::<full test name>) or verify:urlOk(<url>)",
  supports: "claims compatibility. Cite the install test, required CI check or specification that proves it, with verify:ciJob(<job>), verify:testExists(<file>::<full test name>) or verify:urlOk(<url>)",
  superlative: "makes a superlative. Cite the measurement (an evidence file, checked with verify:fileLine), or say it without the superlative",
};

const HOW_TO = {
  markdown: 'Mark it as a claim: [the words](<source> "verify:<check>"), or end the sentence with [^id] and add "[^id]: <source> verify:<check>" (the claim docs).',
  jsdoc: 'Add `@claim "<words of the sentence>" <source> verify:<check>` to the comment (the claim docs).',
  copy: 'Wrap it in claim("…", { source, verify }) from lib/ouro/claims (the claim docs).',
};

/** Whether text has one of the claim words (not a number): a quotation with one is read, not masked. */
const hasClaimWord = (text) => WORDS.some(([, pattern]) => pattern.test(text));

/**
 * A short quotation mentions text, such as a label or an example of output ("3 days ago"); it
 * asserts nothing, so it is masked. One with a claim word, or longer than a label (six words),
 * is read like any other text, so a claim cannot hide in quotation marks.
 *
 * @claim "so a claim cannot hide in quotation marks" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::bypasses: noun-verbs, quotations, headings and spelled-out claims are caught)
 */
const QUOTED = /"([^"\n]{1,80})"|“([^”\n]{1,80})”/g;
const maskQuote = (quote, plain, curly) => {
  const inner = plain ?? curly;
  return hasClaimWord(inner) || inner.trim().split(/\s+/).length > 6 ? quote : "§".repeat(quote.length);
};

/** Code spans, template substitutions, links' targets and addresses: their digits and words are not prose. */
function maskCode(text) {
  return text
    .replace(/(`+)[\s\S]*?\1/g, (span) => "§".repeat(span.length))
    .replace(/\$\{[^}]*\}/g, (span) => "§".repeat(span.length))
    .replace(/\]\([^)]*\)/g, (target) => "]" + " ".repeat(target.length - 1))
    .replace(/<?https?:\/\/[^\s)>\]]*[^\s)>\].,;:!?'"]>?/g, (url) => "§".repeat(url.length))
    .replace(QUOTED, maskQuote);
}

/** The kinds of claim a sentence makes, with the words that make it. */
export function triggers(sentence) {
  let text = maskCode(sentence);
  const found = [];
  const take = (kind, pattern) => {
    const words = [...text.matchAll(pattern)].map((match) => match[0]);
    if (words.length === 0) return;
    found.push({ kind, words });
    text = text.replace(pattern, (match) => " ".repeat(match.length));
  };
  take("date", DATE);
  take("version", VERSION);
  // A digit inside a name ("e2e", "h1") is part of the name; "v2" and "x4" still count.
  take("number", /(?<![A-Za-uwyz])\d+/g);
  const spelled = [...text.matchAll(NUMBER_WORDS)].map((match) => match[0]);
  if (spelled.length > 0) {
    const number = found.find((entry) => entry.kind === "number");
    if (number) number.words.push(...spelled);
    else found.push({ kind: "number", words: spelled });
  }
  for (const [kind, pattern] of WORDS) {
    const match = pattern.exec(text);
    if (match) found.push({ kind, words: [match[0]] });
  }
  return found;
}

/** A verb form that, as the second or third word, makes the first word a noun with its verb ("Test coverage is…"), not an instruction. */
const COPULA = /^(?:is|are|was|were|be|been|has|have|had|will|would|can|could|should|may|might|must|does|did)$/;
const DETERMINER = /^(?:the|a|an|your|its|their|this|these|those|it|them|each|every|all|any|our|my|one|some|no)$/;

/**
 * Whether a sentence is an instruction, which needs no source: it starts with an instruction
 * verb ("Run pnpm test"), or with a condition and then one ("If it fails, run it again"), or
 * it is a question. A verb that is the subject's noun ("Test coverage is 100%", "Release 2.0
 * shipped", "Note that…", "Record: …") is not an instruction.
 *
 * @claim "Whether a sentence is an instruction" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::instructions are allowed: imperatives, conditional imperatives and questions)
 * @claim "A verb that is the subject's noun" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::bypasses: noun-verbs, quotations, headings and spelled-out claims are caught)
 */
export function isInstruction(sentence, verbs = INSTRUCTION_VERBS) {
  const known = verbs instanceof Set ? verbs : new Set(verbs);
  // A list item's label in code ("`pageCount`: Leave it out…") names what the instruction is about.
  const text = maskCode(sentence).replace(/^[\s>*_#-]*(?:\d+[.)]\s+)?(?:\*\*|__)?/, "").replace(/^\s*§*:\s+/, "").trim();
  if (/\?["'”’)*_]*$/.test(text)) return true;
  const imperative = (clause) => {
    const match = /^([A-Za-z’']+)(\s+|,|:|$)(.*)$/s.exec(clause);
    if (!match || !known.has(match[1].toLowerCase().replace("’", "'"))) return false;
    if (match[2] === ":") return false;
    const [next = "", after = ""] = match[3].toLowerCase().split(/\s+/).map((word) => word.replace(/[^a-z']/g, ""));
    if (COPULA.test(next) || next === "that" || COPULA.test(after)) return false;
    // "Release 2.0 shipped": a past tense after a noun, not after a determiner ("Use the shared…").
    return !(/^[a-z]+ed$/.test(after) && !DETERMINER.test(next));
  };
  if (imperative(text.replace(/^(?:then|also|next|first|finally|now|and|or)\s+/i, ""))) return true;
  if (!/^(?:if|when|whenever|before|after|once|to|for|unless|until|while|with|without|in|on)\b/i.test(text)) return false;
  // The condition may list several things ("For each arm, each screen and each run, make…"): any clause after a comma may start the instruction.
  return [...text.matchAll(/,\s+(?=[A-Za-z’'])/g)].some((match) => imperative(text.slice(match.index + match[0].length)));
}

// ---------------------------------------------------------------------------------------
// Sources and checks as written

/** `<source>; <source> verify:<check> verify:<check>`, as a footnote or `@claim` writes it. */
function parseEvidence(body) {
  const errors = [];
  const at = body.search(/(?:^|\s)verify:/);
  const sourceText = at === -1 ? body : body.slice(0, at);
  const checkText = at === -1 ? "" : body.slice(at);
  const sources = [];
  for (const piece of sourceText.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean)) {
    const link = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(piece);
    try {
      sources.push(parseClaimSource(link ? link[1] : piece));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (sources.length === 0 && errors.length === 0) errors.push("A claim needs a source: a repository path, a CI run, test:<file>::<full test name>, evidence:<path> or a specification's address.");
  const checks = [];
  for (const piece of checkText.split(/(?:^|\s+)verify:/).map((part) => part.trim()).filter(Boolean)) {
    try {
      checks.push(parseClaimCheck(piece));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { sources, checks, errors, hasCheck: at !== -1 };
}

// ---------------------------------------------------------------------------------------
// Markdown

const collapse = (text) => text.replace(/\s+/g, " ").trim();

/** Splits Markdown into the units sentences come from: paragraphs, list items, headings and table cells. */
function blocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const definitions = new Map();
  const out = [];
  let current = null;
  let fence = null;
  let comment = false;
  const end = () => {
    if (current) out.push(current);
    current = null;
  };
  const push = (line, offset, content, fresh) => {
    if (fresh) end();
    if (!current) current = { lines: [] };
    current.lines.push({ line, text: " ".repeat(offset) + content });
  };
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const line = index + 1;
    if (fence) {
      if (raw.trim().startsWith(fence)) fence = null;
      continue;
    }
    const heading = /^(#{1,6}\s+)(.*)$/.exec(raw);
    if (comment) {
      if (raw.includes("-->")) comment = false;
      continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(raw)) {
      end();
      continue;
    }
    if (/^\s*<!--/.test(raw) && !raw.includes("-->")) {
      end();
      comment = true;
      continue;
    }
    const opening = /^\s*(```+|~~~+)/.exec(raw);
    if (opening) {
      end();
      fence = opening[1];
      continue;
    }
    const definition = /^\[\^([^\]]+)\]:\s?(.*)$/.exec(raw);
    if (definition) {
      end();
      let body = definition[2];
      while (index + 1 < lines.length && /^\s{2,}\S/.test(lines[index + 1])) body += ` ${lines[++index].trim()}`;
      definitions.set(definition[1], { line, body });
      continue;
    }
    if (raw.trim() === "") {
      end();
      continue;
    }
    if (heading) {
      // A heading is read like a sentence: "## 73 components, all tested" is a claim too.
      end();
      // A step number ("#### 1. Update…") is the heading's numbering, not a sentence of its own.
      const step = /^\d+[.)]\s+/.exec(heading[2])?.[0] ?? "";
      out.push({ lines: [{ line, text: " ".repeat(heading[1].length + step.length) + heading[2].slice(step.length) }] });
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      end();
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(raw)) continue;
      let offset = 0;
      for (const cell of raw.split(/(?<!\\)\|/)) {
        if (cell.trim()) out.push({ lines: [{ line, text: " ".repeat(offset) + cell }], cell: true });
        offset += cell.length + 1;
      }
      continue;
    }
    const item = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(raw);
    if (item) {
      push(line, item[1].length, item[2], true);
      continue;
    }
    const quote = /^(\s*(?:>\s?)+)(.*)$/.exec(raw);
    if (quote) push(line, quote[1].length, quote[2], false);
    else push(line, 0, raw, false);
  }
  end();
  return { blocks: out, definitions };
}

/** The block's text with code, addresses and markup masked to the same length, and its claim markers. */
function maskBlock(text, definitions) {
  const markers = [];
  let masked = text
    .replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length))
    .replace(/(`+)[\s\S]*?\1/g, (span) => "§".repeat(span.length))
    .replace(/\$\{[^}]*\}/g, (span) => "§".repeat(span.length))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, (image) => "§".repeat(image.length));
  masked = masked.replace(/\[([^\]^][^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"([^"]*)")?\s*\)/g, (match, label, target, title, offset) => {
    if (title !== undefined && /^\s*verify:/.test(title)) {
      const parsed = parseEvidence(`${target.replace(/^<|>$/g, "")} ${title.trim()}`);
      markers.push({ at: offset, text: match, ...parsed });
    }
    return `[${label}]${" ".repeat(match.length - label.length - 2)}`;
  });
  masked = masked.replace(/\[\^([^\]]+)\]/g, (match, id, offset) => {
    const definition = definitions.get(id);
    if (!definition) markers.push({ at: offset, sources: [], checks: [], errors: [`The footnote [^${id}] has no definition. Add "[^${id}]: <source> verify:<check>".`], hasCheck: true });
    else {
      const parsed = parseEvidence(definition.body);
      if (!parsed.hasCheck) parsed.errors.push(`The footnote [^${id}] has no verify: check. Add one to its definition: "[^${id}]: ${definition.body} verify:<check>".`);
      markers.push({ at: offset, ...parsed });
    }
    return "¹".repeat(match.length);
  });
  masked = masked
    .replace(/<?https?:\/\/[^\s)>\]]*[^\s)>\].,;:!?'"]>?/g, (url) => "§".repeat(url.length))
    .replace(QUOTED, maskQuote)
    .replace(/<\/?[A-Za-z][^>]*>/g, (tag) => " ".repeat(tag.length));
  return { masked, markers };
}

/** Sentence spans in masked text: a sentence ends at . ! or ? (and any closing marks or footnote references) before a space and a capital, digit or mark. */
function sentenceSpans(masked) {
  const spans = [];
  let start = 0;
  for (const match of masked.matchAll(/[.!?]["'”’)*_¹]*\s+(?=[A-Z0-9"'“‘([*_§¹]|v\d)/g)) {
    const stop = match.index + match[0].trimEnd().length;
    spans.push([start, stop]);
    start = match.index + match[0].length;
  }
  spans.push([start, masked.length]);
  return spans;
}

/**
 * Reads Markdown: the claims it makes (with their sources and checks) and a finding for a
 * factual sentence that is not one, or for a claim marker that cannot be read.
 * `cover(sentence)` returns the evidence that backs a sentence from outside its text (a
 * JSDoc `@claim` that quotes it), or nothing. `howTo` says how to mark a claim in this kind
 * of file; `verbs` are the instruction verbs.
 */
export function readMarkdown(text, { file, startLine = 1, lineOf, cover, howTo = HOW_TO.markdown, verbs = INSTRUCTION_VERBS } = {}) {
  const findings = [];
  const claims = [];
  const { blocks: units, definitions } = blocks(text);
  if (!(verbs instanceof Set)) verbs = new Set(verbs);
  const at = (line) => (lineOf ? lineOf(line) : line + startLine - 1);
  for (const unit of units) {
    const joined = unit.lines.map((entry) => entry.text).join("\n");
    const starts = [];
    let offset = 0;
    for (const entry of unit.lines) {
      starts.push(offset);
      offset += entry.text.length + 1;
    }
    const lineAt = (position) => {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= position) index++;
      return at(unit.lines[index].line);
    };
    const { masked, markers } = maskBlock(joined, definitions);
    for (const [from, to] of sentenceSpans(masked)) {
      const clean = collapse(masked.slice(from, to).replace(/[§¹]/g, " "));
      if (!/[A-Za-z0-9]/.test(clean)) continue;
      // A table cell of a word or two without a number is a value, such as a default of "none".
      if (unit.cell && !/\d/.test(clean) && clean.split(" ").length <= 2) continue;
      const lead = from + (masked.slice(from, to).length - masked.slice(from, to).trimStart().length);
      const line = lineAt(lead);
      const sentence = collapse(joined.slice(from, to));
      const own = markers.filter((marker) => marker.at >= from && marker.at < to);
      for (const marker of own) for (const error of marker.errors) findings.push({ file, line, sentence, message: `${file}:${line}: "${sentence}": ${error}` });
      if (own.length > 0) {
        if (own.every((marker) => marker.errors.length === 0)) claims.push({ file, line, text: sentence, sources: own.flatMap((marker) => marker.sources), checks: own.flatMap((marker) => marker.checks) });
        continue;
      }
      const backed = cover?.(sentence) ?? [];
      if (backed.length > 0) {
        claims.push({ file, line, text: sentence, sources: backed.flatMap((entry) => entry.sources), checks: backed.flatMap((entry) => entry.checks) });
        continue;
      }
      if (isInstruction(clean, verbs)) continue;
      const found = triggers(clean);
      if (found.length === 0) continue;
      const kinds = found.map((entry) => entry.kind);
      const words = found.flatMap((entry) => entry.words).map((word) => `"${word}"`).join(", ");
      findings.push({ file, line, sentence, kinds, message: `${file}:${line}: "${sentence}" ${NEEDS[kinds[0]]}. (It reads as a claim because of ${words}.) ${howTo}` });
    }
  }
  return { findings, claims };
}

/** The findings for some Markdown. */
export function lintMarkdown(text, options) {
  return readMarkdown(text, options).findings;
}

/** The findings for plain text, such as a pull request's title. */
export function lintPlain(text, options) {
  return readMarkdown(text.replace(/^#+\s*/, ""), options).findings;
}

// ---------------------------------------------------------------------------------------
// TypeScript: JSDoc and copy

const JSDOC_TAGS = "claim|default|defaultValue|example|group|see|internal|param|returns?|deprecated|remarks|throws|link|template|typeParam";

/** A kept tag's text with its head blanked: the tag, a `{type}` (braces nested), and a @param's name. */
function blankTagHead(text) {
  let end = /^@\w+/.exec(text)[0].length;
  const typed = /^\s+\{/.exec(text.slice(end));
  if (typed) {
    let depth = 0;
    let index = end + typed[0].length - 1;
    for (; index < text.length; index++) {
      if (text[index] === "{") depth++;
      else if (text[index] === "}" && --depth === 0) break;
    }
    end = index + 1;
  }
  const name = /^\s+[\w.$[\]]+(?=\s+[-–]?\s*\S)/.exec(text.slice(end));
  if (name && /^@(param|typeParam)\b/.test(text)) end += name[0].length;
  else if (!typed && name) end += name[0].length;
  return " ".repeat(end) + text.slice(end);
}

/**
 * A JSDoc comment's prose with its tags handled: `@claim` read as evidence (with the words it
 * quotes, `@claim "<words>" <source> verify:<check>`), @example and the like blanked, line
 * breaks kept.
 */
function jsdocProse(comment) {
  const body = comment
    .replace(/^\/\*\*/, "   ")
    .replace(/\*\/$/, "  ")
    .split("\n")
    .map((line) => line.replace(/^(\s*\*(?!\/)\s?)/, (prefix) => " ".repeat(prefix.length)))
    .join("\n");
  const evidence = [];
  const defaults = [];
  const tag = new RegExp(`(^|\\s)@(${JSDOC_TAGS})\\b`, "g");
  const found = [...body.matchAll(tag)].map((match) => ({ at: match.index + match[1].length, name: match[2] }));
  let prose = found.length > 0 ? body.slice(0, found[0].at) : body;
  for (const [index, entry] of found.entries()) {
    const text = body.slice(entry.at, found[index + 1]?.at ?? body.length);
    const keep = ["param", "returns", "return", "deprecated", "remarks", "throws", "typeParam"].includes(entry.name);
    if (entry.name === "claim") {
      const rest = collapse(text.slice("@claim".length));
      const quoted = /^(?:"([^"]+)"|“([^”]+)”)\s*(.*)$/.exec(rest);
      evidence.push({ line: body.slice(0, entry.at).split("\n").length, quote: quoted ? collapse(quoted[1] ?? quoted[2]) : undefined, ...parseEvidence(quoted ? quoted[3] : rest) });
    }
    // A default's value is code ("button", 14); what follows it is prose the docs table shows,
    // read as a sentence of its own.
    if (entry.name === "default") {
      const rest = text.replace(/^@default(\s+(?:"[^"]*"|'[^']*'|\d[\w.]*|true|false|null|undefined)(?=\s|$))?/, (head) => " ".repeat(head.length));
      // A one-word default ("none") is a value too, and a function (`(count) => …`) is code.
      if (/\s/.test(rest.trim()) && !/=>/.test(rest)) defaults.push({ line: body.slice(0, entry.at).split("\n").length, text: rest });
    }
    const shown = keep ? blankTagHead(text) : text.replace(/[^\n]/g, " ");
    prose += shown;
  }
  const links = (text) => text.replace(/\{@link\s+([^}|]+?)(?:\s*\|\s*([^}]+))?\}/g, (match, target, label) => (label ?? target).padEnd(match.length));
  return { prose: links(prose), evidence, defaults: defaults.map((entry) => ({ ...entry, text: links(entry.text) })) };
}

/** A literal expression's value, or undefined when it is not one (an identifier, a call). */
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(literal);
    return values.includes(undefined) ? undefined : values;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return undefined;
      const value = literal(property.initializer);
      if (value === undefined) return undefined;
      out[property.name.text] = value;
    }
    return out;
  }
  return undefined;
}

const SOURCE_KEYS = ["file", "ciRun", "test", "spec", "evidence"];
const CHECK_KEYS = ["count", "urlOk", "testExists", "ciJob", "fileLine", "equals"];

/** A claim() call's evidence object, checked for shape. */
function evidenceOf(value) {
  const errors = [];
  const list = (entry) => (entry === undefined ? [] : Array.isArray(entry) ? entry : [entry]);
  const sources = list(value?.source);
  const checks = list(value?.verify);
  if (sources.length === 0) errors.push("claim() needs at least one source.");
  if (checks.length === 0) errors.push("claim() needs at least one check in verify.");
  for (const source of sources) if (Object.keys(source).filter((key) => SOURCE_KEYS.includes(key)).length !== 1) errors.push(`${JSON.stringify(source)} is not a source: give one of ${SOURCE_KEYS.join(", ")}.`);
  for (const check of checks) if (Object.keys(check).filter((key) => CHECK_KEYS.includes(key)).length !== 1) errors.push(`${JSON.stringify(check)} is not a check: give one of ${CHECK_KEYS.join(", ")}.`);
  return { sources, checks, errors };
}

/** Attributes whose string is code, not copy. */
const CODE_ATTRIBUTES = /^(className|class|id|key|href|src|srcSet|type|role|name|value|htmlFor|rel|target|lang|dir|as|variant|tone|size|align|side|presentation|data-[\w-]+|style)$/;

/**
 * Whether a string literal reads as prose: three or more words, starting with a capital or ending a sentence.
 *
 * @claim "Whether a string literal reads as prose" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::TypeScript copy: claim() calls are claims, unsourced prose literals and JSX text fail)
 */
const isProse = (text) => /(?:[A-Za-z’'][\w’'/.-]*\s+){2,}[A-Za-z’']/.test(text) && (/^[\s"“'(]*[A-Z]/.test(text) || /[.!?]["”']?\s*$/.test(text)) && !/[{};=]|=>|--|\bvar\(/.test(text);

/** Whether a string is Markdown: a heading line or paragraphs apart. It is read as Markdown, with its code spans. */
const isMarkdown = (text) => /(^|\n)[ \t]*#{1,6}[ \t]+\S|\n[ \t]*\n[ \t]*[A-Za-z]/.test(text);

/**
 * Whether a string that is not plainly prose still says something: it has a claim word and two
 * or more plain words ("tested in every browser"). Class lists and identifiers are not plain
 * words: "transition-colors duration-200" is code.
 *
 * @claim "Whether a string that is not plainly prose still says something" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::TypeScript copy: Markdown templates, lowercase and unpunctuated strings and comma templates are read)
 */
const saysSomething = (text) => {
  const tokens = text.trim().split(/\s+/);
  const plain = tokens.filter((token) => /^[A-Za-z’']+[,.;:!?]?$/.test(token));
  return hasClaimWord(maskCode(text)) && plain.length >= 2 && plain.length * 2 >= tokens.length;
};

/**
 * Whether a short string states a number of something ("73 components", "100% coverage"): a
 * number, then a plain word. It is read with its number, which needs a source like any other.
 *
 * @claim "Whether a short string states a number of something" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::TypeScript copy: a string of only a number and a noun is read)
 */
const statesNumber = (text) => /(?:^|\s)\d[\d,.]*%?\+?\s+[A-Za-z’']{2,}\b/.test(text) && !/[{};=<>()]|=>|--|\bvar\(/.test(text);

/** Where a string literal is a value the code compares or looks up, not text a reader sees. */
function isLookup(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent) || ts.isElementAccessExpression(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  return false;
}

/**
 * Reads a TypeScript file: with `jsdoc`, its JSDoc comments (an `@claim` tag covers its
 * comment); with `copy`, its claim() calls, and its prose string literals and JSX text,
 * which must be claims when they state a fact.
 */
export function lintTypeScript(source, { file, jsdoc = false, copy = false, claimsOnly = false, verbs = INSTRUCTION_VERBS }) {
  const findings = [];
  const claims = [];
  const lineAt = (position) => source.slice(0, position).split("\n").length;
  if (jsdoc) {
    for (const match of source.matchAll(/\/\*\*(?!\/)[\s\S]*?\*\//g)) {
      const start = lineAt(match.index);
      const { prose, evidence, defaults } = jsdocProse(match[0]);
      const errors = evidence.flatMap((entry) => entry.errors.map((error) => ({ line: start + entry.line - 1, error })));
      for (const entry of evidence) if (!entry.hasCheck) errors.push({ line: start + entry.line - 1, error: "This @claim has no verify: check. Add one: @claim <source> verify:<check>." });
      for (const { line, error } of errors) findings.push({ file, line, sentence: "@claim", message: `${file}:${line}: ${error}` });
      const usable = evidence.filter((entry) => entry.errors.length === 0 && entry.hasCheck);
      for (const entry of usable) if (!entry.quote) findings.push({ file, line: start + entry.line - 1, sentence: "@claim", message: `${file}:${start + entry.line - 1}: This @claim backs no sentence: quote the words of the sentence it backs, @claim "<words>" <source> verify:<check>.` });
      const at = (entry) => `${file}:${start + entry.line - 1}`;
      // A quote is three words or more, found as whole words, in exactly one sentence.
      const short = usable.filter((entry) => entry.quote && entry.quote.split(" ").length < 3);
      for (const entry of short) findings.push({ file, line: start + entry.line - 1, sentence: "@claim", message: `${at(entry)}: This @claim quotes "${entry.quote}": quote at least three words of the sentence it backs.` });
      let quoted = usable.filter((entry) => entry.quote && !short.includes(entry));
      const words = new Map(quoted.map((entry) => [entry, new RegExp(`(?<![\\w'’-])${entry.quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'’-])`)]));
      const read = (cover) => [
        readMarkdown(prose, { file, startLine: start, cover, howTo: HOW_TO.jsdoc, verbs }),
        ...defaults.map((entry) => readMarkdown(entry.text, { file, startLine: start + entry.line - 1, cover, howTo: HOW_TO.jsdoc, verbs })),
      ];
      const sentences = new Map(quoted.map((entry) => [entry, new Set()]));
      const cover = (sentence) => {
        const backing = quoted.filter((entry) => words.get(entry).test(collapse(sentence)));
        for (const entry of backing) sentences.get(entry).add(sentence);
        return backing;
      };
      read(cover);
      const ambiguous = quoted.filter((entry) => sentences.get(entry).size > 1);
      for (const entry of ambiguous) findings.push({ file, line: start + entry.line - 1, sentence: "@claim", message: `${at(entry)}: "${entry.quote}" is in more than one sentence of this comment. Quote words only one of them has.` });
      for (const entry of quoted) if (sentences.get(entry).size === 0) findings.push({ file, line: start + entry.line - 1, sentence: "@claim", message: `${at(entry)}: "${entry.quote}" is in no sentence of this comment, so this @claim backs nothing. Quote words of the sentence it backs.` });
      quoted = quoted.filter((entry) => sentences.get(entry).size === 1);
      const results = read(cover);
      for (const result of results) {
        findings.push(...result.findings);
        claims.push(...result.claims);
      }
    }
  }
  if (!copy && !claimsOnly) return { findings, claims };
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") || file.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  // A footnote or a source link in the text is a claim, so its checks run like a claim() call's.
  const prose = (text, node, wordsOnly = false) => {
    if (claimsOnly) return;
    const result = readMarkdown(text, { file, startLine: lineOf(node), howTo: HOW_TO.copy, verbs });
    findings.push(...(wordsOnly ? result.findings.filter((finding) => finding.kinds?.some((kind) => !["number", "version", "date"].includes(kind))) : result.findings));
    claims.push(...result.claims);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "claim") {
      const [textNode, evidenceNode] = node.arguments;
      const text = textNode ? literal(textNode) : undefined;
      const value = evidenceNode ? literal(evidenceNode) : undefined;
      const line = lineOf(node);
      const sentence = typeof text === "string" ? collapse(text) : node.getText(tree).slice(0, 80);
      if (typeof text !== "string" || value === undefined) {
        findings.push({ file, line, sentence, message: `${file}:${line}: "${sentence}": claim()'s arguments must be literals (a string, then an object of strings, numbers and arrays), so pnpm claims:check can read them.` });
        return;
      }
      const evidence = evidenceOf(value);
      for (const error of evidence.errors) findings.push({ file, line, sentence, message: `${file}:${line}: "${sentence}": ${error}` });
      if (evidence.errors.length === 0) claims.push({ file, line, text: sentence, sources: evidence.sources, checks: evidence.checks });
      return;
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && CODE_ATTRIBUTES.test(node.name.getText(tree))) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["cn", "clsx", "require", "matchMedia", "querySelector", "querySelectorAll"].includes(node.expression.text)) return;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parts = node.children.map((child) => (ts.isJsxText(child) ? child.text : ts.isJsxExpression(child) && child.expression && literal(child.expression) !== undefined ? String(literal(child.expression)) : "§"));
      if (node.children.some((child) => ts.isJsxText(child) && /[A-Za-z]/.test(child.text))) prose(parts.join(""), node);
      for (const child of node.children) if (!ts.isJsxText(child) && !(ts.isJsxExpression(child) && child.expression && literal(child.expression) !== undefined)) visit(child);
      if (ts.isJsxElement(node)) visit(node.openingElement);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isLookup(node)) return;
      if (isMarkdown(node.text) || isProse(node.text) || statesNumber(node.text)) prose(node.text, node);
      else if (saysSomething(node.text)) prose(node.text, node, true);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => `\${${span.expression.getText(tree)}}${span.literal.text}`)].join("");
      if (isMarkdown(text) || isProse(text) || statesNumber(text)) prose(text, node);
      else if (saysSomething(text)) prose(text, node, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { findings, claims };
}

// ---------------------------------------------------------------------------------------
// Tests

/**
 * Every statically named test in a file, by full name (`describe > it`), and whether it is skipped (skip, todo, fails, or { skip }).
 *
 * @claim "Every statically named test in a file" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::testNames: full test names, nested with ' > ', and whether each is skipped)
 */
export function testNames(source, file) {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const names = new Map();
  const visit = (node, prefix, skipped) => {
    if (ts.isCallExpression(node)) {
      // `it.each(cases)("name %s", fn)` is one test named as written: the callee is the `.each` call.
      const table = ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "each";
      let callee = table ? node.expression.expression.expression : node.expression;
      const modifiers = table ? ["each"] : [];
      while (ts.isPropertyAccessExpression(callee)) {
        modifiers.unshift(callee.name.text);
        callee = callee.expression;
      }
      const [first, second] = node.arguments;
      if (ts.isIdentifier(callee) && ["describe", "it", "test", "suite"].includes(callee.text) && first && (table || !modifiers.includes("each"))) {
        const name = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text : null;
        const options = second && ts.isObjectLiteralExpression(second) ? literal(second) : undefined;
        const skip = skipped || modifiers.some((modifier) => ["skip", "todo", "fails"].includes(modifier)) || Boolean(options?.skip || options?.todo);
        if (name === null || prefix === null) {
          for (const argument of node.arguments) visit(argument, null, skip);
          return;
        }
        const full = prefix ? `${prefix} > ${name}` : name;
        names.set(full, { skipped: skip });
        for (const argument of node.arguments.slice(1)) visit(argument, full, skip);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, prefix, skipped));
  };
  visit(tree, "", false);
  return names;
}

/**
 * The required CI job that runs a test file, or null. Without `requiredTests` in the config
 * (an app's default) any test counts; with it, a test counts only where a rule names its job:
 * `{ match, job }`, or `{ match, job, listedIn: "package.json#scripts.test:scripts" }` for a file
 * that runs only when that command lists it.
 */
function requiredJobFor(root, file, config) {
  if (!config.requiredTests) return "any";
  for (const rule of config.requiredTests) {
    if (!new RegExp(rule.match).test(file)) continue;
    if (!rule.listedIn) return rule.job;
    const [json, path] = rule.listedIn.split("#");
    const [key, ...rest] = path.split(".");
    const listed = readJson(root, json)?.[key]?.[rest.join(".")];
    if (typeof listed === "string" && listed.split(/\s+/).includes(file)) return rule.job;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Checks

function readJson(root, file) {
  const path = join(root, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

const read = (root, file) => (existsSync(join(root, file)) && statSync(join(root, file)).isFile() ? readFileSync(join(root, file), "utf8") : undefined);

/** A field path into JSON: `ouro.latestRelease`, `items.0.name`, `items[0]`. */
function field(value, path) {
  let current = value;
  for (const key of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (current === null || typeof current !== "object" || !(key in current)) return { missing: true };
    current = current[key];
  }
  return { value: current };
}

/** The jobs the workflows define: id and, when it has one, name. */
function workflowJobs(root) {
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  const jobs = [];
  for (const workflow of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const lines = readFileSync(join(dir, workflow), "utf8").split("\n");
    const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (start === -1) continue;
    for (let index = start + 1; index < lines.length && !/^\S/.test(lines[index]); index++) {
      const id = /^ {2}([\w-]+):\s*$/.exec(lines[index])?.[1];
      if (!id) continue;
      let name;
      // The values each matrix key takes, from its list and its include entries.
      const matrix = {};
      const add = (key, value) => (matrix[key] ??= new Set()).add(value.replace(/^["']|["']$/g, ""));
      let matrixIndent;
      for (let inner = index + 1; inner < lines.length && !/^ {0,2}\S/.test(lines[inner]); inner++) {
        const line = lines[inner];
        name ??= /^ {4}name:\s*(.+?)\s*$/.exec(line)?.[1]?.replace(/^["']|["']$/g, "");
        const indent = /^ */.exec(line)[0].length;
        if (/^\s+matrix:\s*$/.test(line)) {
          matrixIndent = indent;
          continue;
        }
        if (matrixIndent === undefined || !line.trim()) continue;
        if (indent <= matrixIndent) {
          matrixIndent = undefined;
          continue;
        }
        const list = /^\s+([\w-]+):\s*\[(.*)\]\s*$/.exec(line);
        if (list && list[1] !== "include" && list[1] !== "exclude") for (const value of list[2].split(",")) add(list[1], value.trim());
        const entry = /^\s+(?:- )?([\w-]+):\s*([^\s[{][^#]*?)\s*$/.exec(line);
        if (entry && entry[1] !== "include" && entry[1] !== "exclude") add(entry[1], entry[2]);
      }
      jobs.push({ workflow, id, name, matrix: Object.fromEntries(Object.entries(matrix).map(([key, values]) => [key, [...values]])) });
    }
  }
  return jobs;
}

/** The repository's owner/name, for recognising its own GitHub addresses. */
function repoSlug(root) {
  const url = readJson(root, "package.json")?.repository?.url ?? "";
  return /github\.com\/([^/]+\/[^/.]+)/.exec(url)?.[1] ?? "ourostack/ouro-ui";
}

async function fetchStatus(url) {
  let last = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      for (const method of ["HEAD", "GET"]) {
        const response = await globalThis.fetch(url, { method, redirect: "follow", signal: globalThis.AbortSignal.timeout(15000), headers: { "user-agent": "ouro-ui claims check" } });
        last = response.status;
        if (response.ok) return last;
      }
    } catch {
      last = 0;
    }
    await new Promise((settle) => globalThis.setTimeout(settle, 1000 * (attempt + 1)));
  }
  return last;
}

/**
 * The required checks' names, from the committed list the config names. In a pull request
 * (`context.baseRef`, or CLAIMS_BASE_REF) it is read at the base ref, so a pull request cannot
 * make its own job required. Only when the base has no list does the pull request's own count,
 * and then the ratchet makes its description name each check, for a reviewer to hold against
 * the branch's rules.
 *
 * @claim "Only when the base has no list does the pull request's own count" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::ciJob reads the pull request's list of required checks only when the base has none, and the ratchet makes it name each check it adds)
 */
function requiredChecks(root, context) {
  if (!("required" in context)) {
    const file = context.config.requiredChecks;
    const ref = context.baseRef ?? process.env.CLAIMS_BASE_REF;
    const text = (ref ? gitShow(root, ref, file) : undefined) ?? read(root, file);
    context.required = text === undefined ? null : JSON.parse(text);
  }
  return context.required;
}

/** Whether a job reports a required check: by id, by name, or by a matrix name (`themes (${{ matrix.shard }}/3)`) one of whose runs is required. */
function isRequired(job, required) {
  // GitHub names a job's check by its name, or by its id when it has none.
  if (!job.name) return required.includes(job.id);
  // A matrix job's checks are named for each combination: expand `${{ matrix.<key> }}` over the
  // values the matrix lists. Any other expression names no check this can know.
  let names = [job.name];
  for (const match of job.name.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)) {
    const values = /^matrix\.([\w-]+)$/.exec(match[1]) ? (job.matrix?.[match[1].slice(7)] ?? []) : [];
    names = names.flatMap((name) => values.map((value) => name.replace(match[0], value)));
  }
  return names.some((name) => required.includes(name));
}

/** Whether a test exists, is not skipped and runs in a required CI job; the failure message otherwise. */
function testProblem(root, id, config) {
  const [file, name] = [id.slice(0, id.indexOf("::")), id.slice(id.indexOf("::") + 2)];
  const source = read(root, file);
  if (source === undefined) return `${file} does not exist.`;
  const names = testNames(source, file);
  const found = names.get(name);
  if (!found) return `${file} has no test "${name}"; it has: ${[...names.keys()].slice(0, 12).join(", ")}${names.size > 12 ? ", …" : ""}. (A computed name cannot be cited; cite the file with verify:fileLine instead.)`;
  if (found.skipped) return `${file}::${name} is skipped, so it proves nothing.`;
  if (!requiredJobFor(root, file, config)) return `no required CI job runs ${file}, so a green main does not mean it passed. Cite a test a required job runs, or the run's address.`;
  return null;
}

/**
 * Runs checks (and checks sources that can be checked offline) against the repository at
 * `context.root`. Returns the failures of the checks that do not hold, with their reasons.
 */
export async function verify(checks, context, sources = []) {
  const { root, network = false } = context;
  const config = (context.config ??= loadConfig(root));
  const cacheFile = (context.urlCache ??= config.urlCache);
  const cache = (context.cache ??= readJson(root, cacheFile) ?? {});
  const failures = [];
  const fail = (message) => failures.push({ message });
  const lines = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  for (const check of checks) {
    if ("count" in check) {
      const what = check.count;
      let count;
      if (what.startsWith("registry:")) count = (readJson(root, "registry.json")?.items ?? []).filter((item) => item.type === what).length;
      else if (what.startsWith("dir:")) {
        const dir = join(root, what.slice(4));
        count = existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith(".")).length : undefined;
      } else if (what.includes("#")) {
        const [file, path] = what.split("#");
        const value = field(readJson(root, file), path);
        count = value.missing ? undefined : Array.isArray(value.value) ? value.value.length : value.value && typeof value.value === "object" ? Object.keys(value.value).length : undefined;
      } else {
        fail(`count(${what}): count registry:<type>, dir:<path> or <file>#<field path>.`);
        continue;
      }
      if (count === undefined) fail(`count(${what}) names nothing that exists.`);
      else if (count !== check.is) fail(`count(${what}) counts ${count}, not ${check.is}.`);
    } else if ("equals" in check) {
      const [file, path] = check.equals.split("#");
      const json = readJson(root, file);
      const value = json === undefined ? { missing: true } : field(json, path);
      if (json === undefined) fail(`${file} does not exist.`);
      else if (value.missing) fail(`${file} has no ${path}.`);
      else if (String(value.value) !== String(check.is)) fail(`equals(${check.equals}) is ${JSON.stringify(value.value)}, not ${JSON.stringify(check.is)}.`);
    } else if ("fileLine" in check) {
      const text = read(root, check.fileLine);
      const pattern = new RegExp(check.pattern, check.line ? "" : "m");
      if (text === undefined) fail(`${check.fileLine} does not exist.`);
      else if (check.line) {
        const line = text.split("\n")[check.line - 1];
        if (line === undefined || !pattern.test(line)) fail(`${check.fileLine}:${check.line} does not match /${check.pattern}/${line === undefined ? ` (it has ${lines(text)} lines)` : `: ${line.trim().slice(0, 120)}`}.`);
      } else if (!pattern.test(text)) fail(`${check.fileLine} does not match /${check.pattern}/.`);
    } else if ("ciJob" in check) {
      const jobs = workflowJobs(root).filter((job) => !check.workflow || job.workflow === check.workflow);
      const job = jobs.find((each) => each.id === check.ciJob || each.name === check.ciJob);
      const required = requiredChecks(root, context);
      if (!job) fail(`No workflow${check.workflow ? ` (${check.workflow})` : ""} defines a job "${check.ciJob}"; jobs: ${[...new Set(jobs.map((each) => each.id))].join(", ")}.`);
      else if (!required) fail(`verify:ciJob needs the list of required checks, ${config.requiredChecks}: the checks a branch must pass to merge, as a JSON array of names.`);
      else if (!isRequired(job, required)) fail(`"${check.ciJob}" is not a required check (${config.requiredChecks}: ${required.join(", ")}), so a green main does not mean it passed. Cite a required check, or a test one runs.`);
    } else if ("testExists" in check) {
      const problem = testProblem(root, check.testExists, config);
      if (problem) fail(problem);
    } else if ("urlOk" in check) {
      // A file or folder on GitHub at a branch or tag still answers after its contents change.
      const ref = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/([^/#?]+)/.exec(check.urlOk)?.[1];
      if (ref !== undefined && !/^[0-9a-f]{40}$/.test(ref)) {
        fail(`${check.urlOk} follows a branch or tag, so it answers after the file changes and backs nothing in it. Pin it to a commit: https://github.com/<owner>/<repo>/blob/<40-character commit hash>/<path>#L<line>.`);
        continue;
      }
      const before = cache[check.urlOk];
      if (network === true || (network === "changed" && context.refresh?.has(check.urlOk))) {
        const status = await fetchStatus(check.urlOk);
        if (before && before.status !== status) fail(`${check.urlOk} answered ${status || "nothing"}, where the cache had ${before.status}.`);
        // The weekly full run also asks for the refreshed cache once a committed answer is old.
        const today = context.today ?? new Date().toISOString().slice(0, 10);
        const maxAge = config?.urlMaxAgeDays ?? DEFAULT_CONFIG.urlMaxAgeDays;
        if (network === true && before?.checked && (Date.parse(today) - Date.parse(before.checked)) / 86_400_000 > maxAge) {
          fail(`${check.urlOk} was checked ${before.checked}, more than ${maxAge} days before ${today}: run the check with --network and commit the refreshed ${cacheFile}.`);
        }
        cache[check.urlOk] = { status, checked: new Date().toISOString().slice(0, 10) };
        context.cacheChanged = true;
      }
      const entry = cache[check.urlOk];
      if (!entry) fail(`${check.urlOk} has not been checked. Run the check with --network and commit ${cacheFile}.`);
      else if (entry.status < 200 || entry.status >= 400) fail(`${check.urlOk} answered ${entry.status || "nothing"} (checked ${entry.checked}).`);
    }
  }
  const slug = repoSlug(root);
  for (const source of sources) {
    if ("file" in source || "evidence" in source) {
      const file = source.file ?? source.evidence;
      const text = read(root, file);
      if (text === undefined && !(existsSync(join(root, file)) && statSync(join(root, file)).isDirectory())) fail(`${file} does not exist.`);
      else if (source.line && text !== undefined && source.line > lines(text)) fail(`${file} has ${lines(text)} lines, not ${source.line}.`);
    } else if ("test" in source) {
      const problem = testProblem(root, source.test, config);
      if (problem) fail(problem);
    } else if ("spec" in source) {
      const own = new RegExp(`^https://github\\.com/${slug.replace(".", "\\.")}/(?:blob|tree)/[^/]+/([^#?]+)(?:#L(\\d+))?`).exec(source.spec);
      if (own) {
        const file = decodeURIComponent(own[1]).replace(/\/$/, "");
        const text = read(root, file);
        if (!existsSync(join(root, file))) fail(`${file} does not exist.`);
        else if (own[2] && text !== undefined && Number(own[2]) > lines(text)) fail(`${file} has ${lines(text)} lines, not ${own[2]}.`);
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Surfaces

function listFiles(root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(root)) throw new Error("not the repository's root");
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean)
      .filter((file) => existsSync(join(root, file)));
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".git", ".tmp"].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else out.push(relative(root, path).split("\\").join("/"));
      }
    };
    walk(root);
    return out.sort();
  }
}

/**
 * Every prose surface in the repository: linted, or not, with the reason.
 *
 * @claim "Every prose surface in the repository" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::surfaces: every tracked prose file is linted or declared generated, evidence or input with a reason)
 */
export function surfaces(root, config = loadConfig(root)) {
  const out = [];
  for (const file of listFiles(root)) {
    const entry = classify(file, config);
    if (entry) out.push({ file, ...entry });
  }
  return out;
}

/** Findings without the allowed sentences (config `allowed`: exact sentences, with their reasons), and the allowed entries that matched nothing. */
export function applyAllowed(findings, allowed, files) {
  const used = new Set();
  const kept = findings.filter((finding) => {
    const entry = allowed.find((each) => each.file === finding.file && each.sentence === finding.sentence && finding.kinds);
    if (entry) used.add(entry);
    return !entry;
  });
  const unused = allowed.filter((entry) => !used.has(entry) && (!files || files.includes(entry.file)));
  return { findings: kept, unused: unused.map((entry) => ({ message: `claims.config.json: the allowed sentence "${entry.sentence}" (${entry.file}) matches no finding any more. Remove it from allowed.` })) };
}

/** A line in a registry message that is code a reader copies (a `--- <file>` header and the file after it), not prose. */
const isCodeLine = (line) => /^--- \S|^\s|^(import|export|const|let|function|return)\b|^[}\])<]|^\/\/|[{};]\s*$|=>/.test(line);

/**
 * Lints registry.json's own prose: the items' `description` and `docs`, the messages the shadcn
 * CLI prints, with code lines blanked. A finding's file is `registry.json:items[<n>].<field>`.
 */
export function lintRegistry(text, { file = "registry.json", verbs } = {}) {
  const findings = [];
  const claims = [];
  const items = JSON.parse(text).items ?? [];
  for (const [index, item] of items.entries()) {
    for (const key of ["description", "docs"]) {
      if (typeof item[key] !== "string") continue;
      const prose = item[key].split("\n").map((line) => (isCodeLine(line) ? "" : line)).join("\n");
      const result = readMarkdown(prose, { file: `${file}:items[${index}].${key}`, verbs });
      findings.push(...result.findings);
      claims.push(...result.claims);
    }
  }
  return { findings, claims };
}

/** Lints one file by its kind; `hooks.prepare(file, text)` may mask what another check already holds. */
async function readSurface(root, file, kind, config, hooks = {}) {
  kind ??= classify(file, config)?.kind;
  const raw = readFileSync(join(root, file), "utf8");
  const text = hooks.prepare ? hooks.prepare(file, raw) : raw;
  const verbs = new Set(config.instructionVerbs);
  if (kind === "markdown") return readMarkdown(text, { file, verbs });
  if (kind === "registry") return lintRegistry(text, { file, verbs });
  return lintTypeScript(text, { file, jsdoc: kind === "jsdoc", copy: kind === "copy", verbs });
}

/** Verifies claims, prefixing a failure with where its claim is. */
async function verifyClaims(claims, context) {
  const failures = [];
  for (const claim of claims) {
    for (const failure of await verify(claim.checks, context, claim.sources)) failures.push({ ...failure, message: `${claim.file}:${claim.line}: "${claim.text}": ${failure.message}` });
  }
  return failures;
}

/** Writes the addresses `--network` checked into the URL cache, sorted. */
function saveUrlCache(context) {
  if (context.cacheChanged) writeFileSync(join(context.root, context.urlCache), `${JSON.stringify(Object.fromEntries(Object.entries(context.cache).sort()), null, 2)}\n`);
}

/** A claim's text as a generated file would repeat it: without code marks or link targets, in single spaces. */
const plainText = (text) =>
  collapse(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[\^[^\]]+\]/g, "").replace(/`/g, "")).replace(/\s+([,.;:!?)])/g, "$1");

/**
 * Drops the findings in generated files whose claim words all sit in text a source already
 * claims: a JSDoc or Markdown claim the generator copied, or a generator's own claim() call
 * (`claim("the installed files reach 100% coverage", …)` in the template that writes it).
 *
 * @claim "Drops the findings in generated files" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::generated surfaces are linted: registry.json, README regions and llms.txt items, with claims carried from their sources)
 */
function carryOver(findings, claims, config) {
  const generated = config.generated.map((pattern) => new RegExp(pattern));
  // A generator may drop a label ("Part: ") and change a letter's case, so the match ignores both.
  const texts = [...new Set(claims.map((claim) => plainText(claim.text).replace(/^[A-Z][a-z]+:\s+/, "").toLowerCase()).filter((text) => text.length >= 8))].sort((a, b) => b.length - a.length);
  return findings.filter((finding) => {
    const file = finding.file.split(":")[0];
    if (!finding.kinds || !generated.some((pattern) => pattern.test(file))) return true;
    let rest = plainText(finding.sentence).toLowerCase();
    for (const text of texts) rest = rest.split(text).join(" ");
    return triggers(rest).length > 0;
  });
}

/** The claims in the generators' templates: their claim() calls, which carry into what they write. */
function generatorClaims(root, config) {
  const claims = [];
  const findings = [];
  for (const file of config.generators) {
    const text = read(root, file);
    if (text === undefined) {
      findings.push({ message: `claims.config.json: the generator ${file} does not exist.` });
      continue;
    }
    const result = lintTypeScript(text, { file, claimsOnly: true });
    claims.push(...result.claims);
    findings.push(...result.findings);
  }
  return { claims, findings };
}

/** The addresses the claims cite with urlOk. */
const citedUrls = (claims) => new Set(claims.flatMap((claim) => claim.checks.filter((check) => "urlOk" in check).map((check) => check.urlOk)));

/**
 * The URL cache against its base: the entries a pull request adds or changes, which CI fetches
 * again (`--network=changed`), and the entries no claim cites, which fail.
 *
 * @claim "The URL cache against its base" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::the URL cache: new or changed entries are fetched again, and an entry no claim cites fails)
 */
export function urlCacheReview(base, head, cited) {
  const refresh = Object.keys(head).filter((url) => JSON.stringify(head[url]) !== JSON.stringify(base[url])).sort();
  const uncited = Object.keys(head).filter((url) => !cited.has(url)).sort();
  return { refresh, uncited };
}

/** Lints the surfaces (or `files`) and runs the claims' checks. */
export async function checkClaims({ root = process.cwd(), network = false, files, baseRef, hooks = {} } = {}) {
  const config = loadConfig(root);
  const context = { root, network, config, baseRef };
  if (network === "changed") {
    const ref = baseRef ?? process.env.CLAIMS_BASE_REF;
    const base = ref ? JSON.parse(gitShow(root, ref, config.urlCache) ?? "{}") : {};
    context.refresh = new Set(urlCacheReview(base, readJson(root, config.urlCache) ?? {}, new Set()).refresh);
  }
  const all = surfaces(root, config).filter((entry) => entry.mode === "lint");
  const generated = config.generated.map((pattern) => new RegExp(pattern));
  // A generated file needs its sources' claims, so they are read even when only it is linted.
  const needsAll = !files || files.some((file) => generated.some((pattern) => pattern.test(file)));
  const scanned = needsAll ? all : all.filter((entry) => files.includes(entry.file));
  const claims = [];
  let findings = [];
  for (const entry of scanned) {
    const result = await readSurface(root, entry.file, entry.kind, config, hooks);
    claims.push(...result.claims);
    findings.push(...result.findings);
  }
  const fromGenerators = generatorClaims(root, config);
  claims.push(...fromGenerators.claims);
  findings = carryOver(findings, claims, config);
  const listed = files ? all.filter((entry) => files.includes(entry.file)) : all;
  const inScope = (file) => !files || files.includes(file.split(":")[0]);
  const allowed = applyAllowed(findings.filter((finding) => inScope(finding.file)), config.allowed, listed.map((entry) => entry.file));
  const failures = [...fromGenerators.findings, ...allowed.findings, ...allowed.unused];
  failures.push(...(await verifyClaims(claims.filter((claim) => inScope(claim.file) || !files), context)));
  if (!files) {
    const cache = readJson(root, config.urlCache) ?? {};
    for (const url of urlCacheReview(cache, cache, citedUrls(claims)).uncited) failures.push({ message: `${config.urlCache}: ${url} is cited by no claim. Remove it.` });
    if (hooks.extraFailures) failures.push(...(await hooks.extraFailures(root)));
  }
  saveUrlCache(context);
  return { claims, failures, surfaces: listed.length };
}

// ---------------------------------------------------------------------------------------
// Exemptions against the base ref

/** The exemption lists a pull request could grow to let a claim through, keyed by what names an entry. */
// What the ratchet compares: the lists that drop findings (allowed, notLinted, verbs, generated),
// widen what counts as a required test (requiredTests), or change what is read (surfaces). A new
// entry is named in the pull request's description; one marked here also needs a reason.
/** The lists that decide which files are read and how: removing an entry is an exemption. */
const NARROWING = ["surfaces", "generators", "generated"];

/** JSON with sorted keys, leaving out undefined values, to compare config entries whole. */
const canonical = (value) =>
  JSON.stringify(value, (_, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : inner));

const EXEMPTIONS = [
  ["allowed", (entry) => entry.sentence, true],
  ["notLinted", (entry) => entry.match, true],
  ["instructionVerbs", (entry) => entry, false],
  ["generated", (entry) => entry, false],
  ["requiredTests", (entry) => `${entry.match} in ${entry.job}`, true],
  ["surfaces", (entry) => entry.match, false],
  ["generators", (entry) => entry, false],
];

/**
 * What a pull request adds to the exemptions, against the base ref's config: each new entry
 * needs a reason (where it has one) and must be named in the pull request's description, so
 * a reviewer sees it. So must each check it adds to the list of required checks.
 *
 * @claim "What a pull request adds to the exemptions" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::exemptions ratchet against the base ref: a new one must carry a reason and be named in the pull request)
 * @claim "So must each check it adds" scripts/claims.test.mjs verify:testExists(scripts/claims.test.mjs::ciJob reads the pull request's list of required checks only when the base has none, and the ratchet makes it name each check it adds)
 */
export function policyProblems({ base, head, body = "", baseChecks = [], headChecks = [] }) {
  const problems = [];
  for (const check of headChecks) {
    if (!baseChecks.includes(check) && !body.includes(check)) problems.push({ message: `${head.requiredChecks ?? DEFAULT_CONFIG.requiredChecks} adds "${check}"; name it in the pull request's description, so a reviewer checks it against the branch's rules.` });
  }
  for (const [list, key, reasoned] of EXEMPTIONS) {
    const before = new Set((base[list] ?? []).map(key));
    for (const entry of head[list] ?? []) {
      const name = key(entry);
      if (before.has(name)) continue;
      if (reasoned && !entry.reason?.trim()) problems.push({ message: `claims.config.json: ${list} adds "${name}" with no reason. Give it one.` });
      if (!body.includes(name)) problems.push({ message: `claims.config.json: ${list} adds "${name}"; name it in the pull request's description, so a reviewer sees the exemption.` });
    }
    // An entry kept by name but changed (a surface's mode, a rule's job) is an exemption too, as
    // is removing what decides which files are read and how.
    const same = (a, b) => canonical(a) === canonical(b);
    for (const entry of base[list] ?? []) {
      if ((head[list] ?? []).some((other) => same(other, entry))) continue;
      const changed = (head[list] ?? []).find((other) => key(other) === key(entry));
      if (changed && same({ ...changed, reason: undefined }, { ...entry, reason: undefined })) continue;
      if (!changed && !NARROWING.includes(list)) continue;
      const name = key(entry);
      if (!body.includes(name)) problems.push({ message: `claims.config.json: ${list} ${changed ? "changes" : "removes"} "${name}"; name it in the pull request's description, so a reviewer sees the exemption.` });
    }
  }
  for (const setting of ["urlMaxAgeDays", "urlCache", "requiredChecks"]) {
    const before = base[setting] ?? DEFAULT_CONFIG[setting];
    const after = head[setting] ?? DEFAULT_CONFIG[setting];
    if (setting === "urlMaxAgeDays" ? after <= before : after === before) continue;
    if (!body.includes(setting)) problems.push({ message: `claims.config.json: ${setting} ${setting === "urlMaxAgeDays" ? "rises" : "changes"} from ${before} to ${after}; name ${setting} in the pull request's description, so a reviewer sees the exemption.` });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------
// Command line

/** Runs a command (check, lint, show, ratchet) in `root`; returns the exit code. */
export async function main(argv, { root: defaultRoot = process.cwd(), hooks = {}, guide = "the claim docs" } = {}) {
  const [command, ...rest] = argv;
  const flag = (name) => rest.includes(name);
  const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const root = option("--root") ?? defaultRoot;
  const network = flag("--network") ? true : flag("--network=changed") ? "changed" : false;
  const positional = rest.filter((arg, index) => !arg.startsWith("--") && !["--root", "--name"].includes(rest[index - 1] ?? ""));
  const config = loadConfig(root);
  const report = (failures, ok) => {
    for (const failure of failures) process.stderr.write(`${failure.message}\n`);
    if (failures.length > 0) {
      process.stderr.write(`\n${failures.length} problem${failures.length === 1 ? "" : "s"}. Each factual sentence needs a primary source and a check: ${guide}.\n`);
      return 1;
    }
    process.stdout.write(`${ok}\n`);
    return 0;
  };
  if (command === "check") {
    const result = await checkClaims({ root, network, hooks });
    return report(result.failures, `${result.claims.length} claim${result.claims.length === 1 ? "" : "s"} verified on ${result.surfaces} surfaces.`);
  }
  if (command === "lint") {
    const context = { root, network, config };
    const claims = [];
    const failures = [];
    const verbs = new Set(config.instructionVerbs);
    if (flag("--pr")) {
      failures.push(...readMarkdown((process.env.PR_TITLE ?? "").replace(/^#+\s*/, ""), { file: "pull request title", verbs }).findings);
      const body = readMarkdown(process.env.PR_BODY ?? "", { file: "pull request body", verbs });
      claims.push(...body.claims);
      failures.push(...body.findings);
    }
    if (flag("--stdin")) {
      const result = readMarkdown(readFileSync(0, "utf8"), { file: option("--name") ?? "stdin", verbs });
      claims.push(...result.claims);
      failures.push(...result.findings);
    }
    failures.push(...(await verifyClaims(claims, context)));
    saveUrlCache(context);
    const files = [];
    for (const file of positional) {
      const entry = classify(file, config);
      if (entry && entry.mode !== "lint") process.stderr.write(`${file} is not linted: ${entry.mode}, ${entry.reason}.\n`);
      else files.push(file);
    }
    let count = claims.length;
    if (files.length > 0) {
      const result = await checkClaims({ root, network, files, hooks });
      failures.push(...result.failures);
      count += result.claims.filter((claim) => files.includes(claim.file.split(":")[0])).length;
    }
    return report(failures, `${count} claim${count === 1 ? "" : "s"} verified; no unsourced claims.`);
  }
  if (command === "ratchet") {
    const ref = process.env.CLAIMS_BASE_REF;
    if (!ref) {
      process.stderr.write("ratchet needs CLAIMS_BASE_REF, the pull request's base (origin/main).\n");
      return 2;
    }
    const base = loadConfig(root, { ref });
    const checks = (text) => (text === undefined ? [] : JSON.parse(text));
    const baseChecks = checks(gitShow(root, ref, base.requiredChecks));
    const headChecks = checks(read(root, config.requiredChecks));
    return report(policyProblems({ base, head: config, body: process.env.PR_BODY ?? "", baseChecks, headChecks }), "No exemption added without its reason and a mention.");
  }
  if (command === "show") {
    for (const file of positional) {
      const { claims, findings } = await readSurface(root, file, undefined, config, hooks);
      for (const claim of claims) {
        const failures = await verify(claim.checks, { root, network, config }, claim.sources);
        process.stdout.write(`${claim.file}:${claim.line}: ${claim.text}\n`);
        for (const source of claim.sources) process.stdout.write(`  source ${JSON.stringify(source)}\n`);
        for (const check of claim.checks) process.stdout.write(`  verify ${JSON.stringify(check)}\n`);
        process.stdout.write(failures.length === 0 ? "  holds\n" : failures.map((failure) => `  FAILS: ${failure.message}\n`).join(""));
      }
      for (const finding of findings) process.stdout.write(`UNSOURCED ${finding.message}\n`);
    }
    return 0;
  }
  process.stderr.write("Usage: claims-check.mjs check [--network | --network=changed] | lint [<file>…] [--pr] [--stdin [--name <name>]] | show <file>… | ratchet\n");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
