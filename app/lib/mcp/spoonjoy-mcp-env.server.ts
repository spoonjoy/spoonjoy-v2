export interface SpoonjoyMcpEnvSource {
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_IMAGE_TIMEOUT_MS?: string;
  IMAGE_PROVIDER_PRIMARY?: string;
  IMAGE_PROVIDER_FALLBACKS?: string;
  SPOONJOY_BASE_URL?: string;
}

export interface SpoonjoyMcpEnv {
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_IMAGE_TIMEOUT_MS?: string;
  IMAGE_PROVIDER_PRIMARY?: string;
  IMAGE_PROVIDER_FALLBACKS?: string;
  SPOONJOY_BASE_URL?: string;
}

export function getSpoonjoyMcpEnv(source: SpoonjoyMcpEnvSource): SpoonjoyMcpEnv | null {
  const openAiApiKey = source.OPENAI_API_KEY?.trim();
  const googleApiKey = source.GOOGLE_API_KEY?.trim();
  const geminiApiKey = source.GEMINI_API_KEY?.trim();
  const geminiImageModel = source.GEMINI_IMAGE_MODEL?.trim();
  const geminiImageTimeoutMs = source.GEMINI_IMAGE_TIMEOUT_MS?.trim();
  const imageProviderPrimary = source.IMAGE_PROVIDER_PRIMARY?.trim();
  const imageProviderFallbacks = source.IMAGE_PROVIDER_FALLBACKS?.trim();
  const spoonjoyBaseUrl = source.SPOONJOY_BASE_URL?.trim();
  if (
    !openAiApiKey &&
    !googleApiKey &&
    !geminiApiKey &&
    !geminiImageModel &&
    !geminiImageTimeoutMs &&
    !imageProviderPrimary &&
    !imageProviderFallbacks &&
    !spoonjoyBaseUrl
  ) return null;
  return {
    ...(openAiApiKey ? { OPENAI_API_KEY: openAiApiKey } : {}),
    ...(googleApiKey ? { GOOGLE_API_KEY: googleApiKey } : {}),
    ...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
    ...(geminiImageModel ? { GEMINI_IMAGE_MODEL: geminiImageModel } : {}),
    ...(geminiImageTimeoutMs ? { GEMINI_IMAGE_TIMEOUT_MS: geminiImageTimeoutMs } : {}),
    ...(imageProviderPrimary ? { IMAGE_PROVIDER_PRIMARY: imageProviderPrimary } : {}),
    ...(imageProviderFallbacks ? { IMAGE_PROVIDER_FALLBACKS: imageProviderFallbacks } : {}),
    ...(spoonjoyBaseUrl ? { SPOONJOY_BASE_URL: spoonjoyBaseUrl } : {}),
  };
}
