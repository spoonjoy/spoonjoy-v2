import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useNavigate, useLocation, Outlet } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { createTestRoutesStub } from "../../utils";

describe("Spoonjoy actions using released Button directly", () => {
  it.each([
    [{}, "solid", "bg-(--ouro-action,var(--primary))"],
    [{ variant: "solid" as const }, "solid", "bg-(--ouro-action,var(--primary))"],
    [{ variant: "soft" as const, tone: "destructive" as const }, "soft", "bg-destructive/10"],
    [{ variant: "outline" as const, tone: "secondary" as const }, "outline", "border-border"],
  ])("keeps the action's explicit native appearance %j", (props, variant, colorClass) => {
    render(<Button {...props}>Action</Button>);
    const button = screen.getByRole("button", { name: "Action" });
    expect(button).toHaveAttribute("data-variant", variant);
    expect(button).not.toHaveAttribute("data-sj-action");
    expect(button).toHaveClass(colorClass);
    expect(button).toHaveAttribute("type", "button");
  });

  it("preserves native submit and reset types, disabled behavior, refs and focus", () => {
    const ref = createRef<HTMLButtonElement>();
    const submitted: string[] = [];
    render(<form onSubmit={(event) => { event.preventDefault(); submitted.push("submit"); }}>
      <Button ref={ref} type="submit">Save</Button>
      <Button type="reset">Reset</Button>
      <Button disabled type="submit">Unavailable</Button>
    </form>);
    ref.current!.focus();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    fireEvent.click(ref.current!);
    fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(submitted).toEqual(["submit"]);
    expect(screen.getByRole("button", { name: "Reset" })).toHaveAttribute("type", "reset");
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
  });

  it("keeps loading focusable but prevents duplicate activation", () => {
    const calls: string[] = [];
    render(<Button loading onClick={() => calls.push("write")}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(calls).toEqual([]);
  });

  it("keeps real root Router SPA history separate from native OAuth/download boundaries", async () => {
    const ref = createRef<HTMLAnchorElement>();
    function Shell() {
      const navigate = useNavigate();
      const location = useLocation();
      return <>
        <p data-testid="where">{location.pathname}</p>
        <button onClick={() => navigate(-1)}>Back</button>
        <button onClick={() => navigate(1)}>Forward</button>
        <Button href="/next" ref={ref}>SPA</Button>
        <Button href="/auth/google" reloadDocument>OAuth</Button>
        <Button href="/account/export" reloadDocument download>Export</Button>
        <Button href="https://example.com" target="_blank" rel="author">External</Button>
        <Outlet />
      </>;
    }
    const Stub = createTestRoutesStub([{ path: "/", Component: Shell, children: [
      { index: true, Component: () => <p>Home page</p> },
      { path: "next", Component: () => <p>Next page</p> },
    ] }]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByText("Home page");
    ref.current!.focus();
    expect(ref.current).toHaveFocus();
    // Native anchors do not prevent default to turn a document request into Router data.
    expect(fireEvent.click(screen.getByRole("link", { name: "OAuth" }))).toBe(true);
    expect(fireEvent.click(screen.getByRole("link", { name: "Export" }))).toBe(true);
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "External" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "External" }).getAttribute("rel")).toContain("author");
    expect(fireEvent.click(ref.current!, { ctrlKey: true })).toBe(true);
    expect(screen.getByTestId("where")).toHaveTextContent("/");
    expect(fireEvent.click(ref.current!)).toBe(false);
    await screen.findByText("Next page");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Home page");
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/next"));
  });
});

// Retired app-only roles are not another API over the installed Button.
function roleTypes() {
  // @ts-expect-error use native variant="outline" and tone="secondary"
  return <Button plain>Invalid</Button>;
}
function toneTypes() {
  // @ts-expect-error destructive is a tone, not a native variant
  return <Button variant="destructive">Invalid</Button>;
}
function documentTypes() {
  // @ts-expect-error document navigation only exists with href
  return <Button reloadDocument>Invalid</Button>;
}
