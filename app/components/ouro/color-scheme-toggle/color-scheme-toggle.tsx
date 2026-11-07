"use client";

import { useState, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useColorScheme, type ColorScheme } from "~/lib/ouro/color-scheme";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Button } from "~/components/ouro/button/button";
import { Menu } from "~/components/ouro/menu/menu";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";

/**
 * The words for each scheme, for apps in other languages.
 *
 * @claim "The words for each scheme, for" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:fileLine(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx, /labels=\{\{\slight:\s"Hell",\sdark:\s"Dunkel"/)
 */
export interface ColorSchemeLabels {
  /** @default "Light" */
  light?: string | undefined;
  /** @default "Dark" */
  dark?: string | undefined;
  /** @default "System" */
  system?: string | undefined;
}

/** Props for {@link ColorSchemeToggle}. */
export interface ColorSchemeToggleProps {
  /**
   * `menu` is an icon button, the sun or the moon of the scheme the page shows, that opens
   * a menu of Light, Dark and System, for a header. `segmented` shows the three side by
   * side, for a settings page.
   * @default "menu"
   * @claim "`segmented` shows the three side by" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:testExists(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx::ColorSchemeToggle > shows the three side by side as a segmented control)
   */
  variant?: "menu" | "segmented" | (string & { 'Use "menu" (an icon button for a header) or "segmented" (for settings)': never }) | undefined;
  /** Names the control for screen readers: the button's name, or the segmented control's label. @default "Color scheme" */
  label?: string | undefined;
  /**
   * The words for each scheme.
   *
   * @claim "The words for each scheme" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:fileLine(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx, /labels=\{\{\slight:\s"Hell",\sdark:\s"Dunkel"/)
   */
  labels?: ColorSchemeLabels | undefined;
  /** Layout only: margins, grid placement (`ms-auto`). Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the menu button, or the segmented control's group. */
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. The toggle keeps the scheme itself, through `ColorSchemeProvider`; read it with `useColorScheme()`. */
  value?: { 'The toggle keeps the scheme; read it with useColorScheme()': never };
  /** Not a prop. The toggle applies the choice itself; to react to it, read `useColorScheme().resolved`. */
  onChange?: { 'The toggle applies the choice; read useColorScheme().resolved to react to it': never };
  /** Not a prop. Ouro UI says color scheme: `<ColorSchemeToggle />` with `ColorSchemeProvider` around the app. */
  theme?: { 'Use <ColorSchemeToggle /> inside <ColorSchemeProvider>': never };
}

const variants = ["menu", "segmented"] as const;
const order: readonly ColorScheme[] = ["light", "dark", "system"];

/** The sun of a light page and the moon of a dark one, as lucide-react draws them. */
function SchemeIcon({ dark }: { dark: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
      {dark ? (
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </>
      )}
    </svg>
  );
}

/**
 * The control that switches the app between light, dark and the system's scheme, and
 * keeps the choice. `variant="menu"`, the default, is an icon button for a header: the sun
 * or the moon of the scheme the page shows, opening a menu of Light, Dark and System, the
 * current one checked. `variant="segmented"` shows the three side by side, for a settings
 * page. Either way the choice applies at once, as the `.dark` class on `<html>` that
 * shadcn themes switch on, and is kept in `localStorage`.
 *
 * It works on its own, but the choice then shows only once the toggle changes it: wrap the
 * app in `ColorSchemeProvider`, which applies the kept choice on every page and follows the
 * system's setting live, and put `colorSchemeScript()` in `<head>` so a reload never flashes
 * the wrong scheme. For a control of your own, `useColorScheme()` gives the scheme
 * and its setter.
 *
 * Use `Switch` with `useColorScheme()` instead for a plain dark-mode on/off, and
 * `SegmentedControl` for other choices of how a view looks.
 *
 * @group Actions
 * @see https://ui.ouro.bot/docs/color-scheme-toggle
 *
 * @example
 * <Navbar label="Main" items={items} actions={<ColorSchemeToggle />} />
 * <ColorSchemeToggle variant="segmented" label="Appearance" />
 * @claim "It works on its own, but" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:testExists(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx::ColorSchemeToggle > applies and keeps the choice, and shows the moon on a dark page)
 * @claim "It works on its own, but" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:testExists(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx::ColorSchemeToggle > follows the system while the choice is System)
 * @claim "` shows the three side by side, for" registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx verify:testExists(registry/ouro/components/ouro/color-scheme-toggle/color-scheme-toggle.test.tsx::ColorSchemeToggle > shows the three side by side as a segmented control)
 */
export function ColorSchemeToggle(props: ColorSchemeToggleProps): JSX.Element {
  const {
    variant: variantProp = "menu",
    label = "Color scheme",
    labels,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    value,
    onChange,
    theme,
  } = props;
  const variant = (variants as readonly string[]).includes(variantProp) ? (variantProp as (typeof variants)[number]) : "menu";
  const { scheme, resolved, setScheme } = useColorScheme();
  useAppearanceClassNameCheck(
    "ColorSchemeToggle",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; ColorSchemeToggle sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ColorSchemeToggle",
    process.env.NODE_ENV !== "production"
      ? () => [
          variant !== variantProp && [`variant="${String(variantProp)}" is not a variant; use "menu" or "segmented"`, '<ColorSchemeToggle variant="segmented" />'],
          value !== undefined && ["value is not a prop; the toggle keeps the scheme", "const { scheme } = useColorScheme()"],
          onChange !== undefined && ["onChange is not a prop; the toggle applies the choice", "const { resolved } = useColorScheme()"],
          theme !== undefined && ["theme is not a prop", "<ColorSchemeToggle />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const words: Record<ColorScheme, string> = { light: labels?.light ?? "Light", dark: labels?.dark ?? "Dark", system: labels?.system ?? "System" };
  const options = order.map((option) => ({ value: option, label: words[option] }));
  // The menu closes on a choice, as a menu of settings does on the Mac; the page has already switched behind it.
  const [open, setOpen] = useState(false);
  const choose = (next: string) => {
    setScheme(next as ColorScheme);
    setOpen(false);
  };

  return (
    <div data-ouro="color-scheme-toggle" data-variant={variant} className={cn("inline-flex", className)}>
      {variant === "segmented" ? (
        <SegmentedControl ref={ref as Ref<HTMLDivElement>} label={label} hideLabel items={options} value={scheme} onValueChange={choose} />
      ) : (
        <Menu
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button
              ref={ref as Ref<HTMLButtonElement>}
              data-ouro-control="color-scheme-toggle"
              data-ouro-part="trigger"
              data-scheme={resolved}
              variant="plain"
              tone="secondary"
              aria-label={label}
              className="w-11 px-0"
            >
              <SchemeIcon dark={resolved === "dark"} />
            </Button>
          }
          items={[{ type: "radio", label, value: scheme, onValueChange: choose, options }]}
        />
      )}
    </div>
  );
}
