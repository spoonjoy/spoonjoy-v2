/** Spoonjoy for iPhone and iPad on the App Store (Apple ID 6787505444, bundle app.spoonjoy). */
export const SPOONJOY_APP_STORE_ID = "6787505444";

/** Storefront-neutral listing link: Apple sends each visitor to their own country's store. */
export const SPOONJOY_APP_STORE_URL = `https://apps.apple.com/app/id${SPOONJOY_APP_STORE_ID}`;

const PRODUCTION_ORIGIN = "https://spoonjoy.app";

/**
 * The `apple-itunes-app` meta content for Safari's Smart App Banner. The argument is the page's
 * production URL, which the app opens like a universal link, so "Open" lands on the same recipe.
 * Commas separate the attribute's fields, so a comma in the URL is percent-encoded.
 */
export function smartAppBannerContent(pathname: string, search: string): string {
  const url = new URL(`${pathname}${search}`, PRODUCTION_ORIGIN).toString().replaceAll(",", "%2C");
  return `app-id=${SPOONJOY_APP_STORE_ID}, app-argument=${url}`;
}
