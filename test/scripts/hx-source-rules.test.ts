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
  findRegressions,
  formatComparison,
  isCliEntry,
  isControlStateClass,
  isScannedFile,
  isThirdPartyControlModule,
  listSourceFiles,
  loadPaths,
  main,
  runCliIfEntry,
  serializeBaseline,
  THIRD_PARTY_CONTROL_PACKAGES,
} from "../../scripts/hx-source-rules.mjs";
import { expectConsoleError } from "../warning-policy";

type Offender = { category: string; fingerprint: string; file: string; line: number };

const scan = (source: string, file = "app/routes/fixture.tsx"): Offender[] => findOffendersInSource(file, source);
const PATHS = { "~/*": ["./app/*"], "#dialog": ["./app/components/dialog"] };
const scanFiles = (files: Record<string, string>) =>
  findOffenders(Object.keys(files), { root: "/repo", readFile: (file: string) => files[path.relative("/repo", file)], paths: PATHS });
const categories = (source: string, file?: string) => scan(source, file).map((offender) => offender.category);
const fingerprints = (source: string, file?: string) => scan(source, file).map((offender) => offender.fingerprint);

describe("findOffendersInSource: each category", () => {
  it("lists the categories", () => {
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
      "uses-hand-rolled-control",
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
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Theme::third-party-control::@headlessui/react.MenuItems::",
      "app/routes/fixture.tsx::Theme::control-state-style::@headlessui/react.MenuItems::",
    ]);
  });
});

