import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The Move in journeys move a kitchen in from a stand-in of the other recipe app's server, a Worker of its own at
// workers.dev in the same account as the QA Worker (workers/move-in-stand-in). Without global_fetch_strictly_public, a
// fetch to the Worker's own zone goes to the zone's origin, skipping any Worker mapped to the address; with it, fetch
// goes out as if from the public internet, as a move-in from a cook's own server does
// (https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public). Cloudflare:
// "Worker-to-Worker fetch requests are possible with Service bindings or by enabling the global_fetch_strictly_public
// compatibility flag" (https://developers.cloudflare.com/workers/runtime-apis/fetch/). A service binding would read the
// stand-in without the network, which is what the journey is there to prove. Production fetches only servers in other
// accounts, where the flag makes no difference, so it keeps the default.
describe("QA Worker fetch", () => {
  it("routes QA's fetches over the public internet, keeping nodejs_compat, and leaves production's flags alone", () => {
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
      compatibility_flags: string[];
      env: { qa: { compatibility_flags?: string[] } };
    };
    expect(wrangler.env.qa.compatibility_flags).toEqual([...wrangler.compatibility_flags, "global_fetch_strictly_public"]);
    expect(wrangler.compatibility_flags).toEqual(["nodejs_compat"]);
  });
});
