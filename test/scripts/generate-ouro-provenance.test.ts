import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  OUTPUT_PATH,
  buildProvenance,
  defaultDeps,
  importGraph,
  installedItems,
  isCliEntry,
  itemForOuroFile,
  listFiles,
  main,
  parseRoutes,
  readOuroTag,
  rendersPage,
  resolveImport,
  runCliIfEntry,
  serializeProvenance,
} from "../../scripts/generate-ouro-provenance.mjs";

/** A small app in memory: the routes, a root, two pages, a view and the installed HX they use. */
function fixture(overrides: Record<string, string | undefined> = {}) {
  const files: Record<string, string | undefined> = {
    "app/routes.ts": `import { index, layout, prefix, route } from "@react-router/dev/routes";
export default [
  index("routes/home.tsx"),
  route("kitchen", "routes/kitchen.tsx", [route("deep", "routes/deep.tsx")]),
  layout("routes/shell.tsx", [route("inside", "routes/inside.tsx")]),
  ...prefix("api", [route("ping", "routes/ping.ts")]),
] satisfies RouteConfig;`,
    "app/root.tsx": `import { Button } from "~/components/ouro/button/button";\nexport default function Root() {}`,
    "app/routes/home.tsx": `import { View } from "../components/view";\nimport { Text } from "~/components/ouro/text/text";\nimport "./home.css";\nimport type { Thing } from "~/lib/thing";\nimport data from "~/lib/data.json";\nexport default function Home() {}`,
    "app/routes/home.css": "",
    "app/lib/data.json": "{}",
    "app/lib/thing.server.ts": "",
    "app/lib/thing.ts": `import { cn } from "~/lib/ouro/cn";\nimport { View } from "~/components/view";\nexport type Thing = 1;`,
    "app/lib/ouro/cn.ts": "",
    "app/components/view/index.tsx": `import { ChecklistRoot } from "~/components/ouro/checklist/checklist-parts";\nimport { Text } from "~/components/ouro/text/text";\nimport { useState } from "react";\nexport function View() {}`,
    "app/routes/kitchen.tsx": `export default function Kitchen() {}`,
    "app/routes/deep.tsx": `export default function Deep() {}`,
    "app/routes/shell.tsx": `export default function Shell() {}`,
    "app/routes/inside.tsx": `export default function Inside() {}`,
    "app/routes/ping.ts": `export function loader() {}`,
    "app/lib/ouro/dev.ts": `const fix = "npx shadcn@latest add ourostack/ouro-ui/ouro-base#v1.1.0";`,
    "app/components/ouro/button/button.tsx": "",
    "app/components/ouro/checklist/checklist-parts.tsx": "",
    "app/components/ouro/text/text.tsx": "",
    ...overrides,
  };
  return {
    files,
    deps: {
      readFile: (file: string) => {
        const source = files[file];
        if (source === undefined) throw new Error(`no ${file}`);
        return source;
      },
      exists: (file: string) => files[file] !== undefined,
    },
    ouroFiles: [
      "app/components/ouro/button/button.tsx",
      "app/components/ouro/button/button.test.tsx",
      "app/components/ouro/checklist/checklist.tsx",
      "app/components/ouro/checklist/checklist-parts.tsx",
      "app/components/ouro/checklist/checklist-styles.ts",
      "app/components/ouro/checklist/checklist.stories.tsx",
      "app/components/ouro/checklist/checklist.touch.test.tsx",
      "app/components/ouro/checklist/checklist.test-d.ts",
      "app/components/ouro/checklist/README.md",
      "app/components/ouro/text/text.tsx",
      "app/lib/ouro/cn.ts",
    ],
  };
}

describe("parseRoutes", () => {
  it("reads routes, indexes, layouts and prefixes with their full paths", () => {
    expect(parseRoutes(fixture().files["app/routes.ts"])).toEqual([
      { path: "/", file: "app/routes/home.tsx" },
      { path: "/kitchen", file: "app/routes/kitchen.tsx" },
      { path: "/kitchen/deep", file: "app/routes/deep.tsx" },
      { path: "/", file: "app/routes/shell.tsx" },
      { path: "/inside", file: "app/routes/inside.tsx" },
      { path: "/api/ping", file: "app/routes/ping.ts" },
    ]);
  });

  it("reads a plain exported list, and ignores calls it does not know and nesting that is not a list", () => {
    expect(parseRoutes(`export default [route("a", "routes/a.tsx", children), other("b"), layout("routes/l.tsx"), ...prefix("p", list), "x"] as RouteConfig;`)).toEqual([
      { path: "/a", file: "app/routes/a.tsx" },
      { path: "/", file: "app/routes/l.tsx" },
    ]);
    expect(parseRoutes(`export default routes;`)).toEqual([]);
  });

  it("refuses a path or a file that is not written as a string", () => {
    expect(() => parseRoutes(`export default [route(somePath, "routes/a.tsx")];`)).toThrow("write each route's path and file as a string, not somePath");
  });

  it("reads the app's own routes, the Test Kitchen among them", () => {
    const routes = parseRoutes(readFileSync("app/routes.ts", "utf8"));
    expect(routes).toContainEqual({ path: "/test-kitchen", file: "app/routes/test-kitchen.tsx" });
    expect(routes).toContainEqual({ path: "/recipes/:id", file: "app/routes/recipes.$id.tsx" });
  });
});

