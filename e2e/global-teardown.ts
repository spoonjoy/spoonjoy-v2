import { runDisposableE2ETeardown } from "./support/disposable-auth";

export default async function globalTeardown() {
  await runDisposableE2ETeardown();
}
