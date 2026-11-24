// The image runs the build in the Miniflare and workerd that the app's own wrangler uses, so a
// self-hosted server runs exactly what `wrangler dev` and the Journeys build were checked with.
// Bumping wrangler without bumping self-host/package.json (and its lockfile) fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const pnpmLock = parse(readFileSync("pnpm-lock.yaml", "utf8")) as {
  importers: Record<string, { devDependencies?: Record<string, { version: string }>; dependencies?: Record<string, { version: string }> }>;
  snapshots: Record<string, { dependencies?: Record<string, string> }>;
};
const selfHostPackage = JSON.parse(readFileSync("self-host/package.json", "utf8")) as { dependencies: Record<string, string> };
const selfHostLock = JSON.parse(readFileSync("self-host/package-lock.json", "utf8")) as {
  packages: Record<string, { version?: string }>;
};

const bare = (version: string) => version.split("(")[0];

function wranglerDependency(name: string): string {
  const root = pnpmLock.importers["."];
  const wrangler = root.devDependencies?.wrangler ?? root.dependencies?.wrangler;
  if (!wrangler) throw new Error("wrangler is not in pnpm-lock.yaml's root importer");
  const snapshot = pnpmLock.snapshots[`wrangler@${wrangler.version}`];
  const version = snapshot?.dependencies?.[name];
  if (!version) throw new Error(`wrangler@${wrangler.version} has no ${name} dependency in pnpm-lock.yaml`);
  return bare(version);
}

describe("self-host runtime pins", () => {
  it("pins Miniflare to the exact version the app's wrangler uses", () => {
    expect(selfHostPackage.dependencies.miniflare).toBe(wranglerDependency("miniflare"));
  });

  it("locks the image's Miniflare and workerd to wrangler's", () => {
    expect(selfHostLock.packages["node_modules/miniflare"]?.version).toBe(wranglerDependency("miniflare"));
    expect(selfHostLock.packages["node_modules/workerd"]?.version).toBe(wranglerDependency("workerd"));
  });

  it("depends on nothing but Miniflare and the mail sender, which brings nothing else in", () => {
    expect(Object.keys(selfHostPackage.dependencies)).toEqual(["miniflare", "nodemailer"]);
    const mailer = selfHostLock.packages["node_modules/nodemailer"] as { version?: string; dependencies?: Record<string, string> };
    expect(mailer.version).toBe(selfHostPackage.dependencies.nodemailer);
    expect(mailer.dependencies ?? {}).toEqual({});
  });
});
