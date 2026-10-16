import config from "../vitest.ouro.config";
import { ouroTestProjects } from "../app/lib/ouro/testing/vitest";
import { touchHostAudit, touchHostGeometry, touchHostWrongPoint, touchHostZoomGeometry } from "./touch-host-probe";

const mode = process.env.VITE_HOST_CONTROL;
if (mode !== "default" && mode !== "roomy") throw new Error("VITE_HOST_CONTROL must be default or roomy");
const defaultProvider = ouroTestProjects({
  css: "./app/styles/tailwind.css",
  include: [
    "app/components/ouro/**/*.test.{ts,tsx}",
    "app/lib/ouro/**/*.test.{ts,tsx}",
    "test/ouro/**/*.test.{ts,tsx}",
  ],
}).find((project) => project.test?.name === "ouro-touch")?.test?.browser?.provider;
if (!defaultProvider) throw new Error("The default touch provider is missing");

for (const project of config.test?.projects ?? []) {
  if (typeof project !== "object" || project === null || !("test" in project)) {
    throw new Error("The touch host proof requires the actual inline Ouro projects");
  }
  const browser = project.test?.browser;
  if (browser && project.test?.name === "ouro-touch" && mode === "default") {
    browser.provider = defaultProvider;
  }
  if (browser) browser.commands = { ...browser.commands, touchHostGeometry, touchHostWrongPoint, touchHostZoomGeometry, touchHostAudit };
}

export default config;
