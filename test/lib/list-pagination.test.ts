import { describe, expect, it } from "vitest";
import {
  LIST_PAGE_SIZE,
  MAX_LIST_PAGE,
  listOffset,
  listPageHref,
  listPageInfo,
  parseListPage,
} from "~/lib/list-pagination";

const at = (path: string) => new URL(path, "https://spoonjoy.test");

describe("list pagination", () => {
  it("reads the page parameter, falling back to the first page", () => {
    expect(parseListPage(at("/users/chef"))).toBe(1);
    expect(parseListPage(at("/users/chef?page=3"))).toBe(3);
    for (const raw of ["0", "-2", "2.5", "two", "", "1e3"]) {
      expect(parseListPage(at(`/users/chef?page=${raw}`)), raw).toBe(1);
    }
    expect(parseListPage(at("/users/chef?page=99999999"))).toBe(MAX_LIST_PAGE);
  });

  it("turns a page into an offset", () => {
    expect(listOffset(1)).toBe(0);
    expect(listOffset(3)).toBe(2 * LIST_PAGE_SIZE);
    expect(listOffset(2, 10)).toBe(10);
  });

  it("builds page links that keep the other query parameters", () => {
    const url = at("/recipes?q=soup&page=2");
    expect(listPageHref(url, 1)).toBe("/recipes?q=soup");
    expect(listPageHref(url, 3)).toBe("/recipes?q=soup&page=3");
    expect(listPageHref(at("/users/chef?page=2"), 1)).toBe("/users/chef");
  });

  it("describes the neighbouring pages", () => {
    expect(listPageInfo(at("/users/chef"), 1, 0)).toEqual({
      page: 1, totalPages: 1, totalItems: 0, previousHref: null, nextHref: null,
    });
    expect(listPageInfo(at("/users/chef"), 1, LIST_PAGE_SIZE + 1)).toMatchObject({
      totalPages: 2, previousHref: null, nextHref: "/users/chef?page=2",
    });
    expect(listPageInfo(at("/users/chef?page=2"), 2, 50, 10)).toMatchObject({
      totalPages: 5, previousHref: "/users/chef", nextHref: "/users/chef?page=3",
    });
    expect(listPageInfo(at("/users/chef?page=5"), 5, 50, 10)).toMatchObject({ nextHref: null });
  });
});
