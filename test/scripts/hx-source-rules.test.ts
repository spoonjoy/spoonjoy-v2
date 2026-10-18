import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_PATH,
  CATEGORIES,
  compareWithBaseline,
  countFingerprints,
  defaultCliErrorHandler,
  defaultDeps,
  defaultExit,
  findOffenders,
  findOffendersInSource,
  formatComparison,
  isCliEntry,
  isControlStateClass,
  isScannedFile,
  isThirdPartyControlModule,
  listSourceFiles,
  main,
  runCliIfEntry,
  serializeBaseline,
  THIRD_PARTY_CONTROL_PACKAGES,
} from "../../scripts/hx-source-rules.mjs";
import { expectConsoleError } from "../warning-policy";

type Offender = { category: string; fingerprint: string; file: string; line: number };

const scan = (source: string, file = "app/routes/fixture.tsx"): Offender[] => findOffendersInSource(file, source);
const categories = (source: string, file?: string) => scan(source, file).map((offender) => offender.category);
const fingerprints = (source: string, file?: string) => scan(source, file).map((offender) => offender.fingerprint);

describe("findOffendersInSource: each category", () => {
  it("lists the twelve categories", () => {
    expect(CATEGORIES).toEqual([
      "raw-button",
      "raw-anchor",
      "raw-input",
      "raw-select",
      "raw-textarea",
      "details-summary",
      "contenteditable",
      "positive-tabindex",
      "interactive-role",
      "plain-element-handler",
      "data-ouro-attr",
      "control-state-style",
      "third-party-control",
    ]);
  });

  it("finds a raw <button>, with its stable props in the fingerprint", () => {
    expect(scan(`export function Save() { return <button type="button" aria-label="Save">Save</button>; }`)).toEqual([
      {
        category: "raw-button",
        fingerprint: "app/routes/fixture.tsx::Save::raw-button::button::type=button,aria-label=Save",
        file: "app/routes/fixture.tsx",
        line: 1,
      },
    ]);
  });

  it("finds a raw <a>", () => {
    expect(fingerprints(`function Nav() { return <a href="/recipes">Recipes</a>; }`)).toEqual([
      "app/routes/fixture.tsx::Nav::raw-anchor::a::",
    ]);
  });

  it("finds React Router's Link and NavLink, by their imported names", () => {
    const source = `
      import { Link as RouterLink, NavLink, useNavigate } from "react-router";
      import type { LinkProps } from "react-router";
      import { Link as DomLink } from "react-router-dom";
      import * as Router from "react-router";
      export function Nav() {
        return <>
          <RouterLink to="/a">A</RouterLink>
          <NavLink to="/b" />
          <DomLink to="/c" />
          <Router.Link to="/d" />
          <Router.Form method="post" />
          <Other.Link to="/e" />
        </>;
      }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Nav::raw-anchor::react-router.Link::",
      "app/routes/fixture.tsx::Nav::raw-anchor::react-router.NavLink::",
      "app/routes/fixture.tsx::Nav::raw-anchor::react-router.Link::",
      "app/routes/fixture.tsx::Nav::raw-anchor::react-router.Link::",
    ]);
  });

  it("finds visible inputs, selects and textareas", () => {
    const source = `function Fields({ kind }) {
      return <form>
        <input name="q" />
        <input type="text" name="title" />
        <input type={kind} />
        <select name="unit" />
        <textarea name="notes"></textarea>
      </form>;
    }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Fields::raw-input::input::name=q",
      "app/routes/fixture.tsx::Fields::raw-input::input::type=text,name=title",
      "app/routes/fixture.tsx::Fields::raw-input::input::type={kind}",
      "app/routes/fixture.tsx::Fields::raw-select::select::name=unit",
      "app/routes/fixture.tsx::Fields::raw-textarea::textarea::name=notes",
    ]);
  });

  it("finds <details> and <summary>", () => {
    expect(fingerprints(`function More() { return <details><summary>More</summary></details>; }`)).toEqual([
      "app/routes/fixture.tsx::More::details-summary::details::",
      "app/routes/fixture.tsx::More::details-summary::summary::",
    ]);
  });

  it("finds contentEditable unless it is literally false", () => {
    const source = `function Edit({ on }) {
      return <>
        <div contentEditable />
        <div contentEditable="true" />
        <div contentEditable={true} />
        <p contenteditable="plaintext-only" />
        <div contentEditable={on} />
        <div contentEditable="false" />
        <div contentEditable={false} />
      </>;
    }`;
    expect(categories(source)).toEqual(Array(5).fill("contenteditable"));
  });

  it("finds a positive tabIndex, including one branch of a conditional", () => {
    const source = `function Order({ on, n }) {
      return <>
        <div tabIndex={1} />
        <div tabIndex="2" />
        <span tabindex="3" />
        <div tabIndex={on ? 4 : -1} />
        <div tabIndex={0} />
        <div tabIndex={-1} />
        <div tabIndex="-1" />
        <div tabIndex={on ? 0 : -1} />
        <div tabIndex={n} />
      </>;
    }`;
    expect(categories(source)).toEqual(Array(4).fill("positive-tabindex"));
  });

  it("finds interactive roles, static or chosen at runtime, on any element", () => {
    const source = `function Roles({ open }) {
      return <>
        <div role="button" />
        <li role="option tab" />
        <Card role={open ? "dialog" : "switch"} />
        <section role="region" />
        <div role={open ? "dialog" : "note"} />
      </>;
    }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Roles::interactive-role::div::role=button",
      "app/routes/fixture.tsx::Roles::interactive-role::li::role=option tab",
      'app/routes/fixture.tsx::Roles::interactive-role::Card::role={open ? "dialog" : "switch"}',
    ]);
  });

  it("finds click, key, pointer and touch handlers on plain elements only", () => {
    const source = `function Handlers({ go }) {
      return <>
        <div onClick={go} />
        <li onKeyDown={go} onClick={go} />
        <span onPointerDown={go} />
        <article onTouchStartCapture={go} />
        <figure onMouseDown={go} />
        <div onMouseEnter={go} onFocus={go} onChange={go} />
        <form onSubmit={go} />
        <button type="button" onClick={go} />
        <Button onClick={go} />
      </>;
    }`;
    expect(categories(source)).toEqual([
      "plain-element-handler",
      "plain-element-handler",
      "plain-element-handler",
      "plain-element-handler",
      "plain-element-handler",
      "raw-button",
    ]);
  });

  it("finds any data-ouro* attribute app code writes: in JSX, in props objects and through setAttribute", () => {
    const source = `function Marks({ el }) {
      el.setAttribute("data-ouro-control", "checkbox");
      el.toggleAttribute("data-ouro");
      el.setAttribute("data-theme", "dark");
      el.setAttribute(name, "x");
      el.querySelector("[data-ouro-control] button");
      const props = { "data-ouro-part": "row", "data-other": 1, plain: 2, [key]: 3 };
      return <>
        <div data-ouro-control="checkbox" />
        <Button data-ouro="button" />
        <div data-testid="row" />
      </>;
    }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Marks::data-ouro-attr::setAttribute::",
      "app/routes/fixture.tsx::Marks::data-ouro-attr::setAttribute::",
      "app/routes/fixture.tsx::Marks::data-ouro-attr::object::",
      "app/routes/fixture.tsx::Marks::data-ouro-attr::div[data-ouro-control]::",
      "app/routes/fixture.tsx::Marks::data-ouro-attr::Button[data-ouro]::",
    ]);
  });

  describe("control-state-style in className", () => {
    it("finds focus, press, aria and data state utilities in a className literal", () => {
      const source = `function Styles() {
        return <>
          <div className="rounded focus-visible:outline-2" />
          <div className="active:scale-95" />
          <div className="aria-pressed:bg-black" />
          <div className="data-[state=open]:rotate-180" />
          <div className="group-data-[checked]/row:line-through" />
          <div className="md:dark:focus:ring-2" />
        </>;
      }`;
      expect(categories(source)).toEqual(Array(6).fill("control-state-style"));
    });

    it("follows class strings through constants, calls, objects, helpers and templates", () => {
      const source = `
        const ring = "focus-visible:ring-2";
        const tones = { on: "aria-checked:bg-accent", off: "bg-paper" };
        function stateClass(open) { return open ? "data-open:rotate-90" : ""; }
        const recursive = recursive;
        export function Styles({ open, tone }) {
          return <>
            <div className={ring} />
            <div className={cn("p-2", tones[tone])} />
            <div className={stateClass(open)} />
            <div className={\`grid \${open ? "has-[:checked]:bg-white" : ""}\`} />
            <div className={\`grid focus:outline-none \${tone}\`} />
            <div className={recursive} />
            <Row rowClassName="peer-aria-expanded:block" />
          </>;
        }`;
      expect(categories(source)).toEqual(Array(6).fill("control-state-style"));
    });

    it("leaves hover-only decoration, theme and layout alone", () => {
      const source = `
        import { Photo } from "~/components/recipe/photo";
        export function Tile() {
          return <div className="group">
            <img className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none" />
            <Photo className="pointer-fine:hover:opacity-90 dark:bg-black data-[theme=dark]:text-white aria-[sort=ascending]:font-bold" />
            <p className="text-sm">Note: focus: stays plain prose</p>
          </div>;
        }`;
      expect(scan(source)).toEqual([]);
    });
  });
});

