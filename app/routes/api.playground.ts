import { redirect } from "react-router";

function redirectToPlayground() {
  return redirect("/developers/playground", 301);
}

export function loader() {
  return redirectToPlayground();
}

export function action() {
  return redirectToPlayground();
}
