import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { RouteErrorContent, routeErrorCopy } from "~/components/errors/route-error";

function errorResponse(status: number, data: unknown) {
  // The shape React Router gives a boundary for a thrown Response.
  return { status, statusText: "", internal: false, data };
}

describe("routeErrorCopy", () => {
  it.each([
    [errorResponse(404, "x"), "Page not found.", "The page you're looking for doesn't exist or may have moved."],
    [errorResponse(403, "x"), "Not allowed.", "You don't have access to this page."],
    [errorResponse(401, "x"), "Please sign in.", "You need to be signed in to view this page."],
    [errorResponse(409, "That cookbook already exists."), "We can't open that.", "That cookbook already exists."],
    [errorResponse(400, "   "), "We can't open that.", "Try again, or head back home."],
    [errorResponse(400, { message: "object" }), "We can't open that.", "Try again, or head back home."],
    [errorResponse(503, "down"), "Something went wrong.", "We hit an unexpected snag. Try again in a moment."],
    [new Error("boom"), "Something went wrong.", "We hit an unexpected snag. Try again in a moment."],
  ])("words %o as %s", (error, title, message) => {
    expect(routeErrorCopy(error)).toMatchObject({ title, message });
  });
});

describe("RouteErrorContent", () => {
  function renderContent(error: unknown) {
    const router = createMemoryRouter([{ path: "/", element: <RouteErrorContent error={error} /> }]);
    render(<RouterProvider router={router} />);
  }

  it("offers home, and a log-in link only when signing in would help", () => {
    renderContent(errorResponse(401, ""));
    expect(screen.getByRole("heading", { level: 1, name: "Please sign in." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("offers only home for other errors", () => {
    renderContent(new Error("boom"));
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong." })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });
});
