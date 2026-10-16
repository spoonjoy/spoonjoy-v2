import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "tailwindcss";
import postcss from "postcss";
import { viewportClass } from "../app/components/ouro/toast/toaster-styles.ts";
import { cn } from "../app/lib/ouro/cn.ts";
const viewportTokens = () => cn(viewportClass).split(/\s+/);

test("Toaster emits the original named-only spacing scale without requiring a universal token", async () => {
  const compiler = await compile("@theme { --spacing: initial; --spacing-4: 1rem; --spacing-6: 1.5rem; --spacing-90: 22.5rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportTokens(), "start-4", "end-4", "end-6", "bottom-6", "w-90"]));
  const values = new Map();
  css.walkDecls((decl) => values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]));
  for (const [originalProperty, viewportProperty, token] of [
    ["inset-inline-start", "--ouro-toaster-start", "--spacing-4"],
    ["inset-inline-end", "--ouro-toaster-end", "--spacing-4"],
    ["inset-inline-end", "--ouro-toaster-end", "--spacing-6"],
    ["bottom", "--ouro-toaster-bottom", "--spacing-6"],
    ["width", "--ouro-toaster-width", "--spacing-90"],
  ]) {
    assert.ok(values.get(originalProperty).includes(`var(${token})`), `original utility consumes ${token}`);
    assert.ok(values.get(viewportProperty)?.some((value) => value.includes(`var(${token}`)), `${viewportProperty} must still emit for ${token} when --spacing is absent`);
  }
});

test("Toaster omits unavailable responsive spacing in sparse and absent scales, preserving the phone fallback", async () => {
  const original = "fixed start-4 end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] outline-none sm:start-auto sm:end-6 sm:bottom-6 sm:w-90";
  const declarations = (css) => {
    const rows = [];
    postcss.parse(css).walkDecls((decl) => {
      let responsive = false;
      for (let parent = decl.parent; parent; parent = parent.parent) {
        if (parent.type === "atrule" && parent.name === "media") responsive = true;
      }
      rows.push({ property: decl.prop, value: decl.value, responsive });
    });
    return rows;
  };
  for (const named of [true, false]) {
    const theme = `@theme { --spacing: initial; ${named ? "--spacing-4: 1rem; --spacing-90: 22.5rem;" : ""} --breakpoint-sm: 40rem; } @tailwind utilities;`;
    const stock = declarations((await compile(theme)).build(original.split(/\s+/)));
    const candidate = declarations((await compile(theme)).build(viewportTokens()));
    for (const property of ["inset-inline-end", "bottom"]) {
      assert.deepEqual(stock.filter((row) => row.responsive && row.property === property), [], `08 omits unavailable sm ${property}`);
    }
    assert.ok(stock.some((row) => !row.responsive && row.property === "bottom" && row.value.includes("env(safe-area-inset-bottom)")));
    for (const property of ["--ouro-toaster-end", "--ouro-toaster-bottom"]) {
      assert.deepEqual(candidate.filter((row) => row.responsive && row.property === property), [], `${property} must omit unavailable sm spacing, not invalidate its phone fallback`);
    }
    const phoneEnd = candidate.filter((row) => !row.responsive && row.property === "--ouro-toaster-end");
    const desktopWidth = candidate.filter((row) => row.responsive && row.property === "--ouro-toaster-width");
    if (named) {
      assert.ok(phoneEnd.some((row) => row.value.includes("var(--spacing-4")));
      assert.ok(desktopWidth.some((row) => row.value.includes("var(--spacing-90")));
    } else {
      assert.deepEqual(phoneEnd, [], "missing named and universal spacing emits no phone end declaration");
      assert.deepEqual(candidate.filter((row) => !row.responsive && row.property === "--ouro-toaster-start"), []);
      assert.deepEqual(desktopWidth, [], "missing named and universal spacing emits no desktop width declaration");
    }
    assert.deepEqual(candidate.filter((row) => row.property === "--spacing"), [], "no global spacing default introduced");
  }
});

