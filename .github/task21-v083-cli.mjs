// Ouro HX upgrades run the real CLI only in Actions, never inherited Mac providers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Preserved adoption source after integrating recipe drafts and the qualified main prerequisite.
const acceptedHead = "b7aa592260c8fc736ff076bb3ec46c48a3c8d1c7";
const tag = "v1.2.8";
const tagCommit = "cef017af04309b1102c869e32818b432ec5d8a6e";
// Every installed registry item, plus the v1.2.0 items Spoonjoy's screens now compose (SkipLink,
// TabBar, RouteProgress, ColorSchemeToggle, PageHeader, CopyButton, CodeBlock, Timer, TimerTray,
// Celebrate, ChoiceCard, ImageCropper, ImageField, ShareButton, SyncStatus, LocalDate,
// RelativeTime, InstallPrompt), lib-claims, the ouro-census and ouro-source-rules kits, and the
// dependencies they bring.
const items = [
  "alert", "alert-tests", "aspect-ratio", "aspect-ratio-tests", "auth-layout", "auth-layout-tests",
  "avatar", "avatar-tests", "badge", "badge-tests", "breadcrumb", "breadcrumb-tests", "button",
  "button-tests", "card", "card-tests", "celebrate", "celebrate-tests", "checkbox",
  "checkbox-group", "checkbox-group-tests", "checkbox-tests", "checklist", "checklist-tests",
  "choice-card", "choice-card-tests", "code-block", "code-block-tests", "collapsible",
  "collapsible-tests", "color-scheme-toggle", "color-scheme-toggle-tests", "combobox",
  "combobox-tests", "confirm-dialog", "confirm-dialog-tests", "copy-button", "copy-button-tests",
  "description-list", "description-list-tests", "dialog", "dialog-tests", "empty", "empty-tests",
  "field", "field-tests", "fieldset", "fieldset-tests", "file-field", "file-field-tests", "form",
  "form-tests", "heading", "heading-tests", "image-cropper", "image-cropper-tests", "image-field",
  "image-field-tests", "inspector", "inspector-tests", "install-prompt", "install-prompt-tests",
  "item", "item-group", "item-group-tests", "item-tests", "kbd", "kbd-tests", "lib-announce",
  "lib-announce-tests", "lib-appearance-hints", "lib-appearance-hints-tests", "lib-claims",
  "lib-claims-tests", "lib-class-name-check", "lib-class-name-check-tests", "lib-cn",
  "lib-cn-tests", "lib-color-scheme", "lib-color-scheme-script", "lib-color-scheme-script-tests",
  "lib-color-scheme-tests", "lib-control-ref", "lib-control-ref-tests", "lib-current-path",
  "lib-current-path-tests", "lib-dev", "lib-dev-tests", "lib-env", "lib-feedback",
  "lib-feedback-tests", "lib-floating", "lib-floating-tests", "lib-focus-handoff",
  "lib-focus-handoff-tests", "lib-form-answer", "lib-form-answer-tests", "lib-key-shortcuts",
  "lib-key-shortcuts-tests", "lib-last-input", "lib-last-input-tests", "lib-open-mode",
  "lib-ouro-provider", "lib-ouro-provider-tests", "lib-refs", "lib-router-link",
  "lib-server-element", "lib-server-element-tests", "lib-share", "lib-share-tests", "lib-spring",
  "lib-spring-tests", "lib-stretched-link", "lib-toast", "lib-tones", "lib-touch-target",
  "lib-use-backdrop-anchor", "lib-use-dev-messages", "lib-use-dev-messages-tests", "lib-use-drag",
  "lib-use-drag-tests", "lib-use-field", "lib-use-install-prompt", "lib-use-install-prompt-tests",
  "lib-use-keyboard-scrollable", "lib-use-keyboard-scrollable-tests", "lib-use-media-query",
  "lib-use-media-query-tests", "lib-use-ouro", "lib-use-sheet-presentation",
  "lib-use-sheet-presentation-tests", "lib-use-timer", "lib-use-timer-tests", "link", "link-tests",
  "local-date", "local-date-tests", "menu", "menu-tests", "native-select", "native-select-tests",
  "navbar", "navbar-tests", "navigation-menu", "navigation-menu-tests", "number-field",
  "number-field-tests", "ouro-census", "ouro-source-rules", "ouro-testing", "page-header",
  "page-header-tests", "pagination", "pagination-tests", "popover", "popover-tests", "radio-group",
  "radio-group-tests", "relative-time", "relative-time-tests", "reorderable", "reorderable-tests",
  "route-progress", "route-progress-tests", "scroll-area", "scroll-area-tests", "segmented-control",
  "segmented-control-tests", "select", "select-tests", "separator", "separator-tests",
  "share-button", "share-button-tests", "sheet", "sheet-tests", "show-more", "show-more-tests",
  "skip-link", "skip-link-tests", "slider", "slider-tests", "spinner", "spinner-tests",
  "swipe-actions", "swipe-actions-tests", "switch", "switch-tests", "sync-status",
  "sync-status-tests", "tab-bar", "tab-bar-tests", "tabs", "tabs-tests", "text", "text-area",
  "text-area-tests", "text-field", "text-field-tests", "text-tests", "timer", "timer-tests",
  "timer-tray", "timer-tray-tests", "toaster", "toaster-tests", "toggle", "toggle-group",
  "toggle-group-tests", "toggle-tests", "tooltip", "tooltip-tests",
];
// Hashes of the tag's registry sources (the public build serves them byte for byte), never
// regenerated from local edits: every file the CLI writes for these items and their dependencies.
// test/components/ui/design-system-hygiene.test.ts pins the installed files to the same map on
// every pull request.
const installed = JSON.parse(readFileSync(".github/ouro-hx-installed.json", "utf8"));
assert.equal(installed.tag, tag);
assert.equal(installed.tagCommit, tagCommit);
const expected = installed.files;
// Paths introduced by the initial v1.2.0 CLI run, by v1.2.5 (portal-container and the axe
// helper's own test) and by v1.2.8 (the shared axe-core version check); every other path in this
// patch updates an existing file.
const expectedNew = [
  "app/components/ouro/breadcrumb/breadcrumb.stories.tsx",
  "app/components/ouro/breadcrumb/breadcrumb.test-d.ts",
  "app/components/ouro/breadcrumb/breadcrumb.test.tsx",
  "app/components/ouro/breadcrumb/breadcrumb.touch.test.tsx",
  "app/components/ouro/breadcrumb/breadcrumb.tsx",
  "app/components/ouro/celebrate/celebrate.stories.tsx",
  "app/components/ouro/celebrate/celebrate.test-d.ts",
  "app/components/ouro/celebrate/celebrate.test.tsx",
  "app/components/ouro/celebrate/celebrate.tsx",
  "app/components/ouro/choice-card/choice-card.stories.tsx",
  "app/components/ouro/choice-card/choice-card.test-d.ts",
  "app/components/ouro/choice-card/choice-card.test.tsx",
  "app/components/ouro/choice-card/choice-card.touch.test.tsx",
  "app/components/ouro/choice-card/choice-card.tsx",
  "app/components/ouro/code-block/code-block.stories.tsx",
  "app/components/ouro/code-block/code-block.test-d.ts",
  "app/components/ouro/code-block/code-block.test.tsx",
  "app/components/ouro/code-block/code-block.tsx",
  "app/components/ouro/color-scheme-toggle/color-scheme-toggle.stories.tsx",
  "app/components/ouro/color-scheme-toggle/color-scheme-toggle.test-d.ts",
  "app/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx",
  "app/components/ouro/color-scheme-toggle/color-scheme-toggle.touch.test.tsx",
  "app/components/ouro/color-scheme-toggle/color-scheme-toggle.tsx",
  "app/components/ouro/copy-button/copy-button.stories.tsx",
  "app/components/ouro/copy-button/copy-button.test-d.ts",
  "app/components/ouro/copy-button/copy-button.test.tsx",
  "app/components/ouro/copy-button/copy-button.touch.test.tsx",
  "app/components/ouro/copy-button/copy-button.tsx",
  "app/components/ouro/image-cropper/image-cropper-styles.ts",
  "app/components/ouro/image-cropper/image-cropper.stories.tsx",
  "app/components/ouro/image-cropper/image-cropper.test-d.ts",
  "app/components/ouro/image-cropper/image-cropper.test.tsx",
  "app/components/ouro/image-cropper/image-cropper.touch.test.tsx",
  "app/components/ouro/image-cropper/image-cropper.tsx",
  "app/components/ouro/image-field/image-field.stories.tsx",
  "app/components/ouro/image-field/image-field.test-d.ts",
  "app/components/ouro/image-field/image-field.test.tsx",
  "app/components/ouro/image-field/image-field.touch.test.tsx",
  "app/components/ouro/image-field/image-field.tsx",
  "app/components/ouro/install-prompt/install-prompt.focus.test.tsx",
  "app/components/ouro/install-prompt/install-prompt.stories.tsx",
  "app/components/ouro/install-prompt/install-prompt.test-d.ts",
  "app/components/ouro/install-prompt/install-prompt.test.tsx",
  "app/components/ouro/install-prompt/install-prompt.touch.test.tsx",
  "app/components/ouro/install-prompt/install-prompt.tsx",
  "app/components/ouro/local-date/local-date-styles.ts",
  "app/components/ouro/local-date/local-date.stories.tsx",
  "app/components/ouro/local-date/local-date.test-d.ts",
  "app/components/ouro/local-date/local-date.test.tsx",
  "app/components/ouro/local-date/local-date.tsx",
  "app/components/ouro/page-header/page-header.stories.tsx",
  "app/components/ouro/page-header/page-header.test-d.ts",
  "app/components/ouro/page-header/page-header.test.tsx",
  "app/components/ouro/page-header/page-header.tsx",
  "app/components/ouro/relative-time/relative-time-styles.ts",
  "app/components/ouro/relative-time/relative-time.stories.tsx",
  "app/components/ouro/relative-time/relative-time.test-d.ts",
  "app/components/ouro/relative-time/relative-time.test.tsx",
  "app/components/ouro/relative-time/relative-time.tsx",
  "app/components/ouro/route-progress/route-progress.stories.tsx",
  "app/components/ouro/route-progress/route-progress.test-d.ts",
  "app/components/ouro/route-progress/route-progress.test.tsx",
  "app/components/ouro/route-progress/route-progress.tsx",
  "app/components/ouro/share-button/share-button.stories.tsx",
  "app/components/ouro/share-button/share-button.test-d.ts",
  "app/components/ouro/share-button/share-button.test.tsx",
  "app/components/ouro/share-button/share-button.touch.test.tsx",
  "app/components/ouro/share-button/share-button.tsx",
  "app/components/ouro/skip-link/skip-link.stories.tsx",
  "app/components/ouro/skip-link/skip-link.test-d.ts",
  "app/components/ouro/skip-link/skip-link.test.tsx",
  "app/components/ouro/skip-link/skip-link.touch.test.tsx",
  "app/components/ouro/skip-link/skip-link.tsx",
  "app/components/ouro/slider/slider-styles.ts",
  "app/components/ouro/slider/slider.stories.tsx",
  "app/components/ouro/slider/slider.test-d.ts",
  "app/components/ouro/slider/slider.test.tsx",
  "app/components/ouro/slider/slider.touch.test.tsx",
  "app/components/ouro/slider/slider.tsx",
  "app/components/ouro/sync-status/sync-status.stories.tsx",
  "app/components/ouro/sync-status/sync-status.test-d.ts",
  "app/components/ouro/sync-status/sync-status.test.tsx",
  "app/components/ouro/sync-status/sync-status.touch.test.tsx",
  "app/components/ouro/sync-status/sync-status.tsx",
  "app/components/ouro/tab-bar/tab-bar-styles.ts",
  "app/components/ouro/tab-bar/tab-bar.stories.tsx",
  "app/components/ouro/tab-bar/tab-bar.test-d.ts",
  "app/components/ouro/tab-bar/tab-bar.test.tsx",
  "app/components/ouro/tab-bar/tab-bar.touch.test.tsx",
  "app/components/ouro/tab-bar/tab-bar.tsx",
  "app/components/ouro/timer/timer-styles.ts",
  "app/components/ouro/timer/timer-tray.stories.tsx",
  "app/components/ouro/timer/timer-tray.test-d.ts",
  "app/components/ouro/timer/timer-tray.test.tsx",
  "app/components/ouro/timer/timer-tray.tsx",
  "app/components/ouro/timer/timer.stories.tsx",
  "app/components/ouro/timer/timer.test-d.ts",
  "app/components/ouro/timer/timer.test.tsx",
  "app/components/ouro/timer/timer.touch.test.tsx",
  "app/components/ouro/timer/timer.tsx",
  "app/lib/ouro/claims-check.mjs",
  "app/lib/ouro/claims.test.ts",
  "app/lib/ouro/claims.ts",
  "app/lib/ouro/color-scheme-script.test.ts",
  "app/lib/ouro/color-scheme-script.ts",
  "app/lib/ouro/color-scheme.test.tsx",
  "app/lib/ouro/color-scheme.ts",
  "app/lib/ouro/feedback.test.ts",
  "app/lib/ouro/feedback.ts",
  "app/lib/ouro/focus-handoff.test.tsx",
  "app/lib/ouro/focus-handoff.ts",
  "app/lib/ouro/portal-container.test.tsx",
  "app/lib/ouro/portal-container.ts",
  "app/lib/ouro/share.test.ts",
  "app/lib/ouro/share.ts",
  "app/lib/ouro/testing/axe-version.ts",
  "app/lib/ouro/testing/axe.test.ts",
  "app/lib/ouro/use-install-prompt.test.tsx",
  "app/lib/ouro/use-install-prompt.ts",
  "app/lib/ouro/use-timer.test.tsx",
  "app/lib/ouro/use-timer.ts",
  "e2e/ouro-census/census-axe-version.mjs",
  "e2e/ouro-census/census-collect.d.mts",
  "e2e/ouro-census/census-collect.mjs",
  "e2e/ouro-census/census-compare.mjs",
  "e2e/ouro-census/census-merge.mjs",
  "e2e/ouro-census/census-page.d.mts",
  "e2e/ouro-census/census-page.mjs",
  "e2e/ouro-census/census-update.mjs",
  "e2e/ouro-census/census.mjs",
  "e2e/ouro/breadcrumb.spec.ts",
  "e2e/ouro/celebrate.spec.ts",
  "e2e/ouro/choice-card.spec.ts",
  "e2e/ouro/code-block.spec.ts",
  "e2e/ouro/color-scheme-toggle.spec.ts",
  "e2e/ouro/copy-button.spec.ts",
  "e2e/ouro/image-cropper.spec.ts",
  "e2e/ouro/image-field.spec.ts",
  "e2e/ouro/install-prompt.spec.ts",
  "e2e/ouro/local-date.spec.ts",
  "e2e/ouro/page-header.spec.ts",
  "e2e/ouro/relative-time.spec.ts",
  "e2e/ouro/route-progress.spec.ts",
  "e2e/ouro/share-button.spec.ts",
  "e2e/ouro/skip-link.spec.ts",
  "e2e/ouro/slider.spec.ts",
  "e2e/ouro/sync-status.spec.ts",
  "e2e/ouro/tab-bar.spec.ts",
  "e2e/ouro/timer-tray.spec.ts",
  "e2e/ouro/timer.spec.ts",
  "scripts/ouro-source-rules.mjs",
].filter((file) => !existsSync(file));
const protectedPaths = [
  "app", "test", "e2e", "package.json", "pnpm-lock.yaml", "components.json",
  "vitest.config.ts", "vitest.ouro.config.ts", "playwright.ouro.config.ts",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalizedHash = (file) => existsSync(file) ? sha(readFileSync(file, "utf8")
  .replaceAll("~/components/ouro/", "@/registry/ouro/components/ouro/")
  .replaceAll("~/lib/ouro/", "@/registry/ouro/lib/ouro/")) : null;
const run = (name, args) => spawnSync(name, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const command = (name, args) => {
  const result = run(name, args);
  assert.equal(result.status, 0, `${name} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const hashes = () => Object.fromEntries(Object.keys(expected).map((file) => [file, normalizedHash(file)]));
const mode = process.argv[2];
assert.equal(process.env.GITHUB_ACTIONS, "true", "CI-only: do not run against inherited local providers");

// The binding holds on every push: the accepted head stays an ancestor of HEAD, and the commit
// that bound it (the last to change acceptedHead in this file) changed no consumer source.
assert.equal(run("git", ["merge-base", "--is-ancestor", acceptedHead, "HEAD"]).status, 0,
  `acceptedHead ${acceptedHead} must be an ancestor of HEAD`);
const bootstrapCommit = command("git", [
  "log", "-1", "--format=%H", "-G", "^const acceptedHead = ", "--", ".github/task21-v083-cli.mjs",
]).trim();
assert.equal(command("git", ["diff", "--name-only", acceptedHead, bootstrapCommit, "--", ...protectedPaths]), "",
  `Bootstrap commit ${bootstrapCommit} must preserve the gated consumer source of ${acceptedHead}`);

if (mode === "classify") {
  const current = hashes();
  const upgrade = Object.entries(expected).some(([file, hash]) => current[file] !== hash);
  appendFileSync(process.env.GITHUB_OUTPUT, `upgrade=${upgrade}\n`);
  console.log(JSON.stringify({ head: command("git", ["rev-parse", "HEAD"]).trim(), bootstrapCommit, tag, upgrade, current }));
} else {
  assert.ok(mode === "upgrade" || mode === "binding");
  const directory = join(process.env.RUNNER_TEMP, mode === "upgrade" ? "hx-v120-cli" : "hx-v120-strict");
  mkdirSync(directory, { recursive: true });
  const receipt = {
    head: command("git", ["rev-parse", "HEAD"]).trim(),
    tree: command("git", ["rev-parse", "HEAD^{tree}"]).trim(),
    acceptedHead, bootstrapCommit, tag, tagCommit, node: process.version,
    pnpm: command("pnpm", ["--version"]).trim(),
    packageSha256: sha(readFileSync("package.json")),
    lockSha256: sha(readFileSync("pnpm-lock.yaml")),
    before: hashes(),
  };
  writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
  if (mode === "upgrade") {
    assert.equal(command("git", ["status", "--porcelain"]), "");
    const originalLock = readFileSync("pnpm-lock.yaml");
    const originalPackage = readFileSync("package.json");
    const args = [
      "dlx", "shadcn@4.21.1", "add", ...items.map((item) => `ourostack/ouro-ui/${item}#${tag}`), "--yes", "--overwrite",
    ];
    receipt.commands = [];
    for (const dryRun of [true, false]) {
      const argv = [...args, ...(dryRun ? ["--dry-run"] : [])];
      const result = run("pnpm", argv);
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      writeFileSync(join(directory, dryRun ? "cli-preview.log" : "cli-install.log"),
        `${result.stdout ?? ""}${result.stderr ?? ""}`);
      receipt.commands.push({ executable: "pnpm", args: argv, exitCode: result.status });
      writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
      assert.equal(result.status, 0, "Actual pinned shadcn command must succeed");
    }
    // PM mirror/integrity churn is evidence, never an equivalent replacement lock.
    const pmLock = readFileSync("pnpm-lock.yaml");
    writeFileSync(join(directory, "pm-produced-pnpm-lock.yaml"), pmLock);
    writeFileSync(join(directory, "pm-produced.diff"), command("git", ["diff", "--binary"]));
    receipt.pmLockSha256 = sha(pmLock);
    assert.deepEqual(readFileSync("package.json"), originalPackage, "Unexpected dependency-field mutation");
    writeFileSync("pnpm-lock.yaml", originalLock);
    assert.equal(sha(readFileSync("pnpm-lock.yaml")), receipt.lockSha256);
    const untracked = command("git", ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean).sort();
    receipt.untracked = untracked;
    writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
    assert.deepEqual(untracked, [...expectedNew].sort(), "Only missing qualified installed paths may be new");
    if (untracked.length > 0) command("git", ["add", "--intent-to-add", "--", ...untracked]);
    const changed = command("git", ["diff", "--name-only"]).trim().split("\n").filter(Boolean).sort();
    receipt.changedPaths = changed;
    receipt.after = hashes();
    writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
    assert.deepEqual(changed.filter((file) => !(file in expected)), [], "Only qualified installed paths may change");
    // The patch is written before the comparison, so a mismatch can be read in the artifact.
    const patch = command("git", ["diff", "--binary", "HEAD"]);
    receipt.generatedPatchSha256 = sha(patch);
    writeFileSync(join(directory, "registry-generated.patch"), patch);
    assert.deepEqual(receipt.after, expected, "CLI output must match the qualified public tag");
    writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
  } else {
    // The census and the source rule are HX kits now (ouro-census, ouro-source-rules), pinned above
    // like every other installed file, so nothing in Spoonjoy copies HX's selectors any more.
    assert.deepEqual(receipt.before, expected, "Strict proof must consume the actual qualified CLI output");
  }
}
