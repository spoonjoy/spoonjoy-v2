import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { AuthLayout, type AuthLayoutProps } from "~/components/ouro/auth-layout/auth-layout";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof AuthLayout>>().toEqualTypeOf<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form" }>().toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form"; description: "Welcome"; brand: "Logo"; footer: "Sign up"; className: "min-h-96"; id: "auth" }>().toExtend<AuthLayoutProps>();

// title and children are required; the guessed props name the fix.
expectTypeOf<{ children: "Form" }>().not.toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in" }>().not.toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form"; logo: "x" }>().not.toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form"; heading: "x" }>().not.toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form"; subtitle: "x" }>().not.toExtend<AuthLayoutProps>();

// The page's element is main or div.
expectTypeOf<{ title: "Sign in"; children: "Form"; as: "div" }>().toExtend<AuthLayoutProps>();
expectTypeOf<{ title: "Sign in"; children: "Form"; as: "section" }>().not.toExtend<AuthLayoutProps>();
// @ts-expect-error title is required.
createElement(AuthLayout, { children: "Form" });
