// Platform: the seams the rest of the app runs on: its ports, safe to import anywhere. Import it from
// "~/domains/platform", never from its folders; the composition root and the adapters behind the ports
// are in "~/domains/platform/index.server".
export * from "./flags";
export * from "./model";
export * from "./ports/ports";
export * from "./ports/jobs";
