/** Where one page's Ouro HX components are rendered from, as /ouro-provenance.json records it. */
export interface PageProvenance {
  /** The route module, such as `app/routes/test-kitchen.tsx`. */
  file: string;
  /** For each HX item the page's own files render, the files that render it. */
  renders: Record<string, string[] | undefined>;
  /** The root layout around every page, which renders the site's header and toasts. */
  root: { file: string; renders: Record<string, string[] | undefined> };
  /** The commit this build was made from, so a link shows the source that is running. */
  sourceSha: string;
}

export const SOURCE_REPOSITORY = "https://github.com/spoonjoy/spoonjoy-v2";

/**
 * X-ray's Source links for a page: the one file that renders an HX item, when the page (or else the
 * root layout) has exactly one, and otherwise the page's route module, at the commit that is running.
 */
export function sourceHrefFor(provenance: PageProvenance): (item: string) => string {
  return (item) => {
    const files = provenance.renders[item] ?? provenance.root.renders[item];
    const file = files?.length === 1 ? files[0] : provenance.file;
    return `${SOURCE_REPOSITORY}/blob/${provenance.sourceSha}/${file}`;
  };
}