test("Toaster preserves named spacing tokens when Tailwind compiles an app's spacing scale", async () => {
  const compiler = await compile("@theme { --spacing: 0.25rem; --spacing-4: 1.125rem; --spacing-6: 1.75rem; --spacing-90: 25rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportTokens(), "start-4", "end-6", "w-90"]));
  const values = new Map();
  css.walkDecls((decl) => values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]));
  // The original utilities read the named token, not just the universal spacing multiplier.
  assert.ok(values.get("inset-inline-start").includes("var(--spacing-4)"));
  assert.ok(values.get("inset-inline-end").includes("var(--spacing-6)"));
  assert.ok(values.get("width").includes("var(--spacing-90)"));
  for (const [property, token] of [
    ["--ouro-toaster-start", "--spacing-4"],
    ["--ouro-toaster-end", "--spacing-4"],
    ["--ouro-toaster-end", "--spacing-6"],
    ["--ouro-toaster-bottom", "--spacing-6"],
    ["--ouro-toaster-width", "--spacing-90"],
  ]) {
    assert.ok(values.get(property).some((value) => value.includes(`var(${token}`)), `${property} must consume ${token}, as the original spacing utility does`);
  }
});

test("Toaster named candidates do not outrank later responsive universal defaults after cn", async () => {
  const compiler = await compile("@theme { --spacing: 0.25rem; --spacing-4: 1.125rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const values = new Map();
  postcss.parse(compiler.build(viewportTokens())).walkDecls((decl) => {
    values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]);
  });
  assert.equal(values.get("--ouro-toaster-start").at(-1), "auto", "desktop start must override the named phone inset");
  assert.ok(values.get("--ouro-toaster-end").at(-1).includes("calc(var(--spacing) * 6)"), "desktop universal end wins over named phone end");
});

test("Toaster keeps inline spacing aliases evaluated at the viewport, like the original utilities", async () => {
  const compiler = await compile("@theme inline { --spacing: 0.25rem; --spacing-4: var(--app-gap-4); --spacing-6: var(--app-gap-6); --spacing-90: var(--app-width); --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportTokens(), "start-4", "end-6", "w-90"]));
  const values = new Map();
  const phoneValues = new Map();
  css.walkDecls((decl) => {
    values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]);
    let responsive = false;
    for (let parent = decl.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media") responsive = true;
    }
    if (!responsive) phoneValues.set(decl.prop, [...(phoneValues.get(decl.prop) ?? []), decl.value]);
  });
  for (const [originalProperty, viewportProperty, alias] of [
    ["inset-inline-start", "--ouro-toaster-start", "--app-gap-4"],
    ["inset-inline-end", "--ouro-toaster-end", "--app-gap-6"],
    ["width", "--ouro-toaster-width", "--app-width"],
  ]) {
    assert.ok(values.get(originalProperty).includes(`var(${alias})`));
    const applicable = viewportProperty === "--ouro-toaster-start" ? phoneValues : values;
    assert.ok(applicable.get(viewportProperty).at(-1).startsWith(`var(${alias}`), `${viewportProperty} must evaluate ${alias} at the viewport after the universal candidate, not inherit a pre-resolved theme alias`);
  }
});

test("Toaster preserves an inline universal spacing multiplier instead of introducing a live global dependency", async () => {
  const compiler = await compile("@theme inline { --spacing: 0.3rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportTokens(), "start-4", "end-6", "w-90"]));
  const values = new Map();
  css.walkDecls((decl) => values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]));
  for (const [originalProperty, viewportProperty, multiplier] of [
    ["inset-inline-start", "--ouro-toaster-start", 4],
    ["inset-inline-end", "--ouro-toaster-end", 6],
    ["width", "--ouro-toaster-width", 90],
  ]) {
    const expected = `calc(0.3rem * ${multiplier})`;
    assert.ok(values.get(originalProperty).includes(expected));
    assert.ok(values.get(viewportProperty).some((value) => value.includes(expected)), `${viewportProperty} must preserve the inline spacing multiplier`);
  }
});

