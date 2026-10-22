import { useEffect, useRef } from "react";
import { useSubmit } from "react-router";
import { NETWORK_RESEND_DELAY_MS, isNetworkFailureResult } from "~/lib/network-failure";

/**
 * Sends a submission that got no answer once more, as a new request with the same fields, when its
 * route said the intent is idempotent (NetworkFailureResult.resend). Returns true while that second
 * request is on its way, so the page holds back the "couldn't be reached" message; if the second
 * request is lost too, it returns false and the page shows it. A later Save starts over.
 */
export function useResendLostSubmission(actionData: unknown): boolean {
  const submit = useSubmit();
  // The lost result this hook has already sent again; undefined when none is pending.
  const resentFor = useRef<unknown>(undefined);
  const mounted = useRef(true);
  const resendable = isNetworkFailureResult(actionData) && actionData.resend !== null;
  const holding = resendable && (resentFor.current === undefined || resentFor.current === actionData);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isNetworkFailureResult(actionData) || actionData.resend === null) {
      resentFor.current = undefined;
      return;
    }
    if (resentFor.current !== undefined) {
      // The second request was lost too: show it, and let the next Save be sent again.
      if (resentFor.current !== actionData) resentFor.current = undefined;
      return;
    }
    resentFor.current = actionData;
    const fields = actionData.resend;
    setTimeout(() => {
      if (mounted.current) submit(fields, { method: "post" });
    }, NETWORK_RESEND_DELAY_MS);
  }, [actionData, submit]);

  return holding;
}
