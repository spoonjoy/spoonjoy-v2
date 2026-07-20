import { defaultRunE2eGlobalTeardown } from "../../scripts/e2e-run-cleanup.mjs";

interface GlobalTeardownOptions {
  env: Record<string, string | undefined>;
  projectRoot: string;
  runTeardown: typeof defaultRunE2eGlobalTeardown;
}

export async function runGlobalTeardown({
  env,
  projectRoot,
  runTeardown,
}: GlobalTeardownOptions): Promise<void> {
  const runId = env.SPOONJOY_E2E_RUN_ID;
  if (!runId) throw new Error("SPOONJOY_E2E_RUN_ID is required for Playwright teardown.");
  await runTeardown({ projectRoot, runId });
}

export default runGlobalTeardown.bind(null, {
  env: process.env,
  projectRoot: process.cwd(),
  runTeardown: defaultRunE2eGlobalTeardown,
});
