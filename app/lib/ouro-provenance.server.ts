import manifest from "~/generated/ouro-provenance.json";
import ouroDevSource from "~/lib/ouro/dev.ts?raw";
import { UNKNOWN_SOURCE_SHA, buildSourceSha } from "~/lib/build-info.server";
import type { PageProvenance } from "~/lib/ouro-provenance";

interface ProvenanceEntry {
  file: string;
  sources: string[];
  components: string[];
  renders: Record<string, string[] | undefined>;
}

/** /ouro-provenance.json: the HX release, the root layout, and every page route's sources and components. */
export interface OuroProvenance {
  /** How Spoonjoy builds with Ouro HX: docs/building-with-ouro-hx.md. */
  guide: string;
  ouroTag: string;
  root: ProvenanceEntry;
  routes: Array<ProvenanceEntry & { path: string }>;
}

/**
 * The installed HX release tag (`v1.1.0`), read from HX's own source: its dev messages name the
 * theme's install command at the release. Read at build time rather than committed in the manifest,
 * so an Ouro update, which changes only HX's own files, needs no regenerated file.
 */
export function readOuroTag(source: string): string {
  const match = /ouro-base#(v\d+\.\d+\.\d+)/.exec(source);
  if (!match) throw new Error("Expected the Ouro HX release (ouro-base#vX.Y.Z) in app/lib/ouro/dev.ts");
  return match[1];
}

/** The generated manifest (scripts/generate-ouro-provenance.mjs) with the installed HX release. */
export const OURO_PROVENANCE: OuroProvenance = {
  guide: manifest.guide,
  ouroTag: readOuroTag(ouroDevSource),
  root: manifest.root,
  routes: manifest.routes,
};

/**
 * What X-ray needs to link one page's components to their source: the page's own record from the
 * manifest, the root layout's, and the commit this build came from (`main` when it is unknown, as
 * in a local build without git).
 */
export function pageProvenance(file: string, sourceSha: string = buildSourceSha()): PageProvenance {
  const route = OURO_PROVENANCE.routes.find((candidate) => candidate.file === file);
  if (!route) throw new Error(`${file} is not a page in ${"app/generated/ouro-provenance.json"}; run pnpm provenance:generate`);
  return {
    file: route.file,
    renders: route.renders,
    root: { file: OURO_PROVENANCE.root.file, renders: OURO_PROVENANCE.root.renders },
    sourceSha: sourceSha === UNKNOWN_SOURCE_SHA ? "main" : sourceSha,
  };
}
