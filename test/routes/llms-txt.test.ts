import { describe, expect, it } from "vitest";
import { loader, llmsText } from "~/routes/llms[.]txt";

describe("/llms.txt", () => {
  it("says hello in plain text and links the Test Kitchen, the source, the API, MCP and the provenance", async () => {
    const response = loader({
      request: new Request("https://spoonjoy.app/llms.txt"),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
      params: {},
    } as never);

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text).toMatch(/^# Spoonjoy\n/);
    for (const link of [
      "https://spoonjoy.app/test-kitchen",
      "https://github.com/spoonjoy/spoonjoy-v2",
      "https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/building-with-ouro-hx.md",
      "https://spoonjoy.app/developers",
      "https://spoonjoy.app/api/docs",
      "https://spoonjoy.app/mcp",
      "https://spoonjoy.app/ouro-provenance.json",
    ]) {
      expect(text).toContain(`](${link})`);
    }
  });

  it("links the origin it is served from", () => {
    expect(llmsText("http://localhost:5173")).toContain("(http://localhost:5173/test-kitchen)");
  });
});
