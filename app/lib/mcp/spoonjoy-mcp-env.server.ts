export interface SpoonjoyMcpEnvSource {
  OPENAI_API_KEY?: string;
}

export interface SpoonjoyMcpEnv {
  OPENAI_API_KEY?: string;
}

export function getSpoonjoyMcpEnv(source: SpoonjoyMcpEnvSource): SpoonjoyMcpEnv | null {
  const openAiApiKey = source.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) return null;
  return { OPENAI_API_KEY: openAiApiKey };
}
