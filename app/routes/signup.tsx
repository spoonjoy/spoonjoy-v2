import type { Route } from "./+types/signup";
import { Form, redirect, data, useActionData, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { createUser, emailExists, usernameExists } from "~/lib/auth.server";
import { createUserSession, getUserId } from "~/lib/session.server";
import { OAuthButtonGroup, OAuthDivider, OAuthError } from "~/components/ui/oauth";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { AuthLayout } from "~/components/ui/auth-layout";
import { Heading } from "~/components/ui/heading";
import { Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Text, TextLink } from "~/components/ui/text";

interface ActionData {
  errors?: {
    email?: string;
    username?: string;
    password?: string;
    confirmPassword?: string;
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

// Action - handle signup form submission
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email")?.toString() || "";
  const username = formData.get("username")?.toString() || "";
  const password = formData.get("password")?.toString() || "";
  const confirmPassword = formData.get("confirmPassword")?.toString() || "";

  const errors: ActionData["errors"] = {};

  // Validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Valid email is required";
  }

  if (!username || username.length < 3) {
    errors.username = "Username must be at least 3 characters";
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
    const usernameInUse = await usernameExists(database, username);
    if (usernameInUse) {
      errors.username = "This username is already taken";
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Create user
  const user = await createUser(database, email, username, password);

  // Create session and redirect
  return createUserSession(user.id, "/recipes", context.cloudflare?.env);
}

export default function Signup() {
  const actionData = useActionData<ActionData>();
  const loaderData = useLoaderData<LoaderData | null>();
  const oauthProviders = loaderData?.oauthProviders ?? [];

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <Heading>Sign Up</Heading>

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

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
              required
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.email}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.email && (
              <ErrorMessage>{actionData.errors.email}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="username">Username</Label>
            <Input
              type="text"
              id="username"
              name="username"
              required
              minLength={3}
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.username}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.username && (
              <ErrorMessage>{actionData.errors.username}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="password">Password</Label>
            <Input
              type="password"
              id="password"
              name="password"
              required
              minLength={8}
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.password}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.password && (
              <ErrorMessage>{actionData.errors.password}</ErrorMessage>
            )}
          </Field>

          <Field>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              required
              minLength={8}
              invalid={/* istanbul ignore next -- @preserve */ !!actionData?.errors?.confirmPassword}
            />
            {/* istanbul ignore next -- @preserve */ actionData?.errors?.confirmPassword && (
              <ErrorMessage>{actionData.errors.confirmPassword}</ErrorMessage>
            )}
          </Field>

          <Button type="submit" className="w-full">
            Sign Up
          </Button>
        </Form>

        <Text className="mt-6 text-center">
          Already have an account?{" "}
          <TextLink href="/login">Log in</TextLink>
        </Text>
      </div>
    </AuthLayout>
  );
}
