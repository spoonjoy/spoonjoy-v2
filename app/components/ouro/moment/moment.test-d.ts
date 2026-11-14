import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Moment, MomentProvider, type MomentProps, type MomentProviderProps } from "~/components/ouro/moment/moment";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof Moment>>().toEqualTypeOf<MomentProps>();
expectTypeOf<ComponentProps<typeof MomentProvider>>().toEqualTypeOf<MomentProviderProps>();
expectTypeOf<{
  title: "No messages yet";
  kind: "success";
  description: "Add one";
  art: "a";
  artLabel: "A tray";
  action: "a";
  secondaryAction: "b";
  headingLevel: 2;
  size: "inline";
  quiet: true;
  celebrate: true;
  cap: { times: 1; per: "week" };
  dismissKey: "welcome";
  onDismiss: () => void;
  dismissLabel: "Close";
  announce: true;
}>().toExtend<MomentProps>();

// The title is required: it says what the moment is about.
expectTypeOf<{ description: "Add one" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; kind: "info" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; size: "sm" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; cap: { times: 1; per: "hour" } }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; icon: "i" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; heading: "y" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; actions: "y" }>().not.toExtend<MomentProps>();
expectTypeOf<{ title: "x"; onClose: () => void }>().not.toExtend<MomentProps>();

// @ts-expect-error title is required.
createElement(Moment, { description: "Add one" });
