import difflib
import hashlib
import json
from pathlib import Path
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


mode, upstream_name, app_name, evidence_name = sys.argv[1:]
upstream, app, evidence = map(Path, (upstream_name, app_name, evidence_name))
evidence.mkdir(parents=True, exist_ok=True)
helper = Path(__file__).resolve().parent
script = upstream / "scripts/install-test.sh"
if mode == "prepare":
    original = script.read_text()
    anchor = "\nnpx vitest run\n"
    assert original.count(anchor) == 1
    hook = f"""
python3 "{helper / 'number-press-proof.py'}" observe "$root" "$app" "{evidence}"
export NATIVE_PRESS_EVIDENCE="{evidence}"
set +e
NATIVE_PRESS_PHASE=full npx vitest run --reporter=verbose --reporter=json \\
  --reporter="{helper / 'number-press-reporter.mjs'}" --outputFile="{evidence}/full-tests.json"
full_status=$?
printf '%s\\n' "$full_status" > "{evidence}/full-status.txt"
for iteration in $(seq 1 5); do
  NATIVE_PRESS_PHASE="target-$iteration" npx vitest run src/components/ouro/number-field/number-field.test.tsx \\
    -t "shows a pressed color that differs from the hover color" \\
    --reporter=verbose --reporter=json --reporter="{helper / 'number-press-reporter.mjs'}" \\
    --outputFile="{evidence}/target-$iteration.json"
  printf '%s\\n' "$?" > "{evidence}/target-$iteration-status.txt"
done
set -e
test "$full_status" -eq 0
"""
    instrumented = original.replace(anchor, "\n" + hook)
    (evidence / "installer.original.sh").write_text(original)
    (evidence / "installer.diff").write_text("".join(difflib.unified_diff(
        original.splitlines(True), instrumented.splitlines(True), "original", "diagnostic",
    )))
    script.write_text(instrumented)
elif mode == "observe":
    target = app / "src/components/ouro/number-field/number-field.test.tsx"
    original = target.read_text()
    opening = '  it("shows a pressed color that differs from the hover color", async () => {\n'
    assert original.count(opening) == 1
    start = original.index(opening)
    ending = "  });\n});\n"
    assert original[start:].endswith(ending)
    block = original[start:]
    stepper_line = '    const stepper = page.getByRole("button", { name: "Increase", exact: true }).element();\n'
    assert block.count(stepper_line) == 1
    before, body = block.split(stepper_line)
    body = body.removesuffix(ending)
    # Preserve all original operations/assertions and the pointer-up finally.
    settled_body = body
    if "stepper.getAnimations()" not in body:
        settled_body = body.replace(
            "    const hovered = color();\n",
            '    await expect.poll(() => stepper.getAnimations().every(animation => animation.playState !== "running")).toBe(true);\n'
            '    const hovered = color();\n',
        ).replace(
            "    try {\n",
            '    try {\n'
            '      await expect.poll(() => stepper.getAnimations().every(animation => animation.playState !== "running")).toBe(true);\n'
            '      expect(stepper.matches(":active")).toBe(true);\n',
        )
    else:
        assert body.count("stepper.getAnimations()") == 2
        assert body.count('expect(stepper.matches(":active")).toBe(true)') == 1
    observed_body = settled_body.replace(
        "    const hovered = color();\n",
        '    snapshot("after-hover");\n    const hovered = color();\n',
    ).replace(
        '      await expect.poll(color).not.toBe(hovered);',
        '      snapshot("after-down");\n'
        '      await expect.poll(color).not.toBe(hovered);',
    ).replace(
        '      await commands.pointerPress({ action: "up" });',
        '      snapshot("before-up");\n      await commands.pointerPress({ action: "up" });\n      snapshot("after-up");',
    )
    observer = (helper / "number-press-observer.ts.txt").read_text()
    assert observer.count("__ORIGINAL_BODY__") == 1
    observer = observer.replace("__ORIGINAL_BODY__", "".join(
        "  " + line if line.strip() else line for line in observed_body.splitlines(True)
    ).rstrip("\n"))
    instrumented = original[:start] + before.replace("async ()", "async ({ annotate })") + stepper_line + observer + ending
    target.write_text(instrumented)
    (evidence / "number-field.original.tsx").write_text(original)
    (evidence / "number-field.observed.tsx").write_text(instrumented)
    (evidence / "number-field.diff").write_text("".join(difflib.unified_diff(
        original.splitlines(True), instrumented.splitlines(True), "installed", "observed",
    )))
    manifest = {}
    for name in [
        "src/index.css", "package.json", "vitest.config.ts",
        "src/components/ouro/number-field/number-field.tsx",
        "src/components/ouro/number-field/number-field-styles.ts",
        "src/lib/ouro/testing/commands.ts", "src/lib/ouro/testing/vitest.ts",
    ]:
        source = app / name
        assert source.is_file(), name
        manifest[name] = digest(source.read_bytes())
    (evidence / "binding.json").write_text(json.dumps({
        "upstream": "4f7439c40e91166c598f180bd0ebefe633c4a30f",
        "originalTest": digest(original.encode()), "observedTest": digest(instrumented.encode()),
        "installedFiles": manifest,
    }, indent=2) + "\n")
else:
    raise ValueError(mode)
