import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import ts from "typescript";

// The Ouro source rule. Anything reusable in an app is an Ouro component, installed under the
// app's components/ouro/ and lib/ouro/ (add the missing component to Ouro UI first, then install
// it); this rule finds the controls app code still builds by hand, so their number can only fall.
//
//   node scripts/ouro-source-rules.mjs [--base <ref>] [--write-baseline [--allow-regression <reason>]]
//
// It reads the app's source (`src`, default src/ or else app/: every .ts and .tsx file) with the
// TypeScript compiler API, skipping the Ouro installs (`ouroDirs`, default <src>/components/ouro/
// and <src>/lib/ouro/), the `exclude` prefixes, tests, stories and declarations, and its .css files
// with PostCSS, and reports each offender by category:
//
// - raw-button, raw-anchor, raw-input, raw-select, raw-textarea, details-summary: the intrinsic
//   element, and React Router's Link/NavLink as raw anchors. `<input type="hidden">` is exempt,
//   and so is the anchor Ouro's Link renders through OuroProvider's linkComponent (a function typed
//   with OuroLinkComponent).
// - contenteditable, positive-tabindex, interactive-role (any element, Ouro calls included).
// - plain-element-handler: click, key, pointer or touch handlers on a non-control intrinsic element.
// - data-ouro-attr: any data-ouro* attribute app code writes (JSX, props objects, setAttribute).
// - third-party-control: a JSX element from a UI-control library other than Ouro UI
//   (THIRD_PARTY_CONTROL_PACKAGES), by named, default or namespace import or a same-file alias of
//   one; app code reaches those libraries only through Ouro UI. Type-only imports and hooks are
//   not elements, so they never count.
// - control-state-style: class utilities for focus, press, selection, open/close or gesture state
//   (focus:, active:, aria-pressed:, data-[state=open]:, group-data-[checked]: ...) in a className,
//   followed through same-file constants and helpers; and stylesheet rules (or @apply) whose
//   selector puts that state on a class or a data-* hook (only the app's own hooks, `.<prefix>-`
//   and `[data-<prefix>-`, when `hookPrefix` is set). Hover-only decoration and page motion are
//   not control state.
// - hand-drawn-avatar, hand-drawn-presence-dot: an intrinsic element drawn as what Ouro UI's Avatar
//   draws: a round picture (`img`, or `overflow-hidden`/`object-cover`, `rounded-full`, at least
//   24px square), or an empty round dot (at most 12px, `bg-*`). Counted where written; use
//   <Avatar shape presence>.
// - hand-drawn-hero: an intrinsic `section` or `header` whose class names a hero (`hero`, `hero-banner`, `page-hero`),
//   which is a hero frame drawn by hand. Ouro UI's `Hero` is the one hero; a registry component passes.
// - hand-drawn-corner: a fixed corner radius written by hand in a class (`rounded-[12px]`, `rounded-t-[0.5rem]`) on an intrinsic element. A fixed radius
//   ignores the theme's `--radius` scale, so it misses a change to every corner (squircles included).
//   The scale's own classes (`rounded-lg`), `var(...)` values, circles (`rounded-full`, 50%, 9999px) and 0 pass.
// - hand-drawn-switch: an intrinsic element given `role="switch"`, which is an on/off switch drawn by hand. Ouro UI's
//   `Switch` is the one switch; a registry component, or any element without that role, passes.
// - content-spinner: a spinner standing where content would: Ouro UI's `<Spinner>` (imported from a
//   spinner/spinner module) or any element with an `animate-spin` class, returned or assigned on its
//   own or the only thing in its element. Inline progress passes: in a prop, in an object's icon, or
//   beside the words that say what is under way. Show a Skeleton shaped
//   like the content instead, so the content takes its place and nothing moves when it arrives. The
//   one exception is an inline busy indicator inside a button (a raw `<button>` or a `Button`, in its
//   children or any of its props), which marks an action in progress, not missing content; Button's
//   `loading` draws that one itself. It counts where the spinner is written and never makes the
//   component around it a hand-rolled control.
// - render-index: an index built at the top level of a render: `new Map(…)`, `new Set(…)`,
//   `new RegExp(…)`, `Object.fromEntries(…)`, `Object.groupBy(…)` or `Map.groupBy(…)` with an
//   argument, evaluated in the body of a component (a capitalised function in a .tsx file, also
//   through `memo` or `forwardRef`, but not an all-capitals one such as a route handler's `GET`), a
//   custom hook (`useX`) or a class's `render`, so it is rebuilt on every render.
//   Build it in the store, once per change, wrap it in `useMemo` on its inputs, or hoist a constant
//   to module scope. Anything inside a nested function (a `useMemo` or `useEffect` callback, a lazy
//   `useState` initializer, an event handler) passes, and so does an empty `new Map()`. Like a
//   spinner, it counts where it is written and never makes the component around it a hand-rolled
//   control. Known gap: a callback that runs during render (`rows.map((row) => new Set(row.tags))`)
//   is not counted.
// - layout-animation: an animation of a property that re-runs layout on every frame (width,
//   height, top, left, inset, margin, padding, border width, gap, flex, grid tracks, font size,
//   line height) or of `all`: Tailwind's `transition-all`, `transition-[height]`, an arbitrary
//   `[transition:…]` or `[transition-property:…]` in any string; a `transition` or
//   `transitionProperty` style value; keyframes passed to an element's `animate()`, or Motion's
//   `animate`, `exit` and `while…` props, as an object of layout properties; and in stylesheets, a
//   `transition` or `transition-property` declaration (a shorthand with no property animates `all`),
//   `@apply` of such a class, and `@keyframes` that set one. Animate `transform` and `opacity`
//   instead, which the compositor runs without layout. Tailwind's plain `transition`,
//   `transition-colors`, `transition-opacity` and `transition-transform` pass. Like a spinner, it
//   counts where it is written and never makes the component around it a hand-rolled control.
// - gated-load: a data or asset load that waits for focus, visibility, return, idle or being
//   scrolled into view: a fetch, a load/prefetch/refetch call, a data hook, import(), `new Image()`
//   or a `src` set, inside a visibilitychange, focus, blur or pageshow listener on the window or
//   document (or its `on…` handler), under a `document.hidden`, `visibilityState` or `hasFocus()`
//   condition, in a requestIdleCallback, an IntersectionObserver or an in-view or idle hook's
//   callback, or waiting on what such a hook returns (`enabled: inView`) or on state such a
//   callback sets from what the gate says (`setShown(entry.isIntersecting)`, not `setOpen(false)`);
//   and an element's `loading="lazy"`, or an address (`src`, `srcSet`, `poster`) that waits on a
//   gate (`src={inView ? url : undefined}`).
//   Rendering-only gates pass, since they load nothing: pausing an animation or a caret, windowing
//   what is drawn while the data stays loaded, a media stream; so does saving on hide (a fetch with
//   keepalive or another method). It counts where the load is written and never makes the
//   component around it a hand-rolled control.
// - vague-failure-copy: a string literal, a template literal (its static parts, joined) or JSX text
//   with a vague failure phrase (VAGUE_FAILURE_PHRASES: "couldn't", "could not", "something went
//   wrong", "unable to", "failed to load", "an error occurred"), or whose whole text is a bare
//   failure (BARE_FAILURE: "Error", "Upload failed", "Error:"; not after a NOT_BARE_LEADS word:
//   "No errors", "Retry failed"). A phrase with its cause after it in the same sentence (statesCause:
//   "Couldn't send: you're offline", "… because …"; not "Couldn't send: try again") is precise, and
//   "Error: …" is held to the same test. JSX text is read with the children after it, as ${…}. A failure states what happened and
//   why (the system and its answer: "The photo service says this picture was deleted"), who or what
//   caused it where known, and the next step as a working action; when the cause is unknown, what
//   was tried and what came back. Not copy, so never read: import, export, require() and import()
//   specifiers, type positions, object and member keys, tagged templates (css``, gql``), operands
//   of ==, !=, === and !== and `case` labels, the value of an attribute or object property named
//   in NOT_COPY_ATTRIBUTE (className and the like, data-*, id, key, type, href, src, to, name, role,
//   htmlFor, as), and a string that is one lowercase token ("error", "load-failed": a status, not
//   copy). Also not copy: the first argument of includes, startsWith, endsWith, has and test (a
//   string matched against, not shown), a string in a `new Set([...])` that is only used for
//   `.has(…)` membership, and the class name in `x.name || "Error"`. A heading or label that names
//   the topic ("Errors", "Machine errors", "Common failures": at most two words before a plural,
//   none an action) is not a bare failure either. A template with a substitution, or JSX text
//   beside other children (`{count} failed`), is never bare. `failureCopyAllow` lets a precise text
//   through, each entry with its reason, and is where a protocol's own wording ("Parse error")
//   goes. It counts where the text is written and never makes the component around it a
//   hand-rolled control.
// - uses-hand-rolled-control: a JSX use of an imported app component that is offending, counted at
//   the call site. A component is offending when an offender sits inside it, or it renders an
//   offending component (same file or imported), to a fixed point across modules: a wrapper
//   (`NiceLink` around a raw `<a>`) and every wrapper of it count where they are used. Imports
//   resolve through tsconfig paths, barrels, re-exports and namespace re-exports (`export * as`);
//   a re-exported third-party control counts as third-party-control where it is used.
//
// An element is what it renders: Motion's `<m.button>` and `motion.create("button")`,
// `createElement("button")`, a string-typed tag (`const Tag = "button"`) and an `as="button"` prop
// are buttons. Tags are resolved in every category (`@headlessui/react.Button`,
// `src/components/nav/app-link#Link`).
//
// Each offender has a fingerprint, `file::component::category::tag::stable props` (props are
// type, name, aria-label and role), never a line number, so moving code keeps it and renaming a
// file changes it. The baseline (`baseline`, default ouro-source-rules.baseline.json) holds the
// fingerprint counts; the scan must equal it exactly. With `--base <ref>` it also ratchets: no
// fingerprint may rise against that ref's baseline unless the new baseline lists it under
// `allowedRegressions` with a reason and the count it permits, and that entry is not already on
// the base (an entry is spent by the pull request that adds it; a copy left on the base is stale:
// ignored, noted, and dropped by the next write). A move is neutral: an added and a removed
// fingerprint with the same category, tag and literal props, in the same file (a renamed
// component) or the same component (a moved file), paired one-to-one. `--write-baseline` rewrites
// the file, refusing a rise unless `--allow-regression <reason>` records why; when the base has
// no baseline it records nothing.
//
// Against `--base` the base's own ouro-source-rules.json names its baseline, and the pull request's
// settings may only widen the scan: moving the baseline, another `src`, an `ouroDirs` or `exclude`
// entry the base did not already skip, a `failureCopyAllow` match no match at the base already
// covered (an allow entry hides offenders as an exclude does), or a set or changed `hookPrefix`
// fails like a rise, and needs `--allow-regression <reason>`, recorded the same way
// (`ouro-source-rules.json::<setting>::<value>`). A missing baseline is the first one, recorded without a reason, only when the base has
// neither the settings file nor a baseline.
//
// Settings, all optional, come from ouro-source-rules.json at the root:
// `{ "src": "app", "ouroDirs": ["app/components/ouro/", "app/lib/ouro/"], "exclude": ["app/lib/generated/"], "hookPrefix": "app", "baseline": "test/ouro-source-rules.baseline.json",
//    "failureCopyAllow": [{ "match": "The card service says your card could not be charged", "reason": "names the service and its answer" }] }`.
// A text that holds an entry's `match` (case-sensitive) passes; an entry with an empty `match` or
// no `reason` stops the rule with the fix.
//
// Known gaps: members of an imported app component (`<Menu.Item>` from an app module) are not
// counted at call sites, and Motion through a namespace import of motion/react
// (`<Motion.motion.div>`) is not treated as the element it renders. Failure copy is read where it
// is written: text an app builds by concatenation ("Could " + "not") or loads from a file other
// than .ts and .tsx (a JSON message catalog) is not read, and lowercase one-word copy in a string
// ("error") passes as a token while the same word as JSX text counts.

export const CATEGORIES = [
  "raw-button",
  "raw-anchor",
  "raw-input",
  "raw-select",
  "raw-textarea",
  "details-summary",
  "contenteditable",
  "positive-tabindex",
  "interactive-role",
  "plain-element-handler",
  "data-ouro-attr",
  "control-state-style",
  "layout-animation",
  "third-party-control",
  "content-spinner",
  "render-index",
  "gated-load",
  "hand-drawn-hero",
  "hand-drawn-corner",
  "hand-drawn-switch",
  "vague-failure-copy",
  "hand-drawn-avatar",
  "hand-drawn-presence-dot",
  "uses-hand-rolled-control",
];

// UI-control libraries other than Ouro UI. A trailing `/*` is a whole npm scope; any other entry is
// the package and its subpaths. Ouro UI itself builds on Base UI, but only inside its installed
// paths, which this rule does not scan.
export const THIRD_PARTY_CONTROL_PACKAGES = [
  "@headlessui/react",
  "@radix-ui/*",
  "@base-ui-components/*",
  "@base-ui/*",
  "react-aria-components",
  "react-aria",
  "@ariakit/*",
  "@mui/*",
  "@chakra-ui/*",
  "vaul",
  "cmdk",
  "sonner",
];

/** What the content-spinner rule tells an app to do, and the one exception it allows. */
export const CONTENT_SPINNER_FIX =
  'Show a Skeleton shaped like the content instead (<Skeleton shape="row" count={6}>, <Skeleton shape="text" lines={3}>, <Skeleton shape="card">), ' +
  "so the content takes its place and nothing moves when it arrives. " +
  "Inline progress for an action is allowed: a spinner inside a button (<Button loading>), in a prop such as a field's endAdornment or an icon, or beside the words that say what is under way.";

