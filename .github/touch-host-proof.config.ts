import config from "../vitest.ouro.config";
import { touchHostAudit, touchHostGeometry, touchHostWrongPoint, touchHostZoomGeometry } from "./touch-host-probe";

for (const project of config.test?.projects ?? []) {
  if (typeof project !== "object" || project === null || !("test" in project)) {
    throw new Error("The touch host proof requires the actual inline Ouro projects");
  }
  const browser = project.test?.browser;
  if (browser) browser.commands = { ...browser.commands, touchHostGeometry, touchHostWrongPoint, touchHostZoomGeometry, touchHostAudit };
}

export default config;