describe("files and items", () => {
  it("knows a page by its default export", () => {
    expect(rendersPage("export default function Page() {}")).toBe(true);
    expect(rendersPage("export function loader() {}")).toBe(false);
  });

  it("names the HX item an installed file belongs to", () => {
    expect(itemForOuroFile("app/components/ouro/checklist/checklist-parts.tsx")).toBe("checklist");
    expect(itemForOuroFile("app/components/ouro/checklist/checklist-styles.ts")).toBe("checklist");
    expect(itemForOuroFile("app/components/ouro/dialog/confirm-dialog.tsx")).toBe("confirm-dialog");
    expect(itemForOuroFile("app/components/ouro/toast/toast-context.tsx")).toBe("toast");
    expect(itemForOuroFile("app/lib/ouro/cn.ts")).toBeNull();
  });

  it("lists the installed items, without tests, stories or other files", () => {
    expect([...installedItems(fixture().ouroFiles)].sort()).toEqual(["button", "checklist", "text"]);
  });

  it("resolves app imports, and leaves packages alone", () => {
    const { exists } = fixture().deps;
    expect(resolveImport("~/components/view", "app/routes/home.tsx", exists)).toBe("app/components/view/index.tsx");
    expect(resolveImport("../components/view", "app/routes/home.tsx", exists)).toBe("app/components/view/index.tsx");
    expect(resolveImport("~/lib/thing", "app/routes/home.tsx", exists)).toBe("app/lib/thing.ts");
    expect(resolveImport("~/lib/thing.server", "app/routes/home.tsx", exists)).toBe("app/lib/thing.server.ts");
    expect(resolveImport("./home.css", "app/routes/home.tsx", exists)).toBe("app/routes/home.css");
    expect(resolveImport("./home.css?url", "app/routes/home.tsx", exists)).toBe("app/routes/home.css");
    expect(resolveImport("react", "app/routes/home.tsx", exists)).toBeNull();
    expect(resolveImport("./+types/home", "app/routes/home.tsx", exists)).toBeNull();
  });

  it("fails on an app import that resolves to nothing", () => {
    const { exists } = fixture().deps;
    expect(() => resolveImport("./gone.css", "app/routes/home.tsx", exists)).toThrow("app/routes/home.tsx imports ./gone.css, which does not exist");
    expect(() => resolveImport("~/lib/missing", "app/routes/home.tsx", exists)).toThrow("imports ~/lib/missing, which does not exist");
  });

  it("follows a page's imports to the HX it renders, and stops at HX", () => {
    expect(importGraph("app/routes/home.tsx", fixture().deps)).toEqual({
      sources: ["app/routes/home.tsx", "app/components/view/index.tsx", "app/lib/thing.ts"],
      renders: {
        checklist: ["app/components/view/index.tsx"],
        text: ["app/components/view/index.tsx", "app/routes/home.tsx"],
      },
    });
  });

  it("reads the installed release from HX's own source", () => {
    expect(readOuroTag(fixture().files["app/lib/ouro/dev.ts"]!)).toBe("v1.1.0");
    expect(() => readOuroTag("nothing here")).toThrow("names no Ouro HX release");
  });
});

describe("buildProvenance", () => {
  it("records the release, the root, and every page with its sources and the HX it renders", () => {
    const { deps, ouroFiles } = fixture();
    const provenance = buildProvenance({ ...deps, ouroFiles });

    expect(provenance.guide).toBe("https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/building-with-ouro-hx.md");
    expect(provenance.ouroTag).toBe("v1.1.0");
    expect(provenance.root).toEqual({
      file: "app/root.tsx",
      sources: ["app/root.tsx"],
      components: ["button"],
      renders: { button: ["app/root.tsx"] },
    });
    expect(provenance.routes.map((route: { path: string }) => route.path)).toEqual(["/", "/kitchen", "/kitchen/deep", "/", "/inside"]);
    expect(provenance.routes[0]).toMatchObject({ path: "/", file: "app/routes/home.tsx", components: ["checklist", "text"] });
  });

  it("fails on a route whose module is missing", () => {
    const { deps, ouroFiles } = fixture({ "app/routes/deep.tsx": undefined });
    expect(() => buildProvenance({ ...deps, ouroFiles })).toThrow("names app/routes/deep.tsx, which does not exist");
  });

  it("fails on a page that imports an HX item that is not installed", () => {
    const { deps, ouroFiles } = fixture({
      "app/routes/kitchen.tsx": `import { Ghost } from "~/components/ouro/ghost/ghost";\nexport default function Kitchen() {}`,
      "app/components/ouro/ghost/ghost.tsx": "",
    });
    expect(() => buildProvenance({ ...deps, ouroFiles })).toThrow('app/routes/kitchen.tsx imports "ghost", which is not an installed Ouro HX item');
  });
});

