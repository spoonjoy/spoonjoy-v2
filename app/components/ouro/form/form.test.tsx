import { createContext, forwardRef, useState, type ComponentPropsWithRef, type FormEvent, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { Select } from "~/components/ouro/select/select";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
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
    get form() {
      return host.querySelector<HTMLFormElement>("form")!;
    },
    input(name: string) {
      return host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    },
  };
}

/** The ids an element's `aria-describedby` lists. */
const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
/** The text of the elements an element's `aria-describedby` names. */
const description = (element: Element) => describedBy(element).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "");

/**
 * Waits until a field's message has finished fading out and left the form. The message keeps
 * its space while it fades, so what is below it moves up when it goes; a click that presses
 * before the move and releases after it lands on two elements and clicks neither.
 */
const messageGone = (form: Element) =>
  expect.poll(() => form.querySelector('[aria-invalid="true"]') === null && form.querySelector("[data-ending-style]") === null).toBe(true);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
});

/**
 * A page with a React Router style action: submitting sends the form (here, a promise that
 * resolves on the next task) and the action's errors come back as a prop.
 */
function ActionPage({ result, onSent }: { result: FormErrors | undefined; onSent?: (data: FormData) => void }) {
  const [errors, setErrors] = useState<FormErrors | undefined>();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSent?.(data);
    setTimeout(() => setErrors(result));
  };
  return (
    <Form method="post" errors={errors} onSubmit={submit}>
      <TextField label="Name" name="name" defaultValue="Ari" />
      <TextField label="Email" name="email" type="email" description="We never share it." defaultValue="ari@example.com" />
      <TextArea label="Bio" name="bio" />
      <button type="submit">Save</button>
    </Form>
  );
}

