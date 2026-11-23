// What the self-hosted server hands Miniflare: the production build's own settings
// (build/server/wrangler.json), with the changes a server in someone's home needs. Pure: no I/O.
import path from "node:path";

// The app's own settings a container may set (app/cloudflare-env.d.ts). Anything else in the
// container's environment (PATH, HOSTNAME, NODE_OPTIONS) stays out of the Worker.
const PASSED_THROUGH = [
  /^SPOONJOY_/,
  /^SESSION_SECRET$/,
  /^OPENAI_/,
  /^GEMINI_/,
  /^GOOGLE_/,
  /^GITHUB_/,
  /^APPLE_/,
  /^VAPID_/,
  /^POSTHOG_/,
  /^IMAGE_PROVIDER_/,
  /^INGREDIENT_PARSE_/,
  /^COOK_SESSION_/,
  /^PHOTO_SWEEP_MODE$/,
];

const RATE_LIMIT_PREFIX = "SPOONJOY_RATE_LIMIT_";

export function settingsFromEnv(env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535; got "${env.PORT}".`);
  }
  return { port, dataDir: env.DATA_DIR ?? "/data", appDir: env.APP_DIR ?? "/app" };
}

export function selfHostVars({ built, env, port, sessionSecret }) {
  const vars = {
    ...built.vars,
    SPOONJOY_BASE_URL: `http://localhost:${port}`,
    SESSION_SECRET: sessionSecret,
    // spoonjoy.app's moderators are not this server's.
    SPOONJOY_MODERATOR_USERNAMES: "",
    // Sign in with Apple from the Spoonjoy iPhone, iPad and Mac apps: the server checks the app's
    // identity token against Apple's public keys and these bundle IDs, so it needs no Apple secret.
    APPLE_NATIVE_CLIENT_IDS: "app.spoonjoy,app.spoonjoy.mac",
  };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && PASSED_THROUGH.some((pattern) => pattern.test(key))) vars[key] = value;
  }
  let base;
  try {
    base = new URL(vars.SPOONJOY_BASE_URL);
  } catch {
    base = null;
  }
  if (!base || (base.protocol !== "http:" && base.protocol !== "https:")) {
    throw new Error(`SPOONJOY_BASE_URL must be an http:// or https:// address; got "${vars.SPOONJOY_BASE_URL}".`);
  }
  // Analytics are off unless the owner brings their own PostHog project.
  if (!vars.POSTHOG_KEY) vars.POSTHOG_DISABLED = "true";
  return vars;
}

export function selfHostRateLimits(built, env) {
  return Object.fromEntries(
    (built.ratelimits ?? []).map((rule) => {
      const key = `${RATE_LIMIT_PREFIX}${rule.name}`;
      let limit = rule.simple.limit;
      if (env[key] !== undefined) {
        limit = Number(env[key]);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error(`${key} must be a positive whole number of requests a minute; got "${env[key]}".`);
        }
      }
      return [rule.name, { simple: { limit, period: rule.simple.period } }];
    }),
  );
}

/**
 * The Worker's modules, listed by hand: React Router's route loader imports route modules
 * dynamically, which Miniflare's own module walker refuses.
 */
export function workerModules(serverDir, assetFiles) {
  const asset = (file) => path.join(serverDir, "assets", file);
  return [
    { type: "ESModule", path: path.join(serverDir, "_worker.js") },
    ...assetFiles.filter((file) => file.endsWith(".js")).map((file) => ({ type: "ESModule", path: asset(file) })),
    ...assetFiles.filter((file) => file.endsWith(".wasm")).map((file) => ({ type: "CompiledWasm", path: asset(file) })),
  ];
}

export function miniflareOptions({ built, env, settings, sessionSecret, version, serverAssetFiles }) {
  const { appDir, dataDir, port } = settings;
  const serverDir = path.join(appDir, "build/server");
  const vars = selfHostVars({ built, env, port, sessionSecret });
  return {
    host: "0.0.0.0",
    port,
    modulesRoot: serverDir,
    modules: workerModules(serverDir, serverAssetFiles),
    compatibilityDate: built.compatibility_date,
    compatibilityFlags: built.compatibility_flags,
    bindings: {
      ...vars,
      CF_VERSION_METADATA: { id: version, tag: version, timestamp: new Date().toISOString() },
    },
    d1Databases: { DB: "spoonjoy" },
    r2Buckets: { PHOTOS: "spoonjoy-photos" },
    durableObjects: { COOK_SESSIONS: { className: "CookSession", useSQLite: true } },
    ratelimits: selfHostRateLimits(built, env),
    assets: { directory: path.join(appDir, "build/client"), routerConfig: { has_user_worker: true } },
    defaultPersistRoot: dataDir,
    d1Persist: path.join(dataDir, "d1"),
    r2Persist: path.join(dataDir, "r2"),
    durableObjectsPersist: path.join(dataDir, "do"),
    cachePersist: path.join(dataDir, "cache"),
  };
}

const PHOTO_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// The images in a folder, each with the photo store key it goes under and its content type, for
// `server.mjs photos <folder> [prefix]`. Hidden files are skipped; anything else must be an image.
export function photoUploads(fileNames, dir, prefix = "") {
  const uploads = [...fileNames]
    .filter((name) => !name.startsWith("."))
    .sort()
    .map((name) => {
      const contentType = PHOTO_TYPES[path.extname(name).toLowerCase()];
      if (!contentType) throw new Error(`${dir}/${name} is not a JPEG, PNG or WebP image.`);
      return { path: path.join(dir, name), key: `${prefix}${name}`, contentType };
    });
  if (uploads.length === 0) throw new Error(`${dir} has no images.`);
  return uploads;
}
