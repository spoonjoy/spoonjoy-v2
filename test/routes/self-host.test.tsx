import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import SelfHost, { COMPOSE, IMAGE_PUBLIC, ImageNotice, START, UPDATE, meta } from "~/routes/self-host";

async function renderPage() {
  const Stub = createTestRoutesStub([{ path: "/self-host", Component: SelfHost }]);
  const { container } = render(<Stub initialEntries={["/self-host"]} />);
  await screen.findByRole("heading", { name: "Run Spoonjoy on your own server", level: 1 });
  return container;
}

describe("/self-host", () => {
  it("declares its metadata with a canonical address", () => {
    const tags = meta({} as never);
    expect(tags).toContainEqual({ title: "Run Spoonjoy on your own server | Spoonjoy" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://spoonjoy.app/self-host" });
  });

  it("shows the guide's own Compose file, the one command that starts it and the one that updates it", async () => {
    await renderPage();
    const start = screen.getByRole("region", { name: "Start it" });
    expect(within(start).getByText("compose.yaml", { selector: "figcaption *, figcaption" })).toBeInTheDocument();
    expect(COMPOSE).toBe(readFileSync("self-host/compose.yaml", "utf8"));
    expect(start.textContent).toContain("# image: ${SPOONJOY_IMAGE:-ghcr.io/spoonjoy/spoonjoy:latest}");
    expect(start.textContent).toContain("context: https://github.com/spoonjoy/spoonjoy-v2.git#main");
    expect(within(start).getByText(START)).toBeInTheDocument();
    expect(START).toBe("docker compose up -d");
    expect(within(screen.getByRole("region", { name: "Update it" })).getByText(UPDATE)).toBeInTheDocument();
    expect(UPDATE).toBe("docker compose build && docker compose up -d");
  });

  it("keeps the Compose file's notes in short lines and never wraps a code line, so what a phone shows is what to type", async () => {
    await renderPage();
    for (const line of COMPOSE.split("\n").filter((l) => l.startsWith("#"))) expect(line.length).toBeLessThanOrEqual(48);
    const blocks = document.querySelectorAll("[data-ouro-part=code]");
    expect(blocks).toHaveLength(3);
    for (const code of blocks) {
      expect(code.className).toContain("whitespace-pre");
      expect(code.className).not.toContain("whitespace-pre-wrap");
    }
  });

  it("says what the first account gets: who joins, which AI, and backups", async () => {
    await renderPage();
    const first = screen.getByRole("region", { name: "What the first account gets" });
    expect(first).toHaveTextContent("The first account you make is the server's admin.");
    expect(first).toHaveTextContent("invite-only after the first account");
    expect(first).toHaveTextContent("OpenAI or Gemini with their own key, or no AI at all");
    expect(first).toHaveTextContent("backs itself up every day and keeps the last 7");
  });

  it("says the Compose file builds from source until the image is public", async () => {
    expect(IMAGE_PUBLIC).toBe(false);
    await renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Built from source for now");
    expect(screen.getByRole("status")).toHaveTextContent("takes a few minutes");
  });

  it("drops the notice once the image is public", () => {
    const { container } = render(<ImageNotice imagePublic />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the full self-hosting guide", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "self-hosting guide" })).toHaveAttribute(
      "href",
      "https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/self-hosting.md",
    );
  });
});
