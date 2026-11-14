// Ouro HX upgrades run the real CLI only in Actions, never inherited Mac providers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The consumer source the v1.3.62 install starts from: main after the v1.3.33 adoption (#704).
const acceptedHead = "5ff91f541a16fe9dae77f87523b138386cd90cd8";
const tag = "v1.3.62";
const tagCommit = "1732effe5ad16db10816ae866b16bf4ddf35f2d3";
// Every installed registry item, plus the v1.2.0 items Spoonjoy's screens now compose (SkipLink,
// TabBar, RouteProgress, ColorSchemeToggle, PageHeader, CopyButton, CodeBlock, Timer, TimerTray,
// Celebrate, ChoiceCard, ImageCropper, ImageField, ShareButton, SyncStatus, LocalDate,
// RelativeTime, InstallPrompt), lib-claims, the ouro-census and ouro-source-rules kits, the
// ax-xray AX conformance checker (v1.3.62), and the dependencies they bring.
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
  "toggle-group-tests", "toggle-tests", "tooltip", "tooltip-tests", "ax-xray",
];
// Hashes of the tag's registry sources (the public build serves them byte for byte), never
// regenerated from local edits: every file the CLI writes for these items and their dependencies.
// test/components/ui/design-system-hygiene.test.ts pins the installed files to the same map on
// every pull request.
const installed = JSON.parse(readFileSync(".github/ouro-hx-installed.json", "utf8"));
assert.equal(installed.tag, tag);
assert.equal(installed.tagCommit, tagCommit);
const expected = installed.files;
// Paths v1.3.62 adds to the v1.3.33 install (ax-xray's command, help and output modules, and
// ToggleGroup's layout test); every other path in this patch updates an existing file.
const expectedNew = [
  "app/components/ouro/toggle/toggle-group.layout.test.tsx",
  "app/lib/ouro/ax/cli.ts",
  "app/lib/ouro/ax/command.ts",
  "app/lib/ouro/ax/help.ts",
  "app/lib/ouro/ax/output.ts",
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
