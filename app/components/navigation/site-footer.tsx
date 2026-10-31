import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { useXray } from "~/components/xray/xray-provider";

/**
 * The quiet line at the foot of every page: Spoonjoy is built with Ouro HX, and "See all the
 * components" turns on X-ray, which outlines each HX component on the page with its docs and source.
 * It sits after <main> and before the phone tab bar's room at the end of the page, so scrolled to
 * the bottom it shows whole above the bar. Cook mode, a full-screen view, hides it (tailwind.css).
 * While X-ray is on, `data-xray` makes room below it for X-ray's floating bar (tailwind.css).
 */
export function SiteFooter() {
  const { open, setOpen } = useXray();
  return (
    <footer data-xray={open ? "" : undefined} className="sj-site-footer flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[var(--sj-border)] px-5 py-3 font-sj-ui text-sm print:hidden">
      <Link href="https://ui.ouro.bot/" tone="secondary" inline={false}>
        Built with Ouro HX
      </Link>
      <Button variant="plain" tone="secondary" size="sm" onClick={() => setOpen(true)}>
        See all the components
      </Button>
    </footer>
  );
}
