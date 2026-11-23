// Kitchen's server-only surface: the .server adapters that loaders and actions use. Kept out of index.ts, which
// client routes import (docs/domains.md).
export * from "./adapters/organizers-route.server";
export * from "./adapters/organizer-pages.server";
export * from "./adapters/organizer-filters.server";
