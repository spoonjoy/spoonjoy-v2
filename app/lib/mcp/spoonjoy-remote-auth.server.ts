const TOKENLESS_REMOTE_OPERATIONS = new Set([
  "start_agent_connection",
  "poll_agent_connection",
]);

export function spoonjoyRemoteAuthorizationHeader(
  operation: string | undefined,
  token: string | undefined,
): string | null {
  const trimmedToken = token?.trim();
  if (!trimmedToken || !operation) return null;
  if (TOKENLESS_REMOTE_OPERATIONS.has(operation)) return null;
  return `Bearer ${trimmedToken}`;
}
