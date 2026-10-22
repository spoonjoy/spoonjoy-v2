"use client";

import { Fragment, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink } from "~/lib/ouro/router-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Menu } from "~/components/ouro/menu/menu";

/** One step of a Breadcrumb's trail. */
export interface BreadcrumbItem {
  /** The page's name: "Recipes". */
  label: string;
  /**
   * Where the step goes; internal paths go through `OuroProvider`'s `linkComponent`. Every
   * item needs one except the last, the current page, which renders as text.
   * @claim "Every item needs one except the" registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx verify:testExists(registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx::Breadcrumb > renders a labelled nav with an ordered list of links, the last one the current page)
   * @claim "Every item needs one except the" registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx verify:testExists(registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx::Breadcrumb > renders the current page as text even when it has an href)
   */
  href?: string | undefined;
  /**
   * An icon before the label, as an element: `icon: <HomeIcon />`. It is hidden from
   * screen readers, so the label still names the step.
   */
  icon?: ReactNode;
}

/** Props for {@link Breadcrumb}. */
export interface BreadcrumbProps {
  /** The trail from the top of the site to the current page, which is the last item. */
  items: readonly BreadcrumbItem[];
  /**
   * The longest trail shown in full. A longer one keeps the first item and the last ones
   * (`maxItems - 2` of them, at least the current page) and puts the middle in a menu,
   * which is a bottom sheet below 640px.
   * @default 4
   * @claim "A longer one keeps the first" registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx verify:testExists(registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx::Breadcrumb > keeps more of the trail with maxItems, and at least the first and the current page)
   * @claim "A longer one keeps the first" registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx verify:testExists(registry/ouro/components/ouro/breadcrumb/breadcrumb.test.tsx::Breadcrumb > collapses the middle of a long trail into a menu of links)
   * @claim "A longer one keeps the first" registry/ouro/lib/ouro/use-sheet-presentation.ts verify:fileLine(registry/ouro/lib/ouro/use-sheet-presentation.ts, /\(min-width: 640px\)/)
   */
  maxItems?: number | undefined;
  /** Names the navigation for screen readers. @default "Breadcrumb" */
  label?: string | undefined;
  /** The name of the "…" button that opens the hidden steps. @default "More" */
  moreLabel?: string | undefined;
  /** The text of the item that closes the hidden steps' sheet on a phone. @default "Close" */
  closeLabel?: string | undefined;
  /** Layout only: margins, width, grid placement (`mb-4`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `items`: `<Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />`. */
  links?: { 'Use <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />': never };
  /** Not a prop. Breadcrumb draws its own separators. */
  separator?: { "Remove separator; Breadcrumb draws its own": never };
  /** Not rendered. The trail is data: `<Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />`. */
  children?: { 'Use <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />': never };
}

// Class strings are literal so the app's Tailwind finds them when it compiles.

// 16px text and 44px targets on a coarse pointer at every width; 14px text with a fine one.
const text = "text-base pointer-fine:text-sm leading-5";
const crumb =
  "inline-flex min-h-11 min-w-11 pointer-fine:min-h-0 pointer-fine:min-w-0 items-center rounded-xs text-muted-foreground no-underline " +
  "decoration-current/40 underline-offset-4 transition-colors duration-(--ouro-duration-fast) ease-[ease] pointer-fine:hover:text-foreground pointer-fine:hover:underline active:text-foreground " +
  "[-webkit-tap-highlight-color:transparent] outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
const more =
  "press m-0 box-border inline-flex h-11 min-w-11 pointer-fine:h-7 pointer-fine:min-w-7 cursor-pointer items-center justify-center " +
  "rounded-md border-0 forced-colors:border forced-colors:border-solid bg-transparent p-0 font-[inherit] text-muted-foreground select-none touch-manipulation " +
  "[-webkit-tap-highlight-color:transparent] pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground " +
  "motion-safe:active:scale-(--ouro-press-scale) outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

