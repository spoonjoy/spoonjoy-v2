// Comment rules, as an ESLint plugin that oxlint loads through jsPlugins (.oxlintrc.json):
//
// - no-orphan-doc: a doc block (/** … */) with another doc block directly after it. Tools attach
//   only the last block to the code below, so the first describes nothing: it was left behind when
//   the code it described moved or was deleted. Same rule as ourostack/ouro-ui's scripts/lint/comments.mjs.
// - no-restating-comment: a one-line comment that only says what the next statement says, such as
//   "// Handle delete intent" over `if (intent === "delete")`. It is flagged only when it starts with
//   an action verb (Handle, Check, Create, Get, Validate, ...), has no punctuation, and every other
//   word in it, besides small words like "a", "the" or "for", is part of a name in the next three
//   lines. A comment that says why, or what the code can't show, keeps a word the code doesn't have.

const isDoc = (comment) => comment.type === "Block" && comment.value.startsWith("*") && comment.value !== "*";

const noOrphanDoc = {
  meta: {
    type: "problem",
    docs: { description: "Disallow a doc block followed directly by another doc block" },
    messages: {
      orphan:
        "This doc block describes nothing: another doc block follows it directly, and only that one attaches to the code below. Merge the two, move this one to the code it describes, or delete it.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        for (let i = 0; i + 1 < comments.length; i++) {
          const [doc, next] = [comments[i], comments[i + 1]];
          if (!isDoc(doc) || !isDoc(next)) continue;
          const between = sourceCode.text.slice(doc.range[1], next.range[0]);
          if (/^[ \t]*\r?\n?[ \t]*$/.test(between)) context.report({ loc: doc.loc, messageId: "orphan" });
        }
      },
    };
  },
};

const VERB =
  /^\s*(Handle|Check if|Check|Create|Get|Set|Update|Delete|Fetch|Find|Generate|Return|Validate|Parse|Load|Save|Initialize|Init|Add|Remove|Call|Build|Render|Loop|Iterate|Convert|Hash|Increment|Log)\b[^.:;,()"'`!?]{0,40}$/;
const SMALL = new Set(
  "a an the for test tests testing new existing and with to of it its this that one two three four five six some if".split(" "),
);

/** The word without a plural or verb ending, so "steps" matches `step` and "parsing" matches `parse`. */
function stem(word) {
  for (const ending of ["ies", "es", "s", "ing", "ed"]) {
    if (word.endsWith(ending) && word.length - ending.length >= 3) return word.slice(0, -ending.length);
  }
  return word;
}

/** Every lowercased name in the code, and each camelCase or snake_case part of it, with and without its ending. */
function nameParts(code) {
  const parts = new Set();
  for (const name of code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    for (const part of [name, ...(name.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [])]) {
      parts.add(part.toLowerCase());
      parts.add(stem(part.toLowerCase()));
    }
  }
  return parts;
}

/** Whether a one-line comment's words, past its verb, are all small words or names in `code`. */
export function restates(comment, code) {
  const match = VERB.exec(comment);
  if (!match) return false;
  const parts = nameParts(code);
  const words = (comment.trimStart().slice(match[1].length).match(/[A-Za-z]+/g) ?? []).map((word) => word.toLowerCase());
  return words.every((word) => SMALL.has(word) || parts.has(word) || parts.has(stem(word)));
}

const noRestatingComment = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow a one-line comment that only restates the next statement" },
    messages: {
      restates:
        "This comment says what the next lines already say. Delete it, or say why the code does this or what it can't show.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    const lines = sourceCode.lines;
    const isComment = (line) => line !== undefined && /^\s*(\/\/|\/\*|\*)/.test(line);
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Line") continue;
          const row = comment.loc.start.line - 1;
          // Only a comment on a line of its own, with no comment line above or below it.
          if (lines[row].trim() !== `//${comment.value}`.trim() || isComment(lines[row - 1]) || isComment(lines[row + 1])) continue;
          const code = lines.slice(row + 1).filter((line) => line.trim()).slice(0, 3).join("\n");
          if (restates(comment.value, code)) context.report({ loc: comment.loc, messageId: "restates" });
        }
      },
    };
  },
};

export default { meta: { name: "comments" }, rules: { "no-orphan-doc": noOrphanDoc, "no-restating-comment": noRestatingComment } };
