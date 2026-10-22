"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type JSX,
  type ReactElement,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { ariaKeyShortcuts } from "~/lib/ouro/key-shortcuts";
import {
  floatingAligns,
  floatingHint,
  floatingPlacementWarnings,
  floatingPortalClass,
  floatingSide,
  type FloatingAlign,
  type FloatingSide,
} from "~/lib/ouro/floating";
import { RouterLink } from "~/lib/ouro/router-link";
import { toneWarning } from "~/lib/ouro/tones";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useSheetPresentation } from "~/lib/ouro/use-sheet-presentation";
import { Kbd } from "~/components/ouro/kbd/kbd";
import {
  menuBackdropClass,
  menuBarClass,
  menuBarTriggerClass,
  menuContextTriggerClass,
  menuGroupLabelClass,
  menuIndicatorClass,
  menuItemClass,
  menuPopupClass,
  menuPositionerClass,
  menuSeparatorClass,
  menuSheetPopupClass,
  menuSheetPositionerClass,
} from "~/components/ouro/menu/menu-styles";

export type { FloatingAlign as MenuAlign, FloatingSide as MenuSide } from "~/lib/ouro/floating";

/** Keys for a shortcut, as `Kbd` takes them: `["mod", "e"]` shows ⌘E on Apple platforms and Ctrl+E elsewhere. */
export type MenuShortcut = readonly string[] | (string & { 'Use an array: shortcut={["mod", "k"]}': never });

/** A menu entry for `items`: an action, or a link with `href`. */
export interface MenuItemEntry {
  type?: "item" | undefined;
  /** The item's text. */
  label: string;
  /** Runs when the item is chosen, by click, tap or Enter. The menu then closes. */
  onClick?: (() => void) | undefined;
  /** Makes the item a link, through `OuroProvider`'s router link for an internal path. */
  href?: string | undefined;
  /** The keys of the item's shortcut, shown at its end: `["mod", "e"]`. It does not bind them. */
  shortcut?: MenuShortcut | undefined;
  /** `"destructive"` for an action that deletes or cannot be undone. */
  tone?: "destructive" | undefined;
  /** Shown, but cannot be chosen. */
  disabled?: boolean | undefined;
}

/** A menu entry for `items`: an on/off setting that stays in the menu when toggled. */
export interface MenuCheckboxEntry {
  type: "checkbox";
  label: string;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  shortcut?: MenuShortcut | undefined;
  disabled?: boolean | undefined;
}

/** A menu entry for `items`: one choice of several, as radio items under an optional label. */
export interface MenuRadioEntry {
  type: "radio";
  /** Names the group: "Sort by". */
  label?: string | undefined;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  options: ReadonlyArray<{ value: string; label: string; shortcut?: MenuShortcut | undefined; disabled?: boolean | undefined }>;
}

/** A menu entry for `items`: entries under a label. */
export interface MenuGroupEntry {
  type: "group";
  label: string;
  items: readonly MenuEntry[];
}

/** A menu entry for `items`: an item that opens a nested menu. */
export interface MenuSubmenuEntry {
  type: "submenu";
  label: string;
  items: readonly MenuEntry[];
  disabled?: boolean | undefined;
  /** The text of the item that goes back from the submenu in the phone sheet. Default "Back". */
  backLabel?: string | undefined;
}

/** One entry in a Menu's `items`: an item (the default `type`), a checkbox, a radio group, a group, a submenu or a separator. */
export type MenuEntry =
  | MenuItemEntry
  | MenuCheckboxEntry
  | MenuRadioEntry
  | MenuGroupEntry
  | MenuSubmenuEntry
  | { type: "separator" };

/**
 * Props shared by every way of opening a Menu.
 *
 * @claim "Props shared by every way of" registry/ouro/components/ouro/menu/menu.test.tsx verify:fileLine(registry/ouro/components/ouro/menu/menu.test.tsx, /throws\sthe\sexact\sfix\swith\sno\sway\sto\sopen/)
 */
export interface MenuBaseProps {
  /** The entries as data, in place of children: `items={[{ label: "Edit", onClick: edit }, { type: "separator" }]}`. */
  items?: readonly MenuEntry[] | undefined;
  /** The entries as `MenuItem`, `MenuCheckboxItem`, `MenuRadioGroup`, `MenuGroup`, `MenuSub` and `MenuSeparator`. */
  children?: ReactNode;
  /** Whether the menu is open, to control it; pass `onOpenChange` with it. */
  open?: boolean | undefined;
  /** Called when the menu opens or closes. */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /**
   * Layout only, applied to the menu panel: width (`w-64`; at least 12rem by default) and
   * margins. The phone sheet keeps its full width. Appearance classes warn in development.
   * @claim "Layout only, applied to the menu" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu dropdown > is at least 12rem wide, and className sets layout)
   */
  className?: string | undefined;
  /**
   * The text of the item that ends the phone sheet and closes it, for screen-reader and
   * switch users, who cannot swipe or tap the backdrop. Default "Close".
   */
  closeLabel?: string | undefined;

