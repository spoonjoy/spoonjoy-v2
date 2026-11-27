// @vitest-environment node
// Every copy of the push relay's address is RELAY_URL, so moving the relay (to push.spoonjoy.app,
// once the spoonjoy.app zone is in production's Cloudflare account) is one change the tests follow.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELAY_URL } from "../../workers/push-relay/index";
import { DEFAULT_PUSH_RELAY_URL } from "~/lib/native-push.server";
import { DEFAULT_RELAY_URL } from "../../scripts/production-push-relay-key";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { DEFAULT_PUSH_RELAY_URL as SELF_HOST_RELAY_URL } from "../../self-host/push-relay.mjs";

describe("the push relay's address", () => {
  it("is the same in Spoonjoy, the self-host image and the production key script", () => {
    expect(DEFAULT_PUSH_RELAY_URL).toBe(RELAY_URL);
    expect(SELF_HOST_RELAY_URL).toBe(RELAY_URL);
    expect(DEFAULT_RELAY_URL).toBe(RELAY_URL);
  });

  it("is the default the deployment and self-hosting docs give", () => {
    expect(readFileSync("docs/self-hosting.md", "utf8")).toContain(`| \`${RELAY_URL}\` |`);
    expect(readFileSync("docs/deployment.md", "utf8")).toContain(`\`${RELAY_URL}\``);
  });
});