describe("third-party-control", () => {
  it("keeps the library list in one constant", () => {
    expect(THIRD_PARTY_CONTROL_PACKAGES).toEqual([
      "@headlessui/react",
      "@radix-ui/*",
      "@base-ui-components/*",
      "@base-ui/*",
      "react-aria-components",
      "react-aria",
      "@ariakit/*",
      "@mui/*",
      "@chakra-ui/*",
      "vaul",
      "cmdk",
      "sonner",
    ]);
  });

  it.each([
    "@headlessui/react",
    "@radix-ui/react-dialog",
    "@base-ui-components/react",
    "@base-ui/react/button",
    "react-aria-components",
    "react-aria",
    "react-aria/i18n",
    "@ariakit/react",
    "@mui/material/Button",
    "@chakra-ui/react",
    "vaul",
    "cmdk",
    "sonner",
  ])("treats %s as a UI-control library", (specifier) => {
    expect(isThirdPartyControlModule(specifier)).toBe(true);
  });

  it.each([
    "@headlessui/vue",
    "@radix-ui",
    "@muix/grid",
    "react-aria-extras",
    "sonnerish",
    "react-router",
    "lucide-react",
    "~/components/ouro/button/button",
  ])("does not treat %s as a UI-control library", (specifier) => {
    expect(isThirdPartyControlModule(specifier)).toBe(false);
  });

  it("finds a named import, tagged with its package and imported name", () => {
    const source = `
      import { Dialog, DialogPanel } from "@headlessui/react";
      export function Sheet() { return <Dialog><DialogPanel aria-label="Sheet" /></Dialog>; }`;
    expect(scan(source)).toEqual([
      {
        category: "third-party-control",
        fingerprint: "app/routes/fixture.tsx::Sheet::third-party-control::@headlessui/react.Dialog::",
        file: "app/routes/fixture.tsx",
        line: 3,
      },
      {
        category: "third-party-control",
        fingerprint: "app/routes/fixture.tsx::Sheet::third-party-control::@headlessui/react.DialogPanel::aria-label=Sheet",
        file: "app/routes/fixture.tsx",
        line: 3,
      },
    ]);
  });

  it("finds a namespace import, by its members", () => {
    const source = `
      import * as Headless from "@headlessui/react";
      import * as Dialog from "@radix-ui/react-dialog";
      export function Menu() {
        return <>
          <Headless.Button type="button" />
          <Headless.Menu.Items />
          <Dialog.Root />
          <Headless />
        </>;
      }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Menu::third-party-control::@headlessui/react.Button::type=button",
      "app/routes/fixture.tsx::Menu::third-party-control::@headlessui/react.Menu.Items::",
      "app/routes/fixture.tsx::Menu::third-party-control::@radix-ui/react-dialog.Root::",
    ]);
  });

  it("finds aliased imports: renamed, default, and same-file aliases", () => {
    const source = `
      import { Drawer as Sheet } from "vaul";
      import Toaster from "sonner";
      import { Menu } from "@base-ui/react/menu";
      import * as Aria from "react-aria-components";
      const Trigger = Menu.Trigger;
      const Again = Trigger;
      const Field = Aria . TextField;
      const Loop = Cycle;
      const Cycle = Loop;
      const Plain = Other.Thing;
      export function Panel() {
        return <>
          <Sheet.Content />
          <Toaster />
          <Again />
          <Field name="title" />
          <Loop />
          <Plain />
        </>;
      }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Panel::third-party-control::vaul.Drawer.Content::",
      "app/routes/fixture.tsx::Panel::third-party-control::sonner.default::",
      "app/routes/fixture.tsx::Panel::third-party-control::@base-ui/react/menu.Menu.Trigger::",
      "app/routes/fixture.tsx::Panel::third-party-control::react-aria-components.TextField::name=title",
    ]);
  });

  it("does not count type-only imports, hooks or HX components", () => {
    const source = `
      import type { Button } from "@headlessui/react";
      import type * as Radix from "@radix-ui/react-dialog";
      import { type Menu, useClose } from "@headlessui/react";
      import "@radix-ui/themes/styles.css";
      import { Button as HxButton } from "~/components/ouro/button/button";
      import { Checkbox } from "~/components/ouro/checkbox/checkbox";
      export function Actions() {
        const close = useClose();
        return <>
          <Button />
          <Menu />
          <Radix.Root />
          <HxButton type="button" onClick={close}>Save</HxButton>
          <Checkbox name="done" />
        </>;
      }`;
    expect(scan(source)).toEqual([]);
  });

  it("counts a third-party control alongside its other offences", () => {
    const source = `
      import * as Headless from "@headlessui/react";
      export function Theme() { return <Headless.MenuItems className="focus:outline-none" />; }`;
    expect(categories(source)).toEqual(["third-party-control", "control-state-style"]);
  });
});

