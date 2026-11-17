import { describe, expect, it } from "vitest";
import provenance from "~/generated/ouro-provenance.json";
import { OURO_PROVENANCE } from "~/lib/ouro-provenance.server";
import { loader } from "~/routes/ouro-provenance[.]json";

describe("/ouro-provenance.json", () => {
  it("serves the generated manifest, with the installed HX release, to anyone", async () => {
    const response = loader();

    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await response.json();
    expect(body).toEqual({ ...provenance, ouroTag: OURO_PROVENANCE.ouroTag });
    expect(Object.keys(body)).toEqual(["guide", "ouroTag", "root", "routes"]);
    expect(body.routes).toContainEqual(expect.objectContaining({ path: "/test-kitchen", file: "app/routes/test-kitchen.tsx" }));
  });
});
