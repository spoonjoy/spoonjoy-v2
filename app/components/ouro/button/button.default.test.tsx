import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

/** A dialog with a field, a note, a secondary button and the default one. */
function Dialog({ children, start, ...props }: { children?: ReactNode; start?: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <div role="dialog" aria-label="New chat">
      <input aria-label="To" />
      <textarea aria-label="Note" />
      {children}
      <Button variant="outline" tone="secondary">
        Cancel
      </Button>
      <Button default onClick={start} {...props}>
        Start chat
      </Button>
    </div>
  );
}

const field = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;

describe("Button default", () => {
  it("is what Return presses from a field in its dialog, with the key's own trusted event", async () => {
    const start = vi.fn();
    await render(<Dialog start={start} />);
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(1);
    const event = start.mock.calls[0]![0] as KeyboardEvent;
    expect(event.type).toBe("keydown");
    expect(event.key).toBe("Enter");
    expect(event.isTrusted).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("says so to assistive technology, and looks like the dialog's main action", async () => {
    await render(<Dialog />);
    const button = document.querySelector<HTMLElement>("[aria-keyshortcuts]")!;
    expect(button.textContent).toBe("Start chat");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(button.getAttribute("data-variant")).toBe("solid");
    expect(button.getAttribute("data-default")).toBe("");
  });

  it("leaves Return to a multi-line field, and takes Command or Control Return from it", async () => {
    const start = vi.fn();
    await render(<Dialog start={start} />);
    field("Note").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).not.toHaveBeenCalled();
    expect((field("Note") as HTMLTextAreaElement).value).toBe("\n");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(start).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("leaves Return to a control that takes it itself: another button, a link, a list's option and an open list", async () => {
    const start = vi.fn();
    const other = vi.fn();
    await render(
      <Dialog start={start}>
        <a href="#here">Help</a>
        <div role="option" tabIndex={0} aria-selected="false">
          Noor
        </div>
        <input aria-label="Person" role="combobox" aria-expanded="true" />
        <input aria-label="Closed list" role="combobox" aria-expanded="false" />
        <button type="button" onClick={other}>
          Add
        </button>
      </Dialog>,
    );
    for (const name of ["Help", "Noor", "Person", "Add"]) {
      (document.querySelector<HTMLElement>(`[aria-label="${name}"]`) ?? [...document.querySelectorAll<HTMLElement>("a, [role=option], button")].find((node) => node.textContent === name)!).focus();
      await userEvent.keyboard("{Enter}");
    }
    expect(start).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    field("Closed list").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("leaves Return alone with Shift or Option held, while an input method composes, or when the app took it", async () => {
    const start = vi.fn();
    await render(<Dialog start={start} />);
    const to = field("To");
    to.focus();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    to.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    to.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, keyCode: 229 }));
    to.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("a");
    expect(start).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Return while it is disabled or loading", async () => {
    const start = vi.fn();
    const host = await render(<Dialog start={start} disabled />);
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    await act(async () => roots[0]!.render(<Dialog start={start} loading />));
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).not.toHaveBeenCalled();
    await act(async () => roots[0]!.render(<Dialog start={start} />));
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-default]")).not.toBeNull();
  });

  it("answers only Return pressed inside its own dialog, and stops listening once it goes", async () => {
    const start = vi.fn();
    const page = (withDefault: boolean) => (
      <>
        <input aria-label="Outside" />
        <div role="dialog" aria-label="New chat">
          <input aria-label="To" />
          {withDefault && (
            <Button default onClick={start}>
              Start chat
            </Button>
          )}
        </div>
      </>
    );
    await render(page(true));
    field("Outside").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).not.toHaveBeenCalled();
    await act(async () => roots[0]!.render(page(false)));
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).not.toHaveBeenCalled();
  });

  it("takes Return without an onClick, so the key does nothing else in the dialog", async () => {
    await render(<Dialog />);
    const seen: KeyboardEvent[] = [];
    document.addEventListener("keydown", (event) => seen.push(event), { once: true });
    field("To").focus();
    await userEvent.keyboard("{Enter}");
    expect(seen[0]!.defaultPrevented).toBe(true);
  });

  it("sends its form once as a submit button, and calls onClick alone without a form", async () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const start = vi.fn();
    await render(
      <div role="dialog" aria-label="Rename">
        <form id="rename" onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
          <input aria-label="Name" />
        </form>
        <input aria-label="Elsewhere" />
        <Button default type="submit" form="rename" onClick={start}>
          Rename
        </Button>
      </div>,
    );
    field("Name").focus();
    await userEvent.keyboard("{Enter}");
    field("Elsewhere").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]![0].submitter).toBe(document.querySelector("[data-default]"));
    await act(async () => roots[0]!.render(
      <div role="dialog" aria-label="Rename">
        <input aria-label="Name" />
        <Button default type="submit" onClick={start}>
          Rename
        </Button>
      </div>,
    ));
    field("Name").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("leaves a form alone as a plain button, and is never a link's", async () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const start = vi.fn();
    await render(
      <div role="dialog" aria-label="Find">
        <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
          <input aria-label="Name" />
          <Button default onClick={start}>
            Find
          </Button>
        </form>
        <Button href="/help" {...({ default: true } as object)}>
          Help
        </Button>
      </div>,
    );
    field("Name").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelector("a")!.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("keeps an app's own aria-keyshortcuts on a button that is not the default", async () => {
    await render(<Button aria-keyshortcuts="Control+S">Save</Button>);
    expect(document.querySelector("button")!.getAttribute("aria-keyshortcuts")).toBe("Control+S");
  });

  it("does nothing outside a dialog, where Return belongs to the page", async () => {
    const start = vi.fn();
    await render(
      <div>
        <input aria-label="Search" />
        <Button default onClick={start}>
          Search
        </Button>
      </div>,
    );
    field("Search").focus();
    await userEvent.keyboard("{Enter}");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("Button ref", () => {
  it("reaches the button as an object ref, a callback ref and a callback ref with its own cleanup, and lets go on unmount", async () => {
    const object = { current: null as HTMLButtonElement | null };
    const callback = vi.fn();
    const cleanup = vi.fn();
    const withCleanup = vi.fn(() => cleanup);
    await render(
      <>
        <Button ref={object}>One</Button>
        <Button ref={callback}>Two</Button>
        <Button ref={withCleanup}>Three</Button>
      </>,
    );
    const [one, two, three] = [...document.querySelectorAll("button")];
    expect(object.current).toBe(one);
    expect(callback).toHaveBeenLastCalledWith(two);
    expect(withCleanup).toHaveBeenLastCalledWith(three);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(object.current).toBeNull();
    expect(callback).toHaveBeenLastCalledWith(null);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
