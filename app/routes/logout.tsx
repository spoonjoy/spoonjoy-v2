import type { Route } from "./+types/logout";
import { Form, data, redirect, useActionData } from "react-router";
import { destroyUserSession, getUserId } from "~/lib/session.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { AuthLayout } from "~/components/ui/auth-layout";
import { Heading } from "~/components/ui/heading";
import { Button } from "~/components/ui/button";
import { Text, TextLink } from "~/components/ui/text";
import { ValidationError } from "~/components/ui/validation-error";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Log out - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

// Opening /logout never signs anyone out. A GET can come from any site (an image tag, a link, a
// prefetch), so signing out on GET let any page log a visitor out. A signed-in visitor sees a
// "Log out?" page whose button posts the sign-out (the iPhone app opens this page after its own
// Log out, to end the browser's session too); a signed-out one goes to the login page.
export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  if (!userId) throw redirect("/login");
  return { signedIn: true };
}

// Browsers send the Origin header on form posts. A post that names another origin (or the opaque
// "null" origin) is refused, so only Spoonjoy's own pages can sign a visitor out. Spoonjoy's own
// origin is the configured public site (SPOONJOY_BASE_URL): on spoonjoy.app the Worker can see an
// internal workers.dev address as the request URL while the browser sends Origin
// https://spoonjoy.app. The request's own origin also counts, for QA and local hosts. The session
// cookie is SameSite=Lax, so a cross-site post would not carry it anyway; this check makes the
// rule explicit rather than relying on the cookie attribute alone.
function isCrossOriginPost(request: Request, baseUrl: string | undefined): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return false;
  return origin !== resolveIssuerOrigin(request.url, baseUrl) && origin !== new URL(request.url).origin;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  if (isCrossOriginPost(request, env?.SPOONJOY_BASE_URL)) {
    return data({ error: "Sign-out must come from Spoonjoy." }, { status: 403 });
  }
  return destroyUserSession(request, "/login", env);
}

export default function Logout() {
  const actionData = useActionData<{ error?: string }>();
  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <Heading>Log out of Spoonjoy?</Heading>
        {actionData?.error && <ValidationError error={actionData.error} className="mt-4" />}
        <Text className="mt-4">This signs you out in this browser only.</Text>
        <Form method="post" className="mt-6">
          <Button type="submit" className="w-full">
            Log out
          </Button>
        </Form>
        <Text className="mt-6 text-center">
          <TextLink href="/">Stay signed in</TextLink>
        </Text>
      </div>
    </AuthLayout>
  );
}
