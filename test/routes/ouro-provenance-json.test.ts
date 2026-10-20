import { describe, expect, it } from "vitest";
import provenance from "~/generated/ouro-provenance.json";
import { loader } from "~/routes/ouro-provenance[.]json";

describe("/ouro-provenance.json", () => {
  it("serves the generated manifest to anyone", async () => {
    const response = loader();

    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await response.json();
    expect(body).toEqual(provenance);
    expect(body.routes).toContainEqual(expect.objectContaining({ path: "/test-kitchen", file: "app/routes/test-kitchen.tsx" }));
  });
});
