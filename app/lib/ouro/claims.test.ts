import { describe, expect, it } from "vitest";
import { claim, parseClaimCheck, parseClaimSource } from "~/lib/ouro/claims";

describe("claim", () => {
  it("returns its text unchanged, so it reads as plain copy", () => {
    const text = claim("Ships 73 components.", {
      source: { file: "registry.json" },
      verify: { count: "registry:ui", is: 73 },
    });
    expect(text).toBe("Ships 73 components.");
  });

  it("takes several sources and checks", () => {
    const text = claim("Tested in Chromium and WebKit.", {
      source: [{ file: "vitest.config.ts", line: 3, commit: "c752a8bb" }, { ciRun: "https://github.com/ourostack/ouro-ui/actions/runs/1" }],
      verify: [{ ciJob: "ci" }, { fileLine: "registry/ouro/lib/ouro/testing/vitest.ts", pattern: "webkit" }],
    });
    expect(text).toBe("Tested in Chromium and WebKit.");
  });
});

describe("parseClaimSource", () => {
  it("reads a repository path, with an optional line and commit", () => {
    expect(parseClaimSource("scripts/claims.mjs")).toEqual({ file: "scripts/claims.mjs" });
    expect(parseClaimSource("scripts/claims.mjs#L12")).toEqual({ file: "scripts/claims.mjs", line: 12 });
    expect(parseClaimSource("scripts/claims.mjs#L12@c752a8bb")).toEqual({ file: "scripts/claims.mjs", line: 12, commit: "c752a8bb" });
    expect(parseClaimSource("scripts/claims.mjs@c752a8bb")).toEqual({ file: "scripts/claims.mjs", commit: "c752a8bb" });
  });

  it("reads a CI run, a test, an evidence file and a spec", () => {
    expect(parseClaimSource("https://github.com/ourostack/ouro-ui/actions/runs/123/job/456")).toEqual({ ciRun: "https://github.com/ourostack/ouro-ui/actions/runs/123/job/456" });
    expect(parseClaimSource("test:a.test.ts::A > works")).toEqual({ test: "a.test.ts::A > works" });
    expect(parseClaimSource("evidence:scripts/agent-usability/runs/2026-10-15/results.md")).toEqual({ evidence: "scripts/agent-usability/runs/2026-10-15/results.md" });
    expect(parseClaimSource("https://www.w3.org/TR/WCAG22/#target-size-minimum")).toEqual({ spec: "https://www.w3.org/TR/WCAG22/#target-size-minimum" });
  });

  it("refuses what is not a primary source, saying what would be", () => {
    expect(() => parseClaimSource("")).toThrow(/needs a source/);
    expect(() => parseClaimSource("/etc/hosts")).toThrow(/repository-relative path/);
    expect(() => parseClaimSource("../desk/notes.md")).toThrow(/repository-relative path/);
    expect(() => parseClaimSource("my notes")).toThrow(/repository-relative path/);
    expect(() => parseClaimSource("notes.md#section")).toThrow(/<repository path>\[#L<line>\]\[@<commit>\]/);
    expect(() => parseClaimSource("test:a.test.ts")).toThrow(/<file>::<full test name>/);
    expect(() => parseClaimSource("evidence:")).toThrow(/evidence:<repository path>/);
  });
});

describe("parseClaimCheck", () => {
  it("reads each check", () => {
    expect(parseClaimCheck("count(registry:ui)=73")).toEqual({ count: "registry:ui", is: 73 });
    expect(parseClaimCheck("urlOk(https://ui.shadcn.com/docs)")).toEqual({ urlOk: "https://ui.shadcn.com/docs" });
    expect(parseClaimCheck("testExists(a.test.ts::A > works, with commas)")).toEqual({ testExists: "a.test.ts::A > works, with commas" });
    expect(parseClaimCheck("ciJob(ci)")).toEqual({ ciJob: "ci" });
    expect(parseClaimCheck("ciJob(ci.yml#motion-coverage)")).toEqual({ ciJob: "motion-coverage", workflow: "ci.yml" });
    expect(parseClaimCheck("fileLine(app.css, /ouro-base\\.css/)")).toEqual({ fileLine: "app.css", pattern: "ouro-base\\.css" });
    expect(parseClaimCheck("fileLine(app.css#L4, /a, b/)")).toEqual({ fileLine: "app.css", line: 4, pattern: "a, b" });
    expect(parseClaimCheck("equals(package.json#ouro.latestRelease)=v1.1.0")).toEqual({ equals: "package.json#ouro.latestRelease", is: "v1.1.0" });
    expect(parseClaimCheck("equals(package.json#engines.node)=>=22")).toEqual({ equals: "package.json#engines.node", is: ">=22" });
    expect(parseClaimCheck(" count(package.json#ouro) = 1 ")).toEqual({ count: "package.json#ouro", is: 1 });
    expect(parseClaimCheck("equals(test/fixture.json#size)=44")).toEqual({ equals: "test/fixture.json#size", is: 44 });
  });

  it("refuses an unknown or malformed check, listing the forms", () => {
    expect(() => parseClaimCheck("trust me")).toThrow(/is not a check/);
    expect(() => parseClaimCheck("trustMe()")).toThrow(/count\(<what>\)=<n>.*urlOk.*testExists.*ciJob.*fileLine.*equals/s);
    expect(() => parseClaimCheck("count(registry:ui)")).toThrow(/count\(<what>\)=<n>/);
    expect(() => parseClaimCheck("count(registry:ui)=many")).toThrow(/count\(<what>\)=<n>/);
    expect(() => parseClaimCheck("urlOk(ftp://example.com)")).toThrow(/urlOk\(<https URL>\)/);
    expect(() => parseClaimCheck("testExists(a.test.ts)")).toThrow(/<file>::<full test name>/);
    expect(() => parseClaimCheck("fileLine(app.css, ouro)")).toThrow(/fileLine\(<path>\[#L<line>\], \/<pattern>\/\)/);
    expect(() => parseClaimCheck("fileLine(/abs.css, /x/)")).toThrow(/repository-relative path/);
    expect(() => parseClaimCheck("fileLine(app.css, /(/)")).toThrow(/not a valid pattern/);
    expect(() => parseClaimCheck("equals(package.json)=1")).toThrow(/equals\(<file>#<field path>\)=<value>/);
    expect(() => parseClaimCheck("equals(package.json#a)=")).toThrow(/equals\(<file>#<field path>\)=<value>/);
  });
});