// The vague-failure-copy detector. Ouro AX keeps the identical list; change both together.
// Each phrase: its canonical name and the pattern (case-insensitive).
export const VAGUE_FAILURE_PHRASES = [
  ["couldn't", /\bcouldn[’']?t\b/i],
  ["could not", /\bcould not\b/i],
  ["something went wrong", /\bsomething went wrong\b/i],
  ["unable to", /\bunable to\b/i],
  ["failed to load", /\bfailed to load\b/i],
  ["an error occurred", /\ban? (?:unknown |unexpected )?error (?:has )?occurred\b|\ban (?:unknown|unexpected) error\b/i],
];
// A bare failure: the whole text is "error" or "failed" (or "failure"), at most two words of letters before it,
// or "Error:" with nothing after. "3 failed" is a count, not copy, so the words before must start with a letter.
export const BARE_FAILURE = /^[^\p{L}\p{N}]*(?:(?:\p{L}[\p{L}'’-]*\s+){0,2}(?:error|errors|failed|failure)|error\s*:)[^\p{L}\p{N}]*$/iu;

// A failure is precise when its cause follows the phrase in the same sentence, after a colon, a
// dash or "because" (CAUSE_MARKER): "Couldn't send: you're offline", "… because the server refused
// it". The cause is a substitution (`Couldn't send: ${why}`) or at least two words, the first not a
// next step or a vague word (NOT_A_CAUSE): "Couldn't send: try again" and "Couldn't send: error"
// state no cause. "Error: …" and "Upload failed: …" (LEAD_FAILURE) are held to the same test.
export const CAUSE_MARKER = /:|\s[—–-]\s|\bbecause\b/iu;
export const NOT_A_CAUSE = ["try", "please", "retry", "contact", "see", "error", "errors", "unknown", "failed", "failure"];
export const LEAD_FAILURE = /^[^\p{L}\p{N}]*(?:\p{L}[\p{L}'’-]*\s+){0,2}(?:error|errors|failed|failure)\s*(:|\s[—–-]\s)/iu;
// Words before "error" or "failed" that make the text other than a failure: a negation ("No errors",
// "Nothing failed") or an action ("Show errors", "Retry failed").
export const NOT_BARE_LEADS = ["no", "nothing", "zero", "none", "show", "hide", "retry", "clear"];
// A heading or label that names a topic: a plural "errors" or "failures" with at most two words
// before it, none of them an action (TOPIC_VERBS), so "Errors" and "Machine errors" pass and
// "Fix errors" does not.
const TOPIC_LABEL = /^[^\p{L}\p{N}]*((?:\p{L}[\p{L}'’-]*\s+){0,2})(?:errors|failures)[^\p{L}\p{N}]*$/iu;
const TOPIC_VERBS = ["fix", "view", "see", "check", "handle", "resolve", "dismiss", "ignore", "skip", "report", "review", "reset", "copy", "send", "catch", "log", "get", "got", "had", "has", "have", "is", "are", "was", "were", "be", "found", "make", "made"];
const SENTENCE_END = /[.!?](?=\s|$)/u;
const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;

/**
 * Whether `rest`, the text after a failure phrase, states the cause in the same sentence.
 * @param {string} rest
 */
export function statesCause(rest) {
  const sentence = rest.split(SENTENCE_END)[0];
  const marker = CAUSE_MARKER.exec(sentence);
  if (!marker) return false;
  const cause = sentence.slice(marker.index + marker[0].length);
  if (cause.includes("${…}")) return true;
  const words = cause.match(WORD) ?? [];
  return words.length >= 2 && !NOT_A_CAUSE.includes(words[0].toLowerCase()) && !VAGUE_FAILURE_PHRASES.some(([, pattern]) => pattern.test(cause));
}

const leadWords = (text) => [...text.toLowerCase().matchAll(WORD)].map((match) => match[0]);

// Whether a whole text is a heading or label that names a topic ("Machine errors"), not a failure.
const isTopicLabel = (text) => {
  const match = TOPIC_LABEL.exec(text.trim());
  return match !== null && !leadWords(match[1]).some((word) => TOPIC_VERBS.includes(word));
};

/**
 * The vague failure phrase in `text`, by its canonical name, or undefined. Every occurrence of a
 * phrase must state its cause (statesCause), and so must a failure that leads the text ("Error: …",
 * LEAD_FAILURE). A `whole` text (the entire string or element text, not one part of it) that is a
 * bare failure is "bare error" or "bare failed", by its word, unless a word before it is in
 * NOT_BARE_LEADS.
 * @claim "Every occurrence of a phrase must state its cause" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::vague-failure-copy > keeps the detector Ouro AX shares: six phrases and the bare failure pattern)
 * @param {string} text
 * @param {{ whole?: boolean }} [options]
 */
export function vagueFailurePhrase(text, { whole = true } = {}) {
  const found = VAGUE_FAILURE_PHRASES.find(([, pattern]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].some((match) => !statesCause(text.slice(match.index + match[0].length))),
  );
  if (found) return found[0];
  const trimmed = text.trim();
  const word = (failure) => (/\berrors?\b/i.test(failure) ? "bare error" : "bare failed");
  const lead = LEAD_FAILURE.exec(trimmed);
  if (lead && !leadWords(lead[0]).some((w) => NOT_BARE_LEADS.includes(w))) return statesCause(trimmed.slice(lead[0].length - lead[1].length)) ? undefined : word(lead[0]);
  if (!whole || !BARE_FAILURE.test(trimmed) || isTopicLabel(trimmed)) return undefined;
  if (leadWords(trimmed).slice(0, -1).some((w) => NOT_BARE_LEADS.includes(w))) return undefined;
  return word(trimmed);
}

/** What the vague-failure-copy rule tells an app to write instead, and how to keep a precise text. */
export const VAGUE_FAILURE_COPY_FIX =
  'Say what happened and precisely why, naming the system and its answer ("The photo service says this picture was deleted by its owner."), ' +
  "who or what caused it where you know, and the next step as a working action or command (\"Ask them to share it again.\"); " +
  "when the cause is unknown, say what was tried and what came back. " +
  "When the wording is already precise, add it to failureCopyAllow in ouro-source-rules.json with a reason.";

/** What the render-index rule tells an app to do. */
export const RENDER_INDEX_FIX =
  "Build the index where its data changes, once per change: in the store or loader that holds the data, " +
  "or in useMemo on its inputs (useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])); move a constant to module scope. " +
  "Built in render, it is rebuilt on every render, a keystroke or a hover included.";
/** What the layout-animation rule tells an app to do. */
export const LAYOUT_ANIMATION_FIX =
  "Animate transform and opacity instead, which the compositor runs without layout: slide with translate, grow or shrink with scale, fade with opacity. " +
  "Name the properties a transition runs (transition-[opacity,translate], transition-opacity, transition-transform) rather than transition-all; a size that must change changes at once.";

/** What the gated-load rule tells an app to do, and what it lets through. */
export const GATED_LOAD_FIX =
  "Load it eagerly: start the fetch when the data is known to be needed (on mount, or as soon as the page before it lands), not when the page becomes visible, the window gets focus, the browser is idle or an element scrolls into view (loading=\"lazy\" included), " +
  "so nobody waits for what could already be there. Spend the work on what the person is likely to look at next, newest first, within the performance budgets. " +
  "Rendering-only gates pass: pausing an animation or a caret, windowing what is drawn while the data stays loaded, a media stream, and saving on hide (sendBeacon, or fetch with keepalive or a method other than GET).";

/** What the hand-drawn-avatar rule tells an app to do. */
export const HAND_DRAWN_AVATAR_FIX =
  'Draw it with Ouro UI\'s <Avatar name="Ana Lind" src={url} shape="circle">: shape is "circle" for a person, "square" for a team, channel or app, and "agent" for an AI agent, and the picture, initials, size and loading shimmer come with it, so a design change to avatars reaches every one.';

/** What the hand-drawn-presence-dot rule tells an app to do. */
export const HAND_DRAWN_PRESENCE_DOT_FIX =
  'Show presence as <Avatar presence="available" presenceLabel="Ana Lind, Available" ...>, which draws each state in its own shape and tone on the avatar\'s corner and says it aloud. For an unread or status marker that is not presence, use <Badge>.';
/** What the hand-drawn-hero rule tells an app to do. */
export const HAND_DRAWN_HERO_FIX =
  "Use Hero from the registry (`<Hero title=\"...\" picture={{ light, dark }} />`), so its light and dark art, squircle frame and layout, and any change to heroes, reach this one too.";
/** What the hand-drawn-corner rule tells an app to do. */
export const HAND_DRAWN_CORNER_FIX =
  "Take the radius from the theme: a scale class (rounded-md, rounded-lg, rounded-xl) or var(--radius), in a class, an inline style or a stylesheet, so it takes the squircle corner shape (--ouro-corner-shape) and the raised radius with every other corner. A circle, dot, thumb, ring or pill stays rounded-full; rounded-full on a large box that is not one takes the scale instead. A deliberate round corner is [corner-shape:round].";
/** What the hand-drawn-switch rule tells an app to do. */
export const HAND_DRAWN_SWITCH_FIX =
  "Use Switch from the registry (`<Switch label=\"...\" checked={on} onCheckedChange={setOn} />`), so it gets the Quiet glass look (the --ouro-glass tokens), focus, touch target and any change to switches.";

// What each category's message says, for the categories whose fix is not an Ouro component.
const CATEGORY_MESSAGES = {
  "hand-drawn-avatar": { headline: "New hand-drawn avatar", fix: HAND_DRAWN_AVATAR_FIX },
  "hand-drawn-presence-dot": { headline: "New hand-drawn presence dot", fix: HAND_DRAWN_PRESENCE_DOT_FIX },
  "content-spinner": { headline: "New spinner standing in for content", fix: CONTENT_SPINNER_FIX },
  "render-index": { headline: "New index built in render", fix: RENDER_INDEX_FIX },
  "layout-animation": { headline: "New animation of a layout property", fix: LAYOUT_ANIMATION_FIX },
  "hand-drawn-hero": { headline: "New hero drawn by hand", fix: HAND_DRAWN_HERO_FIX },
  "hand-drawn-corner": { headline: "New fixed corner radius", fix: HAND_DRAWN_CORNER_FIX },
  "hand-drawn-switch": { headline: "New switch drawn by hand", fix: HAND_DRAWN_SWITCH_FIX },
  "gated-load": { headline: "New load that waits for focus, visibility, idle or scrolling", fix: GATED_LOAD_FIX },
  // Names the phrase it found, the fingerprint's tag.
  "vague-failure-copy": (phrase) => ({
    headline: `New vague failure copy ("${phrase}")`,
    fix: `"${phrase}" doesn't say what failed or why. ${VAGUE_FAILURE_COPY_FIX}`,
  }),
};

// A category's message for an offender's fingerprint, or undefined when the fix is an Ouro component.
function messageFor(fingerprint) {
  const [, , category, tag] = fingerprint.split("::");
  const message = CATEGORY_MESSAGES[category];
  return typeof message === "function" ? message(tag) : message;
}

export const BASELINE_PATH = "ouro-source-rules.baseline.json";
export const CONFIG_PATH = "ouro-source-rules.json";
const UPDATE_COMMAND = "node scripts/ouro-source-rules.mjs --write-baseline";
const USAGE = "Usage: node scripts/ouro-source-rules.mjs [--base <ref>] [--write-baseline [--allow-regression <reason>]]";

const NEVER_SCANNED = [/(?:^|\/)__tests__\//, /\.(?:test|spec|stories)\.tsx?$/, /\.d\.ts$/];

const RAW_TAGS = {
  button: "raw-button",
  a: "raw-anchor",
  input: "raw-input",
  select: "raw-select",
  textarea: "raw-textarea",
  details: "details-summary",
  summary: "details-summary",
};
const ROUTER_MODULES = new Set(["react-router", "react-router-dom"]);
const ROUTER_ANCHORS = new Set(["Link", "NavLink"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "grid",
  "gridcell",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "textbox",
  "tree",
  "treegrid",
  "treeitem",
]);
const HANDLER = /^on(?:Click|DoubleClick|AuxClick|ContextMenu|Key(?:Down|Up|Press)|Pointer[A-Z]\w*|Touch[A-Z]\w*|Mouse(?:Down|Up))(?:Capture)?$/;
// Motion renders intrinsic elements: `<m.button>` is a button. Its gesture props are handlers.
const MOTION_MODULES = new Set(["motion/react", "motion/react-m", "framer-motion"]);
const MOTION_ELEMENT_NAMESPACE = "motion/react-m";
const MOTION_COMPONENTS = new Set(["motion", "m"]);
const REORDER_TAGS = { Item: "li", Group: "ul" };
const MOTION_HANDLER = /^(?:onTap\w*|onPan\w*|drag\w*|whileTap|whileFocus)$/;
const INTRINSIC_TAG = /^[a-z][\w-]*$/;
const CLASS_ATTRIBUTE = /^(?:class|className|\w+ClassName)$/;
const STABLE_PROPS = ["type", "name", "aria-label", "role"];
const LINK_ADAPTER_TYPE = "OuroLinkComponent";

// Control state as a selector: focus, press, checked/selected/expanded/current, open/close and
// gesture state, as a pseudo-class or an aria/data attribute. Shared by class utilities (each
// variant is turned into the selector it compiles to) and stylesheet rules.
const STATE_NAME =
  "(?:state|checked|unchecked|indeterminate|open|closed|selected|highlighted|pressed|expanded|current|active|popup-open|panel-open|starting-style|ending-style|swip[\\w-]*|dragging|focus[\\w-]*)";
const STATE_SELECTOR = new RegExp(
  `:(?:focus(?:-visible|-within)?|active|checked|indeterminate|open)(?![\\w-])|\\[(?:aria-(?:checked|pressed|expanded|selected|current)|data-${STATE_NAME}|open)(?![\\w-])`,
);
// A stylesheet selector that names something the app styles by hand: any class or data-* hook, or
// only the app's own (`.app-`, `[data-app-`) with a `hookPrefix`.
const ANY_HOOK = /\.[\w-]|\[data-/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The rule's settings: ouro-source-rules.json at `root` over the defaults. `src` defaults to src/
 * when the app has one, else app/.
 * @param {string} root
 * @param {{ readFile?: (file: string) => string, readdir?: (directory: string) => unknown[] }} [deps]
 * @returns {{ src: string, ouroDirs: string[], exclude: string[], hookPrefix: string, hook: RegExp, baseline: string, failureCopyAllow: { match: string, reason: string }[] }}
 */
export function loadConfig(root, { readFile = defaultDeps.readFile, readdir = defaultDeps.readdir } = {}) {
  let settings = {};
  try {
    settings = JSON.parse(readFile(path.join(root, CONFIG_PATH)));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const hasDirectory = (directory) => {
    try {
      readdir(path.join(root, directory));
      return true;
    } catch {
      return false;
    }
  };
  const src = (settings.src ?? (hasDirectory("src") ? "src" : "app")).replace(/\/+$/, "");
  const folder = (directory) => (directory.endsWith("/") ? directory : `${directory}/`);
  const failureCopyAllow = settings.failureCopyAllow ?? [];
  if (!Array.isArray(failureCopyAllow)) {
    throw new Error(`${CONFIG_PATH}: failureCopyAllow must be a list. Fix: "failureCopyAllow": [{ "match": "<part of the text>", "reason": "<why this wording is precise>" }].`);
  }
  failureCopyAllow.forEach((entry, index) => {
    const valid = typeof entry?.match === "string" && entry.match !== "" && hasReason(entry.reason);
    if (!valid) {
      throw new Error(
        `${CONFIG_PATH}: failureCopyAllow[${index}] ${JSON.stringify(entry)} needs a non-empty "match" (part of the text) and a "reason" (why this wording is precise). Fix: { "match": "<part of the text>", "reason": "<why this wording is precise>" }.`,
      );
    }
  });
  return {
    src,
    ouroDirs: (settings.ouroDirs ?? [`${src}/components/ouro/`, `${src}/lib/ouro/`]).map(folder),
    exclude: settings.exclude ?? [],
    hookPrefix: settings.hookPrefix || "",
    hook: settings.hookPrefix ? new RegExp(`\\.${escapeRegExp(settings.hookPrefix)}-|\\[data-${escapeRegExp(settings.hookPrefix)}-`) : ANY_HOOK,
    baseline: settings.baseline ?? BASELINE_PATH,
    failureCopyAllow,
  };
}

/**
 * The settings at a git ref: its ouro-source-rules.json over the defaults, with `src` defaulting by
 * the folders that ref has. `found` says whether the ref has the settings file.
 * @param {string} root
 * @param {string} ref
 * @param {(root: string, ref: string, file: string) => string | undefined} gitShow
 */
export function loadConfigAt(root, ref, gitShow) {
  const show = (file, suffix = "") => gitShow(root, ref, `${path.relative(root, file).split(path.sep).join("/")}${suffix}`);
  const missing = (file) => Object.assign(new Error(`ENOENT: ${ref}:${file}`), { code: "ENOENT" });
  let found = false;
  const config = loadConfig(root, {
    readFile: (file) => {
      const text = show(file);
      if (text === undefined) throw missing(file);
      found = true;
      return text;
    },
    readdir: (directory) => {
      if (show(directory, "/") === undefined) throw missing(directory);
      return [];
    },
  });
  return { ...config, found };
}

/**
 * How `head`'s settings narrow the scan, or move the baseline, against `base`'s (both loadConfig):
 * another `src`, an `ouroDirs` or `exclude` entry no prefix at the base already skipped, a
 * `failureCopyAllow` match that holds no match at the base, or a hookPrefix set or changed. Each
 * change carries a fingerprint, so a reason can be recorded for it the way it is for a rise.
 * Widening (fewer skips, no hookPrefix) is not a change.
 * @returns {{ fingerprint: string, change: string }[]}
 * @claim "settings narrow the scan" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::main > --base: the settings at the base ref > fails each setting that narrows the scan: src, an added exclude or ouroDirs entry, a set or changed hookPrefix)
 * @claim "a `failureCopyAllow` match that holds no match at the base" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::main > --base: the settings at the base ref > fails a new failureCopyAllow match like a new exclude, unless a match at the base is part of it, and records it with a reason)
 * @claim "Each change carries a fingerprint" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::main > --base: the settings at the base ref > records a narrowing with a reason for this pull request, and never honours one already on the base)
 * @claim "Widening (fewer skips, no hookPrefix) is not a change" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::main > --base: the settings at the base ref > passes settings that widen the scan or keep it)
 */
export function narrowedSettings(base, head) {
  const changes = [];
  const add = (setting, value, change) => changes.push({ fingerprint: `${CONFIG_PATH}::${setting}::${value}`, change });
  if (head.baseline !== base.baseline) add("baseline", head.baseline, `moves the baseline from ${base.baseline} to ${head.baseline}`);
  if (head.src !== base.src) add("src", head.src, `reads ${head.src}/ instead of ${base.src}/`);
  const skipped = [...base.ouroDirs, ...base.exclude];
  for (const setting of ["ouroDirs", "exclude"]) {
    // A prefix listed twice is one change.
    for (const prefix of new Set(head[setting])) {
      if (!skipped.some((known) => prefix.startsWith(known))) add(setting, prefix, `stops reading ${prefix} (${setting})`);
    }
  }
  if (head.hookPrefix !== "" && head.hookPrefix !== base.hookPrefix) {
    const prefix = head.hookPrefix;
    add("hookPrefix", prefix, `sets hookPrefix to "${prefix}", so stylesheets count control state only on .${prefix}- and [data-${prefix}- hooks`);
  }
  // An allow entry hides the copy that holds its match, so a new match is a narrowing unless a
  // match at the base is part of it (the base already let all of that copy through).
  const allowed = base.failureCopyAllow.map((entry) => entry.match);
  for (const match of new Set(head.failureCopyAllow.map((entry) => entry.match))) {
    if (!allowed.some((known) => match.includes(known))) add("failureCopyAllow", match, `lets failure copy holding "${match}" through (failureCopyAllow)`);
  }
  return changes;
}

export function isThirdPartyControlModule(specifier) {
  return THIRD_PARTY_CONTROL_PACKAGES.some((entry) =>
    entry.endsWith("/*")
      ? specifier.startsWith(entry.slice(0, -1))
      : specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

/** Whether the rule reads `file` (relative to the root), under `config` (loadConfig). */
export function isScannedFile(file, { src, ouroDirs, exclude }) {
  if (!file.startsWith(`${src}/`) || !/\.(?:tsx?|css)$/.test(file)) return false;
  return ![...ouroDirs, ...exclude].some((prefix) => file.startsWith(prefix)) && !NEVER_SCANNED.some((pattern) => pattern.test(file));
}

export function listSourceFiles(root, config, readdir = defaultDeps.readdir) {
  return readdir(path.join(root, config.src))
    .map((entry) => `${config.src}/${String(entry).split(path.sep).join("/")}`)
    .filter((file) => isScannedFile(file, config))
    .sort();
}

function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of token) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function variantSelector(variant) {
  const bare = variant.replace(/^(?:(?:group|peer|in|not|has)-)+/, "").replace(/\/[\w-]+$/, "");
  const attribute = bare.match(/^(aria|data)-(?:\[(.*)\]|(.+))$/);
  if (attribute) return `[${attribute[1]}-${attribute[2] ?? attribute[3]}]`;
  if (bare.startsWith("[")) return bare.slice(1, -1);
  return `:${bare}`;
}

/** Whether one class token applies a utility under a control-state variant. */
export function isControlStateClass(token) {
  const parts = splitVariants(token);
  const utility = parts.pop();
  return utility !== "" && parts.some((variant) => STATE_SELECTOR.test(variantSelector(variant)));
}

// A property whose change re-runs layout, so animating it lays the page out again on every frame.
const LAYOUT_PROPERTY =
  /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|top|right|bottom|left|inset(?:-[a-z-]+)?|(?:margin|padding)(?:-[a-z-]+)?|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?-width|(?:row-|column-)?gap|flex(?:-basis|-grow|-shrink)?|grid-template-(?:rows|columns)|font-size|line-height)$/;
// The words of a transition shorthand that are not a property: times, easings and behaviors.
const TRANSITION_TIMING = /^(?:-?[\d.]+m?s|ease(?:-in|-out|-in-out)?|linear(?:\(.*)?|step-start|step-end|steps\(.*|cubic-bezier\(.*|normal|allow-discrete)$/;
const TRANSITION_TIME = /^-?([\d.]+)m?s$/;

/**
 * The first layout property, or `all`, that a CSS transition names: a `transition` shorthand
 * (one with no property animates `all`) or, with `{ list: true }`, a `transition-property` list.
 * A shorthand transition whose duration is zero or left out animates nothing, so one made only of
 * keywords (`unset`, `initial`, `inherit`, `revert`, `none`) or with `0s` names no property; a
 * duration from a variable counts as one that runs.
 *
 * @claim "one with no property animates" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::layout-animation > reads a transition value as a shorthand or a property list)
 * @claim "A shorthand transition whose duration" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::layout-animation > reads a shorthand of keywords only, or with a zero or missing duration, as naming no property)
 */
export function layoutTransitionProperty(value, { list = false } = {}) {
  for (const segment of value.split(/,(?![^(]*\))/)) {
    const words = segment.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!list) {
      // A shorthand's first time is its duration; with none, it lasts 0s unless a variable sets it.
      const duration = words.find((word) => TRANSITION_TIME.test(word));
      if (duration ? Number(duration.match(TRANSITION_TIME)[1]) === 0 : !words.some((word) => word.includes("var("))) continue;
    }
    const found = words.find((word) => word === "all" || LAYOUT_PROPERTY.test(word));
    if (found) return found;
    if (!list && words.every((word) => TRANSITION_TIMING.test(word))) return "all";
  }
  return undefined;
}

/** The layout property, or `all`, that one Tailwind class token transitions, after its variants. */
export function layoutAnimationClass(token) {
  const utility = splitVariants(token).at(-1).replace(/^!|!$/g, "");
  if (utility === "transition-all") return "all";
  const listed = utility.match(/^transition-\[(.+)\]$/);
  if (listed) return layoutTransitionProperty(listed[1].replace(/_/g, " "), { list: true });
  const arbitrary = utility.match(/^\[(transition(?:-property)?):(.+)\]$/);
  if (arbitrary) return layoutTransitionProperty(arbitrary[2].replace(/_/g, " "), { list: arbitrary[1] !== "transition" });
  return undefined;
}

// The first layout property an object of keyframes sets (`{ height: [0, 120] }`, camelCase or not).
function layoutKeyframe(node) {
  const objects = ts.isArrayLiteralExpression(node) ? node.elements : [node];
  for (const object of objects) {
    if (!ts.isObjectLiteralExpression(object)) continue;
    for (const property of object.properties) {
      const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : "";
      const css = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      if (LAYOUT_PROPERTY.test(css)) return css;
    }
  }
  return undefined;
}

const STYLE_TRANSITION = /^(?:transition|transitionProperty|WebkitTransition|WebkitTransitionProperty)$/;
const MOTION_ANIMATE = /^(?:animate|exit|while[A-Z]\w*)$/;

// The style property a string is assigned to (`{ transition: "…" }`, `el.style.transition = "…"`).
function styleProperty(node) {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) return parent.name.text;
  if (ts.isBinaryExpression(parent) && parent.right === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(parent.left)) {
    return parent.left.name.text;
  }
  return undefined;
}

const hasControlStateClass = (strings) =>
  strings.some((text) => text.split(/\s+/).some(isControlStateClass));

function collectStrings(node, declarations = new Map(), seen = new Set()) {
  const strings = [];
  const walk = (current) => {
    if (ts.isStringLiteralLike(current) || ts.isTemplateLiteralToken(current)) strings.push(current.text);
    if (ts.isIdentifier(current) && declarations.has(current.text) && !seen.has(current.text)) {
      seen.add(current.text);
      walk(declarations.get(current.text));
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return strings;
}

// The declaration a function is assigned to, through wrappers: `const Row = memo(forwardRef(() => ...))`.
function declarationOf(fn) {
  let node = fn.parent;
  while (ts.isCallExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    node = node.parent;
  }
  return ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) ? node : undefined;
}

function nameOf(node) {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText();
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return node.name?.getText() ?? declarationOf(node)?.name.getText();
  }
  return undefined;
}

function componentName(node) {
  const names = [];
  for (let current = node.parent; current; current = current.parent) {
    const name = nameOf(current);
    if (name) names.push(name);
  }
  return names.find((name) => /^[A-Z]/.test(name)) ?? names[0] ?? "(module)";
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function insideLinkAdapter(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue;
    const typed = [...current.parameters.map((parameter) => parameter.type), declarationOf(current)?.type];
    if (typed.some((type) => type?.getText().includes(LINK_ADAPTER_TYPE))) return true;
  }
  return false;
}

function literalValue(initializer) {
  if (!initializer) return "true";
  const value = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  if (!value) return undefined;
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)) return value.text;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (value.kind === ts.SyntaxKind.FalseKeyword) return "false";
  return undefined;
}

const valueText = (initializer) =>
  (literalValue(initializer) ?? (ts.isJsxExpression(initializer) ? initializer.getText() : `{${initializer.getText()}}`)).replace(
    /\s+/g,
    " ",
  );

function numbersIn(initializer) {
  if (ts.isStringLiteral(initializer)) return [Number(initializer.text)];
  const numbers = [];
  const walk = (node) => {
    if (ts.isNumericLiteral(node)) {
      const negative = ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.MinusToken;
      numbers.push(negative ? -Number(node.text) : Number(node.text));
    }
    ts.forEachChild(node, walk);
  };
  walk(initializer);
  return numbers;
}

// The module index: what a file imports and exports, and the local names its tags resolve through.
function indexScript(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Map();
  const exports = new Map();
  const stars = [];
  const aliases = new Map();
  const declarations = new Map();
  const bindingDefaults = new Map();
  const hasModifier = (node, kind) => (node.modifiers ?? []).some((modifier) => modifier.kind === kind);

  const index = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const specifier = node.moduleSpecifier.text;
      const { name, namedBindings } = node.importClause;
      if (name) imports.set(name.text, { specifier, imported: "default" });
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        imports.set(namedBindings.name.text, { specifier, namespace: true });
      }
      for (const element of namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements : []) {
        if (!element.isTypeOnly) imports.set(element.name.text, { specifier, imported: (element.propertyName ?? element.name).text });
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      const local = node.name?.text ?? "default";
      exports.set(hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : local, { local });
    }
    if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.set(declaration.name.text, { local: declaration.name.text });
      }
    }
    if (ts.isExportAssignment(node)) {
      exports.set("default", { local: ts.isIdentifier(node.expression) ? node.expression.text : "default" });
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const specifier = node.moduleSpecifier?.text;
      if (!node.exportClause) stars.push(specifier);
      if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        exports.set(node.exportClause.name.text, { specifier, namespace: true });
      }
      for (const element of node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : []) {
        const local = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly) exports.set(element.name.text, specifier ? { specifier, imported: local } : { local });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
      if (ts.isIdentifier(node.initializer) || ts.isPropertyAccessExpression(node.initializer)) {
        aliases.set(node.name.text, node.initializer.getText().replace(/\s+/g, ""));
      }
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindingDefaults.set(node.name.text, node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    ts.forEachChild(node, index);
  };
  index(sourceFile);

  // `const Trigger = Menu.Trigger; const Again = Trigger` -> "Menu.Trigger".
  const resolveAlias = (text) => {
    const seen = new Set();
    let current = text;
    for (;;) {
      const [head, ...rest] = current.split(".");
      if (!aliases.has(head) || seen.has(head)) return current;
      seen.add(head);
      current = [aliases.get(head), ...rest].join(".");
    }
  };
  const thirdPartyTagOf = (head, members) => {
    const binding = imports.get(head);
    if (!binding || !isThirdPartyControlModule(binding.specifier)) return undefined;
    if (binding.namespace) return members.length > 0 ? `${binding.specifier}.${members.join(".")}` : undefined;
    return `${binding.specifier}.${[binding.imported, ...members].join(".")}`;
  };
  const localThirdParty = (name) => {
    const [head, ...members] = resolveAlias(name).split(".");
    return thirdPartyTagOf(head, members);
  };

  return { file, sourceFile, imports, exports, stars, declarations, bindingDefaults, resolveAlias, thirdPartyTagOf, localThirdParty };
}

// Resolves an imported name to where it is defined: an app module's local, a third-party control
// (through re-exports and `export *`), or a namespace. Paths come from tsconfig (`~/*`).
function createResolver(modules, paths) {
  const moduleBase = (from, specifier) => {
    if (specifier.startsWith(".")) return path.posix.join(path.posix.dirname(from), specifier);
    for (const [pattern, [target]] of Object.entries(paths)) {
      const prefix = pattern.replace(/\*$/, "");
      const wildcard = prefix !== pattern;
      if (wildcard ? specifier.startsWith(prefix) : specifier === pattern) {
        return path.posix.normalize(target.replace("*", specifier.slice(prefix.length)));
      }
    }
    return undefined;
  };
  const resolveModule = (from, specifier) => {
    const base = moduleBase(from, specifier);
    return base && [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((file) => modules.has(file));
  };
  const namespaceOf = (from, specifier) =>
    isThirdPartyControlModule(specifier) ? { thirdPartyNamespace: specifier } : { namespace: resolveModule(from, specifier) };
  const fromSpecifier = (from, specifier, name, seen) => {
    if (isThirdPartyControlModule(specifier)) return { thirdParty: `${specifier}.${name}` };
    const target = resolveModule(from, specifier);
    return target ? resolveExport(target, name, seen) : undefined;
  };
  const resolveLocal = (file, local, seen) => {
    const module = modules.get(file);
    const thirdParty = module.localThirdParty(local);
    if (thirdParty) return { thirdParty };
    const binding = module.imports.get(local);
    if (binding?.namespace) return namespaceOf(file, binding.specifier);
    if (binding) return fromSpecifier(file, binding.specifier, binding.imported, seen);
    return { file, local };
  };
  const resolveExport = (file, name, seen) => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = modules.get(file);
    const entry = module.exports.get(name);
    if (entry?.namespace) return namespaceOf(file, entry.specifier);
    if (entry?.specifier) return fromSpecifier(file, entry.specifier, entry.imported, seen);
    if (entry) return resolveLocal(file, entry.local, seen);
    for (const specifier of module.stars) {
      const target = resolveModule(file, specifier);
      const found = target && resolveExport(target, name, seen);
      if (found) return found;
    }
    const thirdParty = module.stars.find(isThirdPartyControlModule);
    return thirdParty ? { thirdParty: `${thirdParty}.${name}` } : undefined;
  };

  // An imported tag: `{ thirdParty }`, `{ definition: { file, local }, rest, display }`, or just a
  // display name built from the import when its module is not scanned (Ouro UI, packages). Namespaces,
  // imported or re-exported (`export * as Dialog from "@radix-ui/react-dialog"`), resolve by member.
  const resolveImport = (file, head, members) => {
    const binding = modules.get(file).imports.get(head);
    let definition = binding.namespace
      ? namespaceOf(file, binding.specifier)
      : fromSpecifier(file, binding.specifier, binding.imported, new Set());
    let rest = members;
    while (definition?.namespace && rest.length > 0) {
      definition = resolveExport(definition.namespace, rest[0], new Set());
      rest = rest.slice(1);
    }
    if (definition?.thirdPartyNamespace && rest.length > 0) {
      return { thirdParty: [definition.thirdPartyNamespace, ...rest].join(".") };
    }
    if (definition?.thirdParty) return { thirdParty: [definition.thirdParty, ...rest].join(".") };
    if (definition?.file) {
      return { definition, rest, display: [`${definition.file.replace(/\.tsx?$/, "")}#${definition.local}`, ...rest].join(".") };
    }
    const [name, ...tail] = binding.namespace ? members : [binding.imported, ...members];
    if (name === undefined) return undefined;
    const base = moduleBase(file, binding.specifier);
    return { display: [base ? `${base}#${name}` : `${binding.specifier}.${name}`, ...tail].join(".") };
  };
  const displayOf = (file, head, members) => {
    if (!modules.get(file).imports.has(head)) return undefined;
    const resolved = resolveImport(file, head, members);
    return resolved?.thirdParty ?? resolved?.display;
  };
  return { resolveImport, displayOf };
}

function stringCandidates(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isJsxExpression(node)
  ) {
    return stringCandidates(node.expression);
  }
  if (ts.isConditionalExpression(node)) return [...stringCandidates(node.whenTrue), ...stringCandidates(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
  ) {
    return [...stringCandidates(node.left), ...stringCandidates(node.right)];
  }
  return [];
}

const intrinsicCandidates = (node) => [...new Set(stringCandidates(node).filter((text) => INTRINSIC_TAG.test(text)))];

function isCreateElement(callee) {
  return (
    (ts.isIdentifier(callee) && callee.text === "createElement") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "createElement")
  );
}

// createElement's props are checked with its element, so their data-ouro* keys count once.
function isCreateElementProps(object) {
  return ts.isCallExpression(object.parent) && isCreateElement(object.parent.expression) && object.parent.arguments[1] === object;
}

function objectAttributes(node) {
  const attributes = new Map();
  for (const property of node && ts.isObjectLiteralExpression(node) ? node.properties : []) {
    if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
      attributes.set(property.name.text, property.initializer);
    }
    if (ts.isShorthandPropertyAssignment(property)) attributes.set(property.name.text, property.name);
  }
  return attributes;
}

// Every name a node sits inside: its functions and classes, and `default` for an anonymous
// default export. A component "contains" an offender anywhere inside it.
function ownersOf(node) {
  const owners = [];
  for (let current = node.parent; current; current = current.parent) {
    const anonymousDefault =
      (ts.isArrowFunction(current) && ts.isExportAssignment(current.parent)) ||
      (ts.isFunctionDeclaration(current) && !current.name);
    const name = nameOf(current) ?? (anonymousDefault ? "default" : undefined);
    if (name) owners.push(name);
  }
  return owners;
}

// Ouro UI's Spinner, by its install path (`components/ouro/spinner/spinner`), and the utility class
// a hand-made spinner turns with.
const SPINNER_MODULE = /(?:^|\/)spinner\/spinner(?:\.[cm]?[jt]sx?)?$/;
const SPIN_CLASS = /^!?animate-(?:spin|\[(?:ouro-)?spin(?:_|\]))/;
// The Tailwind scale a hand-drawn avatar or dot is sized on: `size-N`, or `h-N` and `w-N` together,
// in 4px steps (`size-8` is 32px); a dot is at most 12px, an avatar at least 24px.
const SIZE_STEP = /^(?:size|h|w)-(\d+(?:\.\d+)?)$/;
const ROUND_CLASS = /^rounded(?:-(?:full|sm|md|lg|xl|2xl|3xl))?$/;
const AVATAR_PICTURE_CLASS = /^(?:overflow-hidden|object-cover)$/;

// The class tokens of an element, variants removed and a leading `!` dropped.
const baseTokens = (classStrings) =>
  classStrings.flatMap((text) => text.split(/\s+/)).filter(Boolean).map((token) => splitVariants(token).at(-1).replace(/^!/, ""));

// What a hand-drawn avatar or dot is: a round (or rounded) box with a set size. Undefined for
// anything else, so ordinary layout (`rounded-lg p-4`, `h-4 w-full`) never counts.
function drawnShape(tokens, tag, empty) {
  const sizes = new Map();
  for (const token of tokens) {
    const match = SIZE_STEP.exec(token);
    if (match) sizes.set(token.split("-")[0], Number(match[1]));
  }
  const side = sizes.get("size") ?? (sizes.has("h") && sizes.get("h") === sizes.get("w") ? sizes.get("h") : undefined);
  if (tokens.some((token) => SPIN_CLASS.test(token))) return undefined;
  // A round picture is an avatar whatever size it is given (a card's person picture sizes itself by style or its parent).
  if (side === undefined) return tag === "img" && tokens.includes("rounded-full") ? "hand-drawn-avatar" : undefined;
  const round = tokens.filter((token) => ROUND_CLASS.test(token));
  if (round.length === 0) return undefined;
  if (side <= 3 && round.includes("rounded-full") && empty && tokens.some((token) => /^bg-/.test(token))) return "hand-drawn-presence-dot";
  const picture = tag === "img" || tokens.some((token) => AVATAR_PICTURE_CLASS.test(token));
  const rounded = round.includes("rounded-full") || (tag === "img" && round.some((token) => token !== "rounded" && token !== "rounded-sm"));
  return side >= 6 && picture && rounded ? "hand-drawn-avatar" : undefined;
}
const FIXED_CLASS_RADIUS = /^rounded(?:-(?:[stbelrx]|ss|se|ee|es|tl|tr|bl|br))?-\[(?!var\(|calc\(var\()([^\]]*)\]$/;
const CIRCLE_RADIUS = /^(?:0(?:px|rem)?|50%|9999px|999px|100%|9999rem|[\d.]+%)$/;

// Whether a class token fixes a corner radius by hand. Circles and zero pass.
const fixedRadiusIn = (classStrings) =>
  classStrings.some((text) => text.split(/\s+/).some((token) => fixedRadius(splitVariants(token).at(-1).replace(/^!|!$/g, ""))));
const fixedRadius = (token) => {
  const value = FIXED_CLASS_RADIUS.exec(token)?.[1];
  return value !== undefined && !CIRCLE_RADIUS.test(value.replace(/_/g, " "));
};

const RADIUS_PROPERTY = /^border(?:(?:Top|Bottom)(?:Left|Right)|(?:Start|End)(?:Start|End))?Radius$/;
const RADIUS_DECLARATION = /^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/i;
// A radius value that follows the theme, is a circle or is zero; anything else is a hand-set corner.
const themedRadius = (value) => {
  const text = value.trim().replace(/\s+/g, " ");
  return /^(?:inherit|initial|unset|revert)$/i.test(text) || /var\(|^calc\(var/.test(text) || text.split(/[\s/]+/).every((part) => CIRCLE_RADIUS.test(part));
};
// Whether an inline style object sets a corner radius by hand (`style={{ borderRadius: 12 }}`).
function inlineRadius(initializer) {
  const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  return [...objectAttributes(expression && ts.isObjectLiteralExpression(expression) ? expression : undefined)].some(([name, value]) => {
    if (!RADIUS_PROPERTY.test(name)) return false;
    if (ts.isNumericLiteral(value)) return Number(value.text) !== 0;
    if (ts.isStringLiteralLike(value)) return !themedRadius(value.text);
    return false;
  });
}
// `rounded-full` on a box that is not a dot, pill, thumb or ring: a block that is wide and tall (both
// sides over 48px, and not alike), or a structural element. Squares, small pills and pictures are round parts.
const ROUND_PART_MARKER = /(?:^|[-_:\s])(?:dot|thumb|ring|pill|badge|avatar|spinner|circle|chip|tag|knob|handle|track|bar)(?:$|[-_\s])/i;
const STRUCTURAL_TAG = /^(?:section|article|main|aside|header|footer|nav|form|table|ul|ol|li|p|h[1-6])$/;
function roundedBlock(tokens, tag, classStrings) {
  if (!tokens.includes("rounded-full") || tokens.some((token) => SPIN_CLASS.test(token))) return false;
  if (tag === "img" || tokens.some((token) => ROUND_PART_MARKER.test(token)) || classStrings.some((text) => ROUND_PART_MARKER.test(text))) return false;
  if (STRUCTURAL_TAG.test(tag) && tokens.some((token) => /^(?:p|px|py|min-h|min-w|w|h)-/.test(token))) return true;
  const sizes = new Map();
  for (const token of tokens) {
    const match = SIZE_STEP.exec(token);
    if (match) sizes.set(token.split("-")[0], Number(match[1]));
  }
  const h = sizes.get("size") ?? sizes.get("h");
  const w = sizes.get("size") ?? sizes.get("w");
  return h !== undefined && w !== undefined && h !== w && Math.min(h, w) > 12;
}

const BUTTON_MODULE = /(?:^|\/)button\/button(?:\.[cm]?[jt]sx?)?$/;

// Failure copy: the attributes and object properties whose values are not copy, a string that is
// one lowercase token (a status such as "error", a key such as "errors.load-failed"), and the
// apostrophe entities JSX may spell ("Couldn&apos;t").
const NOT_COPY_ATTRIBUTE = /^(?:class|className|\w+ClassName|data-[\w-]*|id|key|type|href|src|to|name|role|htmlFor|as)$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[-_.:/][a-z0-9]+)*$/;
const APOSTROPHE_ENTITY = /&(?:apos|rsquo|#0*39|#0*8217|#x0*27|#x0*2019);/gi;
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
const copySpace = (text) => text.replace(APOSTROPHE_ENTITY, "'").replace(/\s+/g, " ").trim();
// A string that is the first argument of a membership test is matched against, not shown.
const MEMBERSHIP_METHODS = new Set(["includes", "startsWith", "endsWith", "has", "test"]);
const isMembershipArgument = (call, node) =>
  call.arguments[0] === node && ts.isPropertyAccessExpression(call.expression) && MEMBERSHIP_METHODS.has(call.expression.name.text);
// `error.name || "Error"`: a class name for a missing name, not a message.
const ERROR_CLASS_NAME = /^(?:[A-Z][a-z]*)*(?:Error|Exception)$/;
const isNameFallback = (binary, node) =>
  (binary.operatorToken.kind === ts.SyntaxKind.BarBarToken || binary.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
  binary.right === node &&
  ts.isPropertyAccessExpression(binary.left) &&
  binary.left.name.text === "name" &&
  ts.isStringLiteral(node) &&
  ERROR_CLASS_NAME.test(node.text);

const membershipArraysByFile = new WeakMap();
const isSetOf = (node) =>
  ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Set" && node.arguments?.length === 1 && ts.isArrayLiteralExpression(node.arguments[0]);
// The `.has(…)` receiver: `x.has(…)` with x the node.
const isMembershipReceiver = (node) =>
  ts.isPropertyAccessExpression(node.parent) &&
  node.parent.expression === node &&
  node.parent.name.text === "has" &&
  ts.isCallExpression(node.parent.parent) &&
  node.parent.parent.expression === node.parent;

// The array literals of the Sets a file only tests membership in: `new Set([...]).has(x)` inline, and a
// `const` Set that is not exported and whose every use in the file is `Name.has(…)`. The walk is by name,
// not by scope, so another binding of the same name that is used some other way keeps the Set read.
function membershipArraysOf(sourceFile) {
  if (membershipArraysByFile.has(sourceFile)) return membershipArraysByFile.get(sourceFile);
  const arrays = new Set();
  const candidates = [];
  const used = new Set();
  const visit = (node) => {
    if (isSetOf(node) && isMembershipReceiver(node)) arrays.add(node.arguments[0]);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isSetOf(node.initializer) &&
      node.parent.flags & ts.NodeFlags.Const &&
      !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export)
    ) {
      candidates.push({ name: node.name.text, array: node.initializer.arguments[0] });
    }
    if (ts.isIdentifier(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) && !isMembershipReceiver(node)) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const { name, array } of candidates) if (!used.has(name)) arrays.add(array);
  membershipArraysByFile.set(sourceFile, arrays);
  return arrays;
}

// Whether a string or template stands where copy would: not a module specifier, a type, a key, a
// tagged template, a compared value, or the value of an attribute or property in NOT_COPY_ATTRIBUTE.
function isCopyPosition(node) {
  const { parent } = node;
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ts.isComputedPropertyName(parent) ||
    ts.isTaggedTemplateExpression(parent) ||
    ts.isCaseClause(parent) ||
    parent.name === node ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    (ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || parent.expression.getText() === "require")) ||
    (ts.isCallExpression(parent) && isMembershipArgument(parent, node)) ||
    (ts.isBinaryExpression(parent) && (EQUALITY.has(parent.operatorToken.kind) || isNameFallback(parent, node))) ||
    (ts.isArrayLiteralExpression(parent) && membershipArraysOf(node.getSourceFile()).has(parent))
  ) {
    return false;
  }
  for (let current = node; !ts.isSourceFile(current); current = current.parent) {
    const owner = current.parent;
    if (ts.isJsxAttribute(owner)) return !NOT_COPY_ATTRIBUTE.test(owner.name.getText());
    if (ts.isPropertyAssignment(owner) && (ts.isIdentifier(owner.name) || ts.isStringLiteral(owner.name))) {
      if (NOT_COPY_ATTRIBUTE.test(owner.name.text)) return false;
    }
    if (ts.isJsxElement(owner) || ts.isJsxSelfClosingElement(owner) || ts.isJsxFragment(owner) || isFunctionLike(owner)) return true;
  }
  return true;
}

// The copy a node holds, and whether it is the whole text (a template with a substitution, or JSX
// text beside other children, is only part of one), or undefined when the node is not copy.
function copyOf(node) {
  if (ts.isStringLiteralLike(node)) {
    return isCopyPosition(node) && !TOKEN.test(node.text) ? { text: copySpace(node.text), whole: true } : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    const text = node.head.text + node.templateSpans.map((span) => `\${…}${span.literal.text}`).join("");
    return isCopyPosition(node) ? { text: copySpace(text), whole: false } : undefined;
  }
  if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
    const alone = node.parent.children.every(
      (other) => other === node || (ts.isJsxText(other) ? other.containsOnlyTriviaWhiteSpaces : ts.isJsxExpression(other) && !other.expression),
    );
    // Read with the children after it, an expression or element as ${…}, so `Couldn't send: {why}` reads as its template twin.
    const after = node.parent.children
      .slice(node.parent.children.indexOf(node) + 1)
      .map((other) => (ts.isJsxText(other) ? other.text : ts.isJsxExpression(other) && !other.expression ? "" : "${…}"))
      .join("");
    return { text: copySpace(node.text + after), whole: alone };
  }
  return undefined;
}

// An index a render builds: `new Map(rows…)`, `Object.fromEntries(…)`, with at least one argument.
const INDEX_CONSTRUCTORS = new Set(["Map", "Set", "RegExp"]);
const INDEX_BUILDERS = new Set(["Object.fromEntries", "Object.groupBy", "Map.groupBy"]);
const RENDER_WRAPPERS = /^(?:React\.)?(?:memo|forwardRef)$/;
const HOOK_NAME = /^use[A-Z0-9]/;
const COMPONENT_NAME = /^[A-Z]/;
// All capitals is a constant or a route handler (Next.js's `GET`, `POST`), not a component.
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]+$/;
// Components live in files that can hold JSX; a capitalised function in a .ts file is something else.
const JSX_FILE = /\.[jt]sx$/;

function indexBuilt(node) {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && INDEX_CONSTRUCTORS.has(node.expression.text)) {
    return node.arguments?.length ? node.expression.text : undefined;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && INDEX_BUILDERS.has(node.expression.getText())) {
    return node.arguments.length > 0 ? node.expression.getText() : undefined;
  }
  return undefined;
}

// The name of the render a function is: a component (a capitalised name that is not all capitals,
// in a .tsx file, also through memo or forwardRef), a custom hook (useX), or a class's render
// method; else undefined.
function renderName(fn) {
  if (ts.isMethodDeclaration(fn)) {
    const owner = fn.parent;
    return fn.name.getText() === "render" && ts.isClassLike(owner) && owner.heritageClauses?.length
      ? owner.name?.text ?? declarationOf(owner)?.name.getText() ?? "render"
      : undefined;
  }
  if (!ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) && !ts.isArrowFunction(fn)) return undefined;
  let name = fn.name?.text;
  if (!name && !ts.isFunctionDeclaration(fn)) {
    let node = fn.parent;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      (ts.isCallExpression(node) && RENDER_WRAPPERS.test(node.expression.getText()))
    ) {
      node = node.parent;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) name = node.name.text;
  }
  if (!name) return undefined;
  if (HOOK_NAME.test(name)) return name;
  return COMPONENT_NAME.test(name) && !CONSTANT_NAME.test(name) && JSX_FILE.test(fn.getSourceFile().fileName) ? name : undefined;
}

// The render whose own body evaluates `node`, or undefined at module scope or inside a nested function.
function enclosingRender(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isClassStaticBlockDeclaration(current)) return renderName(current);
  }
  return undefined;
}

// The variable an index is assigned to (`const byId = new Map(…)`), for its fingerprint.
function assignedName(node) {
  let current = node.parent;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.parent;
  return ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) ? current.name.text : "";
}

