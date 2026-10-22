import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { InstallPrompt, type InstallPromptProps } from "~/components/ouro/install-prompt/install-prompt";
import { useInstallPrompt, type InstallPromptState } from "~/lib/ouro/use-install-prompt";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<Record<never, never>>().toExtend<InstallPromptProps>();
expectTypeOf<{ title: "Install"; description: "Offline"; installLabel: "Add"; dismissLabel: "Later"; remindAfterDays: 7; storageKey: "k"; headingLevel: 3; onInstall: (outcome: "accepted" | "dismissed") => void; className: "mt-6" }>().toExtend<InstallPromptProps>();
expectTypeOf<ComponentProps<typeof InstallPrompt>>().toEqualTypeOf<InstallPromptProps>();
expectTypeOf(useInstallPrompt).returns.toEqualTypeOf<InstallPromptState>();
expectTypeOf<InstallPromptState["install"]>().returns.resolves.toEqualTypeOf<"accepted" | "dismissed" | "unavailable">();

// Guessed props and values name the fix.
expectTypeOf<{ open: true }>().not.toExtend<InstallPromptProps>();
expectTypeOf<{ onAccept: () => void }>().not.toExtend<InstallPromptProps>();
expectTypeOf<{ headingLevel: 1 }>().not.toExtend<InstallPromptProps>();

// @ts-expect-error open is not a prop.
createElement(InstallPrompt, { open: true });
