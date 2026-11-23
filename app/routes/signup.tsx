import type { Route } from "./+types/signup";
import { Form as RouterForm, redirect, data, useActionData, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { createUser, emailExists } from "~/lib/auth.server";
import { D1_WRITE_UNAVAILABLE_MESSAGE, d1UnavailableHeaders, isD1Unavailable } from "~/lib/d1-write-retry.server";
import { findUsernameConflict } from "~/lib/account-identity.server";
import { isValidEmail, normalizeEmail } from "~/lib/email";
import { createUserSession, getUserId, sanitizeSessionRedirect } from "~/lib/session.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { normalizeUsername, USERNAME_HINT, usernameFormatError } from "~/lib/username";
import { OAuthButtonGroup, OAuthError } from "~/components/oauth";
import { Separator } from "~/components/ouro/separator/separator";
import { getConfiguredOAuthProviders, getOidcButtonLabel, type OAuthProvider } from "~/lib/env.server";
import { getOAuthEnv } from "~/lib/oauth-route.server";
import { AuthPage } from "~/components/auth/auth-page";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { Alert } from "~/components/ouro/alert/alert";
import { useFormErrors } from "~/hooks/use-form-errors";
import { useRedirectToWithHash } from "~/hooks/use-redirect-hash";
import { gateAccountCreation, isSelfHosted, signupDoor } from "~/lib/server-access.server";

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
  /** The server owner's label for its OpenID Connect button, when one is set up. */
  oidcLabel?: string;
  // A self-hosted server that is invite-only: the message shown instead of the form.
  signupsClosed?: string;
  // The invite link this page was opened with, when it lets this person sign up.
  invite?: string;
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign up - Spoonjoy" },
    { name: "description", content: "Start a free Spoonjoy kitchen and save your first recipe from a link." },
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
  const inviteToken = url.searchParams.get("invite");
  // On a self-hosted server that is invite-only, a stranger reads why they can't sign up, and an
  // invite link signs one person up, with a password or one of the server's sign-in providers.
  const env = context.cloudflare?.env;
  const door = isSelfHosted(env) ? await signupDoor(await getRequestDb(context), env, inviteToken) : { door: "open" as const };
  // A stranger on an invite-only server gets no provider buttons; an invite link offers them too.
  const providersOffered = door.door !== "closed";
  const oauthProviders = providersOffered ? getConfiguredOAuthProviders(getOAuthEnv(context)) : [];
  const oidcLabel = providersOffered ? getOidcButtonLabel(getOAuthEnv(context)) : undefined;
  const access = door.door === "closed" ? { signupsClosed: door.message } : door.door === "invite" ? { invite: inviteToken! } : {};

  if (oauthError) {
    return { oauthError, oauthProviders, oidcLabel, ...access } as LoaderData;
  }

  return { oauthProviders, oidcLabel, ...access } as LoaderData;
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

  const inviteToken = formData.get("invite")?.toString() || new URL(request.url).searchParams.get("invite");
  const gate = await gateAccountCreation(database, context.cloudflare?.env, { inviteToken });
  if (!gate.allowed) {
    return data({ errors: { general: gate.message }, values: { email, username } }, { status: 403 });
  }

  let user: Awaited<ReturnType<typeof createUser>>;
  try {
    user = await createUser(database, email, username, password);
  } catch (error) {
    await gate.abandoned();
    // The database was briefly unavailable: say so above the form, which keeps what was typed.
    if (!isD1Unavailable(error)) throw error;
    return data(
      { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, values: { email, username } },
      { status: 503, headers: d1UnavailableHeaders() },
    );
  }

  await gate.created(user.id);

  // A new account lands where it came from (the recipe someone tapped Save on, an app asking for
  // access), sanitised as log-in does, or else in its own Kitchen, which starts with what to do
  // first. A new account starts at session version 0.
  const redirectTo = sanitizeSessionRedirect(new URL(request.url).searchParams.get("redirectTo"), "/");
  const response = await createUserSession(user.id, redirectTo, context.cloudflare?.env, request, { sessionVersion: 0, signInMethod: "password" });
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
  const redirectTo = useRedirectToWithHash();
  const formErrors = useFormErrors(actionData?.errors, undefined, actionData);

  return (
    <AuthPage
      formTitle="Sign up"
      eyebrow="New kitchen"
      title="Keep the good recipes close."
      description="Create your account to cook, fork, save, and remember the recipes that actually make it to your table."
    >
      <div className="w-full max-w-sm">

        {/* OAuth error messages */}
        <OAuthError error={loaderData?.oauthError} className="mt-4" />

        {loaderData?.signupsClosed ? (
          <Alert tone="warning" title={loaderData.signupsClosed} className="mt-8" data-testid="signups-closed" />
        ) : null}
        {loaderData?.invite ? (
          <Alert tone="primary" title="You're invited to this Spoonjoy server." description="This link signs up one account." className="mt-8" />
        ) : null}

        {oauthProviders.length > 0 && (
          <>
            <OAuthButtonGroup providers={oauthProviders} oidcLabel={loaderData?.oidcLabel} redirectTo={redirectTo} invite={loaderData?.invite} className="mt-8" />
            <Separator label="or" className="my-6" data-testid="oauth-separator" />
          </>
        )}

        {/* The action answers with its own messages: each lands on the field with that name, and
            focus moves to the first field with one. The fields carry no minLength, so a short
            username or password reaches the action and shows the app's message, not the browser's.
            An empty field or a malformed email is stopped in the browser, with its message under
            the field. */}
        {loaderData?.signupsClosed ? null : (
        <Form
          method="post"
          errors={formErrors}
          render={<RouterForm />}
          className={oauthProviders.length > 0 ? "gap-6" : "mt-8 gap-6"}
        >
          <TextField
            label="Email"
            type="email"
            name="email"
            defaultValue={actionData?.values?.email}
            autoComplete="email"
            required
          />
          <TextField
            label="Username"
            name="username"
            defaultValue={actionData?.values?.username}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            description={USERNAME_HINT}
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            description="At least 8 characters."
          />
          <TextField
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
          />

          {loaderData?.invite ? <input type="hidden" name="invite" value={loaderData.invite} /> : null}

          <Button type="submit" className="w-full">
            Sign up
          </Button>
        </Form>
        )}

        <Text tone="muted" align="center" className="mt-6">
          Already have an account?{" "}
          <Link href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}>Log in</Link>
        </Text>
      </div>
    </AuthPage>
  );
}
