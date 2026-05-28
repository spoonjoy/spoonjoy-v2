import type { Route } from "./+types/login";
import { useState } from "react";
import { Form, redirect, data, useActionData, useLoaderData, useSearchParams } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { authenticateUser } from "~/lib/auth.server";
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
    email?: string;
    password?: string;
    general?: string;
  };
}

interface LoaderData {
  oauthError?: string;
  oauthProviders: OAuthProvider[];
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
  const email = formData.get("email")?.toString() || "";
  const password = formData.get("password")?.toString() || "";

  const url = new URL(request.url);
  const redirectTo = sanitizeSessionRedirect(url.searchParams.get("redirectTo"), "/recipes");

  const errors: ActionData["errors"] = {};

  // Validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Valid email is required";
  }

  if (!password) {
    errors.password = "Password is required";
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Get the appropriate database instance
  const database = await getRequestDb(context);

  // Authenticate user
  const user = await authenticateUser(database, email, password);

  if (!user) {
    return data(
      { errors: { general: "Invalid email or password" } },
      { status: 401 }
    );
  }

  // Create session and redirect
  return createUserSession(user.id, redirectTo, context.cloudflare?.env);
}

export default function Login() {
  const actionData = useActionData<ActionData>();
  const loaderData = useLoaderData<LoaderData | null>();
  const oauthProviders = loaderData?.oauthProviders ?? [];
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const [email, setEmail] = useState("");

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <Heading>Log In</Heading>

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

        {/* istanbul ignore next -- @preserve */ actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mt-4" />
        )}

        {oauthProviders.length > 0 && (
          <>
            <OAuthButtonGroup providers={oauthProviders} className="mt-8" />
            <OAuthDivider className="my-6" />
          </>
        )}

        <Form method="post" className={oauthProviders.length > 0 ? "space-y-6" : "mt-8 space-y-6"}>
          <Field>
            <Label htmlFor="email">Email</Label>
            <Input
              type="email"
              id="email"
              name="email"
              autoComplete="username webauthn"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.email}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.email && (
              <ErrorMessage>{actionData.errors.email}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="password">Password</Label>
            <Input
              type="password"
              id="password"
              name="password"
              required
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.password}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.password && (
              <ErrorMessage>{actionData.errors.password}</ErrorMessage>
            )}
          </Field>

          <Button type="submit" className="w-full">
            Log In
          </Button>
        </Form>

        <div className="my-6 border-t border-[var(--sj-border)]" aria-hidden="true" />
        <PasskeySignInButton email={email} redirectTo={redirectTo} />

        <Text className="mt-6 text-center">
          Don't have an account?{" "}
          <TextLink href="/signup">Sign up</TextLink>
        </Text>
      </div>
    </AuthLayout>
  );
}
