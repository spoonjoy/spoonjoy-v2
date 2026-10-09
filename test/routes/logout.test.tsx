import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, waitFor } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { loader, action } from "~/routes/logout";
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
    it("keeps a signed-in session and sends the visitor to their kitchen", async () => {
      const user = await db.user.create({
        data: { email: "logout-get@example.com", username: "logout_get" },
      });
      const session = await sessionStorage.getSession();
      session.set("userId", user.id);
      session.set("sessionVersion", 0);
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const request = new UndiciRequest("http://localhost:3000/logout", { headers: { Cookie: cookieValue } });

      const response = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any).catch((thrown: unknown) => thrown);

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe("/");
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

  describe("component", () => {
    it("should render null (empty component)", async () => {
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

      const { container } = render(<Stub initialEntries={["/logout"]} />);

      // Wait for redirect navigation to complete to avoid act() warning
      await waitFor(() => {
        expect(container).toBeDefined();
      });
    });

    it("should render nothing when component is called directly", () => {
      // Test the component directly returns null
      const result = Logout();
      expect(result).toBeNull();
    });
  });
});