// gated-load: what decides a load (an event, a read, an observer or an idle wait), and what a load is.
const DOCUMENT = /^(?:(?:window|globalThis|self)\.)?document$/;
const GATE_TARGET = /^(?:(?:window|globalThis|self)(?:\.document)?|document)$/;
const GATE_EVENTS = new Set(["visibilitychange", "focus", "blur", "pageshow"]);
const GATE_DOCUMENT_READS = new Set(["hidden", "visibilityState", "webkitHidden", "hasFocus"]);
const GATE_ENTRY_READS = new Set(["isIntersecting", "intersectionRatio"]);
const GATE_HOOK =
  /^use(?:InView|InViewport|IntersectionObserver|Intersection|OnScreen|IsVisible|Visible|Visibility|DocumentVisibility|PageVisibility|VisibilityChange|WindowFocus|HasFocus|PageFocus|Idle|IsIdle|IdleTimer|IdleCallback)$/;
const GATE_CALLBACK = /^on(?:visibilitychange|focus|blur|pageshow|Idle|Active|Visible|VisibilityChange|WindowFocus|Intersect|Intersection|InView|EnterViewport)$/;
const GATE_ELEMENT = /^(?:InView|Waypoint|VisibilitySensor)$/;
const LOAD_VERB = /^(?:fetch|refetch|prefetch|preload|preinit|load|reload|refresh|revalidate|invalidate)(?:[A-Z]\w*)?$/;
const DATA_HOOK = /^use(?:SWR|SWRInfinite|SWRImmutable|Query|Queries|InfiniteQuery|SuspenseQuery|SuspenseInfiniteQuery|LazyQuery)$/;
const LOAD_CONSTRUCTORS = new Set(["Image", "XMLHttpRequest", "EventSource", "WebSocket", "FontFace"]);
const ENABLE_OPTIONS = new Set(["enabled", "skip", "pause", "paused"]);
// The attributes through which an element fetches what it shows.
const ASSET_ATTRIBUTES = new Set(["src", "srcSet", "srcset", "poster", "data"]);
const EXITS = new Set([ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.ThrowStatement, ts.SyntaxKind.ContinueStatement, ts.SyntaxKind.BreakStatement]);
const calleeName = (callee) => (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined);
const exits = (statement) => EXITS.has((ts.isBlock(statement) ? statement.statements.at(-1) : statement)?.kind);
const nameText = (name) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined);

