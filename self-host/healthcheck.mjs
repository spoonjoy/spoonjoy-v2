// The image's HEALTHCHECK command (self-host/Dockerfile).
import { checkHealth } from "./health.mjs";

process.exit(await checkHealth({ port: Number(process.env.PORT ?? 8080) }));
