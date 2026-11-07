import { OURO_PROVENANCE } from "~/lib/ouro-provenance.server";

/** Which Ouro HX release Spoonjoy runs, and which files each page is built from and which HX items they render. */
export function loader() {
  return Response.json(OURO_PROVENANCE, {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
