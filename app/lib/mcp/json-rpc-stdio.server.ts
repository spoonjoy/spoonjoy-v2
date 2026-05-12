import { handleJsonRpcLine, type JsonRpcToolRouter } from "~/lib/mcp/json-rpc.server";

interface JsonRpcLineSessionIo {
  write(line: string): void;
  disconnect(): Promise<void>;
}

function internalErrorResponse(message: string) {
  return `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message } })}\n`;
}

export function createJsonRpcLineSession(router: JsonRpcToolRouter, io: JsonRpcLineSessionIo) {
  const pending = new Set<Promise<void>>();
  let tail = Promise.resolve();
  let closed = false;

  function onLine(line: string) {
    if (closed) return;

    let task: Promise<void>;
    task = tail.then(() => handleJsonRpcLine(line, router))
      .then((response) => {
        if (response) io.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        io.write(internalErrorResponse(message));
      })
      .finally(() => pending.delete(task));

    pending.add(task);
    tail = task.then(() => undefined, () => undefined);
  }

  async function close() {
    closed = true;
    await Promise.allSettled([...pending]);
    await io.disconnect();
  }

  return { onLine, close };
}