describe("main", () => {
  const readdir = () => [
    { isFile: () => true, parentPath: "app/components/ouro/button", name: "button.tsx" },
    { isFile: () => false, parentPath: "app/components/ouro", name: "button" },
    { isFile: () => true, path: "app/components/ouro/text", name: "text.tsx" },
    { isFile: () => true, parentPath: "app/components/ouro/checklist", name: "checklist-parts.tsx" },
  ];

  it("lists files under a directory as repository paths", () => {
    expect(listFiles("app/components/ouro/", readdir as never)).toEqual([
      "app/components/ouro/button/button.tsx",
      "app/components/ouro/checklist/checklist-parts.tsx",
      "app/components/ouro/text/text.tsx",
    ]);
  });

  it("writes the manifest, then checks it is current, and fails once it is stale", () => {
    const { files, deps } = fixture();
    const writeFile = vi.fn((file: string, contents: string) => {
      files[file] = contents;
    });
    const io = { log: vi.fn(), error: vi.fn() };

    main([], { ...deps, writeFile }, io, readdir as never);
    expect(writeFile).toHaveBeenCalledWith(OUTPUT_PATH, expect.stringContaining('"ouroTag": "v1.1.0"'));
    expect(io.log).toHaveBeenLastCalledWith(`Wrote ${OUTPUT_PATH}.`);

    main(["--check"], { ...deps, writeFile }, io, readdir as never);
    expect(io.log).toHaveBeenLastCalledWith(`${OUTPUT_PATH} is current.`);

    files[OUTPUT_PATH] = "{}\n";
    expect(() => main(["--check"], { ...deps, writeFile }, io, readdir as never)).toThrow("is stale. Run: pnpm provenance:generate");
    delete files[OUTPUT_PATH];
    expect(() => main(["--check"], { ...deps, writeFile }, io, readdir as never)).toThrow("is stale");
  });

  it("refuses arguments it does not know", () => {
    expect(() => main(["--write"], fixture().deps as never, console, readdir as never)).toThrow("Usage: generate-ouro-provenance.mjs [--check]");
  });

  it("matches the committed manifest", { timeout: 60_000 }, () => {
    const committed = readFileSync(OUTPUT_PATH, "utf8");
    const ouroFiles = listFiles("app/components/ouro/", readdirSync as never);
    expect(serializeProvenance(buildProvenance({ ...defaultDeps, ouroFiles }))).toBe(committed);
  });

  it("reads and writes real files by default", () => {
    expect(defaultDeps.exists("app/routes.ts")).toBe(true);
    expect(defaultDeps.readFile("app/routes.ts")).toContain("test-kitchen");
    // Writing the committed manifest over itself changes nothing.
    defaultDeps.writeFile(OUTPUT_PATH, readFileSync(OUTPUT_PATH, "utf8"));
    expect(readFileSync(OUTPUT_PATH, "utf8")).toContain('"ouroTag"');
  });
});

describe("the command line", () => {
  it("runs nothing when imported", async () => {
    expect(await runCliIfEntry()).toBe(false);
  });

  it("runs only as the entry script", async () => {
    expect(isCliEntry("file:///repo/scripts/generate-ouro-provenance.mjs", "/repo/scripts/generate-ouro-provenance.mjs")).toBe(true);
    expect(isCliEntry("file:///repo/scripts/generate-ouro-provenance.mjs", undefined)).toBe(false);
    expect(await runCliIfEntry({ moduleUrl: "file:///elsewhere.mjs", argv1: "/repo/x.mjs" })).toBe(false);
  });

  it("reports a failure and sets the exit code", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exitCode = process.exitCode;
    await runCliIfEntry({ moduleUrl: "file:///repo/x.mjs", argv1: "/repo/x.mjs", io, runMain: () => { throw new Error("stale"); } });
    expect(io.error).toHaveBeenCalledWith("stale");
    await runCliIfEntry({ moduleUrl: "file:///repo/x.mjs", argv1: "/repo/x.mjs", io, runMain: () => { throw "plain"; } });
    expect(io.error).toHaveBeenCalledWith("plain");
    expect(process.exitCode).toBe(1);
    process.exitCode = exitCode;
  });

  it("checks the committed manifest through the default runner", { timeout: 60_000 }, async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const argv = process.argv;
    process.argv = ["node", "/repo/x.mjs", "--check"];
    try {
      await runCliIfEntry({ moduleUrl: "file:///repo/x.mjs", argv1: "/repo/x.mjs", io });
    } finally {
      process.argv = argv;
    }
    expect(io.error).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledWith(`${OUTPUT_PATH} is current.`);
  });
});
