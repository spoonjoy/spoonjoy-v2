import { createRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Select, type SelectProps } from "~/components/ouro/select/select";
import { SelectGroup, SelectItem } from "~/components/ouro/select/select-parts";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.maxWidth = "420px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="select"]')!;
    },
    get trigger() {
      return host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    },
    get label() {
      return host.querySelector<HTMLElement>('[data-ouro="select"] > div')!;
    },
    hidden(name: string) {
      return [...host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map((input) => input.value);
    },
  };
}

const courses = [
  { value: "starter", label: "Starter" },
  { value: "main", label: "Main" },
  { value: "dessert", label: "Dessert", disabled: true },
];

/** The ids an element's `aria-describedby` lists. */
const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
/** The text of the elements an element's `aria-describedby` names. */
const description = (element: Element) => describedBy(element).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "");

const popup = () => document.querySelector<HTMLElement>('[data-ouro="select-popup"]');
const option = (name: string) => page.getByRole("option", { name });

/** Opens the list and waits for it. */
async function open(trigger: HTMLElement) {
  await userEvent.click(trigger);
  await expect.poll(() => popup()?.hasAttribute("data-open")).toBe(true);
}

/**
 * Resizes the test frame and waits for the frame's resize event at that size. An open list
 * that lines its item up with the trigger closes on any window resize, and WebKit can deliver
 * the event well after the resize, into a later step or the next test.
 */
async function resizeTo(width: number, height: number) {
  if (innerWidth === width && innerHeight === height) return;
  const arrived = new Promise<void>((resolve) => {
    const onResize = () => {
      if (innerWidth !== width || innerHeight !== height) return;
      removeEventListener("resize", onResize);
      resolve();
    };
    addEventListener("resize", onResize);
  });
  await page.viewport(width, height);
  await arrived;
}

