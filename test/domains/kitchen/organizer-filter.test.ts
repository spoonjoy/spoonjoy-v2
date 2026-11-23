import { describe, expect, it } from "vitest";
import { ORGANIZER_FILTER_MAX, organizerFilterParams, parseOrganizerFilters } from "~/domains/kitchen/model/organizer-filter";

const params = (search: string) => new URLSearchParams(search);

describe("organizer filters", () => {
  it("read the organizers a recipe must have and the ones it must not, by kind and slug", () => {
    expect(parseOrganizerFilters(params("with=tag:quick&with=category:dinner&without=tool:stand-mixer"))).toEqual({
      with: [{ kind: "tag", slug: "quick" }, { kind: "category", slug: "dinner" }],
      without: [{ kind: "tool", slug: "stand-mixer" }],
    });
  });

  it("skip unknown kinds, empty slugs, repeats and anything without a kind", () => {
    expect(parseOrganizerFilters(params("with=colour:red&with=tag:&with=quick&with=tag:quick&with=TAG:quick&without=tag:quick"))).toEqual({
      with: [{ kind: "tag", slug: "quick" }],
      without: [{ kind: "tag", slug: "quick" }],
    });
    expect(parseOrganizerFilters(params(""))).toEqual({ with: [], without: [] });
  });

  it("keep at most a bounded number of each, so a query stays a bounded size", () => {
    const many = Array.from({ length: ORGANIZER_FILTER_MAX + 5 }, (_, index) => `with=tag:t${index}`).join("&");
    expect(parseOrganizerFilters(params(many)).with).toHaveLength(ORGANIZER_FILTER_MAX);
  });

  it("write filters back as the same search parameters", () => {
    const filters = { with: [{ kind: "tag" as const, slug: "quick" }], without: [{ kind: "tool" as const, slug: "wok" }] };
    expect(organizerFilterParams(filters)).toEqual([["with", "tag:quick"], ["without", "tool:wok"]]);
    expect(parseOrganizerFilters(new URLSearchParams(organizerFilterParams(filters)))).toEqual(filters);
  });
});
