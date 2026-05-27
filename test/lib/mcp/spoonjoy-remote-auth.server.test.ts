import { describe, expect, it } from "vitest";
import { spoonjoyRemoteAuthorizationHeader } from "../../../app/lib/mcp/spoonjoy-remote-auth.server";

describe("spoonjoyRemoteAuthorizationHeader", () => {
  it("keeps delegated-auth bootstrap calls tokenless so stale vault tokens cannot block reauthorization", () => {
    expect(spoonjoyRemoteAuthorizationHeader("start_agent_connection", "sj_live")).toBeNull();
    expect(spoonjoyRemoteAuthorizationHeader("poll_agent_connection", "sj_live")).toBeNull();
  });

  it("sends the token to status and normal tools once a delegated session has one", () => {
    expect(spoonjoyRemoteAuthorizationHeader("auth_status", " sj_live ")).toBe("Bearer sj_live");
    expect(spoonjoyRemoteAuthorizationHeader("health", "sj_live")).toBe("Bearer sj_live");
    expect(spoonjoyRemoteAuthorizationHeader("create_recipe", "sj_live")).toBe("Bearer sj_live");
  });

  it("omits auth when there is no token or operation", () => {
    expect(spoonjoyRemoteAuthorizationHeader("auth_status", "")).toBeNull();
    expect(spoonjoyRemoteAuthorizationHeader(undefined, "sj_live")).toBeNull();
  });
});
