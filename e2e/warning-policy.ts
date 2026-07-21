export interface BrowserConsoleMessageLike {
  type(): string;
  text(): string;
  location?(): { url?: string; lineNumber?: number; columnNumber?: number };
}

export interface BrowserPageLike {
  on(event: string, listener: (value: unknown) => void): unknown;
}

export interface BrowserContextLike {
  pages(): BrowserPageLike[];
  on(event: string, listener: (value: unknown) => void): unknown;
}

export function createBrowserDiagnosticCollector() {
  const diagnostics: string[] = [];
  const expectations: Array<{ pattern: RegExp; matched: boolean }> = [];

  const record = (diagnostic: string) => {
    const expectation = expectations.find(({ pattern, matched }) => {
      if (matched) return false;
      pattern.lastIndex = 0;
      return pattern.test(diagnostic);
    });
    if (expectation) {
      expectation.matched = true;
      return;
    }
    diagnostics.push(diagnostic);
  };

  return {
    expectDiagnostic(pattern: RegExp) {
      expectations.push({ pattern, matched: false });
    },
    captureConsole(
      type: string,
      text: string,
      location?: { url?: string; lineNumber?: number; columnNumber?: number },
    ) {
      if (type === "warning" || type === "error") {
        const source = location?.url
          ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
          : "";
        record(`console.${type}: ${text}${source}`);
      }
    },
    capturePageError(error: Error) {
      const details = error.stack?.trim() || `${error.name}: ${error.message || "(no message)"}`;
      record(`pageerror: ${details}`);
    },
    assertClean(prefix = "Browser emitted warning/error diagnostics") {
      const missing = expectations
        .filter(({ matched }) => !matched)
        .map(({ pattern }) => `expected diagnostic not observed: ${pattern}`);
      const failures = [...diagnostics, ...missing];
      if (failures.length > 0) {
        throw new Error(`${prefix}:\n${failures.join("\n")}`);
      }
    },
  };
}

export function observeBrowserContext(
  context: BrowserContextLike,
  collector: ReturnType<typeof createBrowserDiagnosticCollector>,
) {
  const observedPages = new WeakSet<object>();
  const observePage = (value: unknown) => {
    const page = value as BrowserPageLike;
    if (observedPages.has(page)) return;
    observedPages.add(page);
    page.on("console", (consoleValue) => {
      const message = consoleValue as BrowserConsoleMessageLike;
      collector.captureConsole(message.type(), message.text(), message.location?.());
    });
    page.on("pageerror", (error) => {
      collector.capturePageError(error as Error);
    });
  };

  context.on("page", observePage);
  for (const page of context.pages()) observePage(page);
}
