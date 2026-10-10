import type { Route } from "./+types/signup";
import { useEffect, useRef } from "react";
import { Form, redirect, data, useActionData, useLoaderData, useSearchParams } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { createUser, emailExists } from "~/lib/auth.server";
import { findUsernameConflict } from "~/lib/account-identity.server";
import { isValidEmail, normalizeEmail } from "~/lib/email";
import { createUserSession, getUserId, sanitizeSessionRedirect } from "~/lib/session.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { normalizeUsername, USERNAME_HINT, usernameFormatError } from "~/lib/username";
import { OAuthButtonGroup, OAuthDivider, OAuthError } from "~/components/ui/oauth";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { AuthLayout } from "~/components/ui/auth-layout";
import { Heading } from "~/components/ui/heading";
import { Field, Label, Description, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Text, TextLink } from "~/components/ui/text";
import { ValidationError } from "~/components/ui/validation-error";

interface ActionData {
  errors?: {
    email?: string;
    username?: string;
    password?: string;
    confirmPassword?: string;
    general?: string;
  };
  // What was typed, so a full-page submit (before hydration) comes back with the fields filled
  // in. Never the password.
  values?: {
    email: string;
    username: string;
  };
}

interface LoaderData {
  oauthError?: string;
  oauthProviders: OAuthProvider[];
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign up - Spoonjoy" },
    { name: "description", content: "Create a Spoonjoy account." },
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

// Action - handle signup form submission
export async function action({ request, context }: Route.ActionArgs) {
  // Throttle account-creation attempts per IP to deter automated abuse.
  const rateLimit = await enforceAuthRateLimit(request, context.cloudflare?.env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return data(
      { errors: { general: "Too many attempts. Please wait a moment and try again." } },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const username = normalizeUsername(formData.get("username"));
  const password = formData.get("password")?.toString() || "";
  const confirmPassword = formData.get("confirmPassword")?.toString() || "";

  const errors: ActionData["errors"] = {};

  // Validation
  if (!isValidEmail(email)) {
    errors.email = "Valid email is required";
  }

  const usernameError = usernameFormatError(username);
  if (usernameError) {
    errors.username = usernameError;
  }

  if (!password || password.length < 8) {
    errors.password = "Password must be at least 8 characters";
  }

  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  // Get the appropriate database instance
  const database = await getRequestDb(context);

  // Check if email or username already exists
  if (!errors.email) {
    const emailInUse = await emailExists(database, email);
    if (emailInUse) {
      errors.email = "An account with this email already exists";
    }
  }

  if (!errors.username) {
    // Taken regardless of letter case, or another account's ID (account-identity.server.ts).
    const usernameInUse = await findUsernameConflict(database, username);
    if (usernameInUse) {
      errors.username = "This username is already taken";
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors, values: { email, username } }, { status: 400 });
  }

  // Create user
  const user = await createUser(database, email, username, password);

  // A new account lands where it came from (the recipe someone tapped Save on, an app asking for
  // access), sanitised as log-in does, or else in its own Kitchen, which starts with what to do
  // first. A new account starts at session version 0.
  const redirectTo = sanitizeSessionRedirect(new URL(request.url).searchParams.get("redirectTo"), "/");
  const response = await createUserSession(user.id, redirectTo, context.cloudflare?.env, request, { sessionVersion: 0 });
  // The connector consent screen must load as a document, as after log-in.
  if (new URL(redirectTo, "https://spoonjoy.app").pathname === "/oauth/authorize") {
    response.headers.set("X-Remix-Reload-Document", "true");
  }
  return response;
}

export default function Signup() {
  const actionData = useActionData<ActionData>();
  const loaderData = useLoaderData<LoaderData | null>();
  const oauthProviders = loaderData?.oauthProviders ?? [];
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const formRef = useRef<HTMLFormElement>(null);
  const errors = actionData?.errors;

  // The browser no longer checks the fields (noValidate), so it no longer moves focus to the
  // first bad one either. Do that here each time the server answers with errors.
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  return (
    <AuthLayout
      eyebrow="New kitchen"
      title="Keep the good recipes close."
      description="Create your account to cook, fork, save, and remember the recipes that actually make it to your table."
    >
      <div className="w-full max-w-sm">
        <Heading>Sign up</Heading>

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

        {/* istanbul ignore next -- @preserve */ actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mt-4" />
        )}

        {oauthProviders.length > 0 && (
          <>
            <OAuthButtonGroup providers={oauthProviders} redirectTo={redirectTo} className="mt-8" />
            <OAuthDivider className="my-6" />
          </>
        )}

        {/* noValidate: the action checks every rule and answers with the messages below. Left to
            the browser, required/minLength would stop the submit with a native bubble instead, so
            a short username or password never showed the app's own message. */}
        <Form ref={formRef} method="post" noValidate className={oauthProviders.length > 0 ? "space-y-6" : "mt-8 space-y-6"}>
          <Field>
            <Label htmlFor="email">Email</Label>
            <Input
              type="email"
              id="email"
              name="email"
              defaultValue={actionData?.values?.email}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              invalid={!!actionData?.errors?.email}
            />
            {actionData?.errors?.email && (
              <ErrorMessage>{actionData.errors.email}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="username">Username</Label>
            <Input
              type="text"
              id="username"
              name="username"
              defaultValue={actionData?.values?.username}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={3}
              invalid={!!actionData?.errors?.username}
            />
            <Description>{USERNAME_HINT}</Description>
            {actionData?.errors?.username && (
              <ErrorMessage>{actionData.errors.username}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="password">Password</Label>
            <Input
              type="password"
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              invalid={!!actionData?.errors?.password}
            />
            <Description>At least 8 characters.</Description>
            {actionData?.errors?.password && (
              <ErrorMessage>{actionData.errors.password}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={8}
              invalid={!!actionData?.errors?.confirmPassword}
            />
            {actionData?.errors?.confirmPassword && (
              <ErrorMessage>{actionData.errors.confirmPassword}</ErrorMessage>
            )}
          </Field>

          <Button type="submit" className="w-full">
            Sign up
          </Button>
        </Form>

        <Text className="mt-6 text-center">
          Already have an account?{" "}
          <TextLink href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}>Log in</TextLink>
        </Text>
      </div>
    </AuthLayout>
  );
}
