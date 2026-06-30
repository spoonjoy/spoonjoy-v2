import { createContext } from "react";

/**
 * The per-request CSP nonce, provided server-side in `entry.server.tsx` (from
 * `AppLoadContext.nonce`, generated in `workers/app.ts`) and consumed by
 * `root.tsx`'s `Layout` for the inline theme-flash `<script>` plus React
 * Router's `<Scripts>` / `<ScrollRestoration>`.
 *
 * Defaults to `""` on the client: the nonce is only meaningful for the
 * server-rendered HTML, and the browser strips the `nonce` attribute from the
 * DOM after parsing — so there is no client-side value to hydrate against and
 * no provider is needed in `entry.client.tsx`.
 */
export const NonceContext = createContext<string>("");
