import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { AuthLayout, type AuthLayoutProps } from "~/components/ouro/auth-layout/auth-layout";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

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
propsOf<ComponentProps<typeof AuthLayout>>({ children: "Form" });
