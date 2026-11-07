// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keepsFunctionNames } from "../vite.config";

describe("function names in the client build (ourostack/ouro-ui#180)", () => {
  it("keeps them where Base UI checks render-prop names, and leaves production builds minified as before", () => {
    expect(keepsFunctionNames("development")).toBe(true);
    expect(keepsFunctionNames("test")).toBe(true);
    expect(keepsFunctionNames("production")).toBe(false);
    expect(keepsFunctionNames(undefined)).toBe(false);
  });
});