  /** Not a prop. Ouro UI uses `open` with `onOpenChange`: `<Menu open={open} onOpenChange={setOpen} trigger={…}>`. */
  isOpen?: { 'Use <Menu open={open} onOpenChange={setOpen} trigger={...}>': never };
  /** Not a prop. `onOpenChange(false)` fires on close: `<Menu open={open} onOpenChange={setOpen} trigger={…}>`. */
  onClose?: { 'Use <Menu open={open} onOpenChange={setOpen} trigger={...}>': never };
  /** Not a prop. Ouro UI splits placement into `side` and `align`: `<Menu side="bottom" align="start">`. */
  placement?: { 'Use side="bottom" align="start"': never };
  /** Not a prop. The trigger element is the button: `trigger={<Button>Actions</Button>}`. */
  asChild?: { "Use trigger={<Button>Actions</Button>}": never };
  /** Not a prop. The entries are `items` (or children): `items={[{ label: "Edit", onClick: edit }]}`. */
  options?: { 'Use items={[{ label: "Edit", onClick: edit }]}': never };
}

/** Where a dropdown sits beside its trigger. */
interface MenuPlacementProps {
  /**
   * The side of the trigger the menu sits on; it flips when there is no room. @default "bottom"
   *
   * @claim "it flips when there is no room" https://base-ui.com/react/components/menu verify:urlOk(https://base-ui.com/react/components/menu)
   */
  side?: FloatingSide | (string & { 'Use "top", "bottom", "left" or "right"': never }) | undefined;
  /** How the menu lines up with the trigger along that side. @default "start" */
  align?: FloatingAlign | (string & { 'Use "start", "center" or "end": left is "start", right is "end"': never }) | undefined;
}

/**
 * A dropdown: `trigger` opens it. Below 640px it is a bottom sheet.
 *
 * @claim "Below 640px it is a bottom" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu presentation > is a bottom sheet below 640px, with a backdrop, and its submenu is a sheet with a Back item)
 */
export type MenuDropdownProps = MenuBaseProps &
  MenuPlacementProps & {
    /** The button that opens the menu, usually a Button: `trigger={<Button>Actions</Button>}`. */
    trigger: ReactElement;
    /** Not with `trigger`. Use one way to open a menu. */
    contextTrigger?: never;
    /** Not with `trigger`. `label` is for a Menu inside `MenuBar`. */
    label?: never;
  };

/** A context menu: right-click or long-press on `contextTrigger` opens it at the pointer. */
export type MenuContextProps = MenuBaseProps & {
  /**
   * The area that opens the menu on right-click, or on a long press on touch screens:
   * `contextTrigger={<div>…</div>}`. Its text stays selectable; only while a finger is
   * down does it turn off text selection and the iOS callout, so a long press opens the
   * menu. Give the same actions a visible control too: a context menu is hard to discover.
   */
  contextTrigger: ReactElement;
  /** Not with `contextTrigger`. Use one way to open a menu. */
  trigger?: never;
  /** Not with `contextTrigger`. `label` is for a Menu inside `MenuBar`. */
  label?: never;
  /** Not with `contextTrigger`: a context menu opens at the pointer. */
  side?: never;
  /** Not with `contextTrigger`: a context menu opens at the pointer. */
  align?: never;
};

/** A menu in a `MenuBar`: `label` is its button's text. */
export type MenuBarMenuProps = MenuBaseProps &
  MenuPlacementProps & {
    /** The text of the menu's button in the `MenuBar`: `<Menu label="File">`. */
    label: string;
    /** Not with `label`. A menu in a `MenuBar` gets its button from `label`. */
    trigger?: never;
    /** Not with `label`. A menu in a `MenuBar` gets its button from `label`. */
    contextTrigger?: never;
  };

/** Props for {@link Menu}: `trigger` (a dropdown), `contextTrigger` (a context menu) or `label` (in a `MenuBar`). */
export type MenuProps = MenuDropdownProps | MenuContextProps | MenuBarMenuProps;

/** What items read from the menu around them: that there is one, and whether it is a phone sheet. */
const MenuContext = createContext<{ sheet: boolean } | null>(null);
/** Whether a Menu sits in a MenuBar. */
const MenuBarContext = createContext(false);
/** Whether a radio item sits in a MenuRadioGroup. */
const RadioGroupContext = createContext(false);

const openFix =
  "Pass trigger={<Button>…</Button>} for a dropdown, contextTrigger={<div>…</div>} for a right-click or long-press area, or label inside <MenuBar>";
const controlFix = "<Menu open={open} onOpenChange={setOpen} trigger={…}>";
const itemsFix = '<Menu trigger={…} items={[{ label: "Edit", onClick: edit }]} />';

