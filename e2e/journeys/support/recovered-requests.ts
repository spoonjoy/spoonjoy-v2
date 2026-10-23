// A request that got no HTTP answer (the connection or its TLS handshake was reset, as in Journeys
// run 39838941793) makes the browser log "Failed to load resource: <why>". When the page sent the
// same request again (same method, URL and body) and that one was answered
// (app/lib/network-failure.ts resends an idempotent submission once), the page recovered, so the
// console gate does not count that log. Each lost request pairs with at most one later answer to
// the same request, and the gate excuses no more of a URL's logs than it has recovered pairs: every
// intent on a page posts to the same URL, so a lost delete is never excused by an answered rename.
// A lost request that was not sent again, or sent again without an answer, still fails the test,
// and so does every "the server responded with a status of …" log, which is an answer.
const TRANSPORT_FAILURE = /^Failed to load resource: (?!the server responded with a status)/;

export function isTransportFailureLog(text: string): boolean {
  return TRANSPORT_FAILURE.test(text);
}

interface RequestLike {
  method(): string;
  url(): string;
  postData(): string | null;
}

interface Sent {
  url: string;
  key: string;
  answered: boolean;
}

export class RequestLedger {
  private readonly events: Sent[] = [];

  failed(request: RequestLike): void {
    this.record(request, false);
  }

  answered(request: RequestLike): void {
    this.record(request, true);
  }

  // How many lost requests to `url` were each followed by an answer to the same request.
  recoveredCount(url: string): number {
    const lost = new Map<string, number>();
    let recovered = 0;
    for (const event of this.events) {
      if (event.url !== url) continue;
      const waiting = lost.get(event.key) ?? 0;
      if (!event.answered) lost.set(event.key, waiting + 1);
      else if (waiting > 0) {
        lost.set(event.key, waiting - 1);
        recovered += 1;
      }
    }
    return recovered;
  }

  private record(request: RequestLike, answered: boolean): void {
    const url = request.url();
    this.events.push({ url, key: JSON.stringify([request.method(), url, request.postData()]), answered });
  }
}
