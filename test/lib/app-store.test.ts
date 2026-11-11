import { describe, expect, it } from "vitest";
import { SPOONJOY_APP_STORE_ID, SPOONJOY_APP_STORE_URL, smartAppBannerContent } from "~/lib/app-store";

describe("Spoonjoy on the App Store", () => {
  it("links to the live iPhone and iPad listing", () => {
    expect(SPOONJOY_APP_STORE_ID).toBe("6787505444");
    expect(SPOONJOY_APP_STORE_URL).toBe("https://apps.apple.com/app/id6787505444");
  });

  it("hands the open page to the app, on the production host, so Open lands on the same recipe", () => {
    expect(smartAppBannerContent("/recipes/abc", "")).toBe(
      "app-id=6787505444, app-argument=https://spoonjoy.app/recipes/abc",
    );
  });

  it("keeps the query string, so a search opens as that search", () => {
    expect(smartAppBannerContent("/search", "?q=pasta")).toBe(
      "app-id=6787505444, app-argument=https://spoonjoy.app/search?q=pasta",
    );
  });

  it("encodes characters that would break the comma-separated content attribute", () => {
    expect(smartAppBannerContent("/search", "?q=salt, pepper")).toBe(
      "app-id=6787505444, app-argument=https://spoonjoy.app/search?q=salt%2C%20pepper",
    );
  });
});
