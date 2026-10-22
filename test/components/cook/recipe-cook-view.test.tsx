import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { CookController, CookRecipe } from "~/components/cook/cook-controller";
import { clampStepIndex, toggledId } from "~/components/cook/cook-controller";
import { RecipeCookView } from "~/components/cook/RecipeCookView";
import { Timer } from "~/components/ouro/timer/timer";

const ROOT = path.resolve(__dirname, "../../..");
const ALIASES: Array<[string, string]> = [
  ["~/", "app/"],
  ["@/", "app/components/"],
];
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveLocal(specifier: string, fromFile: string): string | null {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  const base = alias
    ? path.join(ROOT, alias[1], specifier.slice(alias[0].length))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  const file = EXTENSIONS.map((extension) => base + extension).find((candidate) => existsSync(candidate) && candidate.match(/\.tsx?$/));
  if (!file) throw new Error(`Cannot resolve ${specifier} from ${path.relative(ROOT, fromFile)}`);
  return file;
}

/** Every package the module imports, directly or through the app modules it imports (types included). */
function packagesReachableFrom(entry: string): { packages: Set<string>; modules: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [path.join(ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const { fileName } of importedFiles) {
      const local = resolveLocal(fileName, file);
      if (local) pending.push(local);
      else packages.add(fileName);
    }
  }
  return { packages, modules: new Set(Array.from(modules, (file) => path.relative(ROOT, file))) };
}

function isRouterPackage(specifier: string): boolean {
  return /^(?:react-router|@react-router\/)/.test(specifier);
}

function fakeController(recipe: CookRecipe, overrides: Partial<CookController> = {}): CookController {
  return {
    recipe,
    checkedIngredientIds: new Set(),
    checkedStepOutputIds: new Set(),
    activeStepIndex: 0,
    scaleFactor: 1,
    cookMode: false,
    timers: [],
    toggleIngredient: vi.fn(),
    toggleStepOutput: vi.fn(),
    setScale: vi.fn(),
    goToStep: vi.fn(),
    enterCookMode: vi.fn(),
    exitCookMode: vi.fn(),
    clearProgress: vi.fn(),
    ...overrides,
  };
}

const BARE_RECIPE: CookRecipe = {
  id: "bare",
  title: "Bare Toast",
  steps: [
    { id: "s1", stepNum: 1, stepTitle: null, description: "Toast the bread." },
    { id: "s2", stepNum: 2, stepTitle: "Butter", description: "Butter it.", duration: 2 },
  ],
  ingredientsByStep: new Map(),
  stepOutputUsesByStep: new Map(),
};

describe("RecipeCookView", () => {
  it("imports nothing from React Router, directly or through anything it imports", () => {
    const { packages, modules } = packagesReachableFrom("app/components/cook/RecipeCookView.tsx");

    expect(modules).toContain("app/components/cook/cook-controller.ts");
    expect(modules).toContain("app/components/recipe/IngredientList.tsx");
    // Two imports away: the walk follows the view's imports' imports.
    expect(modules).toContain("app/components/ouro/checklist/checklist.tsx");
    expect(packages).toContain("react");
    expect(Array.from(packages).filter(isRouterPackage)).toEqual([]);
  });

  it("finds React Router where it is imported, so the module walk sees what it must", () => {
    const { packages, modules } = packagesReachableFrom("app/hooks/use-route-cook-controller.ts");

    expect(modules).toContain("app/components/cook/cook-controller.ts");
    expect(Array.from(packages).filter(isRouterPackage)).toContain("react-router");
    expect(() => resolveLocal("./missing-module", path.join(ROOT, "app/hooks/use-route-cook-controller.ts"))).toThrow(
      "Cannot resolve ./missing-module from app/hooks/use-route-cook-controller.ts",
    );
  });

  it("shows a recipe without steps, with the page's own action and content", () => {
    const controller = fakeController({ ...BARE_RECIPE, steps: [] });
    render(
      <RecipeCookView controller={controller} emptyStepsAction={<span>Add the first step</span>}>
        <p>After the steps</p>
      </RecipeCookView>,
    );

    expect(screen.getByText("No steps added yet")).toBeInTheDocument();
    expect(screen.getByText("Add the first step")).toBeInTheDocument();
    expect(screen.getByText("After the steps")).toBeInTheDocument();
    expect(screen.queryByTestId("cook-mode-panel")).not.toBeInTheDocument();
  });

  it("shows steps whose checklists are missing from the recipe as having none", () => {
    render(<RecipeCookView controller={fakeController(BARE_RECIPE)} />);

    expect(screen.getByText("Toast the bread.")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText("No steps added yet")).not.toBeInTheDocument();
  });

  it("asks the controller to go to the step a timer belongs to", async () => {
    const goToStep = vi.fn();
    const timers = [{ stepNum: 2, label: "Step 2 · Butter", duration: 120, timerId: "recipe-cook-view:2" }];
    render(
      <>
        <Timer label="Step 2 · Butter" duration={120} timerId="recipe-cook-view:2" />
        <RecipeCookView controller={fakeController(BARE_RECIPE, { cookMode: true, goToStep, timers })} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    const panel = screen.getByTestId("cook-mode-panel");
    expect(within(panel).getAllByText("No checklist items")).toHaveLength(2);
    expect(within(panel).getByText("No ingredients to check on this step.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("link", { name: "Go to Step 2 · Butter" }));
    expect(goToStep).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("cook controller helpers", () => {
  it("keeps a step index inside the recipe", () => {
    expect(clampStepIndex(-1, 3)).toBe(0);
    expect(clampStepIndex(1, 3)).toBe(1);
    expect(clampStepIndex(7, 3)).toBe(2);
    expect(clampStepIndex(4, 0)).toBe(0);
  });

  it("toggles an id in a copy of the set", () => {
    const ids = new Set(["a"]);
    expect(Array.from(toggledId(ids, "b"))).toEqual(["a", "b"]);
    expect(Array.from(toggledId(ids, "a"))).toEqual([]);
    expect(Array.from(ids)).toEqual(["a"]);
  });
});
