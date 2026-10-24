import type { Route } from "./+types/login";
import { useRef } from "react";
import { Form as RouterForm, redirect, data, useActionData, useLoaderData, useSearchParams } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { authenticateUserByEmailOrUsername, authenticateUserByEmailOrUsernameOnD1 } from "~/lib/auth.server";
import { requestD1 } from "~/lib/d1-read.server";
import { createUserSession, getUserId, sanitizeSessionRedirect } from "~/lib/session.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { OAuthButtonGroup, OAuthError } from "~/components/oauth";
import { Separator } from "~/components/ouro/separator/separator";
import { getConfiguredOAuthProviders, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { AuthPage } from "~/components/auth/auth-page";
import { PasskeySignInButton } from "~/components/auth/PasskeySignInButton";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { useFormErrors } from "~/hooks/use-form-errors";

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
  const formErrors = useFormErrors(actionData?.errors, undefined, actionData);
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
    <AuthPage formTitle="Log in">
      <div className="w-full max-w-sm">

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

        {oauthProviders.length > 0 && (
          <>
            <OAuthButtonGroup providers={oauthProviders} redirectTo={redirectTo} className="mt-8" />
            <Separator label="or" className="my-6" data-testid="oauth-separator" />
          </>
        )}

        {/* The action's messages land on the fields by name; "general" shows at the top of the form. */}
        <Form
          method="post"
          errors={formErrors}
          render={<RouterForm />}
          className={oauthProviders.length > 0 ? "gap-6" : "mt-8 gap-6"}
        >
          <TextField
            label="Username or email"
            name="identifier"
            autoComplete="username webauthn"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            ref={identifierRef}
          />
          <TextField label="Password" type="password" name="password" autoComplete="current-password" required />

          <Button type="submit" className="w-full">
            Log in
          </Button>
        </Form>

        <div className="my-6 border-t border-[var(--sj-border)]" aria-hidden="true" />
        <PasskeySignInButton identifierRef={identifierRef} redirectTo={redirectTo} />

        <Text tone="muted" align="center" className="mt-6">
          Don't have an account?{" "}
          <Link href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}>Sign up</Link>
        </Text>
      </div>
    </AuthPage>
  );
}
