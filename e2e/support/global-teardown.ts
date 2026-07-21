import { defaultRunE2eGlobalTeardown } from "../../scripts/e2e-run-cleanup.mjs";
import { removeDisposableE2EAuthArtifacts } from "./disposable-auth";

interface GlobalTeardownOptions {
  env: Record<string, string | undefined>;
  projectRoot: string;
  removeAuthArtifacts: () => void;
  runTeardown: typeof defaultRunE2eGlobalTeardown;
}

export async function runGlobalTeardown({
  env,
  projectRoot,
  removeAuthArtifacts,
  runTeardown,
}: GlobalTeardownOptions): Promise<void> {
  try {
    const runId = env.SPOONJOY_E2E_RUN_ID;
    if (!runId) throw new Error("SPOONJOY_E2E_RUN_ID is required for Playwright teardown.");
    await runTeardown({ projectRoot, runId });
  } finally {
    removeAuthArtifacts();
  }
}

export default runGlobalTeardown.bind(null, {
  env: process.env,
  projectRoot: process.cwd(),
  removeAuthArtifacts: removeDisposableE2EAuthArtifacts,
  runTeardown: defaultRunE2eGlobalTeardown,
});
