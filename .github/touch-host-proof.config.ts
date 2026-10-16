import config from "../vitest.ouro.config";
import { touchHostGeometry, touchHostWrongPoint } from "./touch-host-probe";

for (const project of config.test?.projects ?? []) {
  if (typeof project === "string") continue;
  const browser = project.test?.browser;
  if (browser) browser.commands = { ...browser.commands, touchHostGeometry, touchHostWrongPoint };
}

export default config;
