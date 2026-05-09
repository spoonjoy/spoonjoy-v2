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

  interface Env {
    DB?: D1Database;
    PHOTOS?: R2Bucket;
    OPENAI_API_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    APPLE_CLIENT_ID?: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
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