// A write is no load: a fetch with keepalive or a method other than GET, as an app saves when the page hides.
function isWrite(init) {
  if (!init || !ts.isObjectLiteralExpression(init)) return false;
  return init.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const value = literalValue(property.initializer);
    const name = nameText(property.name);
    return (name === "keepalive" && value === "true") || (name === "method" && value !== undefined && !/^(?:get|head)$/i.test(value));
  });
}

// What a node loads, by name: fetch, a load or prefetch call, a data hook, import(), `new Image()`, a
// `src` or `srcset` set. Undefined for anything else.
function loadOf(node) {
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return "import()";
    const name = calleeName(node.expression);
    if (name === "fetch") return isWrite(node.arguments[1]) ? undefined : name;
    if (name === "setAttribute") return /^src(?:set)?$/i.test(node.arguments[0]?.text ?? "") ? "src" : undefined;
    return name !== undefined && (LOAD_VERB.test(name) || DATA_HOOK.test(name)) ? name : undefined;
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && LOAD_CONSTRUCTORS.has(node.expression.text)) return `new ${node.expression.text}`;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
    return /^src(?:set)?$/.test(node.left.name.text) ? node.left.name.text : undefined;
  }
  return undefined;
}

// Loads gated on focus, visibility, return, idle or being scrolled into view, counted where the load is written.
function findGatedLoads({ file, sourceFile, declarations }) {
  const recorded = new Map();
  const record = (node, gate, load) => {
    if (!recorded.has(node)) recorded.set(node, { gate, load });
  };
  // A same-file function a gate calls: `const sync = () => fetch(...)`, or one wrapped in useCallback.
  const localFunction = (name) => {
    let found = declarations.get(name);
    if (found && ts.isCallExpression(found) && calleeName(found.expression) === "useCallback") found = found.arguments[0];
    return found && isFunctionLike(found) ? found : undefined;
  };
  const loads = (node, seen = new Set()) => {
    let found = false;
    const walk = (current) => {
      if (found) return;
      const called = ts.isCallExpression(current) && ts.isIdentifier(current.expression) ? current.expression.text : undefined;
      const local = called !== undefined && !seen.has(called) ? localFunction(called) : undefined;
      if (local) seen.add(called);
      found = loadOf(current) !== undefined || (local !== undefined && loads(local, seen));
      ts.forEachChild(current, walk);
    };
    walk(node);
    return found;
  };
  // Every load in a scope the gate decides; a call to a same-file function that loads counts at the call.
  const scanScope = (scope, gate) => {
    const walk = (node) => {
      const load = loadOf(node);
      const called = ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      const local = called !== undefined ? localFunction(called) : undefined;
      if (load) record(node, gate, load);
      else if (local && loads(local, new Set([called]))) record(node, gate, called);
      ts.forEachChild(node, walk);
    };
    walk(scope);
  };
  // A callback a gate runs: a function, or a name for a load or a same-file function.
  const scanCallback = (callback, gate) => {
    if (!callback) return;
    if (ts.isIdentifier(callback) && (LOAD_VERB.test(callback.text) || DATA_HOOK.test(callback.text))) return record(callback, gate, callback.text);
    const local = ts.isIdentifier(callback) ? localFunction(callback.text) : undefined;
    if (local) return loads(local, new Set([callback.text])) ? record(callback, gate, callback.text) : undefined;
    if (isFunctionLike(callback)) scanScope(callback, gate);
  };

  // Names that hold a gate: what a gate hook returns (`const { ref, inView } = useInView()`, refs
  // aside), and state a gate's callback sets (`setVisible(!document.hidden)`).
  const gateNames = new Map();
  const setters = new Map();
  const bind = (name, gate) => {
    if (ts.isIdentifier(name)) {
      if (!/ref$/i.test(name.text)) gateNames.set(name.text, gate);
      return;
    }
    for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name, gate);
  };
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const call = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      const hook = ts.isCallExpression(call) ? calleeName(call.expression) : undefined;
      if (hook !== undefined && GATE_HOOK.test(hook)) bind(node.name, hook);
      const [state, setter] = ts.isArrayBindingPattern(node.name) ? node.name.elements.map((element) => element.name) : [];
      if (hook === "useState" && state && setter && ts.isIdentifier(state) && ts.isIdentifier(setter)) setters.set(setter.text, state.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const gateRead = (node) => {
    let gate;
    const walk = (current) => {
      if (ts.isPropertyAccessExpression(current)) {
        const name = current.name.text;
        if (GATE_DOCUMENT_READS.has(name) && DOCUMENT.test(current.expression.getText())) gate = `document.${name}`;
        if (GATE_ENTRY_READS.has(name)) gate = name;
        return gate ?? walk(current.expression);
      }
      if (ts.isIdentifier(current) && gateNames.has(current.text)) gate = gateNames.get(current.text);
      if (!gate) ts.forEachChild(current, walk);
    };
    walk(node);
    return gate;
  };

  // The callbacks a gate runs, with the gate's name: a visibility, focus or pageshow listener on the
  // window or document, its `on…` handler, requestIdleCallback, an IntersectionObserver, a gate
  // hook's callbacks, an idle or in-view callback prop, and an in-view component's function props.
  const callbacksOf = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const target = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression.getText() : "window";
      const [event, callback] = node.arguments;
      if (name === "addEventListener" && GATE_TARGET.test(target) && event && GATE_EVENTS.has(event.text)) return [[callback, event.text]];
      if (name === "requestIdleCallback") return [[node.arguments[0], name]];
      if (name !== undefined && GATE_HOOK.test(name)) {
        return node.arguments.flatMap((argument) =>
          ts.isObjectLiteralExpression(argument)
            ? argument.properties.filter(ts.isPropertyAssignment).map((property) => [property.initializer, name])
            : [[argument, name]],
        );
      }
    }
    if (ts.isNewExpression(node) && calleeName(node.expression) === "IntersectionObserver") return [[node.arguments?.[0], "IntersectionObserver"]];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const name = node.left.name.text;
      return GATE_CALLBACK.test(name) && GATE_TARGET.test(node.left.expression.getText()) ? [[node.right, name]] : [];
    }
    if ((ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) && GATE_CALLBACK.test(nameText(node.name) ?? "")) {
      const value = ts.isJsxAttribute(node) ? node.initializer?.expression : node.initializer;
      return [[value, nameText(node.name)]];
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && GATE_ELEMENT.test(node.tagName.getText())) {
      return node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.initializer?.expression, node.tagName.getText()]);
    }
    return [];
  };
  // State a gate's callback sets to what the gate says is a gate too, so a load that waits for it
  // is gated: `setShown(entry.isIntersecting)`, `setVisible(!document.hidden)`, or the callback's
  // own argument (`(seen) => setShown(seen)`). A setter given anything else is not: a popover that
  // closes on blur (`setOpen(false)`) leaves `open` an ordinary state.
  const mentions = (node, names) => {
    let found = false;
    const walk = (current) => {
      found ||= ts.isIdentifier(current) && names.has(current.text);
      if (!found) ts.forEachChild(current, walk);
    };
    walk(node);
    return found;
  };
  const feed = (node) => {
    for (const [callback, gate] of callbacksOf(node)) {
      const said = new Set();
      const name = (current) => {
        if (ts.isIdentifier(current)) said.add(current.text);
        ts.forEachChild(current, name);
      };
      for (const parameter of callback?.parameters ?? []) name(parameter.name);
      const says = (argument) => gateRead(argument) !== undefined || mentions(argument, said);
      const walk = (current) => {
        const setter = ts.isCallExpression(current) && ts.isIdentifier(current.expression) ? setters.get(current.expression.text) : undefined;
        if (setter && current.arguments.some(says)) gateNames.set(setter, gate);
        ts.forEachChild(current, walk);
      };
      if (callback) walk(callback);
    }
    ts.forEachChild(node, feed);
  };
  feed(sourceFile);

  const visit = (node) => {
    for (const [callback, gate] of callbacksOf(node)) scanCallback(callback, gate);
    if (ts.isIfStatement(node)) {
      const gate = gateRead(node.expression);
      if (gate) {
        scanScope(node.thenStatement, gate);
        if (node.elseStatement) scanScope(node.elseStatement, gate);
        // `if (document.hidden) return;` gates everything after it in the block.
        const siblings = node.elseStatement || !exits(node.thenStatement) ? [] : node.parent.statements ?? [];
        for (const sibling of siblings.slice(siblings.indexOf(node) + 1)) scanScope(sibling, gate);
      }
    }
    if (ts.isConditionalExpression(node)) {
      const gate = gateRead(node.condition);
      if (gate) for (const branch of [node.whenTrue, node.whenFalse]) scanScope(branch, gate);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      const gate = gateRead(node.left);
      if (gate) scanScope(node.right, gate);
    }
    // An element that fetches its asset only as it nears the screen (`loading="lazy"`), and one
    // whose address waits on a gate (`src={inView ? url : undefined}`).
    if (ts.isJsxAttribute(node) && ts.isJsxOpeningLikeElement(node.parent.parent)) {
      const name = nameText(node.name);
      const tag = node.parent.parent.tagName.getText();
      if (name === "loading" && literalValue(node.initializer) === "lazy") record(node, "loading=lazy", tag);
      const address = name !== undefined && ASSET_ATTRIBUTES.has(name) && node.initializer ? gateRead(node.initializer) : undefined;
      if (address) record(node, address, `${tag}.${name}`);
    }
    // A data hook or load whose arguments read a gate (`useSWR(inView ? key : null)`), and an
    // `enabled: inView` option.
    const load = loadOf(node);
    const gate = load && ts.isCallExpression(node) ? node.arguments.map(gateRead).find(Boolean) : undefined;
    if (gate) record(node, gate, load);
    if (ts.isPropertyAssignment(node) && ENABLE_OPTIONS.has(nameText(node.name))) {
      const option = gateRead(node.initializer);
      const call = node.parent.parent;
      if (option) record(ts.isCallExpression(call) ? call : node, option, (ts.isCallExpression(call) && calleeName(call.expression)) || nameText(node.name));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return [...recorded].map(([node, { gate, load }]) => ({
    category: "gated-load",
    fingerprint: [file, componentName(node), "gated-load", `${gate}>${load}`, ""].join("::"),
    file,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
  }));
}

function scanScript(module, resolver, failureCopyAllow) {
  const { file, sourceFile, imports, declarations, bindingDefaults } = module;
  const offenders = [];
  const ownerHits = new Set();
  const renders = [];
  const uses = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const add = (category, node, tag, props = "") => {
    offenders.push({ category, fingerprint: [file, componentName(node), category, tag, props].join("::"), file, line: lineOf(node) });
    for (const owner of ownersOf(node)) ownerHits.add(owner);
  };
  // Counted where it is written; a spinner is not a control, so the component around it stays clean.
  const addSpinner = (node, tag, props) => {
    offenders.push({ category: "content-spinner", fingerprint: [file, componentName(node), "content-spinner", tag, props].join("::"), file, line: lineOf(node) });
  };
  // Failure copy counts where it is written too: the phrase is its tag and the text its props.
  const checkCopy = (node) => {
    const copy = copyOf(node);
    const phrase = copy && vagueFailurePhrase(copy.text, { whole: copy.whole });
    if (!phrase || failureCopyAllow.some((entry) => copy.text.includes(entry.match))) return;
    const category = "vague-failure-copy";
    offenders.push({ category, fingerprint: [file, componentName(node), category, phrase, copy.text].join("::"), file, line: lineOf(node) });
  };
  const ouroExport = (control, name, pattern) => {
    if (!control.ref) return false;
    const binding = imports.get(control.ref.head);
    if (!binding || !pattern.test(binding.specifier)) return false;
    const [exported, ...rest] = binding.namespace ? control.ref.members : [binding.imported, ...control.ref.members];
    return rest.length === 0 && exported === name;
  };
  const isButton = (control) => [...control.tags, ...control.asTags].includes("button") || ouroExport(control, "Button", BUTTON_MODULE);
  // The exception: a raw <button> or an Ouro Button (a spin class on it turns an icon inside it), or
  // anywhere inside one, its children or its props.
  // Whether a spinner stands where content would: returned or assigned on its own, or the only thing
  // in its element. One in a prop (a field's adornment, a control's icon), in an object (a toast's or
  // a menu entry's icon) or beside other content (text saying what is under way) is inline progress.
  const standsAlone = (node) => {
    let child = ts.isJsxOpeningElement(node) ? node.parent : node;
    for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent)) continue;
      if (ts.isJsxExpression(parent)) {
        if (ts.isJsxAttribute(parent.parent)) return false;
        continue;
      }
      if (ts.isPropertyAssignment(parent)) return false;
      if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
        return parent.children.every((other) => other === child || (ts.isJsxText(other) ? other.containsOnlyTriviaWhiteSpaces : ts.isJsxExpression(other) && !other.expression));
      }
      return true;
    }
    /* istanbul ignore next @preserve -- a node always has a source file above it */
    return true;
  };
  const inButton = (node, control) => {
    if (isButton(control)) return true;
    for (let parent = node.parent; parent; parent = parent.parent) {
      const opening = ts.isJsxElement(parent) ? parent.openingElement : ts.isJsxSelfClosingElement(parent) ? parent : undefined;
      if (!opening || opening === node) continue;
      const as = opening.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "as");
      if (isButton(describe(opening.tagName.getText(), as?.initializer, true))) return true;
    }
    return false;
  };
  const stableProps = (attributes) =>
    STABLE_PROPS.filter((name) => attributes.has(name))
      .map((name) => `${name}=${valueText(attributes.get(name))}`)
      .join(",");

  const description = (fields) => ({
    tags: [],
    asTags: [],
    motion: false,
    gesture: false,
    thirdParty: false,
    router: false,
    ref: undefined,
    ...fields,
  });
  const routerAnchorOf = (head, members) => {
    const binding = imports.get(head);
    if (!binding || !ROUTER_MODULES.has(binding.specifier)) return undefined;
    const [name, ...rest] = binding.namespace ? members : [binding.imported, ...members];
    return rest.length === 0 && ROUTER_ANCHORS.has(name) ? name : undefined;
  };
  const motionKindOf = (head) => {
    const binding = imports.get(head);
    if (!binding || !MOTION_MODULES.has(binding.specifier)) return undefined;
    if (binding.namespace) return binding.specifier === MOTION_ELEMENT_NAMESPACE ? "element" : undefined;
    if (MOTION_COMPONENTS.has(binding.imported)) return "element";
    return binding.imported === "Reorder" ? "reorder" : undefined;
  };

  // `const X = motion.create("button")` (or the older `motion("button")`) renders a button.
  const motionCreatedTags = (node) => {
    if (!node || !ts.isCallExpression(node)) return [];
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && callee.name.text === "create" && ts.isIdentifier(callee.expression)
        ? callee.expression.text
        : undefined;
    return name !== undefined && motionKindOf(name) === "element" ? intrinsicCandidates(node.arguments[0]) : [];
  };

  // What a tag renders: intrinsic elements (literal, motion's, or a string-typed variable), a
  // React Router anchor, a third-party control, or a component reference.
  const describe = (tagText, asInitializer, literalIntrinsic) => {
    if (literalIntrinsic && INTRINSIC_TAG.test(tagText)) return description({ tags: [tagText], display: tagText });
    const resolved = module.resolveAlias(tagText);
    const [head, ...members] = resolved.split(".");
    const asTags = intrinsicCandidates(asInitializer);
    const thirdParty = module.thirdPartyTagOf(head, members);
    if (thirdParty) return description({ thirdParty: true, display: thirdParty, asTags });
    const router = routerAnchorOf(head, members);
    if (router) return description({ router: true, display: `react-router.${router}`, asTags });
    const motionKind = members.length === 1 ? motionKindOf(head) : undefined;
    if (motionKind === "element" && INTRINSIC_TAG.test(members[0])) {
      return description({ tags: [members[0]], motion: true, display: members[0] });
    }
    if (motionKind === "reorder" && REORDER_TAGS[members[0]]) {
      const tags = asTags.length > 0 ? asTags : [REORDER_TAGS[members[0]]];
      return description({ tags, motion: true, gesture: members[0] === "Item", display: tags.join("|") });
    }
    const dynamic = members.length === 0 ? intrinsicCandidates(declarations.get(head) ?? bindingDefaults.get(head)) : [];
    if (dynamic.length > 0) return description({ tags: dynamic, display: dynamic.join("|") });
    const created = members.length === 0 ? motionCreatedTags(declarations.get(head)) : [];
    if (created.length > 0) return description({ tags: created, motion: true, display: created.join("|") });
    return description({ ref: { head, members }, display: resolver.displayOf(file, head, members) ?? resolved, asTags });
  };

  const checkControl = (node, control, attributes) => {
    const props = stableProps(attributes);
    if (control.ref && imports.has(control.ref.head)) {
      uses.push({ ...control.ref, component: componentName(node), owners: ownersOf(node), line: lineOf(node), props });
    } else if (control.ref) {
      renders.push({ owners: ownersOf(node), head: control.ref.head });
    }
    if (control.tags.length === 1 && control.tags[0] === "input" && literalValue(attributes.get("type")) === "hidden") return;
    if ((control.tags.includes("a") || control.router) && insideLinkAdapter(node)) return;

    for (const tag of [...control.tags, ...control.asTags]) {
      if (RAW_TAGS[tag]) add(RAW_TAGS[tag], node, tag, props);
    }
    if (control.router) add("raw-anchor", node, control.display, props);
    if (control.thirdParty) add("third-party-control", node, control.display, props);
    const plain = control.tags.filter((tag) => !RAW_TAGS[tag]);
    const handles = [...attributes.keys()].some(
      (name) => HANDLER.test(name) || (control.motion && MOTION_HANDLER.test(name)),
    );
    if (plain.length > 0 && (control.gesture || handles)) add("plain-element-handler", node, plain.join("|"), props);
    for (const [name, initializer] of attributes) {
      if (/^contenteditable$/i.test(name) && literalValue(initializer) !== "false") {
        add("contenteditable", node, control.display, props);
      }
      if (/^tabindex$/i.test(name) && initializer && numbersIn(initializer).some((value) => value > 0)) {
        add("positive-tabindex", node, control.display, props);
      }
      if (
        name === "role" &&
        initializer &&
        collectStrings(initializer).some((text) => text.split(/\s+/).some((role) => INTERACTIVE_ROLES.has(role)))
      ) {
        add("interactive-role", node, control.display, props);
      }
      if (
        name === "role" &&
        control.tags.length === 1 &&
        initializer &&
        collectStrings(initializer).some((text) => text.split(/\s+/).includes("switch"))
      ) {
        offenders.push({ category: "hand-drawn-switch", fingerprint: [file, componentName(node), "hand-drawn-switch", control.display, props].join("::"), file, line: lineOf(node) });
      }
      if (name.startsWith("data-ouro")) add("data-ouro-attr", node, `${control.display}[${name}]`, props);
    }
    const classStrings = [...attributes]
      .filter(([name, initializer]) => CLASS_ATTRIBUTE.test(name) && initializer)
      .flatMap(([, initializer]) => collectStrings(initializer, declarations));
    if (
      control.tags.length === 1 &&
      (control.tags[0] === "section" || control.tags[0] === "header") &&
      classStrings.some((text) => /(^|[\s:-])hero($|[\s_-])/.test(text))
    ) {
      offenders.push({ category: "hand-drawn-hero", fingerprint: [file, componentName(node), "hand-drawn-hero", control.display, props].join("::"), file, line: lineOf(node) });
    }
    if (hasControlStateClass(classStrings)) add("control-state-style", node, control.display, props);
    const spins = classStrings.some((text) => text.split(/\s+/).some((token) => SPIN_CLASS.test(splitVariants(token).at(-1))));
    if ((ouroExport(control, "Spinner", SPINNER_MODULE) || spins) && !inButton(node, control) && standsAlone(node)) addSpinner(node, control.display, props);
    // Counted where it is written, like a spinner: a drawn avatar is not a control. Only an intrinsic element counts, so Ouro's Avatar and its className never do.
    if (control.tags.length === 1 && classStrings.length > 0) {
      const empty = !ts.isJsxElement(node.parent) || node.parent.children.every((child) => ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces);
      const drawn = drawnShape(baseTokens(classStrings), control.tags[0], empty);
      if (drawn) offenders.push({ category: drawn, fingerprint: [file, componentName(node), drawn, control.display, props].join("::"), file, line: lineOf(node) });
    }
    // Counted where it is written, like a spinner. Only an intrinsic element counts, so a registry component and its className never do.
    if (
      control.tags.length === 1 &&
      (fixedRadiusIn(classStrings) || inlineRadius(attributes.get("style")) || roundedBlock(baseTokens(classStrings), control.tags[0], classStrings))
    ) {
      offenders.push({ category: "hand-drawn-corner", fingerprint: [file, componentName(node), "hand-drawn-corner", control.display, props].join("::"), file, line: lineOf(node) });
    }
  };

  const visit = (node) => {
    checkCopy(node);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = new Map();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(), attribute.initializer);
      }
      checkControl(node, describe(node.tagName.getText(), attributes.get("as"), true), attributes);
    }
    if (ts.isCallExpression(node) && isCreateElement(node.expression) && node.arguments.length > 0) {
      const [first, props] = node.arguments;
      const tags = intrinsicCandidates(first);
      const control =
        ts.isIdentifier(first) || ts.isPropertyAccessExpression(first)
          ? describe(first.getText(), undefined, false)
          : description({ tags, display: tags.join("|") || first.getText() });
      checkControl(node, control, objectAttributes(props));
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text.startsWith("data-ouro") &&
      !isCreateElementProps(node.parent)
    ) {
      add("data-ouro-attr", node, "object");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(?:set|toggle)Attribute$/.test(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith("data-ouro")
    ) {
      add("data-ouro-attr", node, "setAttribute");
    }
    const built = indexBuilt(node);
    const render = built && enclosingRender(node);
    if (render) {
      // Counted where it is written; an index is not a control, so the component around it stays clean.
      offenders.push({ category: "render-index", fingerprint: [file, render, "render-index", built, assignedName(node)].join("::"), file, line: lineOf(node) });
    }
    // Counted where it is written; an animation is not a control, so the component around it stays clean.
    const addLayout = (tag) => offenders.push({ category: "layout-animation", fingerprint: [file, componentName(node), "layout-animation", tag, ""].join("::"), file, line: lineOf(node) });
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const property = styleProperty(node);
      if (property && STYLE_TRANSITION.test(property)) {
        const found = layoutTransitionProperty(node.text, { list: /Property$/.test(property) });
        if (found) addLayout(`style.${property}:${found}`);
      }
      for (const token of node.text.split(/\s+/)) {
        if (token && layoutAnimationClass(token)) addLayout(token);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "animate" && node.arguments[0]) {
      const found = layoutKeyframe(node.arguments[0]);
      if (found) addLayout(`animate():${found}`);
    }
    if (ts.isJsxAttribute(node) && MOTION_ANIMATE.test(node.name.getText()) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const found = layoutKeyframe(node.initializer.expression);
      if (found) addLayout(`${node.name.getText()}:${found}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  offenders.push(...findGatedLoads(module));
  return { module, offenders, ownerHits, renders, uses };
}

// Pass two: which components contain an offender (directly or through a same-file component they
// render), then every imported use of one, and of a re-exported third-party control, at its call site.
function analyzeScripts(entries, paths, failureCopyAllow) {
  const modules = new Map(entries.map(({ file, source }) => [file, indexScript(file, source)]));
  const resolver = createResolver(modules, paths);
  const scans = [...modules.values()].map((module) => scanScript(module, resolver, failureCopyAllow));
  for (const scan of scans) scan.module.offending = new Set(scan.ownerHits);
  const calls = scans.flatMap(({ module, uses }) =>
    uses.map((use) => ({ module, use, resolved: resolver.resolveImport(module.file, use.head, use.members) })),
  );
  const categoryOf = ({ resolved }) => {
    if (resolved?.thirdParty) return "third-party-control";
    const definition = resolved?.definition;
    const offending = definition && resolved.rest.length === 0 && modules.get(definition.file).offending.has(definition.local);
    return offending ? "uses-hand-rolled-control" : undefined;
  };
  const mark = (offending, owners) => {
    const fresh = owners.filter((owner) => !offending.has(owner));
    for (const owner of fresh) offending.add(owner);
    return fresh.length > 0;
  };
  // To a fixed point across modules: a component that renders an offending component (from its own
  // file or an import) is offending too, so its callers count. Sets only grow, so cycles end.
  for (let grew = true; grew; ) {
    grew = false;
    for (const { module, renders } of scans) {
      for (const { owners, head } of renders) {
        if (module.offending.has(head)) grew = mark(module.offending, owners) || grew;
      }
    }
    for (const call of calls) {
      if (categoryOf(call)) grew = mark(call.module.offending, call.use.owners) || grew;
    }
  }
  const callSites = calls.flatMap((call) => {
    const category = categoryOf(call);
    if (!category) return [];
    const { module, use, resolved } = call;
    const tag = resolved.thirdParty ?? resolved.display;
    return [{ category, fingerprint: [module.file, use.component, category, tag, use.props].join("::"), file: module.file, line: use.line }];
  });
  return [...scans.flatMap(({ offenders }) => offenders), ...callSites];
}

function scanStylesheet(file, source, hook = ANY_HOOK) {
  const offenders = [];
  const add = (node, scope, context) => {
    offenders.push({
      category: "control-state-style",
      fingerprint: [file, "(stylesheet)", "control-state-style", scope, context.join(" ")].join("::"),
      file,
      line: node.source.start.line,
    });
  };
  // Counted where it is written, like a spinner: a stylesheet animation is not a control.
  const addLayout = (node, scope, what) => {
    offenders.push({
      category: "layout-animation",
      fingerprint: [file, "(stylesheet)", "layout-animation", scope, what].join("::"),
      file,
      line: node.source.start.line,
    });
  };
  const ancestors = (node) => {
    const rules = [];
    const atRules = [];
    for (let current = node.parent; current.type !== "root"; current = current.parent) {
      if (current.type === "rule") rules.unshift(current.selector.replace(/\s+/g, " "));
      if (current.type === "atrule") atRules.unshift(`@${current.name} ${current.params}`);
    }
    return { rules, atRules };
  };

  const root = postcss.parse(source, { from: file });
  root.walk((node) => {
    const { rules, atRules } = ancestors(node);
    if (node.type === "rule") {
      for (const selector of node.selectors) {
        const scope = [...rules, selector.replace(/\s+/g, " ")].join(" ");
        if (hook.test(scope) && STATE_SELECTOR.test(selector)) add(node, scope, atRules);
      }
    }
    if (node.type === "atrule" && node.name === "apply") {
      const scope = rules.join(" ");
      if (hook.test(scope) && hasControlStateClass([node.params])) add(node, scope, [...atRules, "@apply"]);
      for (const token of node.params.split(/\s+/)) {
        const found = token && layoutAnimationClass(token);
        if (found) addLayout(node, scope, `@apply ${token}`);
      }
    }
    if (node.type === "decl" && RADIUS_DECLARATION.test(node.prop) && !themedRadius(node.value) && !ROUND_PART_MARKER.test(rules.join(" "))) {
      const scope = rules.join(" ");
      offenders.push({
        category: "hand-drawn-corner",
        fingerprint: [file, "(stylesheet)", "hand-drawn-corner", scope, node.prop].join("::"),
        file,
        line: node.source.start.line,
      });
    }
    if (node.type === "decl" && /^(?:-webkit-)?transition(?:-property)?$/i.test(node.prop)) {
      const found = layoutTransitionProperty(node.value, { list: /property$/i.test(node.prop) });
      if (found) addLayout(node, rules.join(" "), `${node.prop}: ${found}`);
    }
    if (node.type === "atrule" && /keyframes$/i.test(node.name)) {
      let found;
      node.walkDecls((decl) => {
        if (!found && LAYOUT_PROPERTY.test(decl.prop.toLowerCase())) found = decl.prop.toLowerCase();
      });
      if (found) addLayout(node, `@${node.name} ${node.params}`, found);
    }
  });
  return offenders;
}

/**
 * The paths in tsconfig's `compilerOptions.paths` (`{ "~/*": ["./app/*"] }`), or none.
 *
 * @claim "The paths in tsconfig's" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::call sites > loads tsconfig paths, tolerating a missing or path-less tsconfig)
 */
export function loadPaths(root, readFile = defaultDeps.readFile) {
  let text;
  try {
    text = readFile(path.join(root, "tsconfig.json"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return ts.parseConfigFileTextToJson("tsconfig.json", text).config?.compilerOptions?.paths ?? {};
}

/**
 * The offenders in one file's source, in source order. `file` is relative to the repository. Its
 * imports are not resolved to other files, so call sites into other modules are not counted.
 */
export function findOffendersInSource(file, source, { paths = {}, hook = ANY_HOOK, failureCopyAllow = [] } = {}) {
  return file.endsWith(".css") ? scanStylesheet(file, source, hook) : analyzeScripts([{ file, source }], paths, failureCopyAllow);
}

/** The offenders in these files (relative to `root`, or absolute), sorted by file, line and fingerprint. */
export function findOffenders(
  files,
  { root = process.cwd(), readFile = defaultDeps.readFile, paths = loadPaths(root, readFile), hook = ANY_HOOK, failureCopyAllow = [] } = {},
) {
  const entries = files
    .map((file) => (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join("/"))
    .map((file) => ({ file, source: readFile(path.join(root, file)) }));
  return [
    ...entries.filter(({ file }) => file.endsWith(".css")).flatMap(({ file, source }) => scanStylesheet(file, source, hook)),
    ...analyzeScripts(entries.filter(({ file }) => !file.endsWith(".css")), paths, failureCopyAllow),
  ].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.fingerprint.localeCompare(b.fingerprint),
  );
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function countFingerprints(offenders) {
  const counts = {};
  for (const fingerprint of offenders.map((offender) => offender.fingerprint).sort(byText)) {
    counts[fingerprint] = (counts[fingerprint] ?? 0) + 1;
  }
  return counts;
}

/** The baseline file: fingerprint counts, and this pull request's allowed regressions with their reasons. */
export function serializeBaseline(offenders, allowedRegressions = []) {
  const allowed = [...allowedRegressions].sort((a, b) => byText(a.fingerprint, b.fingerprint));
  const offenderCounts = countFingerprints(offenders);
  const body = allowed.length > 0 ? { allowedRegressions: allowed, offenders: offenderCounts } : { offenders: offenderCounts };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** The fingerprints the scan has more of (added) or fewer of (removed) than the baseline counts. */
export function compareWithBaseline(offenders, baseline) {
  const actual = countFingerprints(offenders);
  const fingerprints = [...new Set([...Object.keys(actual), ...Object.keys(baseline)])].sort();
  const added = [];
  const removed = [];
  for (const fingerprint of fingerprints) {
    const difference = (actual[fingerprint] ?? 0) - (baseline[fingerprint] ?? 0);
    if (difference > 0) {
      const at = offenders
        .filter((offender) => offender.fingerprint === fingerprint)
        .map((offender) => `${offender.file}:${offender.line}`);
      added.push({ fingerprint, count: difference, at });
    }
    if (difference < 0) removed.push({ fingerprint, count: -difference });
  }
  return { added, removed };
}

// What a fingerprint keeps when code moves: its category, its tag (without the defining file's
// path, so a call site keeps the name of the component it uses) and its props with non-literal
// values blanked. `sameCallSite` also blanks a call site's component, for a swap in place.
function moveKey(fingerprint, { sameCallSite = false } = {}) {
  const parts = fingerprint.split("::");
  const tag = sameCallSite ? "" : parts.slice(3, -1).join("::").replace(/^[^#]*#/, "#");
  let depth = 0;
  let props = "";
  for (const char of parts.at(-1)) {
    if (char === "{" && depth === 0) props += "{}";
    if (char === "{") depth += 1;
    if (depth === 0) props += char;
    if (char === "}") depth -= 1;
  }
  return [parts[2], tag, props].join("::");
}

/**
 * The fingerprints the scan has more of than `baseline` counts, after pairing each added
 * fingerprint one-to-one with a removed one of the same category, tag and literal props that is
 * in the same file (a renamed component) or the same component (a moved file): a move, which is
 * neutral. A call site that swaps the component it uses (`<Link>` to `<NiceLink>`) pairs only in
 * the same file and the same component. A fix elsewhere never pays for a new control.
 * @claim "A fix elsewhere never pays for a new control" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::the ratchet against real changes > a fix in one component does not pay for a new control in another (the trade))
 * @claim "The fingerprints the scan has more of than" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::findRegressions: moves are neutral > pairs a renamed component and changed non-literal props, but not changed literal props)
 * @claim "The fingerprints the scan has more of than" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::findRegressions: moves are neutral > pairs a moved file)
 * @claim "The fingerprints the scan has more of than" scripts/kits/source-rules.test.mjs verify:testExists(scripts/kits/source-rules.test.mjs::findRegressions: moves are neutral > pairs only within the same file or the same component)
 */
export function findRegressions(offenders, baseline) {
  const { added, removed } = compareWithBaseline(offenders, baseline);
  const units = removed.flatMap(({ fingerprint, count }) => {
    const [file, component] = fingerprint.split("::");
    const key = moveKey(fingerprint);
    const swapKey = moveKey(fingerprint, { sameCallSite: true });
    return Array.from({ length: count }, () => ({ fingerprint, file, component, key, swapKey, used: false }));
  });
  const regressions = [];
  const moves = [];
  for (const entry of added) {
    const [file, component, category] = entry.fingerprint.split("::");
    const key = moveKey(entry.fingerprint);
    const swapKey = moveKey(entry.fingerprint, { sameCallSite: true });
    const open = (predicate) => units.find((unit) => !unit.used && predicate(unit));
    let count = entry.count;
    for (; count > 0; count -= 1) {
      const match =
        open((unit) => unit.key === key && unit.file === file) ??
        open((unit) => unit.key === key && unit.component === component) ??
        (category === "uses-hand-rolled-control"
          ? open((unit) => unit.swapKey === swapKey && unit.file === file && unit.component === component)
          : undefined);
      if (!match) break;
      match.used = true;
      moves.push({ from: match.fingerprint, to: entry.fingerprint });
    }
    if (count > 0) regressions.push({ ...entry, count });
  }
  return { regressions, moves };
}

export function formatComparison({ added, removed }) {
  return [
    ...added.map(({ fingerprint, count, at }) => {
      const message = messageFor(fingerprint);
      return message
        ? `${message.headline}: ${fingerprint} (+${count}) at ${at.join(", ")}. ${message.fix}`
        : `New hand-rolled control: ${fingerprint} (+${count}) at ${at.join(", ")}. Use an Ouro component instead (add the missing one to Ouro UI first).`;
    }),
    ...removed.map(
      ({ fingerprint, count }) => `Fixed: ${fingerprint} (-${count}); remove it from the baseline: ${UPDATE_COMMAND}`,
    ),
  ];
}

export const defaultDeps = {
  readFile: (file) => readFileSync(file, "utf8"),
  readdir: (directory) => readdirSync(directory, { recursive: true }),
  writeFile: (file, text) => writeFileSync(file, text),
  // A file at a git ref (or a folder's listing, for a path ending in "/"), by its path from `root`,
  // or undefined when that commit has none. `./` keeps the path relative to `root` when the app sits
  // below the repository root (apps/web/); without it git reads it from the repository root.
  gitShow: (root, ref, file) => {
    const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
      throw new Error(`ouro-source-rules: unknown base ref ${ref}`);
    }
    const shown = git(["show", `${ref}:./${file}`]);
    return shown.status === 0 ? shown.stdout : undefined;
  },
};

export function defaultExit(code) {
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { write: false, reason: undefined, base: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    if (argv[index] === "--write-baseline") {
      options.write = true;
    } else if (argv[index] === "--allow-regression" && hasValue) {
      options.reason = next;
      index += 1;
    } else if (argv[index] === "--base" && hasValue) {
      options.base = next;
      index += 1;
    } else {
      return undefined;
    }
  }
  return options;
}

function parseBaseline(text) {
  const { offenders, allowedRegressions = [] } = JSON.parse(text);
  return { offenders, allowedRegressions };
}

function readBaseline(file, readFile) {
  try {
    return parseBaseline(readFile(file));
  } catch (error) {
    // No baseline yet: the app is adopting the rule, and its first write records where it starts.
    if (error?.code === "ENOENT") return { offenders: {}, allowedRegressions: [], first: true };
    throw error;
  }
}

const hasReason = (reason) => typeof reason === "string" && reason.trim() !== "";
const entryKey = ({ fingerprint, reason }) => `${fingerprint}\u0000${reason}`;

export function main(argv, deps) {
  const { root, io, exit, readFile, readdir, writeFile, gitShow } = {
    root: process.cwd(),
    io: console,
    exit: defaultExit,
    ...defaultDeps,
    ...deps,
  };
  const options = parseArgs(argv);
  if (!options) {
    io.error(USAGE);
    exit(1);
    return;
  }

  const config = loadConfig(root, { readFile, readdir });
  const files = listSourceFiles(root, config, readdir);
  const offenders = findOffenders(files, { root, readFile, hook: config.hook, failureCopyAllow: config.failureCopyAllow });
  const baselineFile = path.join(root, config.baseline);
  const committed = readBaseline(baselineFile, readFile);
  // The base's own settings name its baseline, so moving the baseline in a pull request cannot hide
  // it, and they are what the scan may not narrow.
  const baseConfig = options.base === undefined ? undefined : loadConfigAt(root, options.base, gitShow);
  const baseText = baseConfig === undefined ? undefined : gitShow(root, options.base, baseConfig.baseline);
  const base = baseText === undefined ? undefined : parseBaseline(baseText);
  const changes = base ? narrowedSettings(baseConfig, config) : [];

  if (options.write) {
    // Against the base ref's baseline when there is one, keeping this pull request's earlier
    // reasons (entries not already on the base, for a rise no larger than they allowed). Otherwise
    // against the committed baseline, dropping every earlier entry. An entry is one pull request's.
    const { regressions, moves } = findRegressions(offenders, (base ?? committed).offenders);
    const spent = new Set((base?.allowedRegressions ?? []).map(entryKey));
    const earlier = new Map(
      (base ? committed.allowedRegressions : [])
        .filter((entry) => !spent.has(entryKey(entry)))
        .map((entry) => [entry.fingerprint, entry]),
    );
    const explain = ({ fingerprint, count }) => {
      const prior = earlier.get(fingerprint);
      const reason = prior?.count >= count && hasReason(prior.reason) ? prior.reason : options.reason;
      return { fingerprint, count, reason };
    };
    const allowed = regressions.map(explain);
    const allowedSettings = changes.map(({ fingerprint }) => explain({ fingerprint, count: 1 }));
    // The first baseline records where the app starts; every later write may only shrink it. A base
    // ref with the settings or a baseline has already started.
    const first = committed.first === true && (baseConfig === undefined || (!baseConfig.found && !base));
    const unexplained = first ? [] : regressions.filter((_, index) => !hasReason(allowed[index].reason));
    const unexplainedSettings = changes.filter((_, index) => !hasReason(allowedSettings[index].reason));
    if (unexplained.length > 0 || unexplainedSettings.length > 0) {
      for (const line of formatComparison({ added: unexplained, removed: [] })) io.error(line);
      for (const { change } of unexplainedSettings) io.error(`Settings change against ${options.base}: ${CONFIG_PATH} ${change}.`);
      if (unexplained.length > 0) {
        io.error(
          "ouro-source-rules: the baseline only shrinks. Replace the new controls with Ouro components, or pass --allow-regression <reason> for review.",
        );
      }
      if (unexplainedSettings.length > 0) {
        io.error(
          "ouro-source-rules: the settings may only widen the scan against the base. Revert the change, or pass --allow-regression <reason> for review.",
        );
      }
      exit(1);
      return;
    }
    // With no baseline at the base ref nothing ratchets, so nothing is recorded.
    const recorded = first || (options.base !== undefined && !base) ? [] : [...allowedSettings, ...allowed];
    const unrecorded = first
      ? "; it is the first baseline, so it records where the app starts"
      : options.base !== undefined && !base
        ? `; ${options.base} has no baseline, so nothing is recorded to ratchet against`
        : "";
    writeFile(baselineFile, serializeBaseline(offenders, recorded));
    io.log(
      `ouro-source-rules: wrote ${config.baseline} with ${offenders.length} offender(s), ${moves.length} move(s) and ${recorded.length} allowed regression(s)${unrecorded}.`,
    );
    return;
  }

  const lines = formatComparison(compareWithBaseline(offenders, committed.offenders));
  const notes = [];
  if (options.base !== undefined && !base) {
    notes.push(`ouro-source-rules: ${options.base} has no baseline; nothing to ratchet against.`);
  }
  if (base) {
    const { regressions, moves } = findRegressions(offenders, base.offenders);
    // An entry already on the base was spent by an earlier pull request: it is never honoured
    // again, so it cannot allow anything, and the next write drops it.
    const spent = new Set(base.allowedRegressions.map(entryKey));
    const stale = committed.allowedRegressions.filter((entry) => spent.has(entryKey(entry))).length;
    if (stale > 0) {
      notes.push(
        `ouro-source-rules: ${stale} stale allowed regression(s) from an earlier pull request are ignored; the next --write-baseline drops them.`,
      );
    }
    const fresh = new Map(
      committed.allowedRegressions
        .filter((entry) => !spent.has(entryKey(entry)) && hasReason(entry.reason))
        .map((entry) => [entry.fingerprint, entry]),
    );
    let allowedCount = 0;
    for (const { fingerprint, change } of changes) {
      if (fresh.get(fingerprint)?.count >= 1) {
        allowedCount += 1;
        continue;
      }
      lines.push(
        `Settings change against ${options.base}: ${CONFIG_PATH} ${change}. Revert it, or record why: ${UPDATE_COMMAND} --base ${options.base} --allow-regression "<reason>"`,
      );
    }
    for (const { fingerprint, count, at } of regressions) {
      const entry = fresh.get(fingerprint);
      if (entry?.count >= count) {
        allowedCount += 1;
        continue;
      }
      const permits = entry ? `, but its allowed regression permits ${entry.count ?? 0}` : "";
      lines.push(
        `Regression against ${options.base}: ${fingerprint} (+${count}) at ${at.join(", ")}${permits}. ${messageFor(fingerprint)?.fix.replace(/\.$/, ";") ?? "Use an Ouro component instead,"} or record why: ${UPDATE_COMMAND} --base ${options.base} --allow-regression "<reason>"`,
      );
    }
    notes.push(`ouro-source-rules: ratchet against ${options.base}: ${allowedCount} allowed regression(s), ${moves.length} move(s).`);
  }
  for (const line of lines) io.error(line);
  if (lines.length > 0) {
    exit(1);
    return;
  }
  io.log(`ouro-source-rules: ${files.length} file(s), ${offenders.length} offender(s), all in the baseline.`);
  for (const note of notes) io.log(note);
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  try {
    runMain(process.argv.slice(2));
  } catch (error) {
    onError(error);
  }
  return true;
}

runCliIfEntry();
