import { defineConfig } from "@playwright/test";
import config from "../playwright.ouro.config";

export default defineConfig({
  ...config,
  testDir: "./preload-e2e",
});
