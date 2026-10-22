import manifest from "~/generated/ouro-provenance.json";
import { UNKNOWN_SOURCE_SHA, buildSourceSha } from "~/lib/build-info.server";
import type { PageProvenance } from "~/lib/ouro-provenance";

interface ProvenanceEntry {
  file: string;
  sources: string[];
  components: string[];
  renders: Record<string, string[] | undefined>;
}

/** The generated manifest (scripts/generate-ouro-provenance.mjs): the HX release, the root layout, and every page route's sources and components. */
export interface OuroProvenance {
  /** How Spoonjoy builds with Ouro HX: docs/building-with-ouro-hx.md. */
  guide: string;
  ouroTag: string;
  root: ProvenanceEntry;
  routes: Array<ProvenanceEntry & { path: string }>;
}

export const OURO_PROVENANCE: OuroProvenance = manifest;

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
