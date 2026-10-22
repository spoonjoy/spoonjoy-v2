// A request that got no HTTP answer (the connection or its TLS handshake was reset, as in Journeys
// run 39838941793) makes the browser log "Failed to load resource: <why>". When the page sent the
// same request again and that one was answered (app/lib/network-failure.ts resends an idempotent
// submission once), the page recovered, so the console gate does not count that log. A lost
// request the page did not send again, or sent again without an answer, still fails the test, and
// so does every "the server responded with a status of …" log, which is an answer.
const TRANSPORT_FAILURE = /^Failed to load resource: (?!the server responded with a status)/;

export function isTransportFailureLog(text: string): boolean {
  return TRANSPORT_FAILURE.test(text);
}

interface RequestLike {
  method(): string;
  url(): string;
}

export class RequestLedger {
  private sequence = 0;
  private readonly failures: Array<{ key: string; at: number }> = [];
  private readonly answers: Array<{ key: string; at: number }> = [];

  failed(request: RequestLike): void {
    this.failures.push({ key: `${request.method()} ${request.url()}`, at: this.sequence++ });
  }

  answered(request: RequestLike): void {
    this.answers.push({ key: `${request.method()} ${request.url()}`, at: this.sequence++ });
  }

  // Whether a request to `url` failed without an answer and the same request was later answered.
  recovered(url: string): boolean {
    return this.failures.some((failure) =>
      failure.key.endsWith(` ${url}`) &&
      this.answers.some((answer) => answer.key === failure.key && answer.at > failure.at));
  }
}
