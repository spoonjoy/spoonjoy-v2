import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Text } from "~/components/text";

describe("Spoonjoy body copy over released Text", () => {
  it("keeps paragraph semantics, muted body defaults and layout attributes", () => {
    render(<Text id="copy" className="mt-3" data-testid="copy">Body copy</Text>);
    const copy = screen.getByTestId("copy");
    expect(copy.tagName).toBe("P");
    expect(copy).toHaveAttribute("id", "copy");
    expect(copy).toHaveAttribute("data-ouro", "text");
    expect(copy).toHaveClass("text-muted-foreground", "text-base", "leading-6", "mt-3");
  });

  it("forwards supported size, semantic tone, alignment, roles and accessible relationships", () => {
    render(<><h2 id="section">Connection</h2>
      <Text size="sm" tone="destructive" align="center" role="alert" aria-labelledby="section">Could not connect</Text>
    </>);
    const alert = screen.getByRole("alert", { name: "Connection" });
    expect(alert).toHaveTextContent("Could not connect");
    expect(alert).toHaveClass("text-sm", "text-destructive", "text-center");
    expect(alert).not.toHaveClass("leading-6");
  });

  it("preserves rich semantic content and explicit app Strong/Code treatments", () => {
    render(<Text tone="default">
      By <strong className="font-medium text-[var(--sj-ink)]">Ari</strong>
      <code className="rounded-sm border border-[var(--sj-border)] bg-[var(--sj-flour)] px-0.5 text-sm font-medium text-[var(--sj-ink)] sm:text-[0.8125rem]">/recipes</code>
      <a href="/recipes">Open recipes</a>
    </Text>);
    expect(screen.getByText("Ari").tagName).toBe("STRONG");
    expect(screen.getByText("/recipes").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "Open recipes" })).toHaveAttribute("href", "/recipes");
    expect(screen.getByText("Ari").closest("p")).toHaveClass("text-foreground");
  });
});
