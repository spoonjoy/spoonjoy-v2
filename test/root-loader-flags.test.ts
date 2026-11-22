// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loader } from "~/root";
import { FLAG_NAMES } from "~/domains/platform";

describe("root loader flags", () => {
  async function flagsWith(env: Record<string, string>) {
    const data = await loader({ request: new Request("http://localhost/"), params: {}, context: { cloudflare: { env } } } as never);
    return data.flags;
  }

  it("hands the client every flag in QA and none in production", async () => {
    expect(await flagsWith({ SPOONJOY_FLAGS: "all" })).toEqual([...FLAG_NAMES]);
    expect(await flagsWith({})).toEqual([]);
  });
});
