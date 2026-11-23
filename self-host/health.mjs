// The image's health: healthy when the server's readiness check (/health/ready, which touches
// the database and the photo store) answers 200.
export async function checkHealth({ port, fetch = globalThis.fetch }) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(4000) });
    return response.status === 200 ? 0 : 1;
  } catch {
    return 1;
  }
}
