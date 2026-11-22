import OpenAI from "openai";

export interface OpenAIClientConfig {
  apiKey: string;
  /** An OpenAI-compatible address; unset is OpenAI's own. */
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export function createOpenAIClient(config: OpenAIClientConfig): OpenAI {
  return new OpenAI({
    ...config,
    // Cloudflare Workers and happy-dom are browser-like runtimes to the SDK,
    // but this module is server-only and reads keys from env/Worker bindings.
    dangerouslyAllowBrowser: true,
  });
}