/** Throws in development, with the JSX the item belongs in, unless it sits inside a Menu. */
function useMenuPart(part: string, inner: string): { sheet: boolean } {
  const context = useContext(MenuContext);
  if (!context) {
    devThrow(
      part,
      "must be rendered inside <Menu>",
      process.env.NODE_ENV !== "production"
        ? `<Menu trigger={<Button>Actions</Button>}>${inner}</Menu>`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  return context;
}

/** The items for `items`. */
function renderEntries(entries: readonly MenuEntry[]): ReactNode {
  return entries.map((entry, index) => {
    switch (entry.type) {
      case "separator":
        return <MenuSeparator key={index} />;
      case "checkbox":
        return (
          <MenuCheckboxItem
            key={index}
            checked={entry.checked}
            defaultChecked={entry.defaultChecked}
            onCheckedChange={entry.onCheckedChange}
            shortcut={entry.shortcut}
            disabled={entry.disabled}
          >
            {entry.label}
          </MenuCheckboxItem>
        );
      case "radio":
        return (
          <MenuRadioGroup
            key={index}
            label={entry.label}
            value={entry.value}
            defaultValue={entry.defaultValue}
            onValueChange={entry.onValueChange}
          >
            {entry.options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value} shortcut={option.shortcut} disabled={option.disabled}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        );
      case "group":
        return (
          <MenuGroup key={index} label={entry.label}>
            {renderEntries(entry.items)}
          </MenuGroup>
        );
      case "submenu":
        return (
          <MenuSub key={index} label={entry.label} disabled={entry.disabled} backLabel={entry.backLabel}>
            {renderEntries(entry.items)}
          </MenuSub>
        );
      default:
        return (
          <MenuItem
            key={index}
            onClick={entry.onClick}
            href={entry.href}
            shortcut={entry.shortcut}
            tone={entry.tone}
            disabled={entry.disabled}
          >
            {entry.label}
          </MenuItem>
        );
    }
  });
}

/** Marks a context area as pressed while a finger is down, so the class turns off selection and the callout. */
function pressing(on: boolean) {
  return (event: TouchEvent<HTMLElement>) => event.currentTarget.toggleAttribute("data-ouro-pressing", on);
}

/** The portal, positioner and popup of a menu or submenu, beside its trigger or as a phone sheet. */
function MenuSurface({
  sheet,
  context,
  side,
  align,
  className,
  children,
  closeLabel,
}: {
  sheet: boolean;
  context: boolean;
  side?: FloatingSide | undefined;
  align?: FloatingAlign | undefined;
  className?: string | undefined;
  children: ReactNode;
  /** Set for a top-level menu: its phone sheet ends with a Close item. */
  closeLabel?: string | undefined;
}): JSX.Element {
  const Positioner = context ? ContextMenu.Positioner : BaseMenu.Positioner;
  return (
    <BaseMenu.Portal data-ouro="menu-portal" className={floatingPortalClass}>
      {sheet && <BaseMenu.Backdrop data-ouro="menu-backdrop" className={menuBackdropClass} />}
      <Positioner
        data-ouro="menu-positioner"
        className={sheet ? menuSheetPositionerClass : menuPositionerClass}
        sideOffset={context ? 0 : 4}
        collisionPadding={8}
        {...(side ? { side } : {})}
        {...(align ? { align } : {})}
      >
        <BaseMenu.Popup
          data-ouro="menu"
          data-ouro-presentation={sheet ? "sheet" : "menu"}
          className={cn(sheet ? menuSheetPopupClass : menuPopupClass, sheet ? undefined : className)}
        >
          <MenuContext.Provider value={{ sheet }}>{children}</MenuContext.Provider>
          {sheet && closeLabel !== undefined && (
            <>
              <BaseMenu.Separator className={menuSeparatorClass} />
              <BaseMenu.Item data-ouro-menu-close="" data-ouro-control="menu" data-ouro-part="close" className={menuItemClass}>
                <span data-ouro-menu-label="">{closeLabel}</span>
              </BaseMenu.Item>
            </>
          )}
        </BaseMenu.Popup>
      </Positioner>
    </BaseMenu.Portal>
  );
}

/**
 * A list of actions that opens from a button, from a right-click or long press, or from a
 * menubar, with one API for all three. Items take a shortcut (shown with `Kbd`),
 * `tone="destructive"` and `href`, and there are checkbox items, radio groups, labelled
 * groups, submenus and separators. Below 640px a dropdown is a bottom sheet; a context menu
 * opens at the pointer at every width.
 *
 * Pass `trigger` for a dropdown, `contextTrigger` for a context menu, or `label` for a menu
 * in a `MenuBar`. Give the entries as children or as `items` data. To give the trigger a
 * tooltip too, put the Tooltip inside `trigger`:
 * `trigger={<Tooltip content="More actions"><Button aria-label="More">…</Button></Tooltip>}`.
 *
 * Use `Select` instead to pick a value for a form, `Popover` for a panel with fields or
 * text, and `Command` for a searchable list of every action in the app.
 *
 * It stacks above the page at `--ouro-layer`, a z-index of 50 by default (from
 * ouro-base.css), like Dialog and Sheet.
 *
 * @group Menus
 * @see https://ourostack.github.io/ouro-ui/docs/menu
 *
 * @example
 * <Menu trigger={<Button variant="outline">Actions</Button>}>
 *   <MenuItem onClick={edit} shortcut={["mod", "e"]}>Edit</MenuItem>
 *   <MenuItem href="/recipes/1/print">Print</MenuItem>
 *   <MenuSeparator />
 *   <MenuItem tone="destructive" onClick={remove}>Delete</MenuItem>
 * </Menu>
 * <Menu contextTrigger={<RecipeCard recipe={recipe} />} items={[{ label: "Copy link", onClick: copy }]} />
 * @claim "Below 640px a dropdown is a" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu presentation > is a bottom sheet below 640px, with a backdrop, and its submenu is a sheet with a Back item)
 * @claim "a context menu opens at the pointer at every width" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu context trigger > stays a menu at the pointer on a phone, not a sheet)
 * @claim "It stacks above the page at" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu stacking > puts the portal on the --ouro-layer level, as its own stacking context)
 * @claim "It stacks above the page at" registry/ouro/theme/ouro-base.css verify:fileLine(registry/ouro/theme/ouro-base.css, /^\s+--ouro-layer:\s50;/)
 * @claim "A list of actions that opens" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu dropdown > opens a menu below its trigger, aligned to its start, named by the trigger)
 * @claim "A list of actions that opens" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu context trigger > opens at the pointer on right-click)
 * @claim "A list of actions that opens" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::MenuBar > is a menubar of menus that the arrow keys move between)
 */
export function Menu(props: MenuProps): JSX.Element {
  const {
    trigger,
    contextTrigger,
    label,
    items,
    children,
    side: sideProp,
    align: alignProp,
    className,
    closeLabel = "Close",
    open,
    onOpenChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isOpen,
    onClose,
    placement,
    asChild,
    options,
  } = props as MenuBaseProps &
    MenuPlacementProps & { trigger?: ReactElement; contextTrigger?: ReactElement; label?: string };
  const inBar = useContext(MenuBarContext);
  const fix = (code: string) => (process.env.NODE_ENV !== "production" ? code : /* istanbul ignore next @preserve -- production only */ "");

  const modes = [trigger, contextTrigger, label].filter((mode) => mode !== undefined).length;
  if (modes === 0) devThrow("Menu", "needs trigger, contextTrigger or label", fix(openFix));
  if (modes > 1) devThrow("Menu", "takes one of trigger, contextTrigger and label", fix(openFix));
  if (inBar && label === undefined) {
    devThrow("Menu", "a Menu inside <MenuBar> takes label, not trigger or contextTrigger", fix('<MenuBar><Menu label="File">…</Menu></MenuBar>'));
  }
  if (!inBar && label !== undefined) {
    devThrow(
      "Menu",
      "label is for a Menu inside <MenuBar>",
      fix(`<MenuBar><Menu label="${label}">…</Menu></MenuBar>, or trigger={<Button>${label}</Button>} for a dropdown`),
    );
  }
  if (items === undefined && children === undefined) devThrow("Menu", "needs items or children", fix(itemsFix));
  if (items !== undefined && children !== undefined) {
    devThrow("Menu", "takes items or children, not both", fix("move the children into items, or the items into <MenuItem> children"));
  }
  if (open !== undefined && typeof onOpenChange !== "function") devThrow("Menu", "open needs onOpenChange", fix(controlFix));

  const context = contextTrigger !== undefined;
  // A side or alignment that is not one of Ouro UI's (a type error) warns and renders the default.
  const side = floatingSide(sideProp, "bottom");
  const align = floatingAligns.includes(alignProp as FloatingAlign) ? (alignProp as FloatingAlign) : "start";

  useAppearanceClassNameCheck(
    "Menu",
    className,
    process.env.NODE_ENV !== "production" ? floatingHint("<Menu trigger={…}>", "</Menu>") : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Menu",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...(context
            ? [
                sideProp !== undefined && (["side is not used by a context menu, which opens at the pointer", "remove side"] as const),
                alignProp !== undefined && (["align is not used by a context menu, which opens at the pointer", "remove align"] as const),
              ]
            : floatingPlacementWarnings("<Menu", sideProp, "bottom", alignProp, placement)),
          isOpen !== undefined && ["isOpen is not a prop", controlFix],
          onClose !== undefined && ["onClose is not a prop", controlFix],
          asChild !== undefined && ["asChild is not a prop; the trigger element is the button", "trigger={<Button>Actions</Button>}"],
          options !== undefined && ["options is not a prop; the entries are items", itemsFix],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // A dropdown (and a menubar's menu) is a bottom sheet on a phone; a context menu opens at
  // the pointer, where the finger is, at every width.
  const sheet = useSheetPresentation(context ? "menu" : "auto");
  const body = items !== undefined ? renderEntries(items) : children;
  const control = open !== undefined ? { open, onOpenChange: (next: boolean) => onOpenChange!(next) } : onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {};

  if (context) {
    return (
      <ContextMenu.Root {...control}>
        <ContextMenu.Trigger
          render={contextTrigger}
          className={menuContextTriggerClass}
          // Base UI turns the callout off for good; Ouro UI turns it off only while pressing.
          style={{ WebkitTouchCallout: undefined }}
          onTouchStart={pressing(true)}
          onTouchEnd={pressing(false)}
          onTouchCancel={pressing(false)}
        />
        <MenuSurface sheet={false} context className={className}>
          {body}
        </MenuSurface>
      </ContextMenu.Root>
    );
  }

  return (
    <BaseMenu.Root {...control}>
      {label !== undefined ? (
        <BaseMenu.Trigger data-ouro-control="menu" data-ouro-part="bar-trigger" className={menuBarTriggerClass}>
          {label}
        </BaseMenu.Trigger>
      ) : (
        <BaseMenu.Trigger render={trigger} />
      )}
      <MenuSurface sheet={sheet} context={false} side={side} align={align} className={className} closeLabel={closeLabel}>
        {body}
      </MenuSurface>
    </BaseMenu.Root>
  );
}

/** Props for {@link MenuBar}. */
export interface MenuBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "children"> {
  /**
   * The menus, each `<Menu label="File">…</Menu>`.
   *
   * @claim "The menus, each `<Menu label=" registry/ouro/components/ouro/menu/menu.test-d.ts verify:fileLine(registry/ouro/components/ouro/menu/menu.test-d.ts, /\{\strigger:\sReactElement;\slabel:\s"File";\schildren:\s"Items"\s\}>\(\)\.not\.toExtend<MenuProps>/)
   * @claim "The menus, each `<Menu label=" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu dev messages > throws the exact fix for label outside a MenuBar, and for a trigger inside one)
   */
  children: ReactNode;
  /** Layout only: margins and width. Appearance classes warn in development. */
  className?: string | undefined;
}

/**
 * A row of menus, as at the top of a desktop app: File, Edit, View. The arrow keys move
 * between the menus, and once one is open, hovering another switches to it instantly.
 * Each child is a `Menu` with a `label`. Below 640px each menu opens as a bottom sheet.
 *
 * Use `Menu` with `trigger` instead for a single menu button, and `Tabs` or navigation
 * links to move between pages.
 *
 * @group Menus
 *
 * @example
 * <MenuBar aria-label="Recipe editor">
 *   <Menu label="File">
 *     <MenuItem onClick={save} shortcut={["mod", "s"]}>Save</MenuItem>
 *   </Menu>
 *   <Menu label="Edit">
 *     <MenuItem onClick={undo} shortcut={["mod", "z"]}>Undo</MenuItem>
 *   </Menu>
 * </MenuBar>
 * @claim "The arrow keys move between the menus" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::MenuBar > is a menubar of menus that the arrow keys move between)
 * @claim "hovering another switches to it instantly" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::MenuBar > switches instantly to the next menu on hover once one is open)
 * @claim "Below 640px each menu opens as a bottom sheet" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::MenuBar > opens each menu as a bottom sheet below 640px)
 * @claim "Each child is a `Menu` with" registry/ouro/components/ouro/menu/menu.test.tsx verify:testExists(registry/ouro/components/ouro/menu/menu.test.tsx::Menu dev messages > throws the exact fix for label outside a MenuBar, and for a trigger inside one)
 */
export function MenuBar({ children, className, ...rest }: MenuBarProps): JSX.Element {
  useAppearanceClassNameCheck(
    "MenuBar",
    className,
    process.env.NODE_ENV !== "production" ? "wrap the MenuBar in an element with that class" : /* istanbul ignore next @preserve -- production only */ "",
  );
  return (
    <Menubar {...rest} data-ouro="menu-bar" className={cn(menuBarClass, className)}>
      <MenuBarContext.Provider value>{children}</MenuBarContext.Provider>
    </Menubar>
  );
}

/** Props for {@link MenuItem}. */
export interface MenuItemProps {
  /** The item's text, or text with an icon. */
  children: ReactNode;
  /** Runs when the item is chosen, by click, tap or Enter. The menu then closes. */
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  /**
   * Makes the item a link: an internal path goes through `OuroProvider`'s router link, an
   * absolute URL is a plain `<a>`. The menu closes when it is followed.
   */
  href?: string | undefined;
  /**
   * Marks a link item as the page being shown (`aria-current="page"`, a medium-weight label
   * with a bar at the start edge, which the highlight does not have), for a menu of pages. It does nothing on an item without `href`.
   */
  current?: boolean | undefined;
  /**
   * The item's keyboard shortcut, as `Kbd` shows it: `["mod", "e"]` is ⌘E on Apple platforms
   * and Ctrl+E elsewhere. It only shows the keys; bind them in your app.
   */
  shortcut?: MenuShortcut | undefined;
  /** `"destructive"` for an action that deletes or cannot be undone. */
  tone?: "destructive" | (string & { 'Only "destructive": danger is "destructive"': never }) | undefined;
  /** Shown, but cannot be chosen. */
  disabled?: boolean | undefined;

  /** Not a prop. The handler is `onClick`: `<MenuItem onClick={edit}>`. (A `Command` item is the one that takes `onSelect`.) */
  onSelect?: { "Use <MenuItem onClick={edit}>": never };
  /** Not a prop. A menu item takes `tone`: `<MenuItem tone="destructive">`. */
  variant?: { 'Use <MenuItem tone="destructive">': never };
  /** Not a prop. For a link, pass `href`: `<MenuItem href="/recipes/1">`. */
  asChild?: { 'Use <MenuItem href="/recipes/1">': never };
  /** Not a prop. A checkable item is a `MenuCheckboxItem`: `<MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>`. */
  checked?: { "Use <MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>": never };
}

/** The shortcut's keys, and the dev message when they came as a string. */
function shortcutKeys(shortcut: MenuShortcut | undefined): readonly string[] | undefined {
  return typeof shortcut === "string" ? shortcut.split("+") : shortcut;
}

function shortcutWarning(component: string, shortcut: unknown): readonly [string, string] | false {
  return (
    typeof shortcut === "string" && [`shortcut="${shortcut}" is a string; shortcut takes an array`, `<${component} shortcut={["mod", "k"]}>`]
  );
}

/** The `aria-keyshortcuts` attribute for an item's shortcut, which its `Kbd` (hidden from the accessible name) shows. */
function keyShortcutProps(shortcut: MenuShortcut | undefined): { "aria-keyshortcuts"?: string } {
  const keys = shortcutKeys(shortcut);
  return keys ? { "aria-keyshortcuts": ariaKeyShortcuts(keys) } : {};
}

/** The item's text, then its shortcut at the end. */
function ItemBody({ children, shortcut }: { children: ReactNode; shortcut: MenuShortcut | undefined }): JSX.Element {
  const keys = shortcutKeys(shortcut);
  return (
    <>
      <span data-ouro-menu-label="" className="flex min-w-0 flex-1 items-center gap-2">
        {children}
      </span>
      {keys && <Kbd keys={keys} aria-hidden="true" className="ms-auto" />}
    </>
  );
}

/**
 * One action in a `Menu`: `onClick` runs it, `href` makes it a link, `shortcut` shows its
 * keys and `tone="destructive"` marks an action that cannot be undone.
 *
 * Use `MenuCheckboxItem` instead for an on/off setting, and `MenuRadioItem` for one choice
 * of several.
 *
 * @group Menus
 *
 * @example
 * <MenuItem onClick={edit} shortcut={["mod", "e"]}>Edit</MenuItem>
 * <MenuItem href="/recipes/1/print">Print</MenuItem>
 * <MenuItem tone="destructive" onClick={remove}>Delete</MenuItem>
 */
export function MenuItem(props: MenuItemProps): JSX.Element {
  const { children, onClick, href, current, shortcut, tone: toneProp, disabled, onSelect, variant, asChild, checked } = props;
  useMenuPart("MenuItem", "<MenuItem>Edit</MenuItem>");
  const tone = toneProp === "destructive" ? "destructive" : undefined;
  useDevWarnings(
    "MenuItem",
    process.env.NODE_ENV !== "production"
      ? () => [
          onSelect !== undefined && ["onSelect is not a prop", "<MenuItem onClick={edit}>"],
          variant !== undefined && ["variant is not a prop; a menu item takes tone", '<MenuItem tone="destructive">'],
          asChild !== undefined && ["asChild is not a prop", '<MenuItem href="/recipes/1"> for a link'],
          checked !== undefined && [
            "checked is not a prop; a checkable item is a MenuCheckboxItem",
            "<MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>",
          ],
          toneProp !== undefined && tone === undefined && toneWarning("MenuItem", String(toneProp), ["destructive"]),
          shortcutWarning("MenuItem", shortcut),
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const shared = { className: menuItemClass, "data-ouro-control": "menu", "data-ouro-part": "item", "data-tone": tone, ...keyShortcutProps(shortcut), ...(onClick ? { onClick: (event: MouseEvent<HTMLElement>) => onClick(event) } : {}) };
  const body = <ItemBody shortcut={shortcut}>{children}</ItemBody>;
  // A disabled link is a disabled item: nothing to follow.
  if (href !== undefined && !disabled) {
    return (
      <BaseMenu.LinkItem {...shared} aria-current={current ? "page" : undefined} closeOnClick render={<RouterLink href={href} />}>
        {body}
      </BaseMenu.LinkItem>
    );
  }
  return (
    <BaseMenu.Item {...shared} disabled={disabled}>
      {body}
    </BaseMenu.Item>
  );
}

/** A check mark, for checkbox and radio items. */
function CheckIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Props for {@link MenuCheckboxItem}. */
export interface MenuCheckboxItemProps {
  /** The setting's text. */
  children: ReactNode;
  /** Whether it is on, to control it; pass `onCheckedChange` with it. */
  checked?: boolean | undefined;
  /** Whether it starts on, uncontrolled. */
  defaultChecked?: boolean | undefined;
  /** Called with the new state when it is toggled. */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /** The keys of its shortcut, shown at its end: `["mod", "b"]`. */
  shortcut?: MenuShortcut | undefined;
  /** Shown, but cannot be toggled. */
  disabled?: boolean | undefined;
}

/**
 * An on/off setting in a `Menu`, with a check mark when it is on. Toggling it keeps the menu
 * open, so several settings can change in one go.
 *
 * Use `MenuRadioItem` instead for one choice of several, and `Switch` for a setting on the page.
 *
 * @group Menus
 *
 * @example
 * <MenuCheckboxItem checked={showNotes} onCheckedChange={setShowNotes}>Show notes</MenuCheckboxItem>
 */
export function MenuCheckboxItem({ children, shortcut, onCheckedChange, ...rest }: MenuCheckboxItemProps): JSX.Element {
  useMenuPart("MenuCheckboxItem", "<MenuCheckboxItem>Pin</MenuCheckboxItem>");
  useDevWarnings(
    "MenuCheckboxItem",
    process.env.NODE_ENV !== "production" ? () => [shortcutWarning("MenuCheckboxItem", shortcut)] : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <BaseMenu.CheckboxItem data-ouro-control="menu" data-ouro-part="checkbox-item" {...rest} {...keyShortcutProps(shortcut)} {...(onCheckedChange ? { onCheckedChange: (next: boolean) => onCheckedChange(next) } : {})} className={menuItemClass}>
      <span data-ouro-menu-indicator="" className={menuIndicatorClass}>
        <BaseMenu.CheckboxItemIndicator className="flex">
          <CheckIcon />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <ItemBody shortcut={shortcut}>{children}</ItemBody>
    </BaseMenu.CheckboxItem>
  );
}

/** Props for {@link MenuRadioGroup}. */
export interface MenuRadioGroupProps {
  /** The `MenuRadioItem`s. */
  children: ReactNode;
  /** Names the group, shown above it: "Sort by". */
  label?: string | undefined;
  /** The chosen value, to control it; pass `onValueChange` with it. */
  value?: string | undefined;
  /** The value chosen at first, uncontrolled. */
  defaultValue?: string | undefined;
  /** Called with the value of the item chosen. */
  onValueChange?: ((value: string) => void) | undefined;
}

/**
 * One choice of several in a `Menu`, such as a sort order: its `MenuRadioItem`s show a mark
 * on the chosen one, and choosing keeps the menu open.
 *
 * Use `MenuCheckboxItem` instead for settings that are each on or off, and `RadioGroup` for a
 * choice on the page.
 *
 * @group Menus
 *
 * @example
 * <MenuRadioGroup label="Sort by" value={sort} onValueChange={setSort}>
 *   <MenuRadioItem value="name">Name</MenuRadioItem>
 *   <MenuRadioItem value="date">Date added</MenuRadioItem>
 * </MenuRadioGroup>
 */
export function MenuRadioGroup({ children, label, onValueChange, ...rest }: MenuRadioGroupProps): JSX.Element {
  useMenuPart("MenuRadioGroup", '<MenuRadioGroup><MenuRadioItem value="a">A</MenuRadioItem></MenuRadioGroup>');
  return (
    <BaseMenu.RadioGroup {...rest} {...(onValueChange ? { onValueChange: (next: string) => onValueChange(next) } : {})}>
      {label !== undefined && <BaseMenu.GroupLabel className={menuGroupLabelClass}>{label}</BaseMenu.GroupLabel>}
      <RadioGroupContext.Provider value>{children}</RadioGroupContext.Provider>
    </BaseMenu.RadioGroup>
  );
}

/** Props for {@link MenuRadioItem}. */
export interface MenuRadioItemProps {
  /** The choice's text. */
  children: ReactNode;
  /** The value the group reports when this item is chosen. */
  value: string;
  /** The keys of its shortcut, shown at its end. */
  shortcut?: MenuShortcut | undefined;
  /** Shown, but cannot be chosen. */
  disabled?: boolean | undefined;
}

/**
 * One choice in a `MenuRadioGroup`, marked when it is the group's value.
 *
 * Use `MenuItem` instead for an action.
 *
 * @group Menus
 *
 * @example
 * <MenuRadioItem value="name">Name</MenuRadioItem>
 */
export function MenuRadioItem({ children, shortcut, ...rest }: MenuRadioItemProps): JSX.Element {
  if (!useContext(RadioGroupContext)) {
    devThrow(
      "MenuRadioItem",
      "must be rendered inside <MenuRadioGroup>",
      process.env.NODE_ENV !== "production"
        ? '<MenuRadioGroup value={sort} onValueChange={setSort}><MenuRadioItem value="name">Name</MenuRadioItem></MenuRadioGroup>'
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useDevWarnings(
    "MenuRadioItem",
    process.env.NODE_ENV !== "production" ? () => [shortcutWarning("MenuRadioItem", shortcut)] : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <BaseMenu.RadioItem data-ouro-control="menu" data-ouro-part="radio-item" {...rest} {...keyShortcutProps(shortcut)} className={menuItemClass}>
      <span data-ouro-menu-indicator="" className={menuIndicatorClass}>
        <BaseMenu.RadioItemIndicator className="flex">
          <CheckIcon />
        </BaseMenu.RadioItemIndicator>
      </span>
      <ItemBody shortcut={shortcut}>{children}</ItemBody>
    </BaseMenu.RadioItem>
  );
}

/** Props for {@link MenuGroup}. */
export interface MenuGroupProps {
  /**
   * Names the group, shown above its items. It is always required.
   *
   * @claim "It is always required" registry/ouro/components/ouro/menu/menu.test-d.ts verify:fileLine(registry/ouro/components/ouro/menu/menu.test-d.ts, /\{\stype:\s"radio";\slabel:\s"Sort"\s\}>\(\)\.not\.toExtend<MenuEntry>/)
   */
  label: string;
  /** The group's items. */
  children: ReactNode;
}

/**
 * Items under a label in a `Menu`, such as "Recipe" and "Account" sections.
 *
 * Use `MenuSeparator` instead to divide items without a label, and `MenuRadioGroup` for
 * one choice of several.
 *
 * @group Menus
 *
 * @example
 * <MenuGroup label="Recipe">
 *   <MenuItem onClick={edit}>Edit</MenuItem>
 *   <MenuItem onClick={duplicate}>Duplicate</MenuItem>
 * </MenuGroup>
 */
export function MenuGroup({ label, children }: MenuGroupProps): JSX.Element {
  useMenuPart("MenuGroup", '<MenuGroup label="Recipe">…</MenuGroup>');
  useDevWarnings(
    "MenuGroup",
    process.env.NODE_ENV !== "production"
      ? () => [!label && ["label is required; it names the group for screen readers", '<MenuGroup label="Recipe">']]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className={menuGroupLabelClass}>{label}</BaseMenu.GroupLabel>
      {children}
    </BaseMenu.Group>
  );
}

/** A chevron pointing to the inline end, for a submenu's item; and back, for its Back item. */
function ChevronIcon({ back }: { back?: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={back ? "rotate-180 rtl:rotate-0" : "ms-auto rtl:rotate-180"}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Props for {@link MenuSub}. */
export interface MenuSubProps {
  /** The text of the item that opens the submenu. */
  label: string;
  /** The submenu's items. */
  children: ReactNode;
  /** The item cannot open the submenu. */
  disabled?: boolean | undefined;
  /**
   * The label of the item at the top of the submenu on a phone, where the submenu is a sheet
   * over its menu, that goes back to it. @default "Back"
   */
  backLabel?: string | undefined;
}

/**
 * A nested menu in a `Menu`: an item that opens more items beside it, on hover, click or
 * the arrow key. On a phone it is a sheet over its menu, with a Back item at its top.
 *
 * Use `MenuGroup` instead when the items fit in the menu under a label: nested menus are
 * harder to reach.
 *
 * @group Menus
 *
 * @example
 * <MenuSub label="Share">
 *   <MenuItem onClick={copyLink}>Copy link</MenuItem>
 *   <MenuItem href={mailto}>Email</MenuItem>
 * </MenuSub>
 */
export function MenuSub({ label, children, disabled, backLabel = "Back" }: MenuSubProps): JSX.Element {
  const { sheet } = useMenuPart("MenuSub", '<MenuSub label="Share">…</MenuSub>');
  // Owned here, so the Back item can close only this submenu.
  const [open, setOpen] = useState(false);
  return (
    <BaseMenu.SubmenuRoot open={open} onOpenChange={setOpen} disabled={disabled}>
      <BaseMenu.SubmenuTrigger data-ouro-control="menu" data-ouro-part="submenu-trigger" className={menuItemClass} disabled={disabled} openOnHover={!sheet}>
        <span data-ouro-menu-label="" className="flex min-w-0 flex-1 items-center gap-2">
          {label}
        </span>
        <ChevronIcon />
      </BaseMenu.SubmenuTrigger>
      <MenuSurface sheet={sheet} context={false}>
        {sheet && (
          <BaseMenu.Item data-ouro-menu-back="" data-ouro-control="menu" data-ouro-part="back" className={menuItemClass} closeOnClick={false} onClick={() => setOpen(false)}>
            <ChevronIcon back />
            <span data-ouro-menu-label="">{backLabel}</span>
          </BaseMenu.Item>
        )}
        {children}
      </MenuSurface>
    </BaseMenu.SubmenuRoot>
  );
}

/**
 * A line between items in a `Menu`, to set apart a group of actions such as the
 * destructive ones at the end.
 *
 * Use `MenuGroup` instead when the items need a label.
 *
 * @group Menus
 *
 * @example
 * <MenuItem onClick={edit}>Edit</MenuItem>
 * <MenuSeparator />
 * <MenuItem tone="destructive" onClick={remove}>Delete</MenuItem>
 */
export function MenuSeparator(): JSX.Element {
  useMenuPart("MenuSeparator", "<MenuSeparator />");
  return <BaseMenu.Separator className={menuSeparatorClass} />;
}
