import { useEffect, useRef, useState } from "react";
import { useNavigation, useSubmit } from "react-router";
import { NETWORK_RESEND_DELAY_MS, isNetworkFailureResult } from "~/lib/network-failure";

/**
 * Sends a submission that got no answer once more, as a new request with the same fields, when its
 * route said the intent is idempotent (NetworkFailureResult.resend). Returns true while that second
 * request is pending, so the page holds back the "couldn't be reached" message; once the second
 * request is lost too, or the resend is cancelled, it returns false and the page shows it. A later
 * Save starts over.
 *
 * The resend waits NETWORK_RESEND_DELAY_MS and is cancelled if any navigation starts meanwhile (a
 * link, or a new Save): it must never post a page's old fields after the cook has moved on.
 *
 * It covers navigation `<Form method="post">` submissions to the route's own action, URL-encoded
 * (the default): it resends with `submit(fields, { method: "post" })`. It does not cover fetchers,
 * a form with its own `action`, or another encType.
 */
export function useResendLostSubmission(actionData: unknown): boolean {
  const submit = useSubmit();
  const idle = useNavigation().state === "idle";
  // The lost result whose fields were sent again, set when the resend goes out.
  const resentFor = useRef<unknown>(undefined);
  // The lost result the page shows: a second loss, or one whose resend was cancelled.
  const [shownFor, setShownFor] = useState<unknown>(undefined);
  const resendable = isNetworkFailureResult(actionData) && actionData.resend !== null;

  useEffect(() => {
    if (!isNetworkFailureResult(actionData) || actionData.resend === null) {
      resentFor.current = undefined;
      return;
    }
    if (shownFor === actionData || resentFor.current === actionData) return;
    if (resentFor.current !== undefined || !idle) {
      // The resend was lost too, or a navigation cancelled it: show this result. A later Save
      // starts over.
      resentFor.current = undefined;
      setShownFor(actionData);
      return;
    }
    const fields = actionData.resend;
    const timer = setTimeout(() => {
      resentFor.current = actionData;
      submit(fields, { method: "post" });
    }, NETWORK_RESEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [actionData, idle, shownFor, submit]);

  return resendable && shownFor !== actionData;
}
