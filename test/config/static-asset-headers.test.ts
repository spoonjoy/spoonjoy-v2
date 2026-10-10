import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type HeaderRule = { pattern: string; headers: Record<string, string> };

// Minimal parser for the Cloudflare `_headers` format: an unindented URL pattern
// line followed by indented `Name: value` lines.
function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: {} });
      continue;
    }
    const rule = rules.at(-1);
    if (!rule) throw new Error(`header line before any pattern: ${raw}`);
    const [name, ...value] = raw.trim().split(":");
    rule.headers[name.trim().toLowerCase()] = value.join(":").trim();
  }
  return rules;
}

function matches(pattern: string, pathname: string) {
  const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return regex.test(pathname);
}

function cacheControlFor(rules: HeaderRule[], pathname: string) {
  return rules.filter((rule) => matches(rule.pattern, pathname)).map((rule) => rule.headers["cache-control"]).filter(Boolean);
}

describe("static asset cache headers", () => {
  const rules = parseHeadersFile(readFileSync(path.join(process.cwd(), "public/_headers"), "utf8"));

  it("caches fingerprinted /assets/ files for a year as immutable", () => {
    expect(cacheControlFor(rules, "/assets/root-CFFi606f.js")).toEqual(["public, max-age=31536000, immutable"]);
    expect(cacheControlFor(rules, "/assets/app-Bx12abCd.css")).toEqual(["public, max-age=31536000, immutable"]);
  });

  it("leaves unhashed public files on the default revalidating policy", () => {
    for (const pathname of ["/sw.js", "/manifest.webmanifest", "/offline.html", "/icons/icon-192.png", "/images/landing.jpg", "/"]) {
      expect(cacheControlFor(rules, pathname)).toEqual([]);
    }
  });

  it("never marks a non-asset path immutable", () => {
    for (const rule of rules) {
      if (rule.headers["cache-control"]?.includes("immutable")) expect(rule.pattern).toBe("/assets/*");
    }
  });
});
