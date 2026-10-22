import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { CodeBlock, type CodeBlockProps } from "~/components/ouro/code-block/code-block";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ code: "npm i" }>().toExtend<CodeBlockProps>();
expectTypeOf<{ code: "x"; language: "bash"; title: "install.sh"; copy: false; copyLabel: "Copy command"; wrap: true; className: "max-h-80" }>().toExtend<CodeBlockProps>();
expectTypeOf<ComponentProps<typeof CodeBlock>>().toEqualTypeOf<CodeBlockProps>();

// code is required.
expectTypeOf<{ language: "bash" }>().not.toExtend<CodeBlockProps>();

// Guessed props name the fix.
expectTypeOf<{ code: "x"; children: "x" }>().not.toExtend<CodeBlockProps>();
expectTypeOf<{ code: "x"; lang: "ts" }>().not.toExtend<CodeBlockProps>();
expectTypeOf<{ code: "x"; filename: "a.ts" }>().not.toExtend<CodeBlockProps>();
expectTypeOf<{ code: "x"; showCopyButton: true }>().not.toExtend<CodeBlockProps>();

// @ts-expect-error lang is not a prop.
createElement(CodeBlock, { code: "x", lang: "ts" });
