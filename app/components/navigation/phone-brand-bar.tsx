import { Button } from "~/components/button";
import { Link } from "~/components/ouro/link/link";
import { SpoonjoyLogo } from "~/components/spoonjoy-logo";

// A slim wordmark bar for signed-out visitors on a phone (below the desktop top bar's breakpoint).
// Someone arriving from a shared recipe link sees whose site this is and how to join, which the tab
// bar (Home, Recipes, Log in) never said (product audit 2026-10-09, finding 18). Cook mode and print
// hide it.
export function PhoneBrandBar() {
  return (
    <header
      data-testid="phone-brand-bar"
      className="sj-phone-brandbar flex min-h-14 items-center justify-between gap-3 border-b border-[var(--sj-border)] bg-[var(--sj-page)] px-4 pt-[env(safe-area-inset-top)] lg:hidden print:hidden"
    >
      <Link href="/" tone="secondary" inline={false} className="inline-flex min-h-11 items-center gap-2">
        <SpoonjoyLogo width={32} height={20} aria-hidden="true" />
        <span className="font-sj-ui text-sm font-bold uppercase tracking-[0.2em]">Spoonjoy</span>
      </Link>
      <Button href="/signup">Sign up</Button>
    </header>
  );
}
