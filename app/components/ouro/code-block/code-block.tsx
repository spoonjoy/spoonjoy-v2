"use client";

import { useCallback, type HTMLAttributes, type JSX, type ReactNode, type Ref, type RefCallback } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";

/** The props CodeBlock adds to the `<figure>` attributes it passes through. */
export interface CodeBlockOwnProps {
  /**
   * The code, as plain text. It shows exactly as given, whitespace and all, and is what the copy button copies.
   *
   * @claim "It shows exactly as given, whitespace" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:testExists(registry/ouro/components/ouro/code-block/code-block.test.tsx::CodeBlock > copies the code exactly with its copy button)
   * @claim "It shows exactly as given, whitespace" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:testExists(registry/ouro/components/ouro/code-block/code-block.test.tsx::CodeBlock > shows the code as given on the muted surface in the monospace font, under a caption naming its language)
   */
  code: string;
  /**
   * The language, shown in the block's caption when there is no `title` and set as
   * `data-language` on the block for a highlighter of your own: `language="bash"`.
   * @claim "The language, shown in the block's" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:testExists(registry/ouro/components/ouro/code-block/code-block.test.tsx::CodeBlock > captions with the title rather than the language)
   * @claim "The language, shown in the block's" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:fileLine(registry/ouro/components/ouro/code-block/code-block.test.tsx, /getAttribute\("data-language"\)\)\.toBe\("bash"\)/)
   */
  language?: string | undefined;
  /** A caption above the code, such as its file name: `title="vite.config.ts"`. */
  title?: ReactNode;
  /**
   * The copy button in the bar above the code. Turn it off for code nobody should paste, such as
   * output. @default true
   */
  copy?: boolean | undefined;
  /** The copy button's name for screen readers. @default "Copy code" */
  copyLabel?: string | undefined;
  /**
   * Wraps long lines instead of scrolling them sideways. Scrolling keeps code as written,
   * so leave it off for code and turn it on for prose-like text such as a long command.
   */
  wrap?: boolean | undefined;
  /** Layout only: margins, width, a maximum height that scrolls (`max-h-80`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. The code is `code`, a string: `<CodeBlock code={source} />`. */
  children?: { 'Use <CodeBlock code={source} />': never };
  /** Not a prop. Ouro UI uses `language`: `<CodeBlock code={source} language="tsx" />`. */
  lang?: { 'Use <CodeBlock language="tsx" />': never };
  /** Not a prop. The caption is `title`: `<CodeBlock code={source} title="app.tsx" />`. */
  filename?: { 'Use <CodeBlock title="app.tsx" />': never };
  /** Not a prop. The copy button is on by default; `copy={false}` turns it off. */
  showCopyButton?: { 'Use copy={false} to hide the copy button; it shows by default': never };
}

/** Props for {@link CodeBlock}: its own props and the `<figure>` attributes it passes through. */
export type CodeBlockProps = Omit<HTMLAttributes<HTMLElement>, keyof CodeBlockOwnProps> & CodeBlockOwnProps;

/**
 * Makes the code a tab stop while it overflows either way, so a keyboard can scroll it (WCAG 2.1.1).
 *
 * @claim "Makes the code a tab stop" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:testExists(registry/ouro/components/ouro/code-block/code-block.test.tsx::CodeBlock > scrolls a long line sideways and becomes a tab stop only while it overflows)
 * @claim "Makes the code a tab stop" registry/ouro/components/ouro/code-block/code-block.test.tsx verify:testExists(registry/ouro/components/ouro/code-block/code-block.test.tsx::CodeBlock > scrolls tall code within a maximum height the app sets, as a tab stop)
 * @claim "Makes the code a tab stop" https://www.w3.org/TR/WCAG22/#keyboard verify:urlOk(https://www.w3.org/TR/WCAG22/#keyboard)
 */
