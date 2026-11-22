import { useRouteLoaderData } from "react-router";
import type { FlagName } from "./flags";

/** Whether a flag is on for the person viewing, read from the flags the root loader resolved on the server. */
export function useFlag(name: FlagName): boolean {
  const data = useRouteLoaderData<{ flags?: readonly string[] }>("root");
  return data?.flags?.includes(name) ?? false;
}
