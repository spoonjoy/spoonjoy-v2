import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useNavigate, useLocation, Outlet } from "react-router";
import { Button } from "~/components/button";
import { createTestRoutesStub } from "../../utils";

describe("Spoonjoy action roles over released Button", () => {
  it.each([
    [{}, "solid", "primary", "bg-primary"],
    [{ variant: "default" as const }, "solid", "primary", "bg-primary"],
    [{ variant: "destructive" as const }, "soft", "destructive", "bg-destructive/10"],
    [{ plain: true as const }, "outline", "quiet", "border-border"],
  ])("maps the exclusive role %j without guessing a library tone", (props, variant, role, colorClass) => {
    render(<Button {...props}>Action</Button>);
    const button = screen.getByRole("button", { name: "Action" });
    expect(button).toHaveAttribute("data-variant", variant);
    expect(button).toHaveAttribute("data-sj-action", role);
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

// The app exposes roles, not a second overlapping variant/tone system.
function roleTypes() {
  // @ts-expect-error quiet and destructive are exclusive app roles
  return <Button plain variant="destructive">Invalid</Button>;
}
function toneTypes() {
  // @ts-expect-error use the released Button directly for an explicit tone
  return <Button tone="success">Invalid</Button>;
}
function documentTypes() {
  // @ts-expect-error document navigation only exists with href
  return <Button reloadDocument>Invalid</Button>;
}
