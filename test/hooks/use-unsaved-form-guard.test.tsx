import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useUnsavedFormGuard } from "~/hooks/use-unsaved-form-guard";

function Guarded({ children }: { children: React.ReactNode }) {
  useUnsavedFormGuard();
  return <>{children}</>;
}

function unload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

afterEach(cleanup);

describe("useUnsavedFormGuard", () => {
  it("lets the page unload when nothing was typed", () => {
    render(<Guarded><form method="post"><input name="title" /></form></Guarded>);
    expect(unload().defaultPrevented).toBe(false);
  });

  it("asks to confirm unloading while a post form holds unsubmitted input", () => {
    const { getByRole } = render(<Guarded><form method="post"><input name="title" /></form></Guarded>);
    fireEvent.input(getByRole("textbox"), { target: { value: "Shakshuka" } });
    const event = unload();
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");
  });

  it("counts a select change as unsaved input", () => {
    const { getByRole } = render(
      <Guarded><form method="post"><select name="unit"><option>g</option><option>kg</option></select></form></Guarded>,
    );
    fireEvent.change(getByRole("combobox"), { target: { value: "kg" } });
    expect(unload().defaultPrevented).toBe(true);
  });

  it("clears the warning once the form is submitted or reset", () => {
    const { getAllByRole, container } = render(
      <Guarded>
        <form method="post" data-testid="a"><input name="a" /></form>
        <form method="post" data-testid="b"><input name="b" /></form>
      </Guarded>,
    );
    const [a, b] = getAllByRole("textbox");
    const [formA, formB] = container.querySelectorAll("form");
    fireEvent.input(a, { target: { value: "1" } });
    fireEvent.input(b, { target: { value: "2" } });
    fireEvent.submit(formA);
    expect(unload().defaultPrevented).toBe(true);
    fireEvent.reset(formB);
    expect(unload().defaultPrevented).toBe(false);
  });

  it("forgets a dirty form that has left the page", () => {
    const { getByRole, rerender } = render(<Guarded><form method="post"><input name="title" /></form></Guarded>);
    fireEvent.input(getByRole("textbox"), { target: { value: "draft" } });
    rerender(<Guarded><p>next page</p></Guarded>);
    expect(unload().defaultPrevented).toBe(false);
  });

  it.each([
    ["a get form", <form method="get"><input name="q" /></form>],
    ["a form that opts out", <form method="post" data-unsaved-guard="off"><input name="q" /></form>],
    ["an input outside any form", <input name="q" />],
  ])("ignores %s", (_label, markup) => {
    const { getByRole } = render(<Guarded>{markup}</Guarded>);
    fireEvent.input(getByRole("textbox"), { target: { value: "x" } });
    expect(unload().defaultPrevented).toBe(false);
  });

  it("ignores input events that come from the document itself", () => {
    render(<Guarded><form method="post"><input name="title" /></form></Guarded>);
    document.dispatchEvent(new Event("input", { bubbles: true }));
    fireEvent.input(document.querySelector("form")!);
    expect(unload().defaultPrevented).toBe(true);
  });

  it("stops listening when unmounted", () => {
    const { getByRole, unmount } = render(<Guarded><form method="post"><input name="title" /></form></Guarded>);
    const input = getByRole("textbox");
    fireEvent.input(input, { target: { value: "draft" } });
    unmount();
    expect(unload().defaultPrevented).toBe(false);
  });
});
