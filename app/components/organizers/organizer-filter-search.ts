// The search part of a filtered recipe list's address: the query, then each filter as the loader gave it, then the page.
export function organizerFilterSearch(query: string, filterParams: [string, string][], page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const [name, value] of filterParams) params.append(name, value);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : "";
}
