"use client";

import type { HTMLAttributes, JSX, ReactNode, Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Card } from "~/components/ouro/card/card";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";

/** The props AuthLayout adds to the `<main>` attributes it passes through. */
export interface AuthLayoutOwnProps {
  /** The page's heading, its `<h1>`: "Sign in". */
  title: string;
  /** A line under the title: "Welcome back to Spoonjoy." */
  description?: ReactNode;
  /** Your logo or product name, above the title. Link it to the home page. */
  brand?: ReactNode;
  /** The form: fields and the submit button, usually a `Form`. */
  children: ReactNode;
  /** A line under the card, such as the link to the other form: "No account? Sign up". */
  footer?: ReactNode;
  /**
   * The element the layout renders. Pass `"div"` when the layout renders inside a page that
   * already has a `<main>`, since a document has one.
   * @default "main"
   */
  as?: "main" | "div" | undefined;
  /** Layout only: margins and height (`min-h-96`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `brand`: `<AuthLayout brand={<Logo />}>`. */
  logo?: { "Use <AuthLayout brand={<Logo />}>": never };
  /** Not a prop. Ouro UI uses `title`: `<AuthLayout title="Sign in">`. */
  heading?: { 'Use <AuthLayout title="Sign in">': never };
  /** Not a prop. Ouro UI uses `description`: `<AuthLayout description="Welcome back">`. */
  subtitle?: { 'Use <AuthLayout description="Welcome back">': never };
}

/** Props for {@link AuthLayout}: its own props and the `<main>` attributes it passes through. */
export type AuthLayoutProps = Omit<HTMLAttributes<HTMLElement>, keyof AuthLayoutOwnProps> & AuthLayoutOwnProps;

/**
 * The page for signing in, signing up or resetting a password: one `Card` in the middle of
 * the screen, with your brand, the title as the page's `<h1>`, the form, and a line under
 * the card. It is the page's `<main>`, at least as tall as the screen, and fills a phone's
 * width.
 *
 * Use `SidebarLayout` or `StackedLayout` instead for the signed-in app. Use `Dialog` for a
 * sign-in prompt over another page.
 *
 * @group Navigation
 * @see https://ourostack.github.io/ouro-ui/docs/auth-layout
 *
 * @example
 * <AuthLayout title="Sign in" description="Welcome back." footer={<Link href="/signup">Create an account</Link>}>
 *   <Form>
 *     <TextField label="Email" name="email" type="email" required />
 *     <Button type="submit" fullWidth>Sign in</Button>
 *   </Form>
 * </AuthLayout>
 */
export function AuthLayout(props: AuthLayoutProps): JSX.Element {
  const {
    title,
    description,
    brand,
    children,
    footer,
    as,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    logo,
    heading,
    subtitle,
    ...rest
  } = props;
  useAppearanceClassNameCheck(
    "AuthLayout",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; AuthLayout sets its own look`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "AuthLayout",
    process.env.NODE_ENV !== "production"
      ? () => [
          !title && ["title is required; it is the page's heading", '<AuthLayout title="Sign in">'],
          logo !== undefined && ["logo is not a prop", "<AuthLayout brand={<Logo />}>"],
          heading !== undefined && ["heading is not a prop", '<AuthLayout title="Sign in">'],
          subtitle !== undefined && ["subtitle is not a prop", '<AuthLayout description="Welcome back">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Typed as "main" for the ref, which is an HTMLElement either way.
  const Root = (as === "div" ? "div" : "main") as "main";
  return (
    <Root
      {...rest}
      data-ouro="auth-layout"
      className={cn(
        "box-border flex min-h-dvh flex-col items-center justify-center gap-6 bg-background py-8 text-foreground",
        "ps-[max(1rem,env(safe-area-inset-left,0px))] pe-[max(1rem,env(safe-area-inset-right,0px))]",
        className,
      )}
    >
      <Card className="w-full max-w-sm">
        <div className="grid gap-6">
          <div className="grid gap-2">
            {brand !== undefined && <div className="mb-2 flex items-center">{brand}</div>}
            <Heading level={1} size="lg">
              {title}
            </Heading>
            {description !== undefined && <Text tone="muted">{description}</Text>}
          </div>
          {children}
        </div>
      </Card>
      {footer !== undefined && <div data-ouro-text="" className="w-full max-w-sm text-center text-base pointer-fine:text-sm text-muted-foreground">{footer}</div>}
    </Root>
  );
}
