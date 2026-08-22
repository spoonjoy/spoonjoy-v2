import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { Link } from "~/components/ui/link";

// Mock React Router's navigate to track navigation
const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Wrapper component to provide React Router context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("Link Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render a link with the provided text", () => {
      render(
        <TestWrapper>
          <Link href="/about">About Us</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "About Us" })).toBeInTheDocument();
    });

    it("should render with the correct href attribute for internal links", () => {
      render(
        <TestWrapper>
          <Link href="/recipes">Recipes</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Recipes" });
      expect(link).toHaveAttribute("href", "/recipes");
    });

    it("should pass through additional props", () => {
      render(
        <TestWrapper>
          <Link href="/test" className="custom-class" data-testid="test-link">
            Test Link
          </Link>
        </TestWrapper>
      );

      const link = screen.getByTestId("test-link");
      expect(link).toHaveClass("custom-class");
    });

    it("should forward ref to the anchor element", () => {
      const ref = { current: null } as React.RefObject<HTMLAnchorElement>;

      render(
        <TestWrapper>
          <Link href="/test" ref={ref}>
            Test
          </Link>
        </TestWrapper>
      );

      expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
    });
  });

  describe("internal links (React Router navigation)", () => {
    it("allows an internal link to opt into native full-document navigation", () => {
      render(
        <TestWrapper>
          <Link href="/auth/apple" {...({ reloadDocument: true } as Record<string, unknown>)}>
            Continue with Apple
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Continue with Apple" });
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
    });

    it("should render internal links using React Router Link", () => {
      render(
        <TestWrapper>
          <Link href="/recipes/123">Recipe Detail</Link>
        </TestWrapper>
      );

      // React Router Link should be rendered (we can verify by checking it has data-discover attribute or similar)
      const link = screen.getByRole("link", { name: "Recipe Detail" });
      expect(link).toHaveAttribute("href", "/recipes/123");
    });

    it("should handle root path correctly", () => {
      render(
        <TestWrapper>
          <Link href="/">Home</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    });

    it("should handle paths with query strings", () => {
      render(
        <TestWrapper>
          <Link href="/search?q=test">Search</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute(
        "href",
        "/search?q=test"
      );
    });

    it("should handle paths with hash fragments", () => {
      render(
        <TestWrapper>
          <Link href="/about#team">Team Section</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Team Section" })).toHaveAttribute(
        "href",
        "/about#team"
      );
    });
  });

  describe("external links", () => {
    it("should open https:// links in new tab", () => {
      render(
        <TestWrapper>
          <Link href="https://example.com">External Site</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "External Site" });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("should open http:// links in new tab", () => {
      render(
        <TestWrapper>
          <Link href="http://example.com">External HTTP</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "External HTTP" });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("should open protocol-relative links (//) in new tab", () => {
      render(
        <TestWrapper>
          <Link href="//cdn.example.com/resource">CDN Link</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "CDN Link" });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("should allow custom target for external links", () => {
      render(
        <TestWrapper>
          <Link href="https://example.com" target="_self">
            Same Tab External
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Same Tab External" });
      expect(link).toHaveAttribute("target", "_self");
    });

    it("should allow custom rel for external links", () => {
      render(
        <TestWrapper>
          <Link href="https://example.com" rel="sponsored">
            Sponsored Link
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Sponsored Link" });
      expect(link).toHaveAttribute("rel", "sponsored");
    });
  });

  describe("special protocols", () => {
    it("should handle mailto: links without new tab behavior", () => {
      render(
        <TestWrapper>
          <Link href="mailto:test@example.com">Email Us</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Email Us" });
      expect(link).toHaveAttribute("href", "mailto:test@example.com");
      expect(link).not.toHaveAttribute("target", "_blank");
    });

    it("should handle tel: links without new tab behavior", () => {
      render(
        <TestWrapper>
          <Link href="tel:+1234567890">Call Us</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Call Us" });
      expect(link).toHaveAttribute("href", "tel:+1234567890");
      expect(link).not.toHaveAttribute("target", "_blank");
    });
  });

  describe("full-document option boundaries", () => {
    it.each([
      ["https://example.com", "HTTPS"],
      ["//cdn.example.com/resource", "Protocol relative"],
      ["mailto:test@example.com", "Email"],
      ["tel:+1234567890", "Telephone"],
    ])("does not forward reloadDocument to native anchor %s", (href, label) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      render(
        <TestWrapper>
          <Link href={href} {...({ reloadDocument: true } as Record<string, unknown>)}>
            {label}
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: label });
      expect(link).not.toHaveAttribute("reloadDocument");
      expect(link).not.toHaveAttribute("reloaddocument");
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe("accessibility", () => {
    it("should be focusable via keyboard", async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <Link href="/test">Keyboard Accessible</Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Keyboard Accessible" });
      await user.tab();
      expect(link).toHaveFocus();
    });

    it("should have proper link role", () => {
      render(
        <TestWrapper>
          <Link href="/test">Accessible Link</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Accessible Link" })).toBeInTheDocument();
    });

    it("should support aria-label for icon-only links", () => {
      render(
        <TestWrapper>
          <Link href="/settings" aria-label="Settings">
            ⚙️
          </Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    });

    it("should support aria-describedby", () => {
      render(
        <TestWrapper>
          <span id="description">Opens in a new window</span>
          <Link href="https://example.com" aria-describedby="description">
            External
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "External" });
      expect(link).toHaveAttribute("aria-describedby", "description");
    });
  });

  describe("click behavior", () => {
    it("should be clickable", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <TestWrapper>
          <Link href="/test" onClick={onClick}>
            Clickable
          </Link>
        </TestWrapper>
      );

      await user.click(screen.getByRole("link", { name: "Clickable" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should handle Enter key press", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <TestWrapper>
          <Link href="/test" onClick={onClick}>
            Enter Key
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link", { name: "Enter Key" });
      await act(async () => {
        link.focus();
      });
      await user.keyboard("{Enter}");
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle empty string href", () => {
      render(
        <TestWrapper>
          <Link href="">Empty Href</Link>
        </TestWrapper>
      );

      // Empty href renders as an anchor but may not be treated as an accessible link
      // This is expected browser behavior - empty hrefs are edge cases
      expect(screen.getByText("Empty Href")).toBeInTheDocument();
    });

    it("should handle relative paths without leading slash", () => {
      render(
        <TestWrapper>
          <Link href="relative/path">Relative Path</Link>
        </TestWrapper>
      );

      expect(screen.getByRole("link", { name: "Relative Path" })).toHaveAttribute(
        "href",
        "/relative/path"
      );
    });

    it("should preserve children content", () => {
      render(
        <TestWrapper>
          <Link href="/test">
            <span>Icon</span>
            <span>Text</span>
          </Link>
        </TestWrapper>
      );

      const link = screen.getByRole("link");
      expect(link).toHaveTextContent("IconText");
    });
  });
});

describe("isExternalUrl helper logic", () => {
  // These tests verify the URL classification behavior through the Link component
  
  it("should classify https:// as external", () => {
    render(
      <TestWrapper>
        <Link href="https://google.com">Google</Link>
      </TestWrapper>
    );
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("should classify http:// as external", () => {
    render(
      <TestWrapper>
        <Link href="http://example.org">Example</Link>
      </TestWrapper>
    );
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("should classify // as external", () => {
    render(
      <TestWrapper>
        <Link href="//cdn.example.com">CDN</Link>
      </TestWrapper>
    );
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("should NOT classify /path as external", () => {
    render(
      <TestWrapper>
        <Link href="/internal/path">Internal</Link>
      </TestWrapper>
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("target", "_blank");
  });

  it("should NOT classify relative paths as external", () => {
    render(
      <TestWrapper>
        <Link href="./relative">Relative</Link>
      </TestWrapper>
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("target", "_blank");
  });
});
