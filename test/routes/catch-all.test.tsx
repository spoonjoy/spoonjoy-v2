import { describe, it, expect } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { loader, meta } from "~/routes/$";
import CatchAll from "~/routes/$";

describe("Catch-all Route ($)", () => {
  describe("meta", () => {
    it("returns 404 metadata", () => {
      const result = meta({} as any);

      expect(result).toEqual([
        { title: "404 - Page not found | Spoonjoy" },
        { name: "description", content: "There's no page at this address on Spoonjoy." },
      ]);
    });
  });

  describe("loader", () => {
    it("returns a 404 status response for unknown routes", async () => {
      const request = new UndiciRequest("http://localhost:3000/unknown-path");

      const response = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { "*": "unknown-path" },
      } as any);

      expect(response).toHaveProperty("type", "DataWithResponseInit");
      expect(response.init).toMatchObject({ status: 404 });
    });

    it("returns a 404 status response for deeply nested unknown routes", async () => {
      const request = new UndiciRequest("http://localhost:3000/some/deeply/nested/path");

      const response = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { "*": "some/deeply/nested/path" },
      } as any);

      expect(response).toHaveProperty("type", "DataWithResponseInit");
      expect(response.init).toMatchObject({ status: 404 });
    });
  });

  describe("component", () => {
    it("renders a friendly not found message and home link", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "*",
          Component: CatchAll,
          loader,
        },
      ]);

      render(<Stub initialEntries={["/missing"]} />);

      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    });
  });
});