describe("isControlStateClass", () => {
  it.each([
    "focus:ring-2",
    "focus-within:ring-2",
    "focus-visible:outline",
    "active:opacity-70",
    "checked:bg-black",
    "indeterminate:bg-black",
    "open:rotate-90",
    "aria-checked:bg-black",
    "aria-selected:bg-black",
    "aria-current:font-bold",
    "aria-[expanded=true]:rotate-180",
    "data-checked:line-through",
    "data-[highlighted]:bg-black",
    "data-[current=true]:underline",
    "data-[starting-style]:opacity-0",
    "data-[swipe-direction=left]:translate-x-2",
    "group-focus-visible:ring",
    "peer-checked:block",
    "not-focus:opacity-50",
    "in-data-[state=open]:block",
    "[&:active]:scale-95",
    "[&[aria-pressed=true]]:bg-black",
    "has-[[open]]:shadow",
  ])("treats %s as control state", (token) => {
    expect(isControlStateClass(token)).toBe(true);
  });

  it.each([
    "hover:bg-black",
    "group-hover:scale-105",
    "motion-safe:animate-spin",
    "dark:bg-black",
    "md:grid",
    "pointer-fine:hover:underline",
    "data-[theme=dark]:bg-black",
    "data-sj-action:bg-black",
    "aria-[sort=ascending]:font-bold",
    "aria-hidden:hidden",
    "[&>img]:rounded",
    "focus:",
    "focus-visible",
    "",
  ])("leaves %s alone", (token) => {
    expect(isControlStateClass(token)).toBe(false);
  });
});

