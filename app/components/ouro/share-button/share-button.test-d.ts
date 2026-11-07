import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ShareButton, type ShareButtonProps } from "~/components/ouro/share-button/share-button";
import type { ShareResult } from "~/lib/ouro/share";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<Record<never, never>>().toExtend<ShareButtonProps>();
expectTypeOf<{ url: "https://example.com"; title: "Notes"; text: "My notes"; label: "Share note"; copiedLabel: "Copied"; failedLabel: "No"; hideLabel: true; variant: "plain"; size: "sm"; onShare: (result: ShareResult) => void; className: "ms-auto" }>().toExtend<ShareButtonProps>();
expectTypeOf<ComponentProps<typeof ShareButton>>().toEqualTypeOf<ShareButtonProps>();
expectTypeOf<ShareResult>().toEqualTypeOf<"shared" | "copied" | "cancelled" | "failed">();

// Guessed props and values name the fix.
expectTypeOf<{ href: "https://example.com" }>().not.toExtend<ShareButtonProps>();
expectTypeOf<{ children: "Share" }>().not.toExtend<ShareButtonProps>();
expectTypeOf<{ onClick: () => void }>().not.toExtend<ShareButtonProps>();
expectTypeOf<{ variant: "ghost" }>().not.toExtend<ShareButtonProps>();
expectTypeOf<{ size: "icon" }>().not.toExtend<ShareButtonProps>();

// @ts-expect-error href is not a prop.
createElement(ShareButton, { href: "https://example.com" });
