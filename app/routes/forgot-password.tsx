import type { Route } from "./+types/forgot-password";
import { Form as RouterForm, data, useActionData, useLoaderData } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { errorName, passwordResetAvailable, recordPasswordResetEvent, requestPasswordReset } from "~/lib/password-reset.server";
import { AuthPage } from "~/components/auth/auth-page";
import { Alert } from "~/components/ouro/alert/alert";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { useFormErrors } from "~/hooks/use-form-errors";

interface LoaderData {
  available: boolean;
}

type ActionData =
  | { sent: true; email: string }
  | { sent?: undefined; errors: { email?: string; general?: string } };

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Reset your password - Spoonjoy" },
    { name: "description", content: "Get a link to choose a new Spoonjoy password." },
  ];
}

export async function loader({ context }: Route.LoaderArgs): Promise<LoaderData> {
  return { available: passwordResetAvailable(getCloudflareEnv(context)) };
}

const UNAVAILABLE_MESSAGE = "Password reset by email isn't available right now.";

export async function action({ request, context }: Route.ActionArgs) {
  const env = getCloudflareEnv(context);
  const rateLimit = await enforceAuthRateLimit(request, env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return data<ActionData>(
      { errors: { general: "Too many attempts. Please wait a moment and try again." } },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const email = formData.get("email")?.toString().trim() ?? "";
  if (!email || !email.includes("@")) {
    return data<ActionData>({ errors: { email: "Enter the email address of your account" } }, { status: 400 });
  }
  if (!passwordResetAvailable(env)) {
    return data<ActionData>({ errors: { general: UNAVAILABLE_MESSAGE } }, { status: 503 });
  }

  // The answer never depends on whether the address has an account, and neither does its timing:
  // on Workers the lookup and the mail run after the response is sent.
  const work = getRequestDb(context)
    .then((db) => requestPasswordReset(db, env, email))
    // Recorded without the address, so a broken mailer shows up without leaking who asked.
    .then((outcome) => recordPasswordResetEvent(env, "spoonjoy.password_reset.requested", { outcome }))
    .catch((error: unknown) => recordPasswordResetEvent(env, "spoonjoy.password_reset.requested", {
      outcome: "error",
      error_name: errorName(error),
    }));
  const waitUntil = context.cloudflare?.ctx?.waitUntil?.bind(context.cloudflare.ctx);
  if (waitUntil) waitUntil(work);
  else await work;

  return { sent: true, email } satisfies ActionData;
}

export default function ForgotPassword() {
  const { available } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const errors = actionData && !actionData.sent ? actionData.errors : undefined;
  const formErrors = useFormErrors(errors, undefined, actionData);

  if (actionData?.sent) {
    return (
      <AuthPage formTitle="Check your email">
        <div className="mt-8 w-full max-w-sm">
          <Alert
            tone="success"
            title="If an account uses that email, a reset link is on its way."
            description={`We sent it to ${actionData.email}. It works once, for the next 30 minutes. If nothing arrives in a few minutes, check your spam folder or ask again.`}
          />
          <Text tone="muted" align="center" className="mt-6">
            <Link href="/login">Back to log in</Link>
          </Text>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage formTitle="Reset your password">
      <div className="w-full max-w-sm">
        {available ? (
          <>
            <Text tone="muted" className="mt-4">
              Enter the email address of your Spoonjoy account and we'll send you a link to choose a new password.
            </Text>
            <Form method="post" errors={formErrors} render={<RouterForm />} className="mt-6 gap-6">
              <TextField
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <Button type="submit" className="w-full">
                Send reset link
              </Button>
            </Form>
          </>
        ) : (
          <Alert
            tone="secondary"
            className="mt-6"
            title={UNAVAILABLE_MESSAGE}
            description="Sign in with Google, Apple, GitHub or a passkey, then set a new password in Account settings."
          />
        )}
        <Text tone="muted" align="center" className="mt-6">
          <Link href="/login">Back to log in</Link>
        </Text>
      </div>
    </AuthPage>
  );
}
