import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { matchRoutes, useLocation, useSearchParams } from "react-router";
import { Inspector } from "~/components/ouro/inspector/inspector";
import { sourceHrefFor } from "~/lib/ouro-provenance";

/** Whether X-ray is on, and the way to turn it on or off, for any control on any page. */
export interface XrayState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const XrayContext = createContext<XrayState | null>(null);

/** The parts of /ouro-provenance.json X-ray reads: which files render each HX item, per page and in the root layout. */
interface Manifest {
  root: { file: string; renders: Record<string, string[] | undefined> };
  routes: Array<{ path: string; file: string; renders: Record<string, string[] | undefined> }>;
}

/** /ouro-provenance.json, or `null` when it cannot be read (X-ray then shows no Source links). */
async function loadManifest(): Promise<Manifest | null> {
  try {
    const response = await fetch("/ouro-provenance.json");
    return response.ok ? ((await response.json()) as Manifest) : null;
  } catch {
    return null;
  }
}

/**
 * The site's one X-ray (HX's Inspector): the footer's "See all the components" and the Test
 * Kitchen's switch both drive it, and `?xray` opens it on arrival. Its Source links name the file
 * that renders each component on the current page, at the commit `sourceSha` that is running.
 */
export function XrayProvider({ sourceSha, children }: { sourceSha: string; children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(() => searchParams.has("xray"));
  // Read once someone turns X-ray on; the provider sits in the root layout, so it lasts the visit.
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open || manifest) return;
    let current = true;
    void loadManifest().then((loaded) => {
      if (current && loaded) setManifest(loaded);
    });
    return () => {
      current = false;
    };
  }, [open, manifest]);

  const sourceHref = useMemo(() => {
    if (!manifest) return undefined;
    // The page's own route, ranked as React Router ranks them. A layout and its index route share a
    // path, and the index (listed after its layout) is the page, so later entries win a tie.
    const route = matchRoutes([...manifest.routes].reverse(), pathname)?.[0]?.route;
    return sourceHrefFor({
      file: route?.file ?? manifest.root.file,
      renders: route?.renders ?? {},
      root: manifest.root,
      sourceSha,
    });
  }, [manifest, pathname, sourceSha]);

  const state = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <XrayContext.Provider value={state}>
      {children}
      <Inspector open={open} onOpenChange={setOpen} sourceHref={sourceHref} />
    </XrayContext.Provider>
  );
}

/** The site's X-ray, from the nearest {@link XrayProvider}. */
export function useXray(): XrayState {
  const state = useContext(XrayContext);
  if (!state) throw new Error("useXray needs <XrayProvider> around it (app/root.tsx renders one)");
  return state;
}
