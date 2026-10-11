import { useCallback, useEffect, useState } from "react";

/**
 * A form's write token: the same submission carries the same token, so a resubmit (after the
 * server could not save it, or a double tap) is recognised as the same write, and the server
 * writes it once. `renew` makes a fresh one once a write has succeeded, so the next submission is
 * a new write. The token is made in the browser, never during server rendering; until then it is
 * empty, and the server keys the write on its request alone.
 */
export function useWriteToken(): [token: string, renew: () => void] {
  const [token, setToken] = useState("");
  const renew = useCallback(() => setToken(crypto.randomUUID()), []);
  useEffect(renew, [renew]);
  return [token, renew];
}
