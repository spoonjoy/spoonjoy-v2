import { describe, expect, it } from "vitest";
import {
  RequestBodyTooLargeError,
  readLimitedTextBody,
} from "~/lib/request-body-limit.server";

function streamRequest(body: string, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const chunks = [body.slice(0, 2), body.slice(2)];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
  });
  return new Request("https://spoonjoy.app/upload", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readLimitedTextBody", () => {
  it("returns an empty string when there is no body", async () => {
    await expect(readLimitedTextBody(new Request("https://spoonjoy.app/upload"))).resolves.toBe("");
  });

  it("reads a body within the byte limit", async () => {
    await expect(readLimitedTextBody(streamRequest("hello"), 5)).resolves.toBe("hello");
  });

  it("rejects declared oversized bodies before reading", async () => {
    const request = new Request("https://spoonjoy.app/upload", { method: "POST" });
    request.headers.set("Content-Length", "9");
    await expect(readLimitedTextBody(request, 8))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects streaming bodies once they cross the byte limit", async () => {
    await expect(readLimitedTextBody(streamRequest("hello"), 4))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