describe("Form", () => {
  it("renders a form that passes action and method through", async () => {
    const { form } = await render(
      <Form action="/recipes/new" method="post" className="mt-4">
        <TextField label="Name" name="name" />
      </Form>,
    );
    expect(form.getAttribute("action")).toBe("/recipes/new");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("data-ouro")).toBe("form");
    expect(getComputedStyle(form).marginTop).toBe("16px");
  });

  it("renders a router's form through render, so its submit handling runs", async () => {
    const routerSubmit = vi.fn();
    // A stand-in for React Router's <Form>: its own submit handler runs after the one it is given.
    const RouterForm = forwardRef<HTMLFormElement, ComponentPropsWithRef<"form">>(function RouterForm({ onSubmit, ...props }, ref) {
      return (
        <form
          {...props}
          ref={ref}
          data-router=""
          onSubmit={(event) => {
            onSubmit?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            routerSubmit(new FormData(event.currentTarget).get("name"));
          }}
        />
      );
    });
    const { form } = await render(
      <Form render={<RouterForm />} method="post">
        <TextField label="Name" name="name" required />
        <button type="submit">Save</button>
      </Form>,
    );
    expect(form.hasAttribute("data-router")).toBe(true);
    expect(form.getAttribute("method")).toBe("post");
    // An empty required field stops the submit before the router sees it.
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(routerSubmit).not.toHaveBeenCalled();
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Pasta");
    await messageGone(form);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(routerSubmit).toHaveBeenCalledWith("Pasta");
  });

  it("validates with the browser's constraints and focuses the first invalid control", async () => {
    const submitted = vi.fn((event: FormEvent) => event.preventDefault());
    const { input } = await render(
      <Form onSubmit={submitted}>
        <TextField label="Name" name="name" />
        <TextField label="Email" name="email" type="email" required />
        <TextField label="Phone" name="phone" type="tel" required />
        <button type="submit">Save</button>
      </Form>,
    );
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input("email"));
    expect(input("email").getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => description(input("email")).join(" ")).toContain(input("email").validationMessage);
  });

  it("shows each error on the field with that name, linked and marked invalid", async () => {
    const { input } = await render(
      <Form errors={{ email: "That email is taken.", bio: ["Too long.", "No links."] }}>
        <TextField label="Name" name="name" />
        <TextField label="Email" name="email" description="We never share it." />
        <TextArea label="Bio" name="bio" />
      </Form>,
    );
    expect(input("name").getAttribute("aria-invalid")).toBeNull();
    expect(input("email").getAttribute("aria-invalid")).toBe("true");
    expect(description(input("email"))).toEqual(["We never share it.", "That email is taken."]);
    expect(input("bio").getAttribute("aria-invalid")).toBe("true");
    expect(description(input("bio"))).toEqual(["Too long.No links."]);
  });

  it("lets a field's own error prop win over the form's", async () => {
    const { input } = await render(
      <Form errors={{ email: "From the form." }}>
        <TextField label="Email" name="email" error="From the field." />
        <TextField label="Name" name="name" error="" />
      </Form>,
    );
    expect(description(input("email"))).toEqual(["From the field."]);
  });

  it("clears a field's form error once the user changes it", async () => {
    const { input } = await render(
      <Form errors={{ email: "That email is taken.", name: "Required." }}>
        <TextField label="Name" name="name" />
        <TextField label="Email" name="email" />
      </Form>,
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Email" }), "new@example.com");
    expect(input("email").getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(input("email"))).toEqual([]);
    // The other field keeps its error.
    expect(input("name").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows new errors when the errors prop changes, even after the user cleared one", async () => {
    const first = { email: "That email is taken." };
    const { input, rerender } = await render(
      <Form errors={first}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Email" }), "x");
    expect(input("email").getAttribute("aria-invalid")).toBeNull();
    // The same object again changes nothing.
    await rerender(
      <Form errors={first}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(input("email").getAttribute("aria-invalid")).toBeNull();
    await rerender(
      <Form errors={{ email: "Still taken." }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(description(input("email"))).toEqual(["Still taken."]);
  });

  it("ignores a change in a field without a form error", async () => {
    const { input } = await render(
      <Form errors={{ email: "That email is taken." }}>
        <TextField label="Name" name="name" />
        <TextField label="Email" name="email" />
        <Field label="Unnamed">
          <FieldControl />
        </Field>
      </Form>,
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Ari");
    await userEvent.fill(page.getByRole("textbox", { name: "Unnamed" }), "x");
    expect(input("email").getAttribute("aria-invalid")).toBe("true");
  });

  it("moves focus to the first invalid field when a submit comes back with errors (Review Focus 2)", async () => {
    const sent = vi.fn();
    const { input } = await render(<ActionPage result={{ bio: "Too short.", email: "That email is taken." }} onSent={sent} />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(sent).toHaveBeenCalledOnce();
    expect((sent.mock.calls[0]![0] as FormData).get("email")).toBe("ari@example.com");
    // Email comes first in the page, so it gets focus, though the action listed Bio first.
    await expect.poll(() => document.activeElement).toBe(input("email"));
    expect(input("email").getAttribute("aria-invalid")).toBe("true");
    expect(description(input("email"))).toEqual(["We never share it.", "That email is taken."]);
    expect(input("bio").getAttribute("aria-invalid")).toBe("true");
    expect(input("name").getAttribute("aria-invalid")).toBeNull();
  });

  it("leaves focus alone when a submit comes back without errors", async () => {
    await render(<ActionPage result={undefined} />);
    const save = page.getByRole("button", { name: "Save" });
    await userEvent.click(save);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    // No field took focus (WebKit does not focus a clicked button, so focus may be on the page).
    expect(document.activeElement?.matches("input, textarea, [role='alert']")).toBe(false);
    expect(save.element()).toBeTruthy();
  });

  it("does not move focus when the user clears an error while typing", async () => {
    const { input } = await render(<ActionPage result={{ email: "That email is taken.", bio: "Too short." }} />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    await expect.poll(() => document.activeElement).toBe(input("email"));
    await userEvent.fill(page.getByRole("textbox", { name: "Email" }), "new@example.com");
    expect(document.activeElement).toBe(input("email"));
    expect(input("bio").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Form errors are display-only (review fix round 1, finding 1)", () => {
  it("resubmits after the user fixes a field whose own error prop came from the action", async () => {
    const sent = vi.fn();
    function Page() {
      const [actionData, setActionData] = useState<{ errors?: FormErrors } | undefined>({ errors: { email: "Taken." } });
      return (
        <Form
          method="post"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            sent(new FormData(event.currentTarget).get("email"));
            setActionData(undefined);
          }}
        >
          <TextField label="Email" name="email" error={actionData?.errors?.email as string | undefined} defaultValue="old@example.com" />
          <button type="submit">Save</button>
        </Form>
      );
    }
    await render(<Page />);
    await userEvent.fill(page.getByRole("textbox", { name: "Email" }), "new@example.com");
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(sent).toHaveBeenCalledWith("new@example.com");
  });

  it("resubmits a TextField after a server error, with the field unchanged", async () => {
    const sent = vi.fn();
    const { input } = await render(<ActionPage result={{ email: "Try again." }} onSent={sent} />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    await expect.poll(() => input("email").getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("resubmits a Select after a server error, with the select unchanged", async () => {
    const sent = vi.fn();
    function Page() {
      const [errors, setErrors] = useState<FormErrors | undefined>();
      return (
        <Form
          errors={errors}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            sent(new FormData(event.currentTarget).get("course"));
            setTimeout(() => setErrors({ course: "That course is full." }));
          }}
        >
          <Select label="Course" name="course" defaultValue="main" options={[{ value: "main", label: "Main" }, { value: "side", label: "Side" }]} />
          <button type="submit">Save</button>
        </Form>
      );
    }
    const { host } = await render(<Page />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    await expect.poll(() => host.querySelector('[role="combobox"]')!.getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(sent.mock.calls).toEqual([["main"], ["main"]]);
  });

  it("still blocks a submit on the browser's own constraints", async () => {
    const sent = vi.fn((event: FormEvent) => event.preventDefault());
    const { input } = await render(
      <Form errors={{ name: "Taken." }} onSubmit={sent}>
        <TextField label="Name" name="name" defaultValue="Ari" />
        <TextField label="Email" name="email" required />
        <button type="submit">Save</button>
      </Form>,
    );
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(sent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input("email"));
  });
});

describe("Form submits only itself (review fix round 1, finding 2)", () => {
  it("stops its submit event from reaching a Form around it in the React tree", async () => {
    const outer = vi.fn((event: FormEvent) => event.preventDefault());
    const inner = vi.fn((event: FormEvent) => event.preventDefault());
    const { createPortal } = await import("react-dom");
    const target = document.createElement("div");
    document.body.append(target);
    mounted.push(target);
    await render(
      <Form onSubmit={outer}>
        <TextField label="Title" name="title" defaultValue="Soup" />
        {createPortal(
          <Form onSubmit={inner}>
            <TextField label="Qty" name="qty" defaultValue="1" />
            <button type="submit">Save qty</button>
          </Form>,
          target,
        )}
      </Form>,
    );
    await userEvent.click(page.getByRole("button", { name: "Save qty" }));
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("Form-level messages (review fix round 1, finding 3)", () => {
  it("shows a form error and keys no field claims in an alert at the top of the form", async () => {
    const { host, form } = await render(
      <Form errors={{ form: "The server is down.", emial: "Typo key.", email: "Taken." }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert).not.toBeNull();
    // First in the DOM, so reading order matches what the eye sees (review fix round 3, ruling 2).
    expect(form.firstElementChild).toBe(alert);
    expect(alert.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.querySelector("input")!.getBoundingClientRect().top);
    await expect.poll(() => alert.textContent).toBe("The server is down.Typo key.");
    // The field's own error shows on the field only.
    expect(alert.textContent).not.toContain("Taken.");
  });

  it("renders no alert without form-level errors", async () => {
    const { host } = await render(
      <Form errors={{ email: "Taken." }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("");
  });

  it("focuses the alert when errors arrive and no field has one", async () => {
    const { host } = await render(<ActionPage result={{ form: "The server is down." }} />);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    await expect.poll(() => document.activeElement).toBe(host.querySelector('[role="alert"]'));
  });

  it("lists several form-level messages and shows nothing for an empty one", async () => {
    const { host } = await render(
      <Form errors={{ form: ["The server is down.", "Try again later."], name: "" }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    await expect.poll(() => host.querySelector('[role="alert"]')!.textContent).toBe("The server is down.Try again later.");
  });

  it("moves focus only when errors arrive that something shows", async () => {
    const { rerender } = await render(
      <Form>
        <TextField label="Email" name="email" />
      </Form>,
    );
    const before = document.activeElement;
    // An empty message shows nowhere, so focus stays.
    await rerender(
      <Form errors={{ email: "" }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(document.activeElement).toBe(before);
    await rerender(
      <Form errors={undefined}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(document.activeElement).toBe(before);
  });

  it("keeps a name claimed while any field with it remains", async () => {
    function Tags({ both }: { both: boolean }) {
      return (
        <Form errors={{ tag: "Pick a tag." }}>
          <TextField label="Tag" name="tag" />
          {both && <TextField label="Another tag" name="tag" />}
        </Form>
      );
    }
    const { host, rerender } = await render(<Tags both />);
    await rerender(<Tags both={false} />);
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns in development about a key no field claims, naming the fields there are", async () => {
    await render(
      <Form errors={{ emial: "Typo key.", form: "Shown at the top." }}>
        <TextField label="Email" name="email" />
        <TextField label="Name" name="name" />
      </Form>,
    );
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Form: errors has "emial", which no field in the form is named, so it shows at the top of the form. Fix: use a field\'s name (email, name), or "form" for a message about the whole form.',
    );
  });

  it("puts the form error in the server HTML", () => {
    const html = renderToString(
      <Form errors={{ form: "The server is down." }}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector('[role="alert"]')!.textContent).toBe("The server is down.");
  });
});

describe("Form-level messages before and after hydration (review fix round 4)", () => {
  // The server and the first client render show only the `form` key at the top; keys no
  // mounted field claims join it after hydration. So nothing shows twice, and the alert
  // never claims a message that a field renders.
  const Ctx = createContext(0);
  function Section({ children }: { children: ReactNode }) {
    return (
      <div>
        <TextField label="Email" name="email" />
        {children}
      </div>
    );
  }
  function AddressFields({ name }: { name: string }) {
    return <TextField label="Street" name={`${name}.street`} />;
  }
  /** A panel that is closed, so its children are written but not rendered. */
  function Closed({ children }: { children: ReactNode }) {
    const open = false;
    return open ? children : null;
  }
  const shapes: [string, FormErrors, ReactNode, string[]][] = [
    [
      "S1 a component with children that renders its own field",
      { email: "Email err", form: "Top" },
      <Section key="s1">
        <TextField label="Name" name="name" />
      </Section>,
      [],
    ],
    [
      "S2 a function child",
      { email: "Email err", form: "Top" },
      <Ctx.Consumer key="s2">{() => <TextField label="Email" name="email" />}</Ctx.Consumer>,
      [],
    ],
    ["S3 a component with a name that renders other fields", { "ship.street": "Street err", form: "Top" }, <AddressFields key="s3" name="ship" />, []],
    [
      "S4 a field written but not rendered",
      { x: "X err", form: "Top" },
      <Closed key="s4">
        <TextField label="X" name="x" />
      </Closed>,
      ["X err"],
    ],
    [
      "S5 a childless component next to the fields, with a typo key",
      { emial: "Typo err", form: "Top" },
      <div key="s5">
        <TextField label="Email" name="email" />
        <hr />
      </div>,
      ["Typo err"],
    ],
    [
      "S6 a named element that is not a field",
      { intent: "Bad intent", form: "Top" },
      <button key="s6" type="submit" name="intent" value="save">
        Save
      </button>,
      ["Bad intent"],
    ],
  ];
  const count = (text: string, message: string) => text.split(message).length - 1;

  describe.each(shapes)("%s", (_name, errors, children, unclaimed) => {
    const node = <Form errors={errors}>{children}</Form>;
    const fieldMessages = Object.entries(errors)
      .filter(([key]) => key !== "form")
      .map(([, message]) => message as string)
      .filter((message) => !unclaimed.includes(message));

    it("shows only the form key at the top of the server HTML, and nothing twice", () => {
      const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
      const alert = doc.querySelector("form")!.firstElementChild!;
      expect(alert.getAttribute("role")).toBe("alert");
      expect([...alert.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Top"]);
      for (const message of Object.values(errors) as string[]) expect(count(doc.body.textContent!, message)).toBeLessThanOrEqual(1);
      for (const message of fieldMessages) expect(count(doc.body.textContent!, message)).toBe(1);
    });

    it("hydrates with no mismatch, then shows every error exactly once", async () => {
      const host = document.createElement("div");
      host.innerHTML = renderToString(node);
      document.body.append(host);
      mounted.push(host);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const recoverable = vi.fn();
      let root!: Root;
      await act(async () => {
        root = hydrateRoot(host, node, { onRecoverableError: recoverable });
      });
      roots.push(root);
      expect(recoverable).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      const alert = host.querySelector('[role="alert"]')!;
      await expect.poll(() => [...alert.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Top", ...unclaimed]);
      for (const message of Object.values(errors) as string[]) expect(count(host.textContent!, message)).toBe(1);
    });
  });
});

describe("Form development messages", () => {
  it("names errors when an app passes validationErrors", async () => {
    const props = { validationErrors: { email: "Taken." } } as unknown as Parameters<typeof Form>[0];
    const { form } = await render(
      <Form {...props}>
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Form: validationErrors is not a prop. Fix: <Form errors={actionData?.errors}>.");
    expect(form.hasAttribute("validationerrors")).toBe(false);
  });

  it("warns for an appearance class", async () => {
    await render(
      <Form className="bg-muted">
        <TextField label="Email" name="email" />
      </Form>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Form: "bg-muted" sets appearance, and className is for layout only. Fix: style fields in your theme (--input, --ring, --radius).',
    );
  });
});

describe("Form server rendering", () => {
  it("links a form error to its control in the server HTML (task 1 review, finding 1)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Form errors={{ email: "Taken." }}>
        <TextField label="Email" name="email" description="We never share it." />
        <TextField label="Name" name="name" />
      </Form>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const email = doc.querySelector<HTMLInputElement>('input[name="email"]')!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const ids = describedBy(email);
    expect(ids.map((id) => doc.getElementById(id)?.textContent)).toEqual(["We never share it.", "Taken."]);
    expect(ids[1]).toMatch(/-error$/);
    const name = doc.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(name.hasAttribute("aria-describedby")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates a form with errors with the same ids and no hydration warning", async () => {
    const node = (
      <Form errors={{ email: "Taken." }}>
        <TextField label="Email" name="email" description="We never share it." />
      </Form>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("input, label, p, div")].map((el) => [el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
