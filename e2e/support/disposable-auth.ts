import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export type DisposableE2EUser = {
  email: string;
  username: string;
  password: string;
};

type UserFactoryOptions = {
  now?: () => Date;
  random?: () => string;
};

type RunCommand = (
  file: string,
  args: string[],
  options: { encoding: BufferEncoding; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

export const DISPOSABLE_E2E_USERS_MANIFEST = "e2e/.auth/disposable-users.json";

function stampDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
}

function disposableToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "run";
}

export function createDisposableE2EUser({
  now = () => new Date(),
  random = () => randomUUID(),
}: UserFactoryOptions = {}): DisposableE2EUser {
  const stamp = stampDate(now());
  const token = disposableToken(random());
  return {
    email: `codex-e2e-${stamp}-${token}@example.com`,
    username: `codex_e2e_${stamp}_${token}`,
    password: `E2E-${stamp}-${token}-${disposableToken(random())}`,
  };
}

export function readDisposableE2EUsers(manifestPath = DISPOSABLE_E2E_USERS_MANIFEST): DisposableE2EUser[] {
  if (!existsSync(manifestPath)) return [];
  return JSON.parse(readFileSync(manifestPath, "utf8")) as DisposableE2EUser[];
}

export function readLatestDisposableE2EUser(manifestPath = DISPOSABLE_E2E_USERS_MANIFEST): DisposableE2EUser {
  const users = readDisposableE2EUsers(manifestPath);
  const latest = users.at(-1);
  if (!latest) {
    throw new Error("No disposable e2e user has been recorded. Run the Playwright setup project first.");
  }
  return latest;
}

export function recordDisposableE2EUser(user: DisposableE2EUser, manifestPath = DISPOSABLE_E2E_USERS_MANIFEST) {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  const users = readDisposableE2EUsers(manifestPath);
  if (!users.some((existing) => existing.email === user.email)) {
    users.push(user);
  }
  writeFileSync(manifestPath, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
}

export async function runDisposableE2ETeardown({
  runCommand = promisify(execFile) as RunCommand,
}: {
  runCommand?: RunCommand;
} = {}) {
  await runCommand("pnpm", ["run", "cleanup:local:apply"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
}
