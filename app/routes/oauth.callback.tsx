import type { Route } from "./+types/oauth.callback";
import { data, redirect } from "react-router";
import { ArrowRight } from "lucide-react";
import { AuthLayout } from "~/components/ui/auth-layout";
import { Heading } from "~/components/ui/heading";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

const CALLBACK_COPY = {
  eyebrow: "Spoonjoy Apple",
  title: "Back to the app.",
  description: "This secure callback is reserved for Spoonjoy on iPhone, iPad, and Mac.",
} as const;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Spoonjoy Apple Callback | Spoonjoy" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
    { name: "description", content: "Secure Spoonjoy Apple OAuth callback." },
  ];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (url.search) {
    return redirect(url.pathname, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  return data(null, {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default function OAuthCallback() {
  return (
    <AuthLayout {...CALLBACK_COPY}>
      <div className="w-full max-w-sm">
        <Heading>Continue in Spoonjoy</Heading>
        <Text className="mt-4">
          If the native app did not open, return to Spoonjoy and start the connection again.
        </Text>
        <div className="mt-8">
          <Button href="/" className="w-full">
            Open Spoonjoy
            <ArrowRight data-slot="icon" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
