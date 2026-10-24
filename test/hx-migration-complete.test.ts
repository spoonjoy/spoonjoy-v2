import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { unmarkedCounts, validateCensus } from "../e2e/ouro-census/census.mjs";

describe("complete HX migration", () => {
  it("keeps no source-rule waivers", () => {
    const baseline = JSON.parse(readFileSync("ouro-source-rules.baseline.json", "utf8"));
    expect(baseline.offenders).toEqual({});
    expect(baseline.allowedRegressions ?? []).toEqual([]);
  });

  it("enrols every census journey and retains its fully marked structural snapshot", () => {
    const source = ts.createSourceFile("hx-census.ts",
      readFileSync("e2e/journeys/support/hx-census.ts", "utf8"), ts.ScriptTarget.Latest, true);
    let journeys: ts.ArrayLiteralExpression | undefined;
    const constants = new Map<string, ts.Expression>();
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        constants.set(node.name.text, node.initializer);
        if (node.name.text === "census" && ts.isArrayLiteralExpression(node.initializer)) journeys = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!journeys) throw new Error("The app's census journey list was not found");
    const expectedStates = new Map<string, string[]>();
    const ids = journeys.elements.map((journey) => {
      if (!ts.isObjectLiteralExpression(journey)) throw new Error("Expected a census journey object");
      const property = (name: string) => journey.properties.find(
        (node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && node.name.getText(source) === name,
      )?.initializer;
      const id = property("id");
      if (!id || !ts.isStringLiteral(id)) throw new Error("Expected a census journey ID");
      expect(property("enrolled")?.kind, id.text).toBe(ts.SyntaxKind.TrueKeyword);
      const states = property("states");
      if (!states || !ts.isArrayLiteralExpression(states)) throw new Error(`Expected states for ${id.text}`);
      expectedStates.set(id.text, states.elements.map((state) => {
        const value = ts.isIdentifier(state) ? constants.get(state.text) : state;
        if (!value || !ts.isObjectLiteralExpression(value)) throw new Error(`Expected a state for ${id.text}`);
        const stateId = value.properties.find(
          (node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && node.name.getText(source) === "id",
        )?.initializer;
        if (!stateId || !ts.isStringLiteral(stateId)) throw new Error(`Expected a state ID for ${id.text}`);
        return stateId.text;
      }).sort());
      return id.text;
    }).sort();
    expect(ids.length).toBeGreaterThan(0);
    const raw = JSON.parse(readFileSync("e2e/ouro-census/census.baseline.json", "utf8"));
    expect(raw.$allowedRegressions ?? []).toEqual([]);
    expect(raw.$removed ?? []).toEqual([]);
    const baseline = validateCensus(raw, "Spoonjoy's committed census");
    const counts = unmarkedCounts(baseline);
    expect(Object.keys(baseline).sort()).toEqual(["desktop-chrome", "iphone-webkit"]);
    for (const project of Object.keys(baseline)) {
      expect(Object.keys(baseline[project]).sort(), project).toEqual(ids);
      let controls = 0;
      for (const [journey, states] of Object.entries(baseline[project])) {
        expect(Object.keys(states).sort(), `${project}/${journey}`).toEqual(expectedStates.get(journey));
        for (const [state, multiset] of Object.entries(states)) {
          expect(multiset.length, `${project}/${journey}/${state}`).toBeGreaterThan(0);
          expect(counts[project][journey][state], `${project}/${journey}/${state}`).toBe(0);
          controls += multiset.reduce((sum, control) => sum + control.count, 0);
        }
      }
      expect(controls, project).toBeGreaterThan(0);
    }
  });
});