function useScrollableCode(): RefCallback<HTMLPreElement> {
  return useCallback((element: HTMLPreElement | null) => {
    // React 19 calls a ref that returns a cleanup with the element only; the cleanup replaces the call with null.
    /* istanbul ignore if @preserve -- never called with null */
    if (!element) return;
    const update = () => {
      const overflows = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
      if (overflows) element.setAttribute("tabindex", "0");
      // Removing the focused block's tab stop would drop focus to <body>; it goes once focus leaves.
      else if (element !== document.activeElement) element.removeAttribute("tabindex");
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(element.firstElementChild!);
    element.addEventListener("blur", update);
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("blur", update);
    };
  }, []);
}

/**
 * Code or a command on a muted surface in the theme's monospace font, with a caption
 * and a button that copies it. The code shows exactly as given and scrolls sideways
 * rather than wrapping (unless `wrap`), and the block becomes a tab stop while it
 * overflows, so a keyboard can scroll it. Copying says "Copied" to screen readers.
 *
 * It does not color the code; to highlight it, set colors on the `data-language` block
 * from a highlighter of your own, or pass highlighted code to your own `<pre>`.
 *
 * Use `Kbd` instead for a key or shortcut in a sentence, `<code>` for a short name in
 * running text, and `CopyButton` for one value without a block around it.
 *
 * @group Display
 * @see https://ui.ouro.bot/docs/code-block
 *
 * @example
 * <CodeBlock language="bash" code="npx shadcn@latest add button" />
 * <CodeBlock title="vite.config.ts" code={config} className="max-h-80" />
 */
export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const {
    code,
    language,
    title,
    copy = true,
    copyLabel = "Copy code",
    wrap,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    children,
    lang,
    filename,
    showCopyButton,
    ...rest
  } = props;
  useAppearanceClassNameCheck(
    "CodeBlock",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; CodeBlock sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "CodeBlock",
    process.env.NODE_ENV !== "production"
      ? () => [
          children !== undefined && ["CodeBlock takes its code as code, a string", "<CodeBlock code={source} />"],
          lang !== undefined && ["lang is not a prop", `<CodeBlock language="${typeof lang === "string" ? lang : "tsx"}" />`],
          filename !== undefined && ["filename is not a prop", `<CodeBlock title="${typeof filename === "string" ? filename : "app.tsx"}" />`],
          showCopyButton !== undefined && ["showCopyButton is not a prop; the copy button shows by default", "<CodeBlock code={source} copy={false} />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const scrollable = useScrollableCode();
  const caption = title ?? language;
  const bar = caption != null || copy;
  // The caption and the copy button share the bar above the code as siblings in the grid: a
  // <figcaption> names the figure, so the button stays out of it.
  return (
    <figure
      {...rest}
      ref={ref}
      data-ouro="code-block"
      data-language={language}
      className={cn(
        "[@layer_ouro-reset]:m-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-solid border-border bg-muted text-foreground",
        bar ? "grid-rows-[minmax(calc(var(--spacing)*11),auto)_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]",
        className,
      )}
    >
      {caption != null ? (
        <figcaption
          data-slot="caption"
          className="col-start-1 row-start-1 flex min-w-0 items-center ps-4 pe-2 text-xs leading-5 font-medium text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))]"
        >
          <span className="min-w-0 truncate">{caption}</span>
        </figcaption>
      ) : null}
      {copy ? (
        <CopyButton
          data-ouro-control="code-block"
          data-ouro-part="copy"
          value={code}
          label={copyLabel}
          hideLabel
          variant="plain"
          size="sm"
          className="col-start-2 row-start-1 self-center me-1.5"
        />
      ) : null}
      <pre
        ref={scrollable}
        data-ouro-control="code-block"
        data-ouro-part="code"
        className={cn(
          "col-span-2 m-0 min-h-0 overflow-auto p-4 font-mono text-sm leading-6 outline-ring -outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid",
          bar && "row-start-2 border-0 border-t border-solid border-border",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        )}
      >
        <code className={cn("[font-family:inherit]", wrap ? "block" : "block w-max min-w-full")}>{code}</code>
      </pre>
    </figure>
  );
}
