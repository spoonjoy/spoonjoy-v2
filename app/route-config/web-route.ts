// A web route's classification: whether the Apple apps open it as a universal link, and whether
// it may be shared. Each context's web-routes.ts builds its entries with webRoute().
export type WebRouteCategory =
  | "user-product"
  | "secure-web-handoff"
  | "api-or-oauth"
  | "developer-resource"
  | "platform-asset"
  | "intentional-exclude";

export type WebRouteClassification = {
  routeId: string;
  routeFile: string;
  urlPattern: `/${string}`;
  category: WebRouteCategory;
  universalLink: boolean;
  publicShareable: boolean;
};

export function webRoute(
  routeFile: string,
  urlPattern: `/${string}`,
  category: WebRouteCategory,
  options: { universalLink?: boolean; publicShareable?: boolean } = {},
): WebRouteClassification {
  return {
    routeId: routeFile.replace(/^routes\//, "").replace(/\.(tsx|ts)$/, ""),
    routeFile,
    urlPattern,
    category,
    universalLink: options.universalLink ?? category === "user-product",
    publicShareable: options.publicShareable ?? false,
  };
}
