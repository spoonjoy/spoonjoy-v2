/** Spoonjoy for iPhone and iPad on the App Store (Apple ID 6787505444, bundle app.spoonjoy). */
export const SPOONJOY_APP_STORE_ID = "6787505444";

/** Storefront-neutral listing link: Apple sends each visitor to their own country's store. */
export const SPOONJOY_APP_STORE_URL = `https://apps.apple.com/app/id${SPOONJOY_APP_STORE_ID}`;

const PRODUCTION_ORIGIN = "https://spoonjoy.app";

/**
 * Pages the native app opens itself. This mirrors spoonjoy-apple's DeepLinkRouter; any other path
 * would open the app on its "Link Not Found" screen, so the banner opens the app's home instead.
 */
const APP_PATHS = [
  /^\/$/,
  /^\/recipes(?:\/new)?$/,
  /^\/recipes\/(?!new\/edit$)[^/]+(?:\/edit)?$/,
  /^\/saved-recipes$/,
  /^\/cookbooks$/,
  /^\/cookbooks\/(?!new$)[^/]+$/,
  /^\/chefs$/,
  /^\/users\/[^/]+(?:\/(?:fellow-chefs|kitchen-visitors))?$/,
  /^\/shopping-list$/,
  /^\/search$/,
  /^\/account\/settings$/,
];

/** Sign-in and consent flows must finish in Safari, so they get no banner inviting people out. */
const NO_BANNER_PATHS = /^\/(?:oauth|auth|agent\/connect)(?:\/|$)/;

/**
 * The `apple-itunes-app` meta content for Safari's Smart App Banner, or null where it shouldn't
 * show. On a page the app can open, the argument is that page's production URL, so "Open" lands on
 * the same recipe. Commas separate the attribute's fields, so a comma in the URL is percent-encoded.
 */
export function smartAppBannerContent(pathname: string, search: string): string | null {
  if (NO_BANNER_PATHS.test(pathname)) return null;
  const appId = `app-id=${SPOONJOY_APP_STORE_ID}`;
  if (!APP_PATHS.some((path) => path.test(pathname))) return appId;
  const url = new URL(`${pathname}${search}`, PRODUCTION_ORIGIN).toString().replaceAll(",", "%2C");
  return `${appId}, app-argument=${url}`;
}
