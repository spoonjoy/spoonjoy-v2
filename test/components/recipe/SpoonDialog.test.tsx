import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTestRoutesStub } from "../../utils";
import { SpoonDialog } from "../../../app/components/recipe/SpoonDialog";
import { withTimeZone } from "../../helpers/timezone";

function renderDialog(props: Partial<React.ComponentProps<typeof SpoonDialog>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () => (
        <SpoonDialog
          isOpen={true}
          onClose={onClose}
          actionUrl="/recipes/r1"
          isOriginCookCandidate={false}
          {...props}
        />
      ),
    },
  ]);
  return { onClose, ...render(<Stub />) };
}

// HX FileField writes the files it keeps back into its input, which user-event's upload stub
// does not allow, so choose the file the way the system picker does: set the input's files and
// fire change.
function chooseFile(input: HTMLInputElement, file: File) {
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  fireEvent.change(input);
}

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("SpoonDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the real form and submit owner when the released dialog presents as a phone sheet", async () => {
    const original = window.matchMedia.bind(window);
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = original(query);
      if (query === "(min-width: 640px)") Object.defineProperty(result, "matches", { value: false });
      return result;
    });
    try {
      renderDialog();
      const dialog = await screen.findByRole("dialog", { name: "Log a cook" });
      expect(dialog).toHaveAttribute("data-ouro-presentation", "sheet");
      const note = screen.getByLabelText(/note/i) as HTMLTextAreaElement;
      await userEvent.type(note, "Keep this actual cook note");
      const submit = screen.getByRole("button", { name: "Log cook", exact: true }) as HTMLButtonElement;
      expect(submit).not.toBeDisabled();
      expect(submit.form).toBe(note.form);
      expect(note.form).not.toBeNull();
    } finally {
      media.mockRestore();
    }
  });

  it("renders fields for photo, note, nextTime, cookedAt", async () => {
    renderDialog();
    expect(await screen.findByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/next time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/photo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cooked at/i)).toBeInTheDocument();
  });

  it("takes one JPG, PNG or WebP photo through HX FileField", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText("Photo")) as HTMLInputElement;
    expect(fileInput).toHaveAttribute("type", "file");
    expect(fileInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(fileInput).not.toHaveAttribute("multiple");
    expect(fileInput).toHaveAccessibleDescription(/JPG, PNG, or WebP\. 5 MB max\./);
  });

  it("lists the chosen photo, and forgets it when it is removed", async () => {
    renderDialog({ coverPromptMode: "optional-update" });
    const fileInput = (await screen.findByLabelText("Photo")) as HTMLInputElement;
    chooseFile(fileInput, makeFile("spoon-night.png", "image/png"));
    expect(await screen.findByText("spoon-night.png")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /use this photo as recipe cover/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove spoon-night.png" }));
    expect(screen.queryByText("spoon-night.png")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /use this photo as recipe cover/i })).toBeNull();
  });

  it("disables submit until at least one of {photo, note, nextTime} is non-empty", async () => {
    renderDialog();
    const submit = await screen.findByRole("button", { name: /^log cook$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/note/i), "tasted great");
    expect(submit).not.toBeDisabled();
  });

  it("enables submit when only nextTime is filled", async () => {
    renderDialog();
    const submit = await screen.findByRole("button", { name: /^log cook$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/next time/i), "more salt");
    expect(submit).not.toBeDisabled();
  });

  it("updates the cookedAt input value on change", async () => {
    renderDialog();
    const input = (await screen.findByLabelText(/cooked at/i)) as HTMLInputElement;
    await userEvent.type(input, "2025-06-01T12:00");
    expect(input.value).toBe("2025-06-01T12:00");
  });

  it("shows the first-chef cover prompt without requiring a photo", async () => {
    renderDialog({ isOriginCookCandidate: true, coverPromptMode: "first-photo" });
    expect(await screen.findByText("Add a photo to create the recipe cover")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /^log cook$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/note/i), "first cook, no photo");
    expect(submit).not.toBeDisabled();

    const fileInput = screen.getByLabelText(/photo/i) as HTMLInputElement;
    chooseFile(fileInput, makeFile("a.png", "image/png"));
    expect(submit).not.toBeDisabled();
  });

  it("shows an owner cover opt-in checkbox when a later spoon photo is selected", async () => {
    renderDialog({ coverPromptMode: "optional-update" });
    expect(screen.queryByRole("checkbox", { name: /use this photo as recipe cover/i })).toBeNull();

    const fileInput = (await screen.findByLabelText(/photo/i)) as HTMLInputElement;
    chooseFile(fileInput, makeFile("spoon-cover.png", "image/png"));

    const checkbox = screen.getByRole("checkbox", { name: /use this photo as recipe cover/i });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("does not show recipe-cover controls for non-owner spoon posts", async () => {
    renderDialog({ coverPromptMode: "none" });
    expect(await screen.findByLabelText(/photo/i)).toBeInTheDocument();
    expect(screen.queryByText("Add a photo to create the recipe cover")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /recipe cover/i })).toBeNull();
  });

  it("leaves out a photo that is not JPG, PNG or WebP, and says why", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText("Photo")) as HTMLInputElement;
    chooseFile(fileInput, makeFile("animated.gif", "image/gif"));
    expect(await screen.findByText("Photos must be JPG, PNG, or WebP.")).toBeInTheDocument();
    expect(screen.queryByText("animated.gif")).toBeNull();
    expect(screen.getByRole("button", { name: /^log cook$/i })).toBeDisabled();
  });

  it("leaves out a photo larger than 5 MB, and says why", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText("Photo")) as HTMLInputElement;
    chooseFile(fileInput, makeFile("big.png", "image/png", 6 * 1024 * 1024));
    expect(await screen.findByText(/5\s*MB/i, { selector: "[role=status] *, [role=status]" })).toBeInTheDocument();
    expect(screen.queryByText("big.png")).toBeNull();
  });

  it("submits a multipart form with intent=createSpoon and the entered fields", async () => {
    const onClose = vi.fn();
    let captured: FormData | null = null;
    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: () => (
          <SpoonDialog
            isOpen={true}
            onClose={onClose}
            actionUrl="/recipes/r1"
            isOriginCookCandidate={false}
            coverPromptMode="optional-update"
          />
        ),
      },
      {
        path: "/recipes/r1",
        async action({ request }) {
          captured = await request.formData();
          return null;
        },
        Component: () => <div data-testid="redirected" />,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await userEvent.type(await screen.findByLabelText(/note/i), "tasted ok");
    chooseFile(screen.getByLabelText("Photo") as HTMLInputElement, makeFile("cover.png", "image/png"));
    await userEvent.click(screen.getByRole("checkbox", { name: /use this photo as recipe cover/i }));
    await userEvent.click(screen.getByRole("button", { name: /^log cook$/i }));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.get("intent")).toBe("createSpoon");
    expect(captured!.get("note")).toBe("tasted ok");
    expect(captured!.get("useAsRecipeCover")).toBe("true");
  });

  async function submitCookedAt(typed: string | null): Promise<FormData> {
    let captured: FormData | null = null;
    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: () => (
          <SpoonDialog isOpen={true} onClose={vi.fn()} actionUrl="/recipes/r1" isOriginCookCandidate={false} />
        ),
      },
      {
        path: "/recipes/r1",
        async action({ request }) {
          captured = await request.formData();
          return null;
        },
        Component: () => <div data-testid="redirected" />,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await userEvent.type(await screen.findByLabelText(/note/i), "tasted ok");
    if (typed !== null) {
      await userEvent.type(screen.getByLabelText(/cooked at/i), typed);
    }
    await userEvent.click(screen.getByRole("button", { name: /^log cook$/i }));
    await waitFor(() => expect(captured).not.toBeNull());
    return captured!;
  }

  it("sends Cooked at as the instant the cook meant in their own timezone, not a bare wall-clock time", async () => {
    const captured = await withTimeZone("America/Los_Angeles", () => submitCookedAt("2026-09-26T07:30"));
    expect(captured.getAll("cookedAt")).toEqual(["2026-09-26T14:30:00.000Z"]);
  });

  it("sends no Cooked at when none is chosen, so the server uses the time of posting", async () => {
    const captured = await submitCookedAt(null);
    // Absent or empty: the server treats both as "now".
    expect(captured.get("cookedAt") || null).toBeNull();
  });

  it("locks the form and ignores duplicate submits while a photo is uploading", async () => {
    let submissions = 0;
    let resolveAction!: () => void;
    const actionPromise = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });

    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: () => (
          <SpoonDialog
            isOpen={true}
            onClose={vi.fn()}
            actionUrl="/recipes/r1"
            isOriginCookCandidate={false}
          />
        ),
      },
      {
        path: "/recipes/r1",
        async action({ request }) {
          submissions += 1;
          await request.formData();
          await actionPromise;
          return null;
        },
        Component: () => <div data-testid="spoon-submit-complete" />,
      },
    ]);

    render(<Stub initialEntries={["/"]} />);
    const fileInput = (await screen.findByLabelText(/photo/i)) as HTMLInputElement;
    chooseFile(fileInput, makeFile("cook.png", "image/png"));

    const submit = screen.getByRole("button", { name: /^log cook$/i });
    const form = submit.closest("form");
    await userEvent.click(submit);

    await waitFor(() => {
      expect(submissions).toBe(1);
    });
    expect(screen.getByRole("button", { name: /uploading photo/i })).toBeDisabled();
    expect(screen.getAllByRole("status").some((status) => /uploading photo/i.test(status.textContent ?? ""))).toBe(true);

    fireEvent.submit(form!);
    expect(submissions).toBe(1);

    resolveAction();
    await waitFor(() => {
      expect(screen.getByTestId("spoon-submit-complete")).toBeInTheDocument();
    });
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await userEvent.click(
      await screen.findByRole("button", { name: /cancel/i }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when isOpen=false", () => {
    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: () => (
          <SpoonDialog
            isOpen={false}
            onClose={vi.fn()}
            actionUrl="/recipes/r1"
            isOriginCookCandidate={false}
          />
        ),
      },
    ]);
    render(<Stub />);
    expect(screen.queryByLabelText(/note/i)).toBeNull();
  });

  it("shows the server-error message when actionData.error is provided", async () => {
    renderDialog({ errors: { form: "Server said no" } });
    expect(await screen.findByText("Server said no")).toBeInTheDocument();
  });

  it("sends one cook token per opening, so a resubmit of the same cook logs it once", async () => {
    const { rerender } = renderDialog();
    const token = () => (document.querySelector("input[name='spoonToken']") as HTMLInputElement).value;
    await waitFor(() => expect(token()).toMatch(/^[0-9a-f-]{36}$/));
    const first = token();

    const Closed = createTestRoutesStub([
      { path: "/", Component: () => <SpoonDialog isOpen={false} onClose={vi.fn()} actionUrl="/recipes/r1" isOriginCookCandidate={false} /> },
    ]);
    rerender(<Closed />);
    const Reopened = createTestRoutesStub([
      { path: "/", Component: () => <SpoonDialog isOpen={true} onClose={vi.fn()} actionUrl="/recipes/r1" isOriginCookCandidate={false} /> },
    ]);
    rerender(<Reopened />);
    await waitFor(() => expect(token()).toMatch(/^[0-9a-f-]{36}$/));
    expect(token()).not.toBe(first);
  });
});
