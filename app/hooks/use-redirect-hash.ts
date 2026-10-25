import { useEffect } from "react";
import { useSearchParams } from "react-router";

/**
 * The sign-in page's `redirectTo`, with the fragment of the page that sent the chef here.
 *
 * A signed-out request for `/account/settings#delete-account` is redirected to
 * `/login?redirectTo=%2Faccount%2Fsettings`: the server never sees the fragment, but the browser
 * keeps it on the login URL. Once hydrated, this moves it into `redirectTo`, so signing in (with a
 * password, a passkey or a provider) returns the chef to the same place on the page.
 */
export function useRedirectToWithHash(): string | undefined {
  const [searchParams, setSearchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  useEffect(() => {
    const hash = window.location.hash;
    if (!redirectTo || redirectTo.includes("#") || hash.length < 2) return;
    const next = new URLSearchParams(searchParams);
    next.set("redirectTo", `${redirectTo}${hash}`);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [redirectTo, searchParams, setSearchParams]);
  return redirectTo;
}
