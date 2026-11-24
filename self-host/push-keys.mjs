// Each self-hosted server's own web push keys (VAPID), made on its first start and kept in the data
// folder, so browsers that subscribed keep getting notifications after restarts and updates. The
// app reads them as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (app/lib/web-push.server.ts), unless the
// owner sets those themselves.
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** A P-256 key pair as web push wants it: the public point and the private scalar, in base64url. */
export function makePushKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const { x, y } = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(x, "base64url"), Buffer.from(y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: privateKey.export({ format: "jwk" }).d };
}

/** The server's keys from `file`, made and saved (readable only by the server) the first time. */
export function serverPushKeys(file) {
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(makePushKeys()), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Who push services contact about this server's notifications: its own address when that is
 * https, which the services ask for, or else a mailto address at its host name.
 */
export function pushSubject(baseUrl) {
  const url = new URL(baseUrl);
  return url.protocol === "https:" ? url.origin : `mailto:owner@${url.hostname}`;
}
