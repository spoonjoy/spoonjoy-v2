import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import Roadmap, { RoadmapRow, meta } from "~/routes/roadmap";
import { ROADMAP, ROADMAP_STATUSES, roadmapByStatus, type RoadmapItem } from "~/content/roadmap";

async function renderRoadmap() {
  const Stub = createTestRoutesStub([{ path: "/roadmap", Component: Roadmap }]);
  render(<Stub initialEntries={["/roadmap"]} />);
  return screen.findByRole("heading", { name: "Roadmap", level: 1 });
}

describe("/roadmap", () => {
  it("declares roadmap metadata, with a canonical address and no other app's name", () => {
    const tags = meta({} as never);
    expect(tags).toContainEqual({ title: "Roadmap | Spoonjoy" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://spoonjoy.app/roadmap" });
    const description = tags.find((tag) => "name" in tag && tag.name === "description") as { content: string };
    expect(description.content).toMatch(/shipped/i);
    expect(JSON.stringify(tags)).not.toMatch(/mealie/i);
  });

  it("shows Shipped, Building now, Next and Later, in that order, each with its count", async () => {
    expect(await renderRoadmap()).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(ROADMAP_STATUSES.map((status) => status.title));
    for (const status of ROADMAP_STATUSES) {
      const section = screen.getByRole("region", { name: status.title });
      const count = roadmapByStatus(status.id).length;
      expect(within(section).getByText(`${count} ${count === 1 ? "thing" : "things"}`)).toBeInTheDocument();
      expect(within(section).getByText(status.summary)).toBeInTheDocument();
    }
  });

  it("lists every item in its group, with its benefit and area", async () => {
    await renderRoadmap();
    for (const status of ROADMAP_STATUSES) {
      const list = within(screen.getByRole("region", { name: status.title })).getByRole("list");
      const items = within(list).getAllByRole("listitem");
      const expected = roadmapByStatus(status.id);
      expect(items).toHaveLength(expected.length);
      expected.forEach((item: RoadmapItem, index) => {
        expect(items[index]).toHaveTextContent(item.title);
        expect(items[index]).toHaveTextContent(item.benefit);
        expect(items[index]).toHaveTextContent(item.area);
      });
    }
  });

  it("links an item that has somewhere to try it, and leaves the rest as plain rows", async () => {
    await renderRoadmap();
    const linked = ROADMAP.filter((item) => item.link);
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) {
      const link = screen.getByRole("link", { name: item.link!.label });
      expect(link).toHaveAttribute("href", item.link!.href);
    }
    const shipped = within(screen.getByRole("region", { name: "Shipped" }));
    expect(shipped.getByRole("link", { name: "Try it in the Test Kitchen" })).toHaveAttribute("href", "/test-kitchen");
    const later = within(screen.getByRole("region", { name: "Later" }));
    expect(later.queryAllByRole("link")).toHaveLength(ROADMAP.filter((item) => item.status === "later" && item.link).length);
  });

  it("names no other recipe app anywhere on the page", async () => {
    await renderRoadmap();
    expect(document.body.textContent).not.toMatch(/mealie/i);
    expect(screen.getByText("Move in from other recipe apps in one step")).toBeInTheDocument();
  });

  it("invites a cook to ask for something, and to start a kitchen", async () => {
    await renderRoadmap();
    expect(screen.getByRole("link", { name: "ari@spoonjoy.app" })).toHaveAttribute("href", "mailto:ari@spoonjoy.app?subject=Spoonjoy%20roadmap");
    expect(screen.getByRole("link", { name: "Start your kitchen" })).toHaveAttribute("href", "/signup");
  });

  it("shows the month a shipped item went live, when it has one", async () => {
    const Stub = createTestRoutesStub([{
      path: "/roadmap",
      Component: () => (
        <RoadmapRow item={{ id: "meal-planner", title: "Meal planner", benefit: "Plan the week.", status: "shipped", area: "Planning", shipped: "2026-12-01" }} />
      ),
    }]);
    render(<Stub initialEntries={["/roadmap"]} />);
    const date = await screen.findByText("Dec 2026");
    expect(date.closest("time")).toHaveAttribute("datetime", "2026-12-01");
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });
});