describe("motion elements", () => {
  it("treats motion's element components as the intrinsic element they render", () => {
    const source = `
      import { m, motion as M, Reorder, AnimatePresence } from "motion/react";
      import type { motion as TypeOnly } from "motion/react";
      import * as mm from "motion/react-m";
      import * as Whole from "motion/react";
      import { motion } from "framer-motion";
      import { m as icon } from "lucide-react";
      const MotionButton = motion.create("button");
      const Old = M("a");
      const NotMotion = other.create("button");
      const Created = m.create(Thing);
      const Named = M.create.call(null, "button");
      export function Moving({ go }) {
        return <>
          <m.button type="button" />
          <M.a href="/" />
          <motion.div onClick={go} />
          <mm.li whileTap={{ scale: 0.9 }} />
          <m.div drag="x" />
          <m.span onPanStart={go} />
          <m.div whileFocus={{}} onTapStart={go} />
          <m.div whileHover={{ scale: 1.02 }} layout />
          <div whileTap={{}} />
          <icon.div onClick={go} />
          <Whole.div onClick={go} />
          <AnimatePresence />
          <AnimatePresence.Child onClick={go} />
          <m.Custom onClick={go} />
          <Reorder.Group values={[]} onReorder={go} />
          <Reorder.Item value={1} />
          <Reorder.Item as="div" value={2} />
          <Reorder.Other />
          <MotionButton whileTap={{}} />
          <Old />
          <NotMotion />
          <Created />
          <Named />
        </>;
      }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Moving::raw-button::button::type=button",
      "app/routes/fixture.tsx::Moving::raw-anchor::a::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::div::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::li::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::div::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::span::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::div::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::li::",
      "app/routes/fixture.tsx::Moving::plain-element-handler::div::",
      "app/routes/fixture.tsx::Moving::raw-button::button::",
      "app/routes/fixture.tsx::Moving::raw-anchor::a::",
    ]);
  });
});

describe("string tags", () => {
  it("resolves string-typed dynamic tags, as props and createElement calls", () => {
    const source = `
      import React, { createElement } from "react";
      const Tag = "button";
      const Heading = "h2";
      export function Dynamic({ href, as: As = "a", go, x }) {
        const Wrapper = href ? "a" : "div";
        const select = document.createElement("select");
        return <>
          <Tag type="submit" />
          <Wrapper onClick={go} />
          <As />
          <Heading tabIndex={2} />
          {createElement("button", { type: "button", onClick: go })}
          {React.createElement("div", { onKeyDown: go, role: "button", [x]: 1, ...x })}
          {createElement(Tag, null)}
          {createElement("input", { type: "hidden", name: "id" })}
          {createElement("span", { "data-ouro": "x" })}
          {createElement(Component, {})}
          {createElement()}
          {createElement(\`b\${x}\`)}
          <Card as="button" onClick={go} />
          <Card as={href ? "a" : undefined} />
          <Card as={("select")} />
          <Card as={"textarea" as const} />
          <Card as={"details" satisfies string} />
          <Card as={(x ?? "summary")!} />
          <Card as={x || "button"} />
          <Card as={x && "button"} />
          <Card as={} />
          <Card as="section" />
        </>;
      }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Dynamic::raw-select::select::",
      "app/routes/fixture.tsx::Dynamic::raw-button::button::type=submit",
      "app/routes/fixture.tsx::Dynamic::raw-anchor::a::",
      "app/routes/fixture.tsx::Dynamic::plain-element-handler::div::",
      "app/routes/fixture.tsx::Dynamic::raw-anchor::a::",
      "app/routes/fixture.tsx::Dynamic::positive-tabindex::h2::",
      "app/routes/fixture.tsx::Dynamic::raw-button::button::type=button",
      "app/routes/fixture.tsx::Dynamic::plain-element-handler::div::role=button",
      "app/routes/fixture.tsx::Dynamic::interactive-role::div::role=button",
      "app/routes/fixture.tsx::Dynamic::raw-button::button::",
      "app/routes/fixture.tsx::Dynamic::data-ouro-attr::span[data-ouro]::",
      "app/routes/fixture.tsx::Dynamic::raw-button::button::",
      "app/routes/fixture.tsx::Dynamic::raw-anchor::a::",
      "app/routes/fixture.tsx::Dynamic::raw-select::select::",
      "app/routes/fixture.tsx::Dynamic::raw-textarea::textarea::",
      "app/routes/fixture.tsx::Dynamic::details-summary::details::",
      "app/routes/fixture.tsx::Dynamic::details-summary::summary::",
      "app/routes/fixture.tsx::Dynamic::raw-button::button::",
    ]);
  });

  it("records createElement props the way JSX props are recorded", () => {
    const source = `function Made({ label, disabled }) {
      return createElement("button", { "aria-label": label, disabled, name: "go" });
    }`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::Made::raw-button::button::name=go,aria-label={label}",
    ]);
  });
});

describe("call sites", () => {
  const files = {
    "app/components/navigation/app-link.tsx": `export function Link({ href }) { return <a href={href} />; }`,
    "app/components/navigation/index.ts": [
      `export { Link as AppLink } from "./app-link";`,
      `export * from "./safe";`,
      `export * from "@radix-ui/react-dialog";`,
      `export * as everything from "./safe";`,
      `export * as Dialog from "@radix-ui/react-dialog";`,
      `export * as Raws from "./app-link";`,
      `export type { Hidden } from "./safe";`,
      `export { type Hidden2, Safe as SafeAgain } from "./safe";`,
    ].join("\n"),
    "app/components/navigation/safe.tsx": `export function Safe() { return <p />; }`,
    "app/components/dialog.tsx": [
      `export { Root as DialogRoot } from "@radix-ui/react-dialog";`,
      `import * as Tabs from "@radix-ui/react-tabs";`,
      `export const TabList = Tabs.List;`,
      `import { Popover } from "@headlessui/react";`,
      `import { Link as Imported } from "./navigation/app-link";`,
      `import * as Ns from "./navigation/app-link";`,
      `export { Popover, Imported, Ns, Tabs };`,
      `export default function Fancy() { return <Inner />; }`,
      `function Inner() { return <button />; }`,
      `export const Plain = () => <p />, Count = 1, { destructured } = {};`,
      `export class Legacy { render() { return <select />; } }`,
      `function Field() { return <input name="q" />; }`,
      `export { Field as SearchField };`,
    ].join("\n"),
    "app/components/def.tsx": `function Thing() { return <textarea />; }\nexport default Thing;`,
    "app/components/anon.tsx": `export default () => <button />;`,
    "app/components/anon-fn.tsx": `export default function () { return <details />; }`,
    "app/components/cycle-a.ts": `export * from "./cycle-b";`,
    "app/components/cycle-b.ts": `export * from "./cycle-a";`,
    "app/routes/page.tsx": [
      `import { Link } from "~/components/navigation/app-link";`,
      `import { AppLink, Safe, Trigger, SafeAgain, Dialog, Raws, everything } from "~/components/navigation";`,
      `import * as Nav from "../components/navigation/app-link";`,
      `import Fancy, { DialogRoot, TabList, Popover, Plain, Legacy, SearchField, Imported, Ns, Tabs } from "#dialog";`,
      `import Thing from "~/components/def";`,
      `import Anon from "~/components/anon";`,
      `import AnonFn from "~/components/anon-fn";`,
      `import { Nothing } from "~/components/cycle-a";`,
      `import { Button } from "~/components/ouro/button/button";`,
      `import { Missing } from "./missing";`,
      `import { Form } from "react-router";`,
      `const Alias = Link;`,
      `export function Page() {`,
      `  return <>`,
      `    <Link href="/a" />`,
      `    <Link href="/b" />`,
      `    <AppLink href="/c" />`,
      `    <Nav.Link href="/d" />`,
      `    <Alias href="/e" />`,
      `    <Link className="focus:ring" href="/f" />`,
      `    <Safe /><SafeAgain /><Plain /><Nav /><Link.Sub /><Nothing /><Missing />`,
      `    <Trigger />`,
      `    <Fancy />`,
      `    <DialogRoot />`,
      `    <TabList />`,
      `    <Popover />`,
      `    <Legacy />`,
      `    <SearchField />`,
      `    <Imported />`,
      `    <Ns.Link />`,
      `    <Thing />`,
      `    <Anon />`,
      `    <AnonFn />`,
      `    <Button className="focus:ring" />`,
      `    <Form className="focus:ring" />`,
      `    <Missing className="focus:ring" />`,
      `    <Dialog.Root />`,
      `    <Raws.Link />`,
      `    <Tabs.Trigger />`,
      `    <Dialog /><everything.Safe /><everything.Nope />`,
      `  </>;`,
      `}`,
    ].join("\n"),
  };

  it("counts each use of an app component that hand-rolls a control, and re-exported third-party controls", () => {
    const page = scanFiles(files).filter((offender: Offender) => offender.file === "app/routes/page.tsx");
    expect(page.map((offender: Offender) => `${offender.line} ${offender.fingerprint}`)).toEqual([
      "15 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "16 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "17 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "18 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "19 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "20 app/routes/page.tsx::Page::control-state-style::app/components/navigation/app-link#Link::",
      "20 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "22 app/routes/page.tsx::Page::third-party-control::@radix-ui/react-dialog.Trigger::",
      "23 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/dialog#Fancy::",
      "24 app/routes/page.tsx::Page::third-party-control::@radix-ui/react-dialog.Root::",
      "25 app/routes/page.tsx::Page::third-party-control::@radix-ui/react-tabs.List::",
      "26 app/routes/page.tsx::Page::third-party-control::@headlessui/react.Popover::",
      "27 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/dialog#Legacy::",
      "28 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/dialog#Field::",
      "29 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "30 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "31 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/def#Thing::",
      "32 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/anon#default::",
      "33 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/anon-fn#default::",
      "34 app/routes/page.tsx::Page::control-state-style::app/components/ouro/button/button#Button::",
      "35 app/routes/page.tsx::Page::control-state-style::react-router.Form::",
      "36 app/routes/page.tsx::Page::control-state-style::app/routes/missing#Missing::",
      "37 app/routes/page.tsx::Page::third-party-control::@radix-ui/react-dialog.Root::",
      "38 app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/navigation/app-link#Link::",
      "39 app/routes/page.tsx::Page::third-party-control::@radix-ui/react-tabs.Trigger::",
    ]);
  });

  it("does not count uses inside the defining module, or across files a second time", () => {
    const dialog = scanFiles(files).filter((offender: Offender) => offender.file === "app/components/dialog.tsx");
    expect(dialog.map((offender: Offender) => offender.category)).toEqual(["raw-button", "raw-select", "raw-input"]);
  });

  it("scans one file without resolving its imports", () => {
    const source = `import { Link } from "~/components/navigation/app-link";\nexport const A = () => <Link className="focus:ring" />;`;
    expect(fingerprints(source)).toEqual([
      "app/routes/fixture.tsx::A::control-state-style::~/components/navigation/app-link.Link::",
    ]);
  });

  it("loads tsconfig paths, tolerating a missing or path-less tsconfig", () => {
    const read = (text: string) => () => text;
    expect(loadPaths("/repo", read(`{ "compilerOptions": { "paths": { "~/*": ["./app/*"] } } }`))).toEqual({ "~/*": ["./app/*"] });
    expect(loadPaths("/repo", read(`{ // comment\n "compilerOptions": {} }`))).toEqual({});
    expect(loadPaths("/repo", read(`{}`))).toEqual({});
    expect(loadPaths("/repo", read(`not json`))).toEqual({});
    const missing = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(loadPaths("/repo", missing)).toEqual({});
    const broken = () => {
      throw new Error("EACCES");
    };
    expect(() => loadPaths("/repo", broken)).toThrow("EACCES");
    expect(loadPaths(process.cwd())).toMatchObject({ "~/*": ["./app/*"] });
  });
});

describe("findRegressions: moves are neutral", () => {
  const at = (fingerprint: string, line = 1): Offender => ({
    category: fingerprint.split("::")[2],
    fingerprint,
    file: fingerprint.split("::")[0],
    line,
  });

  it("pairs a moved file", () => {
    const result = findRegressions([at("app/components/cook/View.tsx::Panel::raw-button::button::type=button")], {
      "app/routes/recipes.$id.tsx::Panel::raw-button::button::type=button": 1,
    });
    expect(result).toEqual({
      regressions: [],
      moves: [
        {
          from: "app/routes/recipes.$id.tsx::Panel::raw-button::button::type=button",
          to: "app/components/cook/View.tsx::Panel::raw-button::button::type=button",
        },
      ],
    });
  });

  it("pairs a renamed component and changed non-literal props, but not changed literal props", () => {
    const result = findRegressions(
      [
        at("app/a.tsx::NewName::raw-button::button::type=button"),
        at("app/a.tsx::A::raw-button::button::aria-label={props.label},type={kind}"),
        at("app/a.tsx::A::raw-button::button::aria-label=Store"),
      ],
      {
        "app/a.tsx::OldName::raw-button::button::type=button": 1,
        "app/a.tsx::A::raw-button::button::aria-label={label},type={fn(a, { b })}": 1,
        "app/a.tsx::A::raw-button::button::aria-label=Save": 1,
      },
    );
    expect(result.moves).toHaveLength(2);
    expect(result.regressions).toEqual([
      { fingerprint: "app/a.tsx::A::raw-button::button::aria-label=Store", count: 1, at: ["app/a.tsx:1"] },
    ]);
  });

  it("pairs a moved definition at its call sites and a moved stylesheet", () => {
    const result = findRegressions(
      [
        at("app/r.tsx::P::uses-hand-rolled-control::app/components/new/link#Link::"),
        at("app/styles/b.css::(stylesheet)::control-state-style::.sj-x[data-current]::after::"),
      ],
      {
        "app/r.tsx::P::uses-hand-rolled-control::app/components/old/link#Link::": 1,
        "app/styles/a.css::(stylesheet)::control-state-style::.sj-x[data-current]::after::": 1,
      },
    );
    expect(result.regressions).toEqual([]);
    expect(result.moves).toHaveLength(2);
  });

  it("pairs only within the same file or the same component", () => {
    const result = findRegressions(
      [
        at("app/b.tsx::Q::raw-button::button::"),
        at("app/a.tsx::Renamed::raw-anchor::a::"),
        at("app/z.tsx::Kept::raw-input::input::"),
        at("app/r.tsx::P::uses-hand-rolled-control::app/components/b#Other::"),
      ],
      {
        "app/a.tsx::P::raw-button::button::": 1,
        "app/a.tsx::P::raw-anchor::a::": 1,
        "app/y.tsx::Kept::raw-input::input::": 1,
        "app/r.tsx::P::uses-hand-rolled-control::app/components/a#Link::": 1,
      },
    );
    expect(result.regressions.map((regression: { fingerprint: string }) => regression.fingerprint)).toEqual([
      "app/b.tsx::Q::raw-button::button::",
    ]);
    expect(result.moves).toHaveLength(3);
  });

  it("still counts a move plus an extra copy, a new tag, a new category and a plain rise", () => {
    const result = findRegressions(
      [
        at("app/b.tsx::P::raw-button::button::", 3),
        at("app/b.tsx::P::raw-button::button::", 7),
        at("app/r.tsx::P::third-party-control::@headlessui/react.Popover::"),
        at("app/a.tsx::P::raw-anchor::a::"),
        at("app/c.tsx::P::raw-input::input::"),
        at("app/c.tsx::P::raw-input::input::", 2),
      ],
      {
        "app/a.tsx::P::raw-button::button::": 1,
        "app/r.tsx::P::third-party-control::@radix-ui/react-dialog.Root::": 1,
        "app/c.tsx::P::raw-input::input::": 1,
      },
    );
    expect(result.regressions).toEqual([
      { fingerprint: "app/a.tsx::P::raw-anchor::a::", count: 1, at: ["app/a.tsx:1"] },
      { fingerprint: "app/b.tsx::P::raw-button::button::", count: 1, at: ["app/b.tsx:3", "app/b.tsx:7"] },
      { fingerprint: "app/c.tsx::P::raw-input::input::", count: 1, at: ["app/c.tsx:1", "app/c.tsx:2"] },
      { fingerprint: "app/r.tsx::P::third-party-control::@headlessui/react.Popover::", count: 1, at: ["app/r.tsx:1"] },
    ]);
    expect(result.moves).toEqual([{ from: "app/a.tsx::P::raw-button::button::", to: "app/b.tsx::P::raw-button::button::" }]);
  });
});

describe("the ratchet against real changes", () => {
  const rise = (before: Record<string, string>, after: Record<string, string>) =>
    findRegressions(scanFiles(after), countFingerprints(scanFiles(before)));

  it("a fix in one component does not pay for a new control in another (the trade)", () => {
    const before = {
      "app/components/recipe/CookSyncStatusLine.tsx": `export function CookSyncStatusLine() { return <button type="button" />; }`,
      "app/routes/shopping-list.tsx": `export default function ShoppingList() { return <p />; }`,
    };
    const after = {
      "app/components/recipe/CookSyncStatusLine.tsx": `export function CookSyncStatusLine() { return <p />; }`,
      "app/routes/shopping-list.tsx": `export default function ShoppingList() { return <button type="button" />; }`,
    };
    expect(rise(before, after)).toEqual({
      regressions: [
        {
          fingerprint: "app/routes/shopping-list.tsx::ShoppingList::raw-button::button::type=button",
          count: 1,
          at: ["app/routes/shopping-list.tsx:1"],
        },
      ],
      moves: [],
    });
  });

  it("a wrapper does not launder a control (NiceLink)", () => {
    const before = { "app/routes/page.tsx": `export function Page() { return <a href="/x">X</a>; }` };
    const after = {
      "app/components/nice.tsx": `export function NiceLink({ href }) { return <a href={href} />; }`,
      "app/routes/page.tsx": `import { NiceLink } from "~/components/nice";\nexport function Page() { return <NiceLink href="/x" />; }`,
    };
    expect(rise(before, after).regressions.map((regression: { fingerprint: string }) => regression.fingerprint)).toEqual([
      "app/components/nice.tsx::NiceLink::raw-anchor::a::",
      "app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/nice#NiceLink::",
    ]);
  });

  it("counts every hop of a wrapper chain, and terminates on a cycle", () => {
    const files = {
      "app/components/raw.tsx": `export function Raw() { return <button />; }`,
      "app/components/nice.tsx": `import { Raw } from "./raw";\nexport function Nice() { return <Raw />; }`,
      "app/components/r1.tsx": `import { Nice } from "./nice";\nexport function R1() { return <Nice />; }`,
      "app/routes/page.tsx": `import { R1 } from "~/components/r1";\nexport function Page() { return <R1 />; }`,
      "app/components/a.tsx": `import { B } from "./b";\nexport function A() { return <B />; }`,
      "app/components/b.tsx": `import { A } from "./a";\nexport function B() { return <><A /><button /></>; }`,
      "app/components/c.tsx": `import { D } from "./d";\nexport function C() { return <D />; }`,
      "app/components/d.tsx": `import { C } from "./c";\nexport function D() { return <C />; }`,
    };
    expect(scanFiles(files).map((offender: Offender) => offender.fingerprint)).toEqual([
      "app/components/a.tsx::A::uses-hand-rolled-control::app/components/b#B::",
      "app/components/b.tsx::B::raw-button::button::",
      "app/components/b.tsx::B::uses-hand-rolled-control::app/components/a#A::",
      "app/components/nice.tsx::Nice::uses-hand-rolled-control::app/components/raw#Raw::",
      "app/components/r1.tsx::R1::uses-hand-rolled-control::app/components/nice#Nice::",
      "app/components/raw.tsx::Raw::raw-button::button::",
      "app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/r1#R1::",
    ]);
  });

  const panelAt = (file: string, name: string) => ({
    [file]: `export function ${name}() { return <button type="button" />; }`,
    "app/routes/page.tsx": `import { ${name} } from "~/${file.slice(4, -4)}";\nexport function Page() { return <${name} />; }`,
  });

  it("a moved file is neutral", () => {
    expect(rise(panelAt("app/components/old/panel.tsx", "Panel"), panelAt("app/components/new/panel.tsx", "Panel"))).toEqual({
      regressions: [],
      moves: [
        {
          from: "app/components/old/panel.tsx::Panel::raw-button::button::type=button",
          to: "app/components/new/panel.tsx::Panel::raw-button::button::type=button",
        },
        {
          from: "app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/old/panel#Panel::",
          to: "app/routes/page.tsx::Page::uses-hand-rolled-control::app/components/new/panel#Panel::",
        },
      ],
    });
  });

  it("a renamed component is neutral", () => {
    const result = rise(panelAt("app/components/panel.tsx", "Panel"), panelAt("app/components/panel.tsx", "Board"));
    expect(result.regressions).toEqual([]);
    expect(result.moves).toHaveLength(2);
  });

  it("a moved and renamed component needs a reason", () => {
    const result = rise(panelAt("app/components/old/panel.tsx", "Panel"), panelAt("app/components/new/board.tsx", "Board"));
    expect(result.regressions.map((regression: { fingerprint: string }) => regression.fingerprint)).toEqual([
      "app/components/new/board.tsx::Board::raw-button::button::type=button",
    ]);
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

  it("serializes allowed regressions, sorted, ahead of the offenders", () => {
    expect(
      serializeBaseline([offender("a")], [
        { fingerprint: "b", count: 2, reason: "second" },
        { fingerprint: "a", count: 1, reason: "first" },
      ]),
    ).toBe(
      `${JSON.stringify(
        {
          allowedRegressions: [
            { fingerprint: "a", count: 1, reason: "first" },
            { fingerprint: "b", count: 2, reason: "second" },
          ],
          offenders: { a: 1 },
        },
        null,
        2,
      )}\n`,
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
    const baseline = JSON.parse(text) as {
      offenders: Record<string, number>;
      allowedRegressions?: Array<{ fingerprint: string; reason: string }>;
    };
    expect(formatComparison(compareWithBaseline(offenders, baseline.offenders))).toEqual([]);
    expect(text).toBe(serializeBaseline(offenders, baseline.allowedRegressions));
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
    const gitShow = vi.fn((_root: string, _ref: string, _file: string): string | undefined => undefined);
    return { deps: { root: "/repo", readFile, readdir, writeFile, io, exit, gitShow }, writeFile, io, exit, gitShow };
  };
  type Entry = { fingerprint: string; count?: number; reason?: string };
  const baselineOf = (offenders: Record<string, number>, allowedRegressions?: Entry[]) =>
    `${JSON.stringify(allowedRegressions ? { allowedRegressions, offenders } : { offenders }, null, 2)}\n`;
  const A = "app/routes/a.tsx::A::raw-button::button::type=button";
  const B = "app/routes/b.tsx::B::raw-anchor::a::";
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
      if (!(file in files)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return files[file];
    });
    expect(() => main([], { ...deps, readFile })).toThrow("EACCES");
  });

  it("writes a smaller baseline", () => {
    const { deps, io, exit, writeFile } = setup(matching, { "/repo/app/routes/a.tsx": `export const A = 1;` });
    main(["--write-baseline"], deps);
    expect(writeFile).toHaveBeenCalledWith(baselineFile, `${JSON.stringify({ offenders: {} }, null, 2)}\n`);
    expect(io.log).toHaveBeenCalledWith(
      `hx-source-rules: wrote ${BASELINE_PATH} with 0 hand-rolled control(s), 0 move(s) and 0 allowed regression(s).`,
    );
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
    expect(writeFile).toHaveBeenCalledWith(baselineFile, baselineOf({ [A]: 1 }, [{ fingerprint: A, count: 1, reason: "first baseline" }]));
    expect(io.log).toHaveBeenCalledWith(
      `hx-source-rules: wrote ${BASELINE_PATH} with 1 hand-rolled control(s), 0 move(s) and 1 allowed regression(s).`,
    );
    expect(exit).not.toHaveBeenCalled();
  });

  it("writes a moved file without a reason, and drops allowed regressions an earlier pull request recorded", () => {
    const moved = { "/repo/app/routes/a.tsx": `export const A = 1;`, "/repo/app/routes/c.tsx": `export function A() { return <button type="button" />; }` };
    const { deps, io, writeFile } = setup(baselineOf({ [A]: 1 }, [{ fingerprint: A, count: 1, reason: "older pull request" }]), moved);
    main(["--write-baseline"], deps);
    expect(writeFile).toHaveBeenCalledWith(baselineFile, baselineOf({ "app/routes/c.tsx::A::raw-button::button::type=button": 1 }));
    expect(io.log).toHaveBeenCalledWith(
      `hx-source-rules: wrote ${BASELINE_PATH} with 1 hand-rolled control(s), 1 move(s) and 0 allowed regression(s).`,
    );
  });

  it("writes against a base ref, keeping this pull request's earlier reasons", () => {
    const extra = { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` };
    const { deps, writeFile, gitShow, exit } = setup(
      baselineOf({ [A]: 1, [B]: 1 }, [{ fingerprint: B, count: 1, reason: "earlier in this PR" }]),
      extra,
    );
    gitShow.mockReturnValue(baselineOf({ [A]: 1 }));
    main(["--write-baseline", "--base", "origin/main"], deps);
    expect(gitShow).toHaveBeenCalledWith("/repo", "origin/main", BASELINE_PATH);
    expect(writeFile).toHaveBeenCalledWith(
      baselineFile,
      baselineOf({ [A]: 1, [B]: 1 }, [{ fingerprint: B, count: 1, reason: "earlier in this PR" }]),
    );
    expect(exit).not.toHaveBeenCalled();
  });

  it("does not reuse an earlier reason for a larger rise, or one already on the base", () => {
    const extra = {
      "/repo/app/routes/b.tsx": `const B = () => <><a href="/" /><a href="/" /></>;`,
    };
    const larger = setup(baselineOf({ [A]: 1, [B]: 2 }, [{ fingerprint: B, count: 1, reason: "earlier in this PR" }]), extra);
    larger.gitShow.mockReturnValue(baselineOf({ [A]: 1 }));
    main(["--write-baseline", "--base", "origin/main"], larger.deps);
    expect(larger.writeFile).not.toHaveBeenCalled();
    expect(larger.exit).toHaveBeenCalledWith(1);

    const entry = { fingerprint: B, count: 2, reason: "spent on main" };
    const spent = setup(baselineOf({ [A]: 1, [B]: 2 }, [entry]), extra);
    spent.gitShow.mockReturnValue(baselineOf({ [A]: 1 }, [entry]));
    main(["--write-baseline", "--base", "origin/main"], spent.deps);
    expect(spent.writeFile).not.toHaveBeenCalled();
    expect(spent.exit).toHaveBeenCalledWith(1);

    const renewed = setup(baselineOf({ [A]: 1, [B]: 2 }, [entry]), extra);
    renewed.gitShow.mockReturnValue(baselineOf({ [A]: 1 }, [entry]));
    main(["--write-baseline", "--base", "origin/main", "--allow-regression", "a new reason"], renewed.deps);
    expect(renewed.writeFile).toHaveBeenCalledWith(
      baselineFile,
      baselineOf({ [A]: 1, [B]: 2 }, [{ fingerprint: B, count: 2, reason: "a new reason" }]),
    );
  });

  it("records no allowed regressions when the base ref has no baseline, but still wants a reason to rise", () => {
    const extra = { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` };
    const refused = setup(baselineOf({ [A]: 1 }, [{ fingerprint: A, count: 1, reason: "old" }]), extra);
    main(["--write-baseline", "--base", "origin/main"], refused.deps);
    expect(refused.writeFile).not.toHaveBeenCalled();
    expect(refused.exit).toHaveBeenCalledWith(1);

    const { deps, writeFile, io } = setup(baselineOf({ [A]: 1 }, [{ fingerprint: A, count: 1, reason: "old" }]), extra);
    main(["--write-baseline", "--base", "origin/main", "--allow-regression", "measure"], deps);
    expect(writeFile).toHaveBeenCalledWith(baselineFile, baselineOf({ [A]: 1, [B]: 1 }));
    expect(io.log).toHaveBeenCalledWith(
      `hx-source-rules: wrote ${BASELINE_PATH} with 2 hand-rolled control(s), 0 move(s) and 0 allowed regression(s); origin/main has no baseline, so nothing is recorded to ratchet against.`,
    );
  });

  it("refuses to write a rise against the base ref without a reason", () => {
    const extra = { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` };
    const { deps, writeFile, gitShow, exit } = setup(baselineOf({ [A]: 1, [B]: 1 }), extra);
    gitShow.mockReturnValue(baselineOf({ [A]: 1 }));
    main(["--write-baseline", "--base", "origin/main"], deps);
    expect(writeFile).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  describe("--base: the ratchet", () => {
    const extra = { "/repo/app/routes/b.tsx": `const B = () => <a href="/" />;` };

    it("passes with no rise against the base, counting moves", () => {
      const { deps, io, exit, gitShow } = setup(matching);
      gitShow.mockReturnValue(baselineOf({ "app/routes/old.tsx::A::raw-button::button::type=button": 1 }));
      main(["--base", "abc123"], deps);
      expect(io.log).toHaveBeenCalledWith("hx-source-rules: ratchet against abc123: 0 allowed regression(s), 1 move(s).");
      expect(exit).not.toHaveBeenCalled();
    });

    it("fails a rise the new baseline does not allow, with the command to record why", () => {
      const { deps, io, exit, gitShow } = setup(baselineOf({ [A]: 1, [B]: 1 }), extra);
      gitShow.mockReturnValue(matching);
      main(["--base", "abc123"], deps);
      expect(io.error).toHaveBeenCalledWith(
        `Regression against abc123: ${B} (+1) at app/routes/b.tsx:1. Use an Ouro HX component instead, or record why: pnpm hx:source-rules --write-baseline --base abc123 --allow-regression "<reason>"`,
      );
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("passes a rise the new baseline allows with a reason and count, and not an empty reason or a smaller count", () => {
      const allowed = setup(baselineOf({ [A]: 1, [B]: 1 }, [{ fingerprint: B, count: 1, reason: "measured" }]), extra);
      allowed.gitShow.mockReturnValue(matching);
      main(["--base", "abc123"], allowed.deps);
      expect(allowed.exit).not.toHaveBeenCalled();
      expect(allowed.io.log).toHaveBeenCalledWith("hx-source-rules: ratchet against abc123: 1 allowed regression(s), 0 move(s).");

      for (const entry of [{ fingerprint: B, count: 1, reason: " " }, { fingerprint: B, count: 1 }]) {
        const empty = setup(baselineOf({ [A]: 1, [B]: 1 }, [entry]), extra);
        empty.gitShow.mockReturnValue(matching);
        main(["--base", "abc123"], empty.deps);
        expect(empty.exit).toHaveBeenCalledWith(1);
      }

      for (const entry of [{ fingerprint: B, count: 0, reason: "too small" }, { fingerprint: B, reason: "no count" }]) {
        const small = setup(baselineOf({ [A]: 1, [B]: 1 }, [entry]), extra);
        small.gitShow.mockReturnValue(matching);
        main(["--base", "abc123"], small.deps);
        expect(small.io.error).toHaveBeenCalledWith(
          `Regression against abc123: ${B} (+1) at app/routes/b.tsx:1, but its allowed regression permits ${entry.count ?? 0}. Use an Ouro HX component instead, or record why: pnpm hx:source-rules --write-baseline --base abc123 --allow-regression "<reason>"`,
        );
        expect(small.exit).toHaveBeenCalledWith(1);
      }
    });

    it("ignores an allowed regression already on the base: it allows nothing, and only a note says so", () => {
      const entry = { fingerprint: B, count: 1, reason: "spent" };
      const stale = "hx-source-rules: 1 stale allowed regression(s) from an earlier pull request are ignored; the next --write-baseline drops them.";
      const { deps, io, exit, gitShow } = setup(baselineOf({ [A]: 1, [B]: 1 }, [entry]), extra);
      gitShow.mockReturnValue(baselineOf({ [A]: 1 }, [entry]));
      main(["--base", "abc123"], deps);
      expect(io.error).toHaveBeenCalledTimes(1);
      expect(io.error).toHaveBeenCalledWith(expect.stringContaining(`Regression against abc123: ${B} (+1)`));
      expect(exit).toHaveBeenCalledWith(1);

      const sameBaseline = setup(baselineOf({ [A]: 1, [B]: 1 }, [entry]), extra);
      sameBaseline.gitShow.mockReturnValue(baselineOf({ [A]: 1, [B]: 1 }, [entry]));
      main(["--base", "abc123"], sameBaseline.deps);
      expect(sameBaseline.io.error).not.toHaveBeenCalled();
      expect(sameBaseline.io.log).toHaveBeenCalledWith(stale);
      expect(sameBaseline.exit).not.toHaveBeenCalled();

      const other = setup(baselineOf({ [A]: 1, [B]: 1 }, [{ ...entry, reason: "this pull request" }]), extra);
      other.gitShow.mockReturnValue(baselineOf({ [A]: 1 }, [entry]));
      main(["--base", "abc123"], other.deps);
      expect(other.exit).not.toHaveBeenCalled();
      expect(other.io.log).not.toHaveBeenCalledWith(stale);
    });

    it("skips the ratchet when the base has no baseline yet", () => {
      const { deps, io, exit } = setup(matching);
      main(["--base", "abc123"], deps);
      expect(io.log).toHaveBeenCalledWith("hx-source-rules: abc123 has no baseline; nothing to ratchet against.");
      expect(exit).not.toHaveBeenCalled();
    });

    it("still requires the scan to equal the committed baseline", () => {
      const { deps, io, exit, gitShow } = setup(matching, extra);
      gitShow.mockReturnValue(baselineOf({ [A]: 1, [B]: 1 }));
      main(["--base", "abc123"], deps);
      expect(io.error).toHaveBeenCalledWith(expect.stringContaining("New hand-rolled control"));
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it("rejects --allow-regression or --base without a value, and unknown arguments", () => {
    for (const argv of [
      ["--write-baseline", "--allow-regression"],
      ["--write-baseline", "--allow-regression", "--x"],
      ["--base"],
      ["--base", "--write-baseline"],
      ["--nope"],
    ]) {
      const { deps, io, exit, writeFile } = setup(matching);
      main(argv, deps);
      expect(io.error).toHaveBeenCalledWith(
        "Usage: hx-source-rules.mjs [--base <ref>] [--write-baseline [--allow-regression <reason>]]",
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

  it("reads a baseline from git: present, missing at the ref, or an unknown ref", () => {
    expect(defaultDeps.gitShow(process.cwd(), "HEAD", BASELINE_PATH)).toContain('"offenders"');
    expect(defaultDeps.gitShow(process.cwd(), "HEAD", "test/scripts/no-such-baseline.json")).toBeUndefined();
    expect(() => defaultDeps.gitShow(process.cwd(), "refs/heads/no-such-ref-for-hx-source-rules", BASELINE_PATH)).toThrow(
      "hx-source-rules: unknown base ref refs/heads/no-such-ref-for-hx-source-rules",
    );
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
