import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTestRoutesStub } from "../../utils";
import { SpoonDialog } from "../../../app/components/recipe/SpoonDialog";

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

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("SpoonDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders fields for photo, note, nextTime, cookedAt", async () => {
    renderDialog();
    expect(await screen.findByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/next time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/photo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cooked at/i)).toBeInTheDocument();
  });

  it("disables submit until at least one of {photo, note, nextTime} is non-empty", async () => {
    renderDialog();
    const submit = await screen.findByRole("button", { name: /save spoon/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/note/i), "tasted great");
    expect(submit).not.toBeDisabled();
  });

  it("enables submit when only nextTime is filled", async () => {
    renderDialog();
    const submit = await screen.findByRole("button", { name: /save spoon/i });
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

  it("clears the photo error when the user removes the selected file", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText(/photo/i)) as HTMLInputElement;
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(fileInput, makeFile("a.svg", "image/svg+xml"));
    expect(await screen.findByText(/jpg, png, gif, or webp/i)).toBeInTheDocument();
    await user.upload(fileInput, []);
    await waitFor(() => {
      expect(screen.queryByText(/jpg, png, gif, or webp/i)).toBeNull();
    });
  });

  it("when isOriginCookCandidate=true shows a photo-required hint and disables submit until photo is provided", async () => {
    renderDialog({ isOriginCookCandidate: true });
    expect(await screen.findByText(/photo required/i)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /save spoon/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/note/i), "ignored without photo");
    expect(submit).toBeDisabled();

    const fileInput = screen.getByLabelText(/photo/i) as HTMLInputElement;
    await userEvent.upload(fileInput, makeFile("a.png", "image/png"));
    expect(submit).not.toBeDisabled();
  });

  it("rejects MIME types not in RECIPE_IMAGE_TYPES with an inline error", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText(/photo/i)) as HTMLInputElement;
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(fileInput, makeFile("a.svg", "image/svg+xml"));
    expect(await screen.findByText(/jpg, png, gif, or webp/i)).toBeInTheDocument();
  });

  it("rejects files >5MB with an inline error", async () => {
    renderDialog();
    const fileInput = (await screen.findByLabelText(/photo/i)) as HTMLInputElement;
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      fileInput,
      makeFile("big.png", "image/png", 6 * 1024 * 1024),
    );
    expect(await screen.findByText(/5\s*mb/i)).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /save spoon/i }));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.get("intent")).toBe("createSpoon");
    expect(captured!.get("note")).toBe("tasted ok");
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
    renderDialog({ errorMessage: "Server said no" });
    expect(await screen.findByText("Server said no")).toBeInTheDocument();
  });
});