// On a fresh page, WebKit can deliver the resize from the runner's first viewport setting
// after the first test has opened a list, closing it. Resizing away and back here consumes it.
beforeAll(async () => {
  await resizeTo(innerWidth + 1, innerHeight);
  await resizeTo(innerWidth - 1, innerHeight);
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await resizeTo(414, 896);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Select", () => {
  it("is a labeled combobox built on the Field contract", async () => {
    const { root, trigger, label } = await render(<Select label="Course" name="course" options={courses} />);
    expect(root.getAttribute("data-ouro")).toBe("select");
    expect(label.tagName).toBe("DIV");
    expect(trigger.getAttribute("aria-labelledby")).toBe(label.id);
    await expect.element(page.getByRole("combobox", { name: "Course" })).toBeVisible();
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("chooses an option, shows its label and submits its value", async () => {
    const onValueChange = vi.fn();
    const { trigger, hidden } = await render(<Select label="Course" name="course" options={courses} onValueChange={onValueChange} />);
    await open(trigger);
    await userEvent.click(option("Main"));
    expect(onValueChange).toHaveBeenCalledWith("main");
    await expect.poll(() => popup()?.hasAttribute("data-open") ?? false).toBe(false);
    expect(trigger.textContent).toBe("Main");
    expect(hidden("course")).toEqual(["main"]);
    // Focus goes back to the trigger.
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  it("shows the placeholder, muted, until an option is chosen", async () => {
    const { trigger } = await render(<Select label="Course" options={courses} placeholder="Choose a course" />);
    const value = trigger.querySelector<HTMLElement>("[data-placeholder]")!;
    expect(value.textContent).toBe("Choose a course");
    const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground");
    expect(muted).not.toBe("");
    const probe = document.createElement("span");
    probe.style.color = "var(--muted-foreground)";
    document.body.append(probe);
    expect(getComputedStyle(value).color).toBe(getComputedStyle(probe).color);
    probe.remove();
  });

  it("keeps a disabled option from being chosen", async () => {
    const { trigger } = await render(<Select label="Course" options={courses} defaultValue="starter" />);
    await open(trigger);
    expect(option("Dessert").element().hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(option("Dessert"), { force: true });
    expect(trigger.textContent).toBe("Starter");
  });

  it("renders groups from options, each named by its heading", async () => {
    const { trigger } = await render(
      <Select
        label="Produce"
        options={[
          { label: "Fruit", options: [{ value: "apple", label: "Apple" }] },
          { label: "Vegetables", options: [{ value: "leek", label: "Leek" }] },
          { value: "other", label: "Other" },
        ]}
      />,
    );
    await open(trigger);
    await expect.element(page.getByRole("group", { name: "Fruit" })).toBeVisible();
    await expect.element(page.getByRole("group", { name: "Vegetables" }).getByRole("option", { name: "Leek" })).toBeVisible();
    await expect.element(option("Other")).toBeVisible();
  });

  it("takes SelectItem and SelectGroup children, and shows a child's label in the trigger", async () => {
    const { trigger } = await render(
      <Select label="Produce" name="produce" defaultValue="leek">
        <>
          <SelectItem value="none">None</SelectItem>
        </>
        <SelectGroup label="Vegetables">
          <SelectItem value="leek" label="Leek">
            <span aria-hidden="true">🥬</span> Leek
          </SelectItem>
        </SelectGroup>
        {false}
        text
      </Select>,
    );
    expect(trigger.textContent).toContain("Leek");
    await open(trigger);
    await expect.element(page.getByRole("group", { name: "Vegetables" })).toBeVisible();
    await userEvent.click(option("None"));
    expect(trigger.textContent).toBe("None");
  });

  it("picks several values with multiple, as a string array", async () => {
    const onValueChange = vi.fn<(value: string[]) => void>();
    const { trigger, hidden } = await render(
      <Select label="Courses" name="courses" multiple defaultValue={["starter"]} options={courses} onValueChange={onValueChange} />,
    );
    expect(trigger.textContent).toBe("Starter");
    await open(trigger);
    await userEvent.click(option("Main"));
    expect(onValueChange).toHaveBeenLastCalledWith(["starter", "main"]);
    // The list stays open while the user picks.
    expect(popup()?.hasAttribute("data-open")).toBe(true);
    expect(trigger.textContent).toBe("Starter, Main");
    expect(hidden("courses")).toEqual(["starter", "main"]);
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState<string | null>("main");
      return (
        <>
          <Select label="Course" options={courses} value={value} onValueChange={setValue} />
          <button type="button" onClick={() => setValue(null)}>
            Reset
          </button>
          <output>{String(value)}</output>
        </>
      );
    }
    const { host, trigger } = await render(<Controlled />);
    expect(trigger.textContent).toBe("Main");
    await open(trigger);
    await userEvent.click(option("Starter"));
    expect(host.querySelector("output")!.textContent).toBe("starter");
    await userEvent.click(page.getByRole("button", { name: "Reset" }));
    expect(trigger.textContent).toBe("");
  });

  it("opens and chooses with the keyboard", async () => {
    const { trigger } = await render(<Select label="Course" options={courses} />);
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => popup()?.hasAttribute("data-open")).toBe(true);
    // The list takes focus a moment after it opens. A key sent before that goes to the
    // trigger, which does not move the highlight. A closing list keeps focus and its highlight
    // while it fades, so check that it is still open, not ending.
    const highlighted = () => popup()!.querySelector("[data-highlighted]")?.textContent;
    const ready = () =>
      popup()!.hasAttribute("data-open") && !popup()!.hasAttribute("data-ending-style") && popup()!.contains(document.activeElement) && highlighted();
    await expect.poll(ready).toBe("Starter");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(highlighted).toBe("Main");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => trigger.textContent).toBe("Main");
  });

  it("shows an error, linked and marked invalid, after the description", async () => {
    const { trigger } = await render(
      <Select label="Course" options={courses} description="What you are cooking." error="Choose a course." required />,
    );
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(description(trigger)).toEqual(["What you are cooking.", "Choose a course."]);
  });

  it("is disabled and read-only on request", async () => {
    const { trigger, rerender } = await render(<Select label="Course" options={courses} disabled />);
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(trigger, { force: true });
    expect(popup()?.hasAttribute("data-open") ?? false).toBe(false);
    await rerender(<Select label="Course" options={courses} readOnly defaultValue="main" />);
    expect(trigger.hasAttribute("data-readonly")).toBe(true);
  });

  it("forwards a ref to the trigger and lets layout classes win", async () => {
    const ref = createRef<HTMLButtonElement>();
    const { root, trigger } = await render(<Select label="Course" options={courses} ref={ref} className="mt-4 w-40" />);
    expect(ref.current).toBe(trigger);
    expect(getComputedStyle(root).marginTop).toBe("16px");
    expect(getComputedStyle(root).width).toBe("160px");
  });

  it("is 36px tall with a fine pointer from sm up, with 32px options", async () => {
    await resizeTo(1024, 768);
    const { trigger } = await render(<Select label="Course" options={courses} />);
    expect(trigger.getBoundingClientRect().height).toBe(36);
    await open(trigger);
    expect(option("Main").element().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    expect(option("Main").element().getBoundingClientRect().height).toBeLessThan(44);
    // A mouse gets the list next to the trigger, not a sheet.
    expect(popup()!.hasAttribute("data-ouro-presentation")).toBe(false);
    expect(document.querySelector('[data-ouro="select-backdrop"]')).toBeNull();
  });

  it("stops a form submit while required and empty, and focuses the trigger", async () => {
    const submitted = vi.fn((event: FormEvent) => event.preventDefault());
    const { trigger } = await render(
      <Form onSubmit={submitted}>
        <Select label="Course" name="course" options={courses} required />
        <button type="submit">Save</button>
      </Form>,
    );
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a Form error for its name and drops it once a value is chosen", async () => {
    const { trigger } = await render(
      <Form errors={{ course: "That course is full." }}>
        <Select label="Course" name="course" options={courses} />
      </Form>,
    );
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(description(trigger)).toEqual(["That course is full."]);
    await open(trigger);
    await userEvent.click(option("Starter"));
    await expect.poll(() => trigger.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(trigger)).toEqual([]);
  });

  it("chooses without a name or a form", async () => {
    const { trigger } = await render(<Select label="Course" options={courses} />);
    await open(trigger);
    await userEvent.click(option("Starter"));
    expect(trigger.textContent).toBe("Starter");
  });
});

describe("Select in a Form with server errors (review fix round 1, finding 7)", () => {
  it("gets focus when the errors arrive, and drops its error once the user picks another option", async () => {
    function Page() {
      const [errors, setErrors] = useState<FormErrors | undefined>();
      return (
        <Form
          errors={errors}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setTimeout(() => setErrors({ name: "Too short.", course: "That course is full." }));
          }}
        >
          <Select label="Course" name="course" defaultValue="main" options={[{ value: "main", label: "Main" }, { value: "side", label: "Side" }]} />
          <TextField label="Name" name="name" defaultValue="x" />
          <button type="submit">Save</button>
        </Form>
      );
    }
    await render(<Page />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
    // The Select comes first in the page, so it gets focus though the action listed Name first.
    await expect.poll(() => document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(page.getByRole("combobox", { name: "Course" }));
    await userEvent.click(page.getByRole("option", { name: "Side" }));
    await expect.poll(() => trigger.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Select development messages", () => {
  it.each([
    ["onChange", { onChange: () => {} }, "onChange is not a prop; Select calls onValueChange with the value", "<Select onValueChange={(value) => setValue(value)}>"],
    ["isMulti", { isMulti: true }, "isMulti is not a prop", "<Select multiple>"],
    ["items", { items: courses }, "items is not a prop", '<Select options={[{ value: "main", label: "Main" }]}>'],
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<Select error="Required.">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<Select required>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Course", options: courses, ...extra } as unknown as SelectProps;
    const { trigger } = await render(<Select {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Select: ${problem}. Fix: ${fix}.`);
    expect(trigger.hasAttribute(Object.keys(extra)[0]!.toLowerCase())).toBe(false);
  });

  it("warns when both options and children are set", async () => {
    await render(
      <Select label="Course" options={courses}>
        <SelectItem value="x">X</SelectItem>
      </Select>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Select: options and children are both set, so the children are ignored. Fix: <Select label="Course" options={options} />.',
    );
  });

  it("warns when there is nothing to choose", async () => {
    await render(<Select label="Course" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Select: there are no options to choose from. Fix: <Select label="Course" options={[{ value: "main", label: "Main" }]} />.',
    );
  });

  it("warns for an appearance class and an empty label", async () => {
    await render(<Select label="" options={courses} className="bg-red-500" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Select: "bg-red-500" sets appearance, and className is for layout only. Fix: <Select error="What is wrong">.');
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Select: label is empty, so the control has no name. Fix: <Select label="Email" hideLabel> to hide a label you still need.');
    // The label is connected through aria-labelledby, so that check passes.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("throws with the JSX shape when a part is outside Select", () => {
    expect(() => renderToString(<SelectItem value="x">X</SelectItem>)).toThrow(
      '[ouro-ui] SelectItem: must be rendered inside <Select>. Fix: <Select label="Fruit"><SelectItem value="apple">Apple</SelectItem></Select>.',
    );
    expect(() => renderToString(<SelectGroup label="Fruit">X</SelectGroup>)).toThrow("[ouro-ui] SelectGroup: must be rendered inside <Select>.");
  });
});

describe("Select server rendering", () => {
  it("names, describes and marks the trigger in the server HTML", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Form errors={{ course: "That course is full." }}>
        <Select label="Course" name="course" description="What you are cooking." options={courses} required />
      </Form>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const trigger = doc.querySelector('[role="combobox"]')!;
    expect(doc.getElementById(trigger.getAttribute("aria-labelledby")!)!.textContent).toBe("Course*");
    expect(description(trigger)).toEqual(["What you are cooking.", "That course is full."]);
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const node = <Select label="Course" name="course" description="What you are cooking." options={courses} defaultValue="main" error="Full." />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("button, div, p")].map((el) => [el.id, el.getAttribute("aria-labelledby"), el.getAttribute("aria-describedby")]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(host.querySelector('[role="combobox"]')!.textContent).toBe("Main");
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
