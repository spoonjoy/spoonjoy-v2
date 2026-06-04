import type { Route } from "./+types/og.pages.$slug.png";
import { pageOgInput } from "~/lib/og-metadata";
import { createPageOgImageResponse } from "~/lib/og-image.server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const input = pageOgInput(params.slug);
  if (!input) {
    throw new Response("Page OG card not found", { status: 404 });
  }

  return createPageOgImageResponse(input, context.cloudflare?.ctx);
}
