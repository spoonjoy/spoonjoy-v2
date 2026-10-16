import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "tailwindcss";
import postcss from "postcss";
import { viewportClass } from "../app/components/ouro/toast/toaster-styles.ts";

test("Toaster emits the original named-only spacing scale without requiring a universal token", async () => {
  const compiler = await compile("@theme { --spacing: initial; --spacing-4: 1rem; --spacing-6: 1.5rem; --spacing-90: 22.5rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportClass.split(/\s+/), "start-4", "end-4", "end-6", "bottom-6", "w-90"]));
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

test("Toaster preserves named spacing tokens when Tailwind compiles an app's spacing scale", async () => {
  const compiler = await compile("@theme { --spacing: 0.25rem; --spacing-4: 1.125rem; --spacing-6: 1.75rem; --spacing-90: 25rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportClass.split(/\s+/), "start-4", "end-6", "w-90"]));
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

test("Toaster keeps inline spacing aliases evaluated at the viewport, like the original utilities", async () => {
  const compiler = await compile("@theme inline { --spacing: 0.25rem; --spacing-4: var(--app-gap-4); --spacing-6: var(--app-gap-6); --spacing-90: var(--app-width); --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportClass.split(/\s+/), "start-4", "end-6", "w-90"]));
  const values = new Map();
  css.walkDecls((decl) => values.set(decl.prop, [...(values.get(decl.prop) ?? []), decl.value]));
  for (const [originalProperty, viewportProperty, alias] of [
    ["inset-inline-start", "--ouro-toaster-start", "--app-gap-4"],
    ["inset-inline-end", "--ouro-toaster-end", "--app-gap-6"],
    ["width", "--ouro-toaster-width", "--app-width"],
  ]) {
    assert.ok(values.get(originalProperty).includes(`var(${alias})`));
    assert.ok(values.get(viewportProperty).some((value) => value.startsWith(`var(${alias}`)), `${viewportProperty} must evaluate ${alias} at the viewport, not inherit a pre-resolved theme alias`);
  }
});

test("Toaster preserves an inline universal spacing multiplier instead of introducing a live global dependency", async () => {
  const compiler = await compile("@theme inline { --spacing: 0.3rem; --breakpoint-sm: 40rem; } @tailwind utilities;");
  const css = postcss.parse(compiler.build([...viewportClass.split(/\s+/), "start-4", "end-6", "w-90"]));
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

