import type { ServerBuild } from "react-router";

export {};

declare global {
  type D1Database = unknown;

  const process: {
    env: Record<string, string | undefined>;
  };

  interface R2ObjectBody {
    body: BodyInit | null;
    httpMetadata?: {
      contentType?: string;
    };
  }

  interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(
      key: string,
      value: Blob | ArrayBuffer | ArrayBufferView | ReadableStream,
      options?: { httpMetadata?: { contentType?: string } }
    ): Promise<unknown>;
    delete(key: string): Promise<void>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  interface ExportedHandler<Environment = unknown> {
    fetch(
      request: Request,
      env: Environment,
      ctx: ExecutionContext
    ): Response | Promise<Response>;
  }

  /**
   * Cloudflare's native Workers Rate Limiting binding (sliding window).
   * Configured in wrangler.json under the supported `ratelimits` binding array.
   */
  interface RateLimitBinding {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  }

  interface Env {
    DB?: D1Database;
    PHOTOS?: R2Bucket;
    /** Sliding-window throttle for authenticated bearer-token traffic. */
    API_TOKEN_RATE_LIMITER?: RateLimitBinding;
    /** Sliding-window throttle for anonymous IP-based traffic to /api/*. */
    API_IP_RATE_LIMITER?: RateLimitBinding;
    /** Tighter per-IP throttle for anonymous auth attempts (login/signup/passkey). */
    AUTH_IP_RATE_LIMITER?: RateLimitBinding;
    SESSION_SECRET?: string;
    SPOONJOY_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GEMINI_IMAGE_MODEL?: string;
    GEMINI_IMAGE_TIMEOUT_MS?: string;
    IMAGE_PROVIDER_PRIMARY?: string;
    IMAGE_PROVIDER_FALLBACKS?: string;
    INGREDIENT_PARSE_PROVIDER?: string;
    INGREDIENT_PARSE_MODEL?: string;
    INGREDIENT_PARSE_TIMEOUT_MS?: string;
    INGREDIENT_PARSE_MAX_RETRIES?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    APPLE_CLIENT_ID?: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    POSTHOG_KEY?: string;
    POSTHOG_HOST?: string;
    POSTHOG_DISABLED?: string;
  }

  interface CloudflareEnvironment extends Env {}
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare?: {
      env?: Env | null;
      ctx?: ExecutionContext;
    };
  }
}

declare module "virtual:react-router/server-build" {
  const build: ServerBuild;
  export default build;
}