const row = "inline-flex min-w-0 items-center gap-x-1.5";

const example = '<Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />';

function Separator(): JSX.Element {
  return (
    <svg
      data-ouro-breadcrumb-separator=""
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0 text-muted-foreground/70 rtl:-scale-x-100"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

/**
 * The trail from the top of the site to the current page: a labelled `<nav>` with an
 * ordered list of links, the last item marked `aria-current="page"`. A long trail keeps
 * its first and last steps and collapses the middle into a `Menu`.
 *
 * Use `Navbar` or `Sidebar` instead for the app's main sections, and `Tabs` for views of
 * one page.
 *
 * @group Navigation
 * @see https://ourostack.github.io/ouro-ui/docs/breadcrumb
 *
 * @example
 * <Breadcrumb
 *   items={[
 *     { label: "Home", href: "/" },
 *     { label: "Recipes", href: "/recipes" },
 *     { label: "Short ribs" },
 *   ]}
 * />
 */
export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const {
    items,
    maxItems = 4,
    label = "Breadcrumb",
    moreLabel = "More",
    closeLabel = "Close",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    links,
    separator,
    children,
  } = props;
  useAppearanceClassNameCheck(
    "Breadcrumb",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Breadcrumb sets its own look`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Breadcrumb",
    process.env.NODE_ENV !== "production"
      ? () => {
          const unlinked = items.slice(0, -1).find((item) => item.href === undefined);
          return [
            unlinked && [
              `"${unlinked.label}" has no href; only the last item, the current page, goes without one`,
              `items={[{ label: "${unlinked.label}", href: "/…" }, …]}`,
            ],
            links !== undefined && ["links is not a prop", example],
            separator !== undefined && ["separator is not a prop; Breadcrumb draws its own", example],
            children !== undefined && ["children are not rendered; the trail is data", example],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // A long trail: the first step, a menu of the middle, and the last steps.
  const tail = Math.max(1, Math.floor(maxItems) - 2);
  const collapsed = items.length > Math.max(maxItems, tail + 1);
  const hidden = collapsed ? items.slice(1, -tail) : [];
  const shown = collapsed ? [items[0]!, ...items.slice(-tail)] : items;
  const last = shown.length - 1;
  const content = (item: BreadcrumbItem) => (
    <>
      {item.icon !== undefined && (
        <span aria-hidden="true" className="me-1.5 inline-flex shrink-0 [&_svg]:size-4">
          {item.icon}
        </span>
      )}
      {item.label}
    </>
  );

  return (
    <nav ref={ref} data-ouro="breadcrumb" aria-label={label} className={cn("min-w-0", className)}>
      <ol className={cn("m-0 flex list-none flex-wrap items-center gap-x-1.5 p-0", text)}>
        {shown.map((item, index) => (
          <Fragment key={index}>
            {index === 1 && collapsed && (
              <li className={row}>
                <Separator />
                <span data-ouro-breadcrumb-item="" className="inline-flex">
                  <Menu
                    closeLabel={closeLabel}
                    trigger={
                      <button type="button" aria-label={moreLabel} data-ouro-control="breadcrumb" data-ouro-part="more" className={more}>
                        <span aria-hidden="true">…</span>
                      </button>
                    }
                    items={hidden.map((step) => ({ label: step.label, href: step.href, disabled: step.href === undefined }))}
                  />
                </span>
              </li>
            )}
            <li className={row}>
              {index > 0 && <Separator />}
              {index === last ? (
                <span data-ouro-breadcrumb-item="" aria-current="page" className="inline-flex items-center font-medium text-foreground">
                  {content(item)}
                </span>
              ) : item.href === undefined ? (
                <span data-ouro-breadcrumb-item="" className="inline-flex items-center text-muted-foreground">
                  {content(item)}
                </span>
              ) : (
                <RouterLink data-ouro-breadcrumb-item="" data-ouro-control="breadcrumb" data-ouro-part="crumb" href={item.href} className={crumb}>
                  {content(item)}
                </RouterLink>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