describe("findOffendersInSource: stylesheets", () => {
  const css = (source: string) => findOffendersInSource("app/styles/tailwind.css", source);

  it("finds focus, press and selection rules on .sj-* classes and [data-sj-*] hooks", () => {
    const source = `
      .sj-skip-link:focus,
      .sj-skip-link:focus-visible { outline: 2px solid; }
      .sj-desktop-nav-link[data-current="true"] { color: red; }
      [data-sj-action="primary"]:active:not([data-disabled]) { scale: 0.97; }
      @media (hover: hover) {
        .sj-row[aria-expanded="true"] .sj-chevron { rotate: 90deg; }
      }`;
    expect(css(source)).toEqual([
      {
        category: "control-state-style",
        fingerprint: "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-skip-link:focus::",
        file: "app/styles/tailwind.css",
        line: 2,
      },
      {
        category: "control-state-style",
        fingerprint: "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-skip-link:focus-visible::",
        file: "app/styles/tailwind.css",
        line: 2,
      },
      {
        category: "control-state-style",
        fingerprint: 'app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-desktop-nav-link[data-current="true"]::',
        file: "app/styles/tailwind.css",
        line: 4,
      },
      {
        category: "control-state-style",
        fingerprint:
          'app/styles/tailwind.css::(stylesheet)::control-state-style::[data-sj-action="primary"]:active:not([data-disabled])::',
        file: "app/styles/tailwind.css",
        line: 5,
      },
      {
        category: "control-state-style",
        fingerprint:
          'app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-row[aria-expanded="true"] .sj-chevron::@media (hover: hover)',
        file: "app/styles/tailwind.css",
        line: 7,
      },
    ]);
  });

  it("composes nested rules with their parents and reads @apply utilities", () => {
    const source = `
      .sj-tab {
        color: red;
        &:focus-visible { outline: 2px solid; }
        &:hover { color: blue; }
      }
      .sj-chip { @apply rounded focus-visible:ring-2; }
      .sj-plain { @apply rounded hover:underline; }
      @layer components { .sj-toggle { @apply data-[state=on]:bg-black; } }
      @apply focus:ring-2;
      .other { @apply focus:ring-2; }`;
    expect(css(source).map((offender) => offender.fingerprint)).toEqual([
      "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-tab &:focus-visible::",
      "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-chip::@apply",
      "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-toggle::@layer components @apply",
    ]);
  });

  it("leaves hover-only photo motion, unhooked state and keyframes alone", () => {
    const source = `
      .sj-photo-tile img { transition: transform 300ms var(--ouro-ease-out); }
      .sj-photo-tile:hover img { transform: scale(1.04); }
      .font-sj-ui:focus { color: red; }
      :where(html[data-theme-switching] :is(input, button)) { transition: none; }
      button:focus-visible { outline: none; }
      @keyframes sj-checklist-strike-draw { from { scale: 0 1; } to { scale: 1 1; } }`;
    expect(css(source)).toEqual([]);
  });
});

