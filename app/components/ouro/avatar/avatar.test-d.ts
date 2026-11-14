import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Avatar, AvatarGroup, type AvatarGroupProps, type AvatarPresence, type AvatarProps } from "~/components/ouro/avatar/avatar";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ name: "Ana Lind" }>().toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana Lind"; src: "/ana.jpg"; alt: ""; initials: "AL"; size: "xl" }>().toExtend<AvatarProps>();
expectTypeOf<ComponentProps<typeof Avatar>>().toEqualTypeOf<AvatarProps>();
expectTypeOf<{ name: "Ana"; shape: "square"; color: "brand"; idForColor: "u-1"; icon: null }>().toExtend<AvatarProps>();
expectTypeOf<{ name: "Halden"; shape: "agent"; src: "/halden.png" }>().toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; presence: "do-not-disturb"; presenceLabel: "Do not disturb" }>().toExtend<AvatarProps>();
// A presence that may be missing, with its label, type checks as it is.
expectTypeOf<{ name: "Ana"; presence: AvatarPresence | undefined; presenceLabel: string }>().toExtend<AvatarProps>();
expectTypeOf<{ label: "Cooks"; max: 3; total: 12; size: "sm"; children: null }>().toExtend<AvatarGroupProps>();
expectTypeOf<ComponentProps<typeof AvatarGroup>>().toEqualTypeOf<AvatarGroupProps>();

// name is required; children, fallback and unknown sizes name the fix.
expectTypeOf<{ src: "/ana.jpg" }>().not.toExtend<AvatarProps>();
// A name still loading is null, not missing.
expectTypeOf<{ name: null; nameLoadingLabel: "Nom en cours" }>().toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; children: "AL" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; fallback: "AL" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; size: "4xl" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; size: 40 }>().not.toExtend<AvatarProps>();
// A presence needs the words it says; unknown shapes, colors and presences name the fix.
expectTypeOf<{ name: "Ana"; presence: "busy" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; presence: "dnd"; presenceLabel: "Busy" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; shape: "rounded" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Halden"; shape: "hexagon" }>().not.toExtend<AvatarProps>();
expectTypeOf<{ name: "Ana"; color: "blue" }>().not.toExtend<AvatarProps>();
// AvatarGroup needs a label.
expectTypeOf<{ children: null }>().not.toExtend<AvatarGroupProps>();

// @ts-expect-error name is required.
createElement(Avatar, { src: "/ana.jpg" });
// @ts-expect-error presence needs presenceLabel.
createElement(Avatar, { name: "Ana", presence: "busy" });
