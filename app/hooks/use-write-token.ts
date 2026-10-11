import { useCallback, useEffect, useState } from "react";
import { useActionData } from "react-router";

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

/**
 * A write token for forms that post to the route's action, renewed when the action answers
 * success for one of `intents`. A resubmit of the same submission (after a 503 or a lost answer)
 * keeps the token; the next real submission gets a new one.
 */
export function useActionWriteToken(intents: readonly string[]): string {
  const [token, renew] = useWriteToken();
  const actionData = useActionData() as { success?: unknown; intent?: unknown } | undefined;
  const intentList = intents.join("\n");
  useEffect(() => {
    if (actionData?.success === true && intentList.split("\n").includes(String(actionData.intent))) renew();
  }, [actionData, intentList, renew]);
  return token;
}
