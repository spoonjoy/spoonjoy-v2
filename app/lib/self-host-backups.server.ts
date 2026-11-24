// A self-hosted server's backups, as its admin sees them on Server settings. The server around the
// Worker makes and restores them (self-host/backup.mjs) and answers through the SELF_HOST service
// binding (self-host/host-api.mjs). spoonjoy.app has no such binding, so there this is null.

export type ServerBackup = { name: string; kind: "auto" | "manual" | "before-restore"; size: number; createdAt: string };
export type ServerBackups = { schedule: string | null; keep: number; backups: ServerBackup[] };
export type BackupMade = { name: string; rows: number; photos: number };
export type BackupRestored = { rows: number; photos: number; createdAt: string; savedFirst: string | null };

type HostEnv = Pick<Env, "SELF_HOST" | "SPOONJOY_SELF_HOSTED"> | null | undefined;

export class ServerBackupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const HOST = "http://self-host";

export function serverBackups(env: HostEnv) {
  const binding = env?.SPOONJOY_SELF_HOSTED === "true" ? env.SELF_HOST : undefined;
  if (!binding) return null;
  const ask = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await binding.fetch(`${HOST}${path}`, init);
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new ServerBackupError(body.error ?? `The server answered ${response.status}.`, response.status);
    return body;
  };
  const backupPath = (name: string) => `/backups/${encodeURIComponent(name)}`;
  return {
    list: () => ask<ServerBackups>("/backups"),
    backUpNow: () => ask<BackupMade>("/backups", { method: "POST" }),
    restore: (name: string) => ask<BackupRestored>(`${backupPath(name)}/restore`, { method: "POST" }),
    /** The server's answer as it is: the file, or a 404 for a backup it doesn't have. */
    download: (name: string) => binding.fetch(`${HOST}${backupPath(name)}`),
  };
}
