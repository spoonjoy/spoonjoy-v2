import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { backupSettings, miniflareOptions, photoUploads, selfHostRateLimits, selfHostVars, settingsFromEnv, workerModules } from "../../self-host/config.mjs";

const built = {
  compatibility_date: "2024-12-01",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    NODE_ENV: "production",
    SPOONJOY_BASE_URL: "https://spoonjoy.app",
    SPOONJOY_MODERATOR_USERNAMES: "arimendelow",
    PHOTO_SWEEP_MODE: "dry-run",
    SPOONJOY_CSP_MODE: "enforce",
  },
  ratelimits: [
    { name: "AUTH_IP_RATE_LIMITER", namespace_id: "1003", simple: { limit: 20, period: 60 } },
    { name: "API_IP_RATE_LIMITER", namespace_id: "1002", simple: { limit: 60, period: 60 } },
  ],
  triggers: { crons: ["23 */6 * * *"] },
};

describe("backupSettings", () => {
  const checked: string[] = [];
  const check = (cron: string) => {
    checked.push(cron);
    if (cron === "every day") throw new Error(`Can't read the cron expression "${cron}"`);
  };

  it("backs up every day at 03:17 UTC into the data folder, keeping seven, unless told otherwise", () => {
    expect(backupSettings({}, "/data", check)).toEqual({ schedule: "17 3 * * *", keep: 7, dir: "/data/backups" });
    expect(backupSettings({ SPOONJOY_BACKUP_SCHEDULE: " 0 */6 * * * ", SPOONJOY_BACKUPS_KEPT: "28", SPOONJOY_BACKUP_DIR: "/backups" }, "/data", check))
      .toEqual({ schedule: "0 */6 * * *", keep: 28, dir: "/backups" });
    expect(checked).toEqual(["17 3 * * *", "0 */6 * * *"]);
  });

  it("turns scheduled backups off, and treats an empty schedule as unset", () => {
    expect(backupSettings({ SPOONJOY_BACKUP_SCHEDULE: "off" }, "/data", check).schedule).toBeNull();
    expect(backupSettings({ SPOONJOY_BACKUP_SCHEDULE: "", SPOONJOY_BACKUP_DIR: "" }, "/srv", check)).toEqual({ schedule: "17 3 * * *", keep: 7, dir: "/srv/backups" });
  });

  it("refuses a schedule it can't read and a number kept that isn't a whole number from 1", () => {
    expect(() => backupSettings({ SPOONJOY_BACKUP_SCHEDULE: "every day" }, "/data", check)).toThrow("Can't read the cron expression");
    for (const kept of ["0", "-1", "1.5", "seven"]) {
      expect(() => backupSettings({ SPOONJOY_BACKUPS_KEPT: kept }, "/data", check)).toThrow(`SPOONJOY_BACKUPS_KEPT must be a whole number of backups, at least 1; got "${kept}".`);
    }
  });
});

