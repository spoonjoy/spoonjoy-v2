import { redirect } from "react-router";

function redirectToOpenApiSpec() {
  return redirect("/api/v1/openapi.json", 301);
}

export function loader() {
  return redirectToOpenApiSpec();
}

export function action() {
  return redirectToOpenApiSpec();
}
