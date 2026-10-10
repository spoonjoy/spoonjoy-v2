import type { ServerBuild } from "react-router";

export {};

declare global {
  type D1Database = unknown;

  const process: {
    env: Record<string, string | undefined>;
  };

  interface R2ObjectBody {
    body: BodyInit | null;
    /** Stored size in bytes. */
    size: number;
    /** The object's ETag, quoted, ready for an ETag header. */
    httpEtag: string;
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
    /** Deletes one key or, in one call, up to 1000 keys. */
    delete(keys: string | string[]): Promise<void>;
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

  interface WorkerVersionMetadata {
    id: string;
    tag: string;
    timestamp: string;
  }

  interface Env {
    DB?: D1Database;
    /**
     * Cloudflare Email Service `send_email` binding for account mail (verification, email change,
     * password reset). Absent until the sending domain is set up; see transactional-email.server.ts.
     */
    EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; html?: string }): Promise<unknown> };
    /** The From address for account mail, on the domain the EMAIL binding is allowed to send from. */
    SPOONJOY_EMAIL_FROM?: string;
    /** "capture" (QA) writes account mail to the EmailOutbox table instead of sending it. */
    SPOONJOY_EMAIL_MODE?: string;
    PHOTOS?: R2Bucket;
    /** Sliding-window throttle for authenticated bearer-token traffic. */
    API_TOKEN_RATE_LIMITER?: RateLimitBinding;
    /** Sliding-window throttle for anonymous IP-based traffic to /api/*. */
    API_IP_RATE_LIMITER?: RateLimitBinding;
    /** Tighter per-IP throttle for anonymous auth attempts (login/signup/passkey). */
    AUTH_IP_RATE_LIMITER?: RateLimitBinding;
    CF_VERSION_METADATA?: WorkerVersionMetadata;
    COOK_SESSIONS?: DurableObjectNamespace;
    COOK_SESSION_BOOTSTRAP_MODE?: string;
    /** "v1" serves cook-session protocol v1 (cross-device cook progress); unset keeps the inert 503. */
    COOK_SESSION_PROTOCOL?: string;
    SPOONJOY_CSP_MODE?: string;
    /** "1" only on a per-run QA Worker: handleError writes one scrubbed console.error line per error. */
    SPOONJOY_QA_ERROR_LOGS?: string;
    /** Share of successful fast API reads that send an analytics event (0 to 1; unset = 1). */
    SPOONJOY_API_EVENT_SAMPLE_RATE?: string;
    VITE_POSTHOG_HOST?: string;
    SESSION_SECRET?: string;
    SPOONJOY_BASE_URL?: string;
    SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS?: string;
    OPENAI_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GEMINI_IMAGE_MODEL?: string;
    /** "off" stops every AI generation (kill switch). */
    SPOONJOY_AI_IMAGE_GENERATION?: string;
    /** Global AI generations per UTC day across all users; default 200. */
    SPOONJOY_AI_DAILY_GENERATION_BUDGET?: string;
    GEMINI_IMAGE_TIMEOUT_MS?: string;
    GEMINI_TEXT_MODEL?: string;
    GEMINI_TEXT_TIMEOUT_MS?: string;
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
    APPLE_NATIVE_CLIENT_ID?: string;
    APPLE_NATIVE_CLIENT_IDS?: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
    APPLE_OAUTH_CALLBACK_MODE?: string;
    APPLE_OAUTH_CLEAN_CALLBACK_REGISTERED?: string;
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
    /**
     * Per-request CSP nonce, generated in `workers/app.ts`. Used for the
     * selected CSP `script-src` AND the SSR inline `<script>` nonces (read in
     * `entry.server.tsx`, provided via `NonceContext`).
     */
    nonce?: string;
  }
}

declare module "virtual:react-router/server-build" {
  const build: ServerBuild;
  export default build;
}