describe("settingsFromEnv", () => {
  it("serves on 8080 from /app with data in /data unless told otherwise", () => {
    expect(settingsFromEnv({})).toEqual({ port: 8080, dataDir: "/data", appDir: "/app" });
    expect(settingsFromEnv({ PORT: "3000", DATA_DIR: "/srv/kitchen", APP_DIR: "/opt/app" })).toEqual({
      port: 3000,
      dataDir: "/srv/kitchen",
      appDir: "/opt/app",
    });
  });

  it("refuses a port that is not a whole number from 1 to 65535", () => {
    expect(() => settingsFromEnv({ PORT: "eighty" })).toThrow(/PORT/);
    expect(() => settingsFromEnv({ PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("selfHostVars", () => {
  const base = { built, env: {}, port: 8080, sessionSecret: "generated-secret" };

  it("answers at localhost on its port, with the generated session secret", () => {
    const vars = selfHostVars(base);
    expect(vars.SPOONJOY_BASE_URL).toBe("http://localhost:8080");
    expect(vars.SESSION_SECRET).toBe("generated-secret");
    expect(vars.NODE_ENV).toBe("production");
    expect(vars.SPOONJOY_CSP_MODE).toBe("enforce");
  });

  it("sends web push with the server's own keys, unless the owner set theirs", () => {
    const pushKeys = { publicKey: "server-public", privateKey: "server-private" };
    expect(selfHostVars({ ...base, pushKeys })).toMatchObject({
      VAPID_PUBLIC_KEY: "server-public",
      VAPID_PRIVATE_KEY: "server-private",
      VAPID_SUBJECT: "mailto:owner@localhost",
    });
    const owner = { VAPID_PUBLIC_KEY: "owner-public", VAPID_PRIVATE_KEY: "owner-private", VAPID_SUBJECT: "mailto:me@example.com" };
    expect(selfHostVars({ ...base, pushKeys, env: owner })).toMatchObject(owner);
    expect(selfHostVars({ ...base, pushKeys, env: { SPOONJOY_BASE_URL: "https://kitchen.example.com" } }).VAPID_SUBJECT).toBe("https://kitchen.example.com");
    expect(selfHostVars(base).VAPID_PUBLIC_KEY).toBeUndefined();
  });

  it("takes the public address from SPOONJOY_BASE_URL, for a server behind an HTTPS proxy", () => {
    expect(selfHostVars({ ...base, env: { SPOONJOY_BASE_URL: "https://kitchen.example.com" } }).SPOONJOY_BASE_URL).toBe(
      "https://kitchen.example.com",
    );
  });

  it("refuses a SPOONJOY_BASE_URL that is not an http or https address", () => {
    expect(() => selfHostVars({ ...base, env: { SPOONJOY_BASE_URL: "kitchen.local" } })).toThrow(/SPOONJOY_BASE_URL/);
    expect(() => selfHostVars({ ...base, env: { SPOONJOY_BASE_URL: "ftp://kitchen.local" } })).toThrow(/SPOONJOY_BASE_URL/);
  });

  it("accepts Sign in with Apple from the Spoonjoy apps out of the box, checked against Apple's public keys", () => {
    expect(selfHostVars(base).APPLE_NATIVE_CLIENT_IDS).toBe("app.spoonjoy,app.spoonjoy.mac");
    expect(selfHostVars({ ...base, env: { APPLE_NATIVE_CLIENT_IDS: "com.example.fork" } }).APPLE_NATIVE_CLIENT_IDS).toBe("com.example.fork");
  });

  it("passes the owner's OpenID Connect provider through to the app", () => {
    const env = {
      SPOONJOY_OIDC_ISSUER: "https://auth.example.test/realms/kitchen",
      SPOONJOY_OIDC_CLIENT_ID: "spoonjoy",
      SPOONJOY_OIDC_CLIENT_SECRET: "test-only-secret",
      SPOONJOY_OIDC_NAME: "Sign in with Keycloak",
      SPOONJOY_OIDC_SCOPES: "openid email",
    };
    expect(selfHostVars({ ...base, env })).toMatchObject(env);
  });

  it("uses a SESSION_SECRET from the environment over the generated one", () => {
    expect(selfHostVars({ ...base, env: { SESSION_SECRET: "mine" } }).SESSION_SECRET).toBe("mine");
  });

  it("turns analytics off unless the owner brings their own PostHog key", () => {
    expect(selfHostVars(base).POSTHOG_DISABLED).toBe("true");
    const withKey = selfHostVars({ ...base, env: { POSTHOG_KEY: "phc_owner", POSTHOG_HOST: "https://ph.example.com" } });
    expect(withKey.POSTHOG_DISABLED).toBeUndefined();
    expect(withKey.POSTHOG_KEY).toBe("phc_owner");
    expect(withKey.POSTHOG_HOST).toBe("https://ph.example.com");
  });

  it("says the Worker is self-hosted, so its first account is its admin, whatever the environment says", () => {
    expect(built.vars).not.toHaveProperty("SPOONJOY_SELF_HOSTED");
    expect(selfHostVars(base).SPOONJOY_SELF_HOSTED).toBe("true");
    expect(selfHostVars({ ...base, env: { SPOONJOY_SELF_HOSTED: "false" } }).SPOONJOY_SELF_HOSTED).toBe("true");
  });

  it("keeps the SMTP settings, password included, out of the Worker, and only tells it that mail goes through the server", () => {
    const smtp = {
      SPOONJOY_SMTP_HOST: "smtp.example.com",
      SPOONJOY_SMTP_PORT: "587",
      SPOONJOY_SMTP_USERNAME: "chef",
      SPOONJOY_SMTP_PASSWORD: "app-password",
      SPOONJOY_EMAIL_FROM: "kitchen@example.com",
    };
    const vars = selfHostVars({ ...base, env: smtp });
    expect(Object.keys(vars).filter((key) => key.startsWith("SPOONJOY_SMTP_"))).toEqual([]);
    expect(JSON.stringify(vars)).not.toContain("app-password");
    expect(vars).toMatchObject({ SPOONJOY_SELF_HOST_MAIL: "smtp", SPOONJOY_EMAIL_FROM: "kitchen@example.com" });
    expect(selfHostVars({ ...base, env: { SPOONJOY_SELF_HOST_MAIL: "smtp", SPOONJOY_SMTP_HOST: " " } }).SPOONJOY_SELF_HOST_MAIL).toBeUndefined();
  });

  it("passes SPOONJOY_SIGNUPS through, and refuses a value that isn't open or invite", () => {
    expect(selfHostVars(base)).not.toHaveProperty("SPOONJOY_SIGNUPS");
    expect(selfHostVars({ ...base, env: { SPOONJOY_SIGNUPS: "open" } }).SPOONJOY_SIGNUPS).toBe("open");
    expect(selfHostVars({ ...base, env: { SPOONJOY_SIGNUPS: "invite" } }).SPOONJOY_SIGNUPS).toBe("invite");
    expect(() => selfHostVars({ ...base, env: { SPOONJOY_SIGNUPS: "closed" } })).toThrow(/SPOONJOY_SIGNUPS must be "open" or "invite"/);
  });

  it("names no moderators unless the owner does", () => {
    expect(selfHostVars(base).SPOONJOY_MODERATOR_USERNAMES).toBe("");
    expect(selfHostVars({ ...base, env: { SPOONJOY_MODERATOR_USERNAMES: "me" } }).SPOONJOY_MODERATOR_USERNAMES).toBe("me");
  });

  it("passes the app's own settings through, and nothing else from the container", () => {
    const vars = selfHostVars({
      ...base,
      env: {
        OPENAI_API_KEY: "sk-test",
        GEMINI_API_KEY: "g",
        PHOTO_SWEEP_MODE: "apply",
        VAPID_PUBLIC_KEY: "v",
        PATH: "/usr/bin",
        HOSTNAME: "abc123",
        NODE_OPTIONS: "--inspect",
      },
    });
    expect(vars).toMatchObject({ OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "g", PHOTO_SWEEP_MODE: "apply", VAPID_PUBLIC_KEY: "v" });
    expect(vars).not.toHaveProperty("PATH");
    expect(vars).not.toHaveProperty("HOSTNAME");
    expect(vars).not.toHaveProperty("NODE_OPTIONS");
  });
});

describe("selfHostRateLimits", () => {
  it("keeps spoonjoy.app's limits", () => {
    expect(selfHostRateLimits(built, {})).toEqual({
      AUTH_IP_RATE_LIMITER: { simple: { limit: 20, period: 60 } },
      API_IP_RATE_LIMITER: { simple: { limit: 60, period: 60 } },
    });
    expect(selfHostRateLimits({}, {})).toEqual({});
  });

  it("raises one limit from SPOONJOY_RATE_LIMIT_<name>, for a household behind one address", () => {
    expect(selfHostRateLimits(built, { SPOONJOY_RATE_LIMIT_AUTH_IP_RATE_LIMITER: "120" }).AUTH_IP_RATE_LIMITER).toEqual({
      simple: { limit: 120, period: 60 },
    });
  });

  it("refuses a limit that is not a positive whole number", () => {
    expect(() => selfHostRateLimits(built, { SPOONJOY_RATE_LIMIT_AUTH_IP_RATE_LIMITER: "lots" })).toThrow(
      /SPOONJOY_RATE_LIMIT_AUTH_IP_RATE_LIMITER/,
    );
    expect(() => selfHostRateLimits(built, { SPOONJOY_RATE_LIMIT_AUTH_IP_RATE_LIMITER: "0" })).toThrow();
  });
});

describe("workerModules", () => {
  it("lists the worker and every chunk and wasm file by hand, since the route loader imports dynamically", () => {
    expect(workerModules("/app/build/server", ["route-a.js", "query_engine_bg.wasm", "manifest.json"])).toEqual([
      { type: "ESModule", path: "/app/build/server/_worker.js" },
      { type: "ESModule", path: "/app/build/server/assets/route-a.js" },
      { type: "CompiledWasm", path: "/app/build/server/assets/query_engine_bg.wasm" },
    ]);
  });
});

describe("miniflareOptions", () => {
  const options = miniflareOptions({
    built,
    env: {},
    settings: { port: 8080, dataDir: "/data", appDir: "/app" },
    sessionSecret: "s",
    version: "1.2.3",
    serverAssetFiles: ["route-a.js"],
  });

  it("listens on every address on one port", () => {
    expect(options).toMatchObject({ host: "0.0.0.0", port: 8080 });
  });

  it("keeps the database, photos, cook sessions and cache in the data folder", () => {
    expect(options).toMatchObject({
      d1Databases: { DB: "spoonjoy" },
      r2Buckets: { PHOTOS: "spoonjoy-photos" },
      durableObjects: { COOK_SESSIONS: { className: "CookSession", useSQLite: true } },
      defaultPersistRoot: "/data",
      d1Persist: "/data/d1",
      r2Persist: "/data/r2",
      durableObjectsPersist: "/data/do",
      cachePersist: "/data/cache",
    });
  });

  it("delivers platform jobs on a JOBS queue to the Worker, one at a time, retried as on spoonjoy.app", () => {
    expect(options.queueProducers).toEqual({ JOBS: { queueName: "spoonjoy-jobs" } });
    expect(options.queueConsumers).toEqual({ "spoonjoy-jobs": { maxBatchSize: 1, maxRetries: 100 } });
  });

  it("takes jobs but runs none while the test-only SPOONJOY_JOBS_PAUSED is 1", () => {
    const paused = (value: string) =>
      miniflareOptions({ built, env: { SPOONJOY_JOBS_PAUSED: value }, settings: { port: 8080, dataDir: "/data", appDir: "/app" }, sessionSecret: "s", version: "1", serverAssetFiles: [] });
    expect(paused("1").queueProducers).toEqual({ JOBS: { queueName: "spoonjoy-jobs" } });
    expect(paused("1").queueConsumers).toBeUndefined();
    expect(paused("0").queueConsumers).toEqual({ "spoonjoy-jobs": { maxBatchSize: 1, maxRetries: 100 } });
  });

  it("runs the build at its own compatibility date and flags, and serves its client assets", () => {
    expect(options.compatibilityDate).toBe("2024-12-01");
    expect(options.compatibilityFlags).toEqual(["nodejs_compat"]);
    expect(options.assets).toEqual({ directory: "/app/build/client", routerConfig: { has_user_worker: true } });
    expect(options.modulesRoot).toBe("/app/build/server");
    expect(options.modules[0]).toEqual({ type: "ESModule", path: "/app/build/server/_worker.js" });
  });

  it("sends the Worker's outbound requests through the fetch it is given, without workerd's CF-Worker header", async () => {
    const outboundFetch = vi.fn(async () => new Response("from node"));
    const routed = miniflareOptions({
      built,
      env: {},
      settings: { port: 8080, dataDir: "/data", appDir: "/app" },
      sessionSecret: "s",
      version: "1.2.3",
      serverAssetFiles: [],
      outboundFetch,
    });
    const request = new Request("https://appleid.apple.com/auth/keys", {
      headers: { Accept: "application/json", "CF-Worker": "worker.example.com", "User-Agent": "Spoonjoy" },
    });
    expect(await (await routed.outboundService(request)).text()).toBe("from node");
    const [url, init] = outboundFetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Headers }];
    expect(url).toBe("https://appleid.apple.com/auth/keys");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("follow");
    expect(init.headers.get("cf-worker")).toBeNull();
    expect(init.headers.get("accept")).toBe("application/json");
    expect(init.headers.get("user-agent")).toBe("Spoonjoy");
    expect(options.outboundService).toBeUndefined();
  });

  it("binds the server's backups as SELF_HOST only when given a handler for them", () => {
    const base = { built, env: {}, settings: { port: 8080, dataDir: "/data", appDir: "/app" }, sessionSecret: "s", version: "v", serverAssetFiles: [] };
    const hostService = vi.fn();
    expect(miniflareOptions({ ...base, hostService }).serviceBindings).toEqual({ SELF_HOST: hostService });
    expect(miniflareOptions(base).serviceBindings).toBeUndefined();
  });

  it("passes a request's body on", async () => {
    const outboundFetch = vi.fn(async () => new Response("ok"));
    const routed = miniflareOptions({
      built,
      env: {},
      settings: { port: 8080, dataDir: "/data", appDir: "/app" },
      sessionSecret: "s",
      version: "1.2.3",
      serverAssetFiles: [],
      outboundFetch,
    });
    await routed.outboundService(new Request("https://api.example.com/v1", { method: "POST", body: "hello" }));
    const [, init] = outboundFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(await new Response(init.body).text()).toBe("hello");
    expect(init).toMatchObject({ duplex: "half" });
  });

  it("names the image version as the worker version", () => {
    expect(options.bindings.CF_VERSION_METADATA).toMatchObject({ id: "1.2.3", tag: "1.2.3" });
    expect(options.bindings.SESSION_SECRET).toBe("s");
    expect(options.ratelimits.AUTH_IP_RATE_LIMITER).toEqual({ simple: { limit: 20, period: 60 } });
  });
});

describe("photoUploads", () => {
  it("puts each image in a folder under the prefix, with its content type, in name order", () => {
    expect(photoUploads(["penne-ragu.jpg", ".DS_Store", "chickpeas.webp", "a.PNG", "b.jpeg"], "/covers", "samples/covers/")).toEqual([
      { path: "/covers/a.PNG", key: "samples/covers/a.PNG", contentType: "image/png" },
      { path: "/covers/b.jpeg", key: "samples/covers/b.jpeg", contentType: "image/jpeg" },
      { path: "/covers/chickpeas.webp", key: "samples/covers/chickpeas.webp", contentType: "image/webp" },
      { path: "/covers/penne-ragu.jpg", key: "samples/covers/penne-ragu.jpg", contentType: "image/jpeg" },
    ]);
  });

  it("puts images at the top of the store when there is no prefix", () => {
    expect(photoUploads(["a.jpg"], "dir")).toEqual([{ path: "dir/a.jpg", key: "a.jpg", contentType: "image/jpeg" }]);
  });

  it("refuses a file that isn't a JPEG, PNG or WebP image", () => {
    expect(() => photoUploads(["notes.txt"], "dir", "")).toThrow("dir/notes.txt is not a JPEG, PNG or WebP image.");
  });

  it("refuses a folder with no images", () => {
    expect(() => photoUploads([".keep"], "dir", "")).toThrow("dir has no images.");
  });
});
