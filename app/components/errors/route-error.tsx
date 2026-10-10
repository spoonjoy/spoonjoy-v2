import { isRouteErrorResponse } from "react-router";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

// The words for a route error: what happened, in plain language, by status.
export function routeErrorCopy(error: unknown): { status: number; title: string; message: string } {
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;
  if (status === 404) {
    return { status, title: "Page not found.", message: "The page you're looking for doesn't exist or may have moved." };
  }
  if (status === 403) return { status, title: "Not allowed.", message: "You don't have access to this page." };
  if (status === 401) return { status, title: "Please sign in.", message: "You need to be signed in to view this page." };
  if (isResponse && status >= 400 && status < 500) {
    const message = typeof error.data === "string" && error.data.trim() ? error.data : "Try again, or head back home.";
    return { status, title: "We can't open that.", message };
  }
  return { status, title: "Something went wrong.", message: "We hit an unexpected snag. Try again in a moment." };
}

// The generic error screen, used by the root boundary (inside its own <main>) and by route
// boundaries that only special-case some errors (inside the app's <main>).
export function RouteErrorContent({ error }: { error: unknown }) {
  const { status, title, message } = routeErrorCopy(error);
  return (
    <CookbookPage>
      <CookbookHeader eyebrow="Spoonjoy" title={title}>
        <Text>{message}</Text>
      </CookbookHeader>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/">Go home</Button>
        {status === 401 ? <Button href="/login" plain>Log in</Button> : null}
      </div>
    </CookbookPage>
  );
}
