import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { SyncStatus, type SyncState, type SyncStatusProps } from "~/components/ouro/sync-status/sync-status";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ status: "saved" }>().toExtend<SyncStatusProps>();
expectTypeOf<{ status: SyncState; labels: { saved: "Enregistré"; retry: "Réessayer" }; onRetry: () => void; className: "mt-2"; id: "sync" }>().toExtend<SyncStatusProps>();
expectTypeOf<ComponentProps<typeof SyncStatus>>().toEqualTypeOf<SyncStatusProps>();
expectTypeOf<SyncState>().toEqualTypeOf<"saved" | "saving" | "offline" | "error">();

// status is required.
expectTypeOf<{ onRetry: () => void }>().not.toExtend<SyncStatusProps>();

// Guessed props and values name the fix.
expectTypeOf<{ status: "pending" }>().not.toExtend<SyncStatusProps>();
expectTypeOf<{ status: "saved"; state: "saving" }>().not.toExtend<SyncStatusProps>();
expectTypeOf<{ status: "saved"; online: false }>().not.toExtend<SyncStatusProps>();

// @ts-expect-error status is one of four.
createElement(SyncStatus, { status: "pending" });
