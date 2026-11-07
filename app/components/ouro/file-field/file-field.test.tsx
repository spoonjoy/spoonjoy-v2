import { createRef, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Form } from "@base-ui/react/form";
import { FileField, type FileFieldProps } from "~/components/ouro/file-field/file-field";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

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
      return host.querySelector<HTMLElement>('[data-ouro="file-field"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>('input[type="file"]')!;
    },
    get zone() {
      return host.querySelector<HTMLElement>("[data-ouro-drop-zone]")!;
    },
    names() {
      return [...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent);
    },
  };
}

/** The ids an element's `aria-describedby` lists. */
const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

// A 1x1 PNG.
const png = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);
const image = (name = "photo.png") => new File([png], name, { type: "image/png" });
const text = (name = "notes.txt", size = 10) => new File(["x".repeat(size)], name, { type: "text/plain" });

const transfer = (files: File[]) => {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  return data;
};

/** Drops files on an element, as dragging them from the desktop does. */
async function drop(target: HTMLElement, files: File[]) {
  const data = transfer(files);
  await act(async () => {
    target.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
}

/** Chooses files in the input, as the system file picker does. */
async function choose(input: HTMLInputElement, files: File[]) {
  await act(async () => {
    input.files = transfer(files).files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

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

describe("FileField", () => {
  it("is a labeled native file input inside a drop zone, on the Field contract", async () => {
    const { root, input, zone } = await render(<FileField label="Recipe photo" name="photo" accept="image/*" />);
    expect(root.getAttribute("data-ouro")).toBe("file-field");
    expect(input.labels![0]!.textContent).toBe("Recipe photo");
    expect(input.name).toBe("photo");
    expect(input.accept).toBe("image/*");
    expect(zone.contains(input)).toBe(true);
    expect(zone.textContent).toContain("Drag a file here, or choose one");
  });

  it("takes chosen files and lists them, with a preview for images", async () => {
    const onFilesChange = vi.fn();
    const { host, input, names } = await render(<FileField label="Photo" onFilesChange={onFilesChange} />);
    expect(names()).toEqual([]);
    await choose(input, [image()]);
    expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: "photo.png" })]);
    expect([...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent)).toEqual(["photo.png"]);
    const preview = host.querySelector<HTMLImageElement>("img")!;
    expect(preview.src).toMatch(/^blob:/);
    expect(preview.alt).toBe("");
    await expect.poll(() => preview.complete && preview.naturalWidth).toBe(1);
  });

  it("takes dropped files and puts them in the input, so the form submits them", async () => {
    let submitted: File[] = [];
    const { host, zone } = await render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = new FormData(event.currentTarget).getAll("attachments") as File[];
        }}
      >
        <FileField label="Attachments" name="attachments" multiple />
        <button type="submit">Send</button>
      </form>,
    );
    await drop(zone, [text("a.txt"), text("b.txt")]);
    expect([...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent)).toEqual(["a.txt", "b.txt"]);
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(submitted.map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("highlights the zone while files are dragged over it", async () => {
    const { zone } = await render(<FileField label="Photo" />);
    const data = transfer([image()]);
    await act(async () => {
      zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    expect(zone.hasAttribute("data-dragging")).toBe(true);
    await act(async () => {
      zone.dispatchEvent(new DragEvent("dragleave", { dataTransfer: data, bubbles: true, relatedTarget: document.body }));
    });
    expect(zone.hasAttribute("data-dragging")).toBe(false);
  });

  it("keeps the highlight while the drag moves over the zone's own children", async () => {
    const { zone } = await render(<FileField label="Photo" />);
    const data = transfer([image()]);
    await act(async () => {
      zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent("dragleave", { dataTransfer: data, bubbles: true, relatedTarget: zone.firstElementChild }));
    });
    expect(zone.hasAttribute("data-dragging")).toBe(true);
  });

  it("adds files to the list with multiple, and replaces the file without it", async () => {
    const { input, rerender, host } = await render(<FileField label="Files" multiple />);
    await choose(input, [text("a.txt")]);
    await choose(input, [text("b.txt"), text("a.txt")]);
    const names = () => [...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent);
    expect(names()).toEqual(["a.txt", "b.txt"]);
    expect([...input.files!].map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
    await rerender(<FileField label="Files" />);
    await choose(input, [text("c.txt")]);
    expect(names()).toEqual(["c.txt"]);
  });

  it("rejects files that do not match accept or exceed maxSize, and reports them", async () => {
    const onReject = vi.fn();
    const onFilesChange = vi.fn();
    const { input, zone, host } = await render(
      <FileField label="Files" multiple accept=".txt,image/*" maxSize={80} onReject={onReject} onFilesChange={onFilesChange} />,
    );
    const pdf = new File(["%PDF"], "doc.pdf", { type: "application/pdf" });
    const big = text("big.txt", 100);
    await drop(zone, [text("ok.TXT"), pdf, big, image()]);
    expect([...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent)).toEqual(["ok.TXT", "photo.png"]);
    expect(onReject).toHaveBeenLastCalledWith([
      { file: pdf, reason: "type" },
      { file: big, reason: "size" },
    ]);
    expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: "ok.TXT" }), expect.objectContaining({ name: "photo.png" })]);
    // A file the picker let through anyway is taken out of the input too.
    await choose(input, [big]);
    expect([...input.files!].map((file) => file.name)).toEqual(["ok.TXT", "photo.png"]);
    expect(onReject).toHaveBeenLastCalledWith([{ file: big, reason: "size" }]);
  });

  it("matches exact MIME types", async () => {
    const onReject = vi.fn();
    const { zone, names } = await render(<FileField label="Photo" accept="image/png" onReject={onReject} />);
    await drop(zone, [new File(["x"], "a.jpg", { type: "image/jpeg" })]);
    expect(onReject).toHaveBeenCalledWith([expect.objectContaining({ reason: "type" })]);
    expect(names()).toEqual([]);
  });

  it("takes only the first of several dropped files without multiple", async () => {
    const onReject = vi.fn();
    const { zone, host } = await render(<FileField label="Photo" onReject={onReject} />);
    const second = text("b.txt");
    await drop(zone, [text("a.txt"), second]);
    expect([...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent)).toEqual(["a.txt"]);
    expect(onReject).toHaveBeenCalledWith([{ file: second, reason: "count" }]);
  });

  describe("says why a file was left out, under the field", () => {
    /** The messages the input points at, in order: each list item of a list, or the element's text. */
    const messages = (host: HTMLElement, input: HTMLInputElement) =>
      describedBy(input).flatMap((id) => {
        const element = host.querySelector(`#${CSS.escape(id)}`)!;
        const items = [...element.querySelectorAll("li")];
        return items.length > 0 ? items.map((item) => item.textContent) : [element.textContent];
      });

    it("for a file that does not match accept", async () => {
      const onReject = vi.fn();
      const { host, input, zone } = await render(<FileField label="Photo" accept="image/*" onReject={onReject} />);
      const notes = text("notes.txt");
      await drop(zone, [notes]);
      expect(messages(host, input)).toEqual(["notes.txt is not an accepted file type."]);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(onReject).toHaveBeenCalledWith([{ file: notes, reason: "type" }]);
    });

    it("for a file larger than maxSize, naming the limit", async () => {
      const onReject = vi.fn();
      const { host, input, zone } = await render(<FileField label="Photo" maxSize={5 * 1024 * 1024} onReject={onReject} />);
      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
      await drop(zone, [big]);
      expect(messages(host, input)).toEqual(["big.png is larger than 5 MB."]);
      expect(onReject).toHaveBeenCalledWith([{ file: big, reason: "size" }]);
    });

    it("for a second file without multiple", async () => {
      const onReject = vi.fn();
      const { host, input, zone } = await render(<FileField label="Photo" onReject={onReject} />);
      const second = text("b.txt");
      await drop(zone, [text("a.txt"), second]);
      expect(messages(host, input)).toEqual(["Only one file can be added, so b.txt was left out."]);
      expect(onReject).toHaveBeenCalledWith([{ file: second, reason: "count" }]);
    });

    it("next to the app's own error, in rejectMessage's words, until the next choice takes every file", async () => {
      const { host, input, zone } = await render(
        <FileField
          label="Photo"
          accept="image/*"
          error="Choose a photo."
          rejectMessage={(rejection) => `${rejection.file.name}: ${rejection.reason}`}
        />,
      );
      await drop(zone, [text("notes.txt")]);
      expect(messages(host, input)).toEqual(["Choose a photo.", "notes.txt: type"]);
      await drop(zone, [image()]);
      expect(messages(host, input)).toEqual(["Choose a photo."]);
    });

    it("in a polite status region, mounted before the rejection and emptied by the next valid pick", async () => {
      const { root, input } = await render(<FileField label="Photo" accept="image/*" error="Choose a photo." />);
      // One live region, there from the first render, so the message is announced once: the
      // field's own error is not live.
      const live = root.querySelectorAll('[role="status"], [role="alert"], [role="log"], [aria-live]');
      expect(live).toHaveLength(1);
      const status = live[0]!;
      expect(status.getAttribute("role")).toBe("status");
      expect(status.textContent).toBe("");
      await choose(input, [text("notes.txt")]);
      expect(root.querySelector('[role="status"]')).toBe(status);
      expect(status.textContent).toBe("notes.txt is not an accepted file type.");
      // It shows where the field's errors show: under the field, in the error style.
      expect(getComputedStyle(status).position).not.toBe("absolute");
      const appError = [...root.querySelectorAll("div")].find((element) => element.textContent === "Choose a photo.")!;
      expect(getComputedStyle(status).color).toBe(getComputedStyle(appError).color);
      await choose(input, [image()]);
      expect(root.querySelector('[role="status"]')).toBe(status);
      expect(status.textContent).toBe("");
      expect(getComputedStyle(status).position).toBe("absolute");
    });

    it("next to a Form's error for its name, which it does not hide", async () => {
      const { host, input, zone } = await render(
        <Form errors={{ photo: "Server says no." }}>
          <FileField label="Photo" name="photo" accept="image/*" />
        </Form>,
      );
      expect(host.textContent).toContain("Server says no.");
      await drop(zone, [text("notes.txt")]);
      expect(host.textContent).toContain("Server says no.");
      expect(host.textContent).toContain("notes.txt is not an accepted file type.");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });

    it("and drops the message when a file is removed or the form resets", async () => {
      const { host, input, zone } = await render(
        <form>
          <FileField label="Files" multiple accept="image/*" />
          <button type="reset">Reset</button>
        </form>,
      );
      await drop(zone, [image("a.png"), text("notes.txt")]);
      expect(messages(host, input)).toEqual(["notes.txt is not an accepted file type."]);
      await userEvent.click(page.getByRole("button", { name: "Remove a.png" }).element() as HTMLButtonElement);
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      await drop(zone, [text("notes.txt")]);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="reset"]')!);
      await expect.poll(() => input.hasAttribute("aria-invalid")).toBe(false);
    });
  });

  it("releases each preview's object URL when its file is removed, and the rest when it unmounts", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { host, zone } = await render(<FileField label="Photos" multiple />);
    await drop(zone, [image("a.png"), image("b.png")]);
    const [a, b] = [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(a).toMatch(/^blob:/);
    expect(b).toMatch(/^blob:/);
    await userEvent.click(page.getByRole("button", { name: "Remove a.png" }).element() as HTMLButtonElement);
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([a]);
    await act(async () => roots.pop()!.unmount());
    expect(revoke.mock.calls.map(([url]) => url)).toEqual([a, b]);
  });

  it("is not left invalid by a blocked submit once a file is dropped", async () => {
    const { host, input, zone } = await render(
      <form onSubmit={(event) => event.preventDefault()}>
        <FileField label="Photo" name="photo" required />
        <button type="submit">Send</button>
      </form>,
    );
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(input.validity.valueMissing).toBe(true);
    await drop(zone, [image()]);
    expect(input.validity.valid).toBe(true);
    await expect.poll(() => input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("removes a file with its button, and focus goes back to the input", async () => {
    const onFilesChange = vi.fn();
    const { input, zone, host } = await render(<FileField label="Files" multiple onFilesChange={onFilesChange} />);
    await drop(zone, [text("a.txt"), text("b.txt")]);
    const remove = page.getByRole("button", { name: "Remove a.txt" }).element() as HTMLButtonElement;
    expect(remove.type).toBe("button");
    await userEvent.click(remove);
    expect([...host.querySelectorAll("[data-ouro-file-name]")].map((name) => name.textContent)).toEqual(["b.txt"]);
    expect([...input.files!].map((file) => file.name)).toEqual(["b.txt"]);
    expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: "b.txt" })]);
    expect(document.activeElement).toBe(input);
  });

  it("leaves a loose label lookup for the field on the input, not on a file's remove button", async () => {
    const { input, host } = await render(<FileField label="Photo" />);
    await choose(input, [text("photo.jpg")]);
    // An aria-label is label text to Playwright's getByLabel, so "Remove photo.jpg" would match "Photo".
    expect(page.getByLabelText("Photo", { exact: false }).elements()).toEqual([input]);
    const remove = page.getByRole("button", { name: "Remove photo.jpg", exact: true });
    await expect.element(remove).toBeVisible();
    expect(remove.element().hasAttribute("aria-label")).toBe(false);
    expect(host.querySelector("[data-ouro-file-remove]")).toBe(remove.element());
  });

  it("names the remove buttons and the prompt with removeLabel and prompt", async () => {
    const { input, zone } = await render(<FileField label="Dateien" multiple prompt="Dateien hierher ziehen" removeLabel="Entfernen" />);
    expect(zone.textContent).toContain("Dateien hierher ziehen");
    await choose(input, [text("a.txt")]);
    await expect.element(page.getByRole("button", { name: "Entfernen a.txt" })).toBeVisible();
  });

  /** Counts the clicks that reach the input (each opens the file picker), without opening it. */
  function countPicks(input: HTMLInputElement) {
    let picks = 0;
    input.addEventListener("click", (event) => {
      event.preventDefault();
      picks++;
    });
    return () => picks;
  }

  it("opens the file picker when the zone is pressed, anywhere in it", async () => {
    const { input, zone } = await render(<FileField label="Photo" />);
    const picks = countPicks(input);
    await userEvent.click(zone);
    await userEvent.click(zone.querySelector("svg")!);
    expect(picks()).toBe(2);
    // The zone labels the input, but the input's name stays the field's label.
    expect(document.getElementById(input.getAttribute("aria-labelledby")!)!.textContent).toBe("Photo");
  });

  it("does nothing when disabled", async () => {
    const onFilesChange = vi.fn();
    const { input, zone, names } = await render(<FileField label="Photo" disabled onFilesChange={onFilesChange} />);
    expect(input.disabled).toBe(true);
    const picks = countPicks(input);
    await userEvent.click(zone, { force: true });
    expect(picks()).toBe(0);
    await drop(zone, [image()]);
    expect(onFilesChange).not.toHaveBeenCalled();
    expect(names()).toEqual([]);
    expect(getComputedStyle(zone).opacity).toBe("0.5");
  });

  it("empties the list when the form resets", async () => {
    const { host, input } = await render(
      <form>
        <FileField label="Photo" />
        <button type="reset">Reset</button>
      </form>,
    );
    await choose(input, [image()]);
    expect(host.querySelectorAll("[data-ouro-file-name]")).toHaveLength(1);
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="reset"]')!);
    await expect.poll(() => host.querySelectorAll("[data-ouro-file-name]").length).toBe(0);
  });

  it("shows each file's size", async () => {
    const { input, host } = await render(<FileField label="File" />);
    await choose(input, [text("a.txt", 2048)]);
    expect(host.querySelector("[data-ouro-file-size]")!.textContent).toMatch(/2(\.0)?\s?kB/);
  });

  it("wires description, error, required and disabled through Field", async () => {
    const { host, input, rerender } = await render(
      <FileField label="Photo" description="PNG or JPG, up to 5 MB." error="Choose a photo." required />,
    );
    expect(describedBy(input).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual([
      "PNG or JPG, up to 5 MB.",
      "Choose a photo.",
    ]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.required).toBe(true);
    await rerender(<FileField label="Photo" disabled />);
    expect(input.disabled).toBe(true);
  });

  it("outlines the zone while the input has keyboard focus", async () => {
    const { zone } = await render(<FileField label="Photo" />);
    document.body.focus();
    await pressTab();
    await expect.poll(() => getComputedStyle(zone).outlineStyle).toBe("solid");
  });

  it("forwards its ref to the input and lets layout classes win on the root", async () => {
    const ref = createRef<HTMLInputElement>();
    const { input, root } = await render(<FileField label="Photo" ref={ref} className="mt-6" capture="environment" />);
    expect(ref.current).toBe(input);
    expect(input.getAttribute("capture")).toBe("environment");
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });

  it("is at least 44px tall on phones", async () => {
    await page.viewport(390, 844);
    const { zone } = await render(<FileField label="Photo" />);
    expect(zone.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});

describe("FileField development messages", () => {
  it.each([
    ["maxFileSize", { maxFileSize: 100 }, "maxFileSize is not a prop", "<FileField maxSize={100}>"],
    ["acceptedFileTypes", { acceptedFileTypes: ["image/png"] }, "acceptedFileTypes is not a prop", '<FileField accept="image/png">'],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<FileField onFilesChange={(files) => …}>"],
    ["onDrop", { onDrop: () => {} }, "onDrop is not a prop; dropped files arrive in onFilesChange", "<FileField onFilesChange={(files) => …}>"],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<FileField description="Hint">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<FileField required>"],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Files", ...extra } as unknown as FileFieldProps;
    const { host } = await render(<FileField {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] FileField: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("warns for an accept entry that is neither an extension nor a type", async () => {
    await render(<FileField label="Files" accept="pdf, .txt" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] FileField: accept lists "pdf", which is neither an extension nor a type. Fix: <FileField accept=".pdf, .txt">.');
  });

  it("warns for a maxSize that is not a positive number of bytes", async () => {
    await render(<FileField label="Files" maxSize={0} />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] FileField: maxSize={0} is not a positive number of bytes. Fix: <FileField maxSize={5 * 1024 * 1024}>.");
  });

  it("warns for a maxSize that reads as megabytes", async () => {
    await render(<FileField label="Files" maxSize={5} />);
    expect(warn).toHaveBeenCalledWith(
      "[ouro-ui] FileField: maxSize={5} is 5 bytes; maxSize counts bytes. Fix: <FileField maxSize={5 * 1024 * 1024}> for 5 MB.",
    );
  });

  it("names FileField in Field's messages", async () => {
    await render(<FileField label="" className="border-red-500" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] FileField: "border-red-500" sets appearance, and className is for layout only. Fix: <FileField error="What is wrong">.',
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] FileField: label is empty, so the control has no name. Fix: <FileField label="Email" hideLabel> to hide a label you still need.',
    );
  });

  it("says nothing for a full, valid field", async () => {
    await render(
      <FileField
        label="Photos"
        name="photos"
        multiple
        accept="image/*,.heic"
        maxSize={5 * 1024 * 1024}
        required
        description="Up to 5 MB each."
        error="Add a photo."
        hideLabel
        className="mt-2"
      />,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("FileField server rendering", () => {
  const node = <FileField label="Photo" name="photo" accept="image/*" description="Up to 5 MB." error="Choose a photo." />;

  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const input = doc.querySelector('input[type="file"]')!;
    expect(doc.querySelector(`label[for="${input.id}"]`)!.textContent).toContain("Photo");
    expect(describedBy(input).map((id) => doc.getElementById(id)!.textContent)).toEqual(["Up to 5 MB.", "Choose a photo."]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("*")].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
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
    await choose(host.querySelector('input[type="file"]')!, [image()]);
    expect(host.querySelectorAll("[data-ouro-file-name]")).toHaveLength(1);
  });
});

describe("FileField press feedback", () => {
  it("tints the drop zone while the pointer is down, and eases its border and tint with ease", async () => {
    const { host } = await render(<FileField label="Photos" />);
    const zone = host.querySelector<HTMLElement>("[data-ouro-drop-zone]")!;
    const rest = getComputedStyle(zone).backgroundColor;
    expect(getComputedStyle(zone).transitionTimingFunction).toBe("ease");
    await commands.pointerPress({ selector: "[data-ouro-drop-zone]", action: "down" });
    try {
      await expect.poll(() => getComputedStyle(zone).backgroundColor).not.toBe(rest);
    } finally {
      await commands.pointerPress({ action: "up" });
    }
  });
});
