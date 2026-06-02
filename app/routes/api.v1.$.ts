import type { Route } from "./+types/api.v1.$";
import { handleApiV1Request } from "~/lib/api-v1.server";

export async function loader(args: Route.LoaderArgs) {
  return handleApiV1Request(args);
}

export async function action(args: Route.ActionArgs) {
  return handleApiV1Request(args);
}