describe("findOffendersInSource: exemptions", () => {
  it("exempts a hidden input, however the type is quoted", () => {
    const source = `function Hidden() {
      return <form>
        <input type="hidden" name="intent" value="save" />
        <input type={"hidden"} name="id" className="focus:ring" />
      </form>;
    }`;
    expect(scan(source)).toEqual([]);
  });

  it("exempts HX component calls", () => {
    const source = `
      import { Button } from "~/components/ouro/button/button";
      import { Link } from "~/components/ouro/link/link";
      import { Checkbox } from "~/components/ouro/checkbox/checkbox";
      export function Actions({ save }) {
        return <>
          <Button type="button" onClick={save}>Save</Button>
          <Link href="/recipes">Recipes</Link>
          <Checkbox name="done" />
        </>;
      }`;
    expect(scan(source)).toEqual([]);
  });

  it("exempts the anchor HX Link renders through OuroProvider's linkComponent", () => {
    const source = `
      import type { ComponentProps } from "react";
      import { Link } from "react-router";
      import type { OuroLinkComponent } from "~/lib/ouro/use-ouro";
      export function OuroRouterLink({ href, ...props }: ComponentProps<OuroLinkComponent>) {
        return <Link to={href} {...props} />;
      }
      export const PlainLink: OuroLinkComponent = (props) => <a {...props} />;
      export const WrappedLink: OuroLinkComponent = forwardRef(function Anchor(props, ref) {
        return <a ref={ref} {...props} />;
      });
      export function NotAnAdapter({ href }: { href: string }) {
        return <a href={href} />;
      }`;
    expect(fingerprints(source)).toEqual(["app/routes/fixture.tsx::NotAnAdapter::raw-anchor::a::"]);
  });

  it("exempts a hover-only photo transform", () => {
    expect(
      scan(`function Photo() { return <img className="transition-transform group-hover:scale-105" alt="" />; }`),
    ).toEqual([]);
  });
});

describe("fingerprints", () => {
  it("name the enclosing component, through wrappers and anonymous callbacks", () => {
    const source = `
      export default function RecipePage({ items }) {
        return <ul>{items.map((item) => <li key={item.id}><button type="button">x</button></li>)}</ul>;
      }
      export const Row = forwardRef(function RowInner(props, ref) { return <button type="submit" />; });
      export const Cell = memo((props) => <button name="cell" />);
      const Arrow = () => <button name="arrow" />;
      const Wrapped = (memo((() => <button name="wrapped" />)) as Component);
      class Legacy { render() { return <button name="legacy" />; } }
      const actions = { Open: () => <button name="open" /> };
      function renderHelper() { return <button name="helper" />; }
      function outer() { function inner() { return <button name="inner" />; } }
      export default () => <button name="default" />;
      const top = <button name="top" />;
    `;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::RecipePage::raw-button::button::type=button",
      "app/routes/fixture.tsx::RowInner::raw-button::button::type=submit",
      "app/routes/fixture.tsx::Cell::raw-button::button::name=cell",
      "app/routes/fixture.tsx::Arrow::raw-button::button::name=arrow",
      "app/routes/fixture.tsx::Wrapped::raw-button::button::name=wrapped",
      "app/routes/fixture.tsx::Legacy::raw-button::button::name=legacy",
      "app/routes/fixture.tsx::Open::raw-button::button::name=open",
      "app/routes/fixture.tsx::renderHelper::raw-button::button::name=helper",
      "app/routes/fixture.tsx::inner::raw-button::button::name=inner",
      "app/routes/fixture.tsx::(module)::raw-button::button::name=default",
      "app/routes/fixture.tsx::(module)::raw-button::button::name=top",
    ]);
  });

  it("record only the stable props, in a fixed order, literal or as written", () => {
    const source = `function Props({ label }) {
      return <>
        <button role="switch" aria-label={label} name={"go"} type="button" disabled id="x" />
        <button aria-label={\`Remove \${label}\`} />
        <button type={  label  ?  "submit"  :  "button"  } />
        <button aria-label />
        <button aria-label={1} />
        <button aria-label={} />
      </>;
    }`;
    expect(scan(source).filter((offender) => offender.category === "raw-button").map((o) => o.fingerprint)).toEqual([
      "app/routes/fixture.tsx::Props::raw-button::button::type=button,name=go,aria-label={label},role=switch",
      "app/routes/fixture.tsx::Props::raw-button::button::aria-label={`Remove ${label}`}",
      'app/routes/fixture.tsx::Props::raw-button::button::type={ label ? "submit" : "button" }',
      "app/routes/fixture.tsx::Props::raw-button::button::aria-label=true",
      "app/routes/fixture.tsx::Props::raw-button::button::aria-label=1",
      "app/routes/fixture.tsx::Props::raw-button::button::aria-label={}",
    ]);
  });

  it("do not change when lines move, and report the new line", () => {
    const before = `function Save() {\n  return <button type="button">Save</button>;\n}`;
    const after = `\n\n// a comment\n\nfunction Save() {\n\n  return (\n    <button type="button">Save</button>\n  );\n}`;
    expect(fingerprints(after)).toEqual(fingerprints(before));
    expect(scan(before)[0].line).toBe(2);
    expect(scan(after)[0].line).toBe(8);
  });

  it("change when the file is renamed", () => {
    const source = `function Save() { return <button type="button">Save</button>; }`;
    expect(fingerprints(source, "app/routes/a.tsx")).not.toEqual(fingerprints(source, "app/routes/b.tsx"));
  });

  it("parse plain .ts files without JSX", () => {
    expect(scan(`export function mark(el) { el.setAttribute("data-ouro", "x"); const n = <number>1; }`, "app/lib/x.ts")).toEqual([
      {
        category: "data-ouro-attr",
        fingerprint: "app/lib/x.ts::mark::data-ouro-attr::setAttribute::",
        file: "app/lib/x.ts",
        line: 1,
      },
    ]);
  });
});

