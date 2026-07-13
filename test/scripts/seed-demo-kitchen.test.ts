import { describe, expect, it } from "vitest";

import {
  DEMO_SEED_BASE_URLS,
  isProductionBaseUrl,
  main,
  parseSeedDemoKitchenArgs,
} from "../../scripts/seed-demo-kitchen.mjs";

describe("seed-demo-kitchen", () => {
  const env = { SPOONJOY_API_TOKEN: "sj_test_token" };

  it("parses explicit QA and local targets", () => {
    expect(parseSeedDemoKitchenArgs(["--target-env", "qa"], env)).toEqual({
      targetEnv: "qa",
      baseUrl: DEMO_SEED_BASE_URLS.qa,
      token: env.SPOONJOY_API_TOKEN,
    });

    expect(parseSeedDemoKitchenArgs(["--target-env", "local"], env)).toEqual({
      targetEnv: "local",
      baseUrl: DEMO_SEED_BASE_URLS.local,
      token: env.SPOONJOY_API_TOKEN,
    });
  });

  it("allows non-production base URL overrides", () => {
    expect(
      parseSeedDemoKitchenArgs(["--target-env", "qa"], {
        ...env,
        SPOONJOY_BASE_URL: "https://qa.example.test/",
      }),
    ).toEqual({
      targetEnv: "qa",
      baseUrl: "https://qa.example.test",
      token: env.SPOONJOY_API_TOKEN,
    });
  });

  it("refuses missing or production targets", () => {
    expect(() => parseSeedDemoKitchenArgs([], env)).toThrow(/--target-env qa/);
    expect(() => parseSeedDemoKitchenArgs(["--target-env", "production"], env)).toThrow(/requires/);
  });

  it("refuses production Spoonjoy domains even when passed as overrides", () => {
    expect(isProductionBaseUrl("https://spoonjoy.app")).toBe(true);
    expect(isProductionBaseUrl("https://www.spoonjoy.app")).toBe(true);
    expect(isProductionBaseUrl(DEMO_SEED_BASE_URLS.qa)).toBe(false);

    expect(() =>
      parseSeedDemoKitchenArgs(["--target-env", "qa"], {
        ...env,
        SPOONJOY_BASE_URL: "https://spoonjoy.app",
      }),
    ).toThrow(/refuses production/);
  });

  it("refuses missing API tokens", () => {
    expect(() => parseSeedDemoKitchenArgs(["--target-env", "qa"], {})).toThrow(/SPOONJOY_API_TOKEN/);
  });

  it("seeds through QA/local URLs only", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${env.SPOONJOY_API_TOKEN}`,
        "Content-Type": "application/json",
      });

      const operation = String(url).split("/api/tools/")[1];
      const payload =
        operation === "auth_status"
          ? { data: { writable: true, principal: { email: "qa-demo@example.test" } } }
          : operation === "create_recipe"
            ? { data: { recipe: { id: `recipe_${urls.length}`, title: "seeded" } } }
            : operation === "create_cookbook"
              ? { data: { cookbook: { id: "cookbook_1", title: "Weeknight Favorites" } } }
              : { data: {} };

      return new Response(JSON.stringify(payload), { status: 200 });
    };

    await main(["--target-env", "qa"], env, fetchImpl, { log: () => undefined });

    expect(urls).toHaveLength(11);
    expect(urls.every((url) => url.startsWith(`${DEMO_SEED_BASE_URLS.qa}/api/tools/`))).toBe(true);
    expect(urls.every((url) => !url.includes("spoonjoy.app"))).toBe(true);
  });
});
