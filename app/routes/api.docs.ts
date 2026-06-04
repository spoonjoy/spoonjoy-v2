import { redirect } from "react-router";

function redirectToDeveloperDocs(request: Request) {
  const url = new URL(request.url);
  const target = `/api${url.search}`;
  return redirect(target, 301);
}

export function loader({ request }: { request: Request }) {
  return redirectToDeveloperDocs(request);
}

export function action({ request }: { request: Request }) {
  return redirectToDeveloperDocs(request);
}
