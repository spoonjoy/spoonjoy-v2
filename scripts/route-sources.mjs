// app/routes.ts spreads in each bounded context's routes from its own file under app/route-config/
// (`import planningRoutes from "./route-config/planning/routes";` then `...planningRoutes`), so two
// pull requests that add routes to different contexts never edit the same lines. The scripts that
// read routes.ts as source (the provenance generator, the journeys' census check) call these first,
// so they see one array of route() calls, as React Router does.
import path from "node:path";
import ts from "typescript";

const CONTEXT_ROUTES = /^\.\/route-config\/[a-z0-9-]+\/routes$/;

/**
 * The context route files a routes.ts source imports by default import: `{ name, file }`, with
 * `file` resolved against routes.ts's own path.
 * @param {string} source
 * @param {string} routesPath
 * @returns {Array<{ name: string, file: string }>}
 */
export function contextRouteImports(source, routesPath) {
  const sourceFile = ts.createSourceFile(routesPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const name = statement.importClause?.name?.text;
    if (!name || !CONTEXT_ROUTES.test(specifier)) continue;
    imports.push({ name, file: path.posix.join(path.posix.dirname(routesPath), `${specifier}.ts`) });
  }
  return imports;
}

// The text of a context file's default-exported array's elements, without the brackets.
function exportedElements(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    let expression = statement.expression;
    while (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.map((element) => element.getText(sourceFile)).join(",\n");
  }
  throw new Error(`${file} must export default an array of route() calls.`);
}

/**
 * The routes.ts source with each `...<context routes>` spread replaced by that file's route() calls.
 * @param {string} source
 * @param {string} routesPath
 * @param {Map<string, string> | Record<string, string>} contextSources each context file's source, by `file`
 * @returns {string}
 */
export function inlineContextRoutes(source, routesPath, contextSources) {
  const read = (file) => (contextSources instanceof Map ? contextSources.get(file) : contextSources[file]);
  let inlined = source;
  for (const { name, file } of contextRouteImports(source, routesPath)) {
    const context = read(file);
    if (context === undefined) throw new Error(`${routesPath} imports ${file}, which was not read.`);
    const spread = new RegExp(`\\.\\.\\.${name}\\b`, "g");
    const elements = exportedElements(context, file);
    inlined = inlined.replace(spread, () => elements);
  }
  return inlined;
}
