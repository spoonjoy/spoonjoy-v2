import type { Route } from "./+types/api.push.public-key";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";

export async function loader({ context }: Route.LoaderArgs) {
  try {
    const env = (context.cloudflare?.env ?? {}) as VapidEnv;
    const config = getVapidConfig(env);
    return Response.json(
      { key: config.publicKey },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=3600" },
      },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "VAPID configuration error" },
      { status: 500 },
    );
  }
}