describe("file selection", () => {
  it.each([
    ["app/routes/recipes.$id.tsx", true],
    ["app/lib/quantity.ts", true],
    ["app/root.tsx", true],
    ["app/styles/tailwind.css", true],
    ["app/styles/nested/other.css", false],
    ["app/components/ouro/button/button.tsx", false],
    ["app/lib/ouro/cn.ts", false],
    ["app/lib/generated/api-v1-playground.ts", false],
    ["app/__tests__/root.test.tsx", false],
    ["app/lib/quantity.test.ts", false],
    ["app/components/recipe/thing.spec.tsx", false],
    ["app/components/recipe/thing.stories.tsx", false],
    ["app/vite-env.d.ts", false],
    ["app/routes/readme.md", false],
    ["workers/app.ts", false],
  ])("isScannedFile(%s) is %s", (file, expected) => {
    expect(isScannedFile(file)).toBe(expected);
  });

  it("lists scanned files under app/, sorted, with forward slashes", () => {
    const readdir = vi.fn(() => [
      "routes/b.tsx",
      ["routes", "a.tsx"].join(path.sep),
      "components/ouro/button/button.tsx",
      "styles/tailwind.css",
      "routes",
    ]);
    expect(listSourceFiles("/repo", readdir)).toEqual(["app/routes/a.tsx", "app/routes/b.tsx", "app/styles/tailwind.css"]);
    expect(readdir).toHaveBeenCalledWith(path.join("/repo", "app"));
  });

  it("reads each file relative to the root, accepting absolute paths", () => {
    const readFile = vi.fn((file: string) =>
      file.endsWith(".css") ? ".sj-x:focus { color: red; }" : `function A() { return <button />; }`,
    );
    const offenders = findOffenders(["/repo/app/routes/b.tsx", "app/styles/tailwind.css", "app/routes/a.tsx"], {
      root: "/repo",
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith(path.join("/repo", "app/routes/b.tsx"));
    expect(offenders.map((offender: Offender) => offender.fingerprint)).toEqual([
      "app/routes/a.tsx::A::raw-button::button::",
      "app/routes/b.tsx::A::raw-button::button::",
      "app/styles/tailwind.css::(stylesheet)::control-state-style::.sj-x:focus::",
    ]);
  });

  it("sorts offenders in one file by line, then fingerprint", () => {
    const readFile = () => `function A() { return <><button name="b" /><button name="a" /></>; }\nconst B = () => <a />;`;
    expect(findOffenders(["app/x.tsx"], { readFile }).map((o: Offender) => `${o.line} ${o.fingerprint}`)).toEqual([
      "1 app/x.tsx::A::raw-button::button::name=a",
      "1 app/x.tsx::A::raw-button::button::name=b",
      "2 app/x.tsx::B::raw-anchor::a::",
    ]);
  });
});

describe("the baseline", () => {
  const offender = (fingerprint: string, line = 1): Offender => ({
    category: "raw-button",
    fingerprint,
    file: "app/x.tsx",
    line,
  });

  it("counts fingerprints, sorted", () => {
    expect(countFingerprints([offender("b"), offender("a"), offender("b", 9)])).toEqual({ a: 1, b: 2 });
    expect(Object.keys(countFingerprints([offender("b"), offender("a")]))).toEqual(["a", "b"]);
  });

  it("serializes sorted offenders with a trailing newline", () => {
    expect(serializeBaseline([offender("b"), offender("a"), offender("b")])).toBe(
      `${JSON.stringify({ offenders: { a: 1, b: 2 } }, null, 2)}\n`,
    );
  });

  it("matches when the scan equals the baseline", () => {
    const comparison = compareWithBaseline([offender("a"), offender("a")], { a: 2 });
    expect(comparison).toEqual({ added: [], removed: [] });
    expect(formatComparison(comparison)).toEqual([]);
  });

  it("fails a new offender, and one more of a known fingerprint", () => {
    const comparison = compareWithBaseline([offender("a", 3), offender("a", 7), offender("new", 5)], { a: 1 });
    expect(comparison.added).toEqual([
      { fingerprint: "a", count: 1, at: ["app/x.tsx:3", "app/x.tsx:7"] },
      { fingerprint: "new", count: 1, at: ["app/x.tsx:5"] },
    ]);
    expect(formatComparison(comparison)).toEqual([
      "New hand-rolled control: a (+1) at app/x.tsx:3, app/x.tsx:7. Use an Ouro HX component instead (grow HX if it lacks one).",
      "New hand-rolled control: new (+1) at app/x.tsx:5. Use an Ouro HX component instead (grow HX if it lacks one).",
    ]);
  });

  it("fails a missing offender and says to remove it from the baseline", () => {
    const comparison = compareWithBaseline([offender("a")], { a: 3, gone: 1 });
    expect(comparison.removed).toEqual([
      { fingerprint: "a", count: 2 },
      { fingerprint: "gone", count: 1 },
    ]);
    expect(formatComparison(comparison)).toEqual([
      "Fixed: a (-2); remove it from the baseline: pnpm hx:source-rules --write-baseline",
      "Fixed: gone (-1); remove it from the baseline: pnpm hx:source-rules --write-baseline",
    ]);
  });

  it("holds the repository to test/scripts/hx-source-rules.baseline.json exactly", () => {
    const offenders = findOffenders(listSourceFiles(process.cwd()));
    const text = readFileSync(BASELINE_PATH, "utf8");
    const baseline = JSON.parse(text) as { offenders: Record<string, number> };
    expect(formatComparison(compareWithBaseline(offenders, baseline.offenders))).toEqual([]);
    expect(text).toBe(serializeBaseline(offenders));
  });
});

describe("main", () => {
  const files: Record<string, string> = {
    "/repo/app/routes/a.tsx": `export function A() { return <button type="button" />; }`,
  };
  const baselineFile = path.join("/repo", BASELINE_PATH);
  const setup = (baseline?: string, extra: Record<string, string> = {}) => {
    const store: Record<string, string> = { ...files, ...extra };
    if (baseline !== undefined) store[baselineFile] = baseline;
    const readFile = vi.fn((file: string) => {
      if (!(file in store)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return store[file];
    });
    const readdir = vi.fn(() => Object.keys(store).filter((f) => f.startsWith("/repo/app/")).map((f) => f.slice("/repo/app/".length)));
    const writeFile = vi.fn();
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    return { deps: { root: "/repo", readFile, readdir, writeFile, io, exit }, writeFile, io, exit };
  };
  const matching = `${JSON.stringify({ offenders: { "app/routes/a.tsx::A::raw-button::button::type=button": 1 } }, null, 2)}\n`;

  it("passes when the scan equals the baseline", () => {
    const { deps, io, exit, writeFile } = setup(matching);
    main([], deps);
    expect(io.log).toHaveBeenCalledWith("hx-source-rules: 1 file(s), 1 hand-rolled control(s), all in the baseline.");
    expect(io.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("fails a new offender", () => {
    const { deps, io, exit } = setup(matching, { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` });
    main([], deps);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("New hand-rolled control: app/routes/b.tsx::B::raw-anchor::a::"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("fails a fixed offender until it is removed from the baseline", () => {
    const { deps, io, exit } = setup(matching, { "/repo/app/routes/a.tsx": `export const A = 1;` });
    main([], deps);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("remove it from the baseline"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("treats a missing baseline as empty", () => {
    const { deps, io, exit } = setup();
    main([], deps);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("New hand-rolled control"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rethrows a baseline read failure other than a missing file", () => {
    const { deps } = setup(matching);
    const readFile = vi.fn((file: string) => {
      if (file === baselineFile) throw new Error("EACCES");
      return files[file];
    });
    expect(() => main([], { ...deps, readFile })).toThrow("EACCES");
  });

  it("writes a smaller baseline", () => {
    const { deps, io, exit, writeFile } = setup(matching, { "/repo/app/routes/a.tsx": `export const A = 1;` });
    main(["--write-baseline"], deps);
    expect(writeFile).toHaveBeenCalledWith(baselineFile, `${JSON.stringify({ offenders: {} }, null, 2)}\n`);
    expect(io.log).toHaveBeenCalledWith(`hx-source-rules: wrote ${BASELINE_PATH} with 0 hand-rolled control(s).`);
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses to write a baseline that adds an offender", () => {
    const { deps, io, exit, writeFile } = setup(matching, { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` });
    main(["--write-baseline"], deps);
    expect(writeFile).not.toHaveBeenCalled();
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("New hand-rolled control"));
    expect(io.error).toHaveBeenCalledWith(
      "hx-source-rules: the baseline only shrinks. Replace the new controls with Ouro HX components, or pass --allow-regression <reason> for review.",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("writes a larger baseline only with a stated reason", () => {
    const { deps, io, exit, writeFile } = setup(undefined);
    main(["--write-baseline", "--allow-regression", "first baseline"], deps);
    expect(writeFile).toHaveBeenCalledWith(baselineFile, matching);
    expect(io.log).toHaveBeenCalledWith(
      `hx-source-rules: wrote ${BASELINE_PATH} with 1 hand-rolled control(s); regression allowed: first baseline.`,
    );
    expect(exit).not.toHaveBeenCalled();
  });

  it("rejects --allow-regression without a reason, and unknown arguments", () => {
    for (const argv of [["--write-baseline", "--allow-regression"], ["--write-baseline", "--allow-regression", "--x"], ["--nope"]]) {
      const { deps, io, exit, writeFile } = setup(matching);
      main(argv, deps);
      expect(io.error).toHaveBeenCalledWith(
        "Usage: hx-source-rules.mjs [--write-baseline [--allow-regression <reason>]]",
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(writeFile).not.toHaveBeenCalled();
    }
  });
});

describe("defaults", () => {
  it("reads, lists and writes real files", () => {
    expect(defaultDeps.readFile("package.json")).toContain('"name"');
    expect(defaultDeps.readdir("app/styles").map(String)).toContain("tailwind.css");
    const cache = path.join(process.cwd(), "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    const directory = mkdtempSync(path.join(cache, "hx-source-rules-"));
    try {
      defaultDeps.writeFile(path.join(directory, "baseline.json"), "{}\n");
      expect(readFileSync(path.join(directory, "baseline.json"), "utf8")).toBe("{}\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("checks the real repository with the default dependencies", () => {
    const io = { log: vi.fn(), error: vi.fn() };
    main([], { io });
    expect(io.error).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledWith(expect.stringMatching(/^hx-source-rules: \d+ file\(s\), \d+ hand-rolled control\(s\), all in the baseline\.$/));
  });

  it("defaultExit sets the process exit code", () => {
    defaultExit(1);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("CLI entry guard", () => {
  it("isCliEntry is true only when argv1 resolves to this module", () => {
    expect(isCliEntry("file:///a/b.mjs", "/a/b.mjs")).toBe(true);
    expect(isCliEntry("file:///a/b.mjs", "/a/other.mjs")).toBe(false);
    expect(isCliEntry("file:///a/b.mjs", undefined)).toBe(false);
  });

  it("runCliIfEntry does nothing when this module is not the entry point", () => {
    const runMain = vi.fn();
    expect(runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/other.mjs", runMain })).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
  });

  it("runCliIfEntry runs main with the process arguments when this module is the entry point", () => {
    const runMain = vi.fn();
    expect(runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/b.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledWith(process.argv.slice(2));
  });

  it("runCliIfEntry routes a throw to onError", () => {
    const failure = new Error("boom");
    const onError = vi.fn();
    runCliIfEntry({
      moduleUrl: "file:///a/b.mjs",
      argv1: "/a/b.mjs",
      runMain: () => {
        throw failure;
      },
      onError,
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("defaultCliErrorHandler logs an Error's message and sets exitCode 1", () => {
    const io = { error: vi.fn() };
    defaultCliErrorHandler(new Error("boom"), io);
    expect(io.error).toHaveBeenCalledWith("boom");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("defaultCliErrorHandler stringifies a non-Error throw", () => {
    const io = { error: vi.fn() };
    defaultCliErrorHandler("boom", io);
    expect(io.error).toHaveBeenCalledWith("boom");
    process.exitCode = 0;
  });

  it("defaultCliErrorHandler defaults to console", () => {
    expectConsoleError("boom-default");
    defaultCliErrorHandler(new Error("boom-default"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
