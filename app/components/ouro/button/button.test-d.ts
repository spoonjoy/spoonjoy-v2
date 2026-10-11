import { createElement, type ComponentProps, type ComponentType, type SVGProps } from "react";
import { expectTypeOf } from "vitest";
import { Button, type ButtonProps } from "~/components/ouro/button/button";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

// Valid shapes.
expectTypeOf<{ children: "Go" }>().toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; type: "submit"; loading: true }>().toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; href: "/x"; target: "_blank"; rel: "noopener" }>().toExtend<ButtonProps>();
expectTypeOf<{
  children: "Go";
  tone: "destructive";
  variant: "soft";
  size: "lg";
  fullWidth: true;
  startIcon: Icon;
  endIcon: Icon;
}>().toExtend<ButtonProps>();
expectTypeOf<ComponentProps<typeof Button>>().toEqualTypeOf<ButtonProps>();

// The guessed names are declared `never`, so they fail with JSDoc pointing to the real prop.
expectTypeOf<{ children: "Go"; isLoading: true }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; color: "red" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; asChild: true }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; leftIcon: Icon }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; rightIcon: Icon }>().not.toExtend<ButtonProps>();

// A link is not a submit button, and cannot be natively disabled.
expectTypeOf<{ children: "Go"; href: "/x"; type: "submit" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; href: "/x"; disabled: true }>().not.toExtend<ButtonProps>();

// Appearance is named, never a color.
expectTypeOf<{ children: "Go"; tone: "red" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; variant: "ghost" }>().not.toExtend<ButtonProps>();
// shadcn and older Ouro names are not tones or variants; the tone names are the theme tokens.
expectTypeOf<{ children: "Go"; tone: "danger" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; tone: "accent" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; variant: "destructive" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; variant: "default" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; variant: "link" }>().not.toExtend<ButtonProps>();
// shadcn's sizes are not sizes either; the error names `md` and `aria-label`.
expectTypeOf<{ children: "Go"; size: "default" }>().not.toExtend<ButtonProps>();
expectTypeOf<{ children: "Go"; size: "icon" }>().not.toExtend<ButtonProps>();
// The hint member accepts no string.
expectTypeOf<{ children: "Go"; variant: string }>().not.toExtend<ButtonProps>();

// Children are required.
expectTypeOf<{ type: "button" }>().not.toExtend<ButtonProps>();

// The same checks through JSX.
// @ts-expect-error isLoading is not a prop; use loading.
createElement(Button, { isLoading: true, children: "Go" });
// @ts-expect-error href and type="submit" cannot be combined.
createElement(Button, { href: "/x", type: "submit", children: "Go" });
