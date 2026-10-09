import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { loader, action, meta } from "~/routes/logout";
import Logout from "~/routes/logout";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { db } from "~/lib/db.server";

describe("Logout Route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    // A GET must never sign out: any site can make a browser send one (an image tag, a link).
    it("keeps a signed-in session and asks the visitor to confirm", async () => {
      const user = await db.user.create({
        data: { email: "logout-get@example.com", username: "logout_get" },
      });
      const session = await sessionStorage.getSession();
      session.set("userId", user.id);
      session.set("sessionVersion", 0);
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const request = new UndiciRequest("http://localhost:3000/logout", { headers: { Cookie: cookieValue } });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      // Data, not a Response: nothing here can set a cookie.
      expect(result).toEqual({ signedIn: true });
    });

    it("sends a signed-out visitor to the login page", async () => {
      const request = new UndiciRequest("http://localhost:3000/logout");

      const response = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any).catch((thrown: unknown) => thrown);

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe("/login");
    });
  });

  describe("action", () => {
    it("should destroy session and redirect to login", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/logout", {
        method: "POST",
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).toBeDefined();
    });

    it("should redirect even without session", async () => {
      const request = new UndiciRequest("http://localhost:3000/logout", {
        method: "POST",
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
    });
    it("refuses a post from another site and leaves the session alone", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      for (const origin of ["https://evil.example", "null"]) {
        const request = new UndiciRequest("http://localhost:3000/logout", {
          method: "POST",
          headers: { Cookie: cookieValue, Origin: origin },
        });

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(response).not.toBeInstanceOf(Response);
        expect((response as any).init?.status).toBe(403);
        expect((response as any).init?.headers).toBeUndefined();
      }
    });

    it("signs out a post from Spoonjoy's own origin", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];
      const request = new UndiciRequest("http://localhost:3000/logout", {
        method: "POST",
        headers: { Cookie: cookieValue, Origin: "http://localhost:3000" },
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe("/login");
    });
  });

  it("keeps the confirm page out of search results", () => {
    expect(meta({} as any)).toEqual([
      { title: "Log out - Spoonjoy" },
      { name: "robots", content: "noindex" },
    ]);
  });

  describe("component", () => {
    it("asks a signed-in visitor to confirm, and posts the sign-out", async () => {
      const posted: string[] = [];
      const Stub = createTestRoutesStub([
        {
          path: "/logout",
          Component: Logout,
          loader: () => ({ signedIn: true }),
          action: ({ request }) => {
            posted.push(request.method);
            return { error: "Sign-out must come from Spoonjoy." };
          },
        },
      ]);
      window.localStorage.setItem("spoonjoy-cook-progress:user:test-user:recipe-1", "{}");
      window.localStorage.setItem("spoonjoy-cook-progress:recipe-1", "{}");
      render(<Stub initialEntries={["/logout"]} />);

      expect(await screen.findByRole("heading", { name: "Log out of Spoonjoy?" })).toBeInTheDocument();
      // A chef who is leaving does not read the sign-in page's welcome.
      expect(screen.getByRole("heading", { name: "Your recipes will be here when you're back." })).toBeInTheDocument();
      expect(screen.queryByText("Kitchen sign-in")).not.toBeInTheDocument();
      expect(screen.queryByText(/Sign in to cook/)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Stay signed in" })).toHaveAttribute("href", "/");
      await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
      expect(await screen.findByText("Sign-out must come from Spoonjoy.")).toBeInTheDocument();
      expect(posted).toEqual(["POST"]);
      // Like every other Log out form, this one clears cook progress cached in the browser.
      expect(window.localStorage.getItem("spoonjoy-cook-progress:user:test-user:recipe-1")).toBeNull();
      expect(window.localStorage.getItem("spoonjoy-cook-progress:recipe-1")).toBeNull();
      window.localStorage.clear();
    });

    it("sends a signed-out visitor to the login page", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/logout",
          Component: Logout,
          loader: () => {
            throw new Response(null, { status: 302, headers: { Location: "/login" } });
          },
        },
        {
          path: "/login",
          Component: () => <div>Login Page</div>,
        },
      ]);

      render(<Stub initialEntries={["/logout"]} />);

      expect(await screen.findByText("Login Page")).toBeInTheDocument();
    });

  });
});
