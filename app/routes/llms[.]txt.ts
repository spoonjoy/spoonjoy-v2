import type { Route } from "./+types/llms[.]txt";
import { llmsText } from "~/lib/llms-txt.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

export function loader({ request, context }: Route.LoaderArgs) {
  const origin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  return new Response(llmsText(origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
