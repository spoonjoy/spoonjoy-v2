import type { Route } from "./+types/reset-password";
import { Form as RouterForm, data, useActionData, useLoaderData } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { enforceAuthRateLimit } from "~/lib/rate-limit.server";
import { PASSWORD_MIN_LENGTH } from "~/lib/password-policy";
import {
  findUsablePasswordResetToken,
  resetPasswordWithToken,
  type PasswordResetFieldErrors,
} from "~/lib/password-reset.server";
import { AuthPage } from "~/components/auth/auth-page";
import { Alert } from "~/components/ouro/alert/alert";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { useFormErrors } from "~/hooks/use-form-errors";

type LoaderData = { state: "form"; token: string } | { state: "invalid" };

type ActionData =
  | { state: "done" }
  | { state: "invalid" }
  | { state: "form"; errors: PasswordResetFieldErrors & { general?: string } };

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Choose a new password - Spoonjoy" },
    { name: "description", content: "Choose a new password for your Spoonjoy account." },
    // The link's token is in this page's address; never send it to another site.
    { name: "referrer", content: "no-referrer" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<LoaderData> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const usable = token ? await findUsablePasswordResetToken(await getRequestDb(context), token) : null;
  return usable ? { state: "form", token } : { state: "invalid" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const rateLimit = await enforceAuthRateLimit(request, getCloudflareEnv(context)?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return data<ActionData>(
      { state: "form", errors: { general: "Too many attempts. Please wait a moment and try again." } },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const result = await resetPasswordWithToken(await getRequestDb(context), {
    token: formData.get("token")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
    confirmPassword: formData.get("confirmPassword")?.toString() ?? "",
    d1: requestD1(context),
  });
  if (result.ok) return { state: "done" } satisfies ActionData;
  if (result.reason === "invalid_token") return data<ActionData>({ state: "invalid" }, { status: 400 });
  return data<ActionData>({ state: "form", errors: result.fieldErrors }, { status: 400 });
}

export default function ResetPassword() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const formErrors = useFormErrors(actionData?.state === "form" ? actionData.errors : undefined, undefined, actionData);
  const state = actionData?.state ?? loaderData.state;

  if (state === "done") {
    return (
      <AuthPage formTitle="Password reset">
        <div className="mt-8 w-full max-w-sm">
          <Alert
            tone="success"
            title="Your password has been reset."
            description="You've been signed out everywhere, and apps, agents and API tokens have been disconnected. Log in with your new password."
          />
          <Button href="/login" className="mt-6 w-full">
            Log in
          </Button>
        </div>
      </AuthPage>
    );
  }

  if (state === "invalid" || loaderData.state !== "form") {
    return (
      <AuthPage formTitle="Reset link expired">
        <div className="mt-8 w-full max-w-sm">
          <Alert
            tone="warning"
            title="This reset link has expired or was already used."
            description="Each link works once, for 30 minutes. Ask for a new one."
          />
          <Button href="/forgot-password" className="mt-6 w-full">
            Send a new link
          </Button>
          <Text tone="muted" align="center" className="mt-6">
            <Link href="/login">Back to log in</Link>
          </Text>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage formTitle="Choose a new password">
      <div className="w-full max-w-sm">
        <Form method="post" errors={formErrors} render={<RouterForm />} className="mt-8 gap-6">
          <input type="hidden" name="token" value={loaderData.token} />
          <TextField
            label="New password"
            type="password"
            name="password"
            autoComplete="new-password"
            description={`At least ${PASSWORD_MIN_LENGTH} characters`}
            required
          />
          <TextField label="Confirm new password" type="password" name="confirmPassword" autoComplete="new-password" required />
          <Button type="submit" className="w-full">
            Reset password
          </Button>
        </Form>
      </div>
    </AuthPage>
  );
}
