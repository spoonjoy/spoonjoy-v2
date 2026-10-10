import type { Route } from "./+types/login";
import { useRef } from "react";
import { Form, redirect, data, useActionData, useLoaderData, useSearchParams } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { authenticateUserByEmailOrUsername, authenticateUserByEmailOrUsernameOnD1 } from "~/lib/auth.server";
import { requestD1 } from "~/lib/d1-read.server";
import { createUserSession, getUserId, sanitizeSessionRedirect } from "~/lib/session.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { OAuthButtonGroup, OAuthDivider, OAuthError } from "~/components/ui/oauth";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { AuthLayout } from "~/components/ui/auth-layout";
import { PasskeySignInButton } from "~/components/auth/PasskeySignInButton";
import { Heading } from "~/components/ui/heading";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Text, TextLink } from "~/components/ui/text";
import { ValidationError } from "~/components/ui/validation-error";

interface ActionData {
  errors?: {
    identifier?: string;
    password?: string;
    general?: string;
  };
}

interface LoaderData {
  oauthError?: string;
  oauthProviders: OAuthProvider[];
}

function requiresPostLoginDocumentReload(redirectTo: string): boolean {
  return new URL(redirectTo, "https://spoonjoy.app").pathname === "/oauth/authorize";
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Log in - Spoonjoy" },
    { name: "description", content: "Log in to your Spoonjoy kitchen." },
  ];
}

// Loader - redirect if already logged in, handle OAuth errors
export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  if (userId) {
    throw redirect("/");
  }

  // Check for OAuth error in URL search params
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("oauthError");
  const oauthProviders = getConfiguredOAuthProviders(getOAuthEnv(context));

  if (oauthError) {
    return { oauthError, oauthProviders } as LoaderData;
  }

  return { oauthProviders } as LoaderData;
}

// Action - handle login form submission
export async function action({ request, context }: Route.ActionArgs) {
  // Throttle before any password work so brute-force can't burn bcrypt cycles.
  const rateLimit = await enforceAuthRateLimit(request, context.cloudflare?.env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return data(
      { errors: { general: "Too many attempts. Please wait a moment and try again." } },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const identifier = (formData.get("identifier") ?? formData.get("email"))?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() || "";

  const url = new URL(request.url);
  const redirectTo = sanitizeSessionRedirect(url.searchParams.get("redirectTo"), "/recipes");

  const errors: ActionData["errors"] = {};

  // Validation
  if (!identifier) {
    errors.identifier = "Enter your username or email";
  }

  if (!password) {
    errors.password = "Password is required";
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Authenticate user by username or email: on the D1 binding when there is one, so a login
  // never builds a Prisma client.
  const d1 = requestD1(context);
  const user = d1
    ? await authenticateUserByEmailOrUsernameOnD1(d1, identifier, password)
    : await authenticateUserByEmailOrUsername(await getRequestDb(context), identifier, password);

  if (!user) {
    return data(
      { errors: { general: "Invalid username, email, or password" } },
      { status: 401 }
    );
  }

  // Create session and redirect, at the session version read with the password hash.
  const response = await createUserSession(user.id, redirectTo, context.cloudflare?.env, request, {
    sessionVersion: user.sessionVersion,
  });
  if (requiresPostLoginDocumentReload(redirectTo)) {
    response.headers.set("X-Remix-Reload-Document", "true");
  }
  return response;
}

export default function Login() {
  const actionData = useActionData<ActionData>();
  const loaderData = useLoaderData<LoaderData | null>();
  const oauthProviders = loaderData?.oauthProviders ?? [];
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  // The identifier field is uncontrolled so React never writes to it. A
  // controlled `value` would reset anything typed before hydration: after
  // hydration any re-render of the input (a focus change, a router update)
  // makes React set the DOM value back to its state, "" — and `required` then
  // silently blocks the submit. The passkey button reads the field through
  // this ref when tapped, so it also sees autofilled values that fire no
  // input event.
  const identifierRef = useRef<HTMLInputElement>(null);

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <Heading>Log in</Heading>

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

        {actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mt-4" />
        )}

        {oauthProviders.length > 0 && (
          <>
            <OAuthButtonGroup providers={oauthProviders} redirectTo={redirectTo} className="mt-8" />
            <OAuthDivider className="my-6" />
          </>
        )}

        <Form method="post" className={oauthProviders.length > 0 ? "space-y-6" : "mt-8 space-y-6"}>
          <Field>
            <Label htmlFor="identifier">Username or email</Label>
            <Input
              type="text"
              id="identifier"
              name="identifier"
              autoComplete="username webauthn"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              ref={identifierRef}
              invalid={!!actionData?.errors?.identifier}
            />
            {actionData?.errors?.identifier && (
              <ErrorMessage>{actionData.errors.identifier}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="password">Password</Label>
            <Input
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              required
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.password}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.password && (
              <ErrorMessage>{actionData.errors.password}</ErrorMessage>
            )}
          </Field>

          <Button type="submit" className="w-full">
            Log in
          </Button>
        </Form>

        <div className="my-6 border-t border-[var(--sj-border)]" aria-hidden="true" />
        <PasskeySignInButton identifierRef={identifierRef} redirectTo={redirectTo} />

        <Text className="mt-6 text-center">
          Don't have an account?{" "}
          <TextLink href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}>Sign up</TextLink>
        </Text>
      </div>
    </AuthLayout>
  );
}
