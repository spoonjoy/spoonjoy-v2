import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestRoutesStub } from "../../utils";
import { RecipePhotoStudio } from "~/components/recipe/RecipePhotoStudio";

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function renderStudio(
  props: Partial<React.ComponentProps<typeof RecipePhotoStudio>> = {},
  onSubmit?: (formData: FormData) => void,
) {
  const Stub = createTestRoutesStub([
    {
      path: "/recipes/r1",
      Component: () => (
        <RecipePhotoStudio
          recipeTitle="Weeknight pasta"
          hasActiveCover={false}
          {...props}
        />
      ),
      action: async ({ request }) => {
        onSubmit?.(await request.formData());
        return { success: true };
      },
    },
  ]);
  return render(<Stub initialEntries={["/recipes/r1"]} />);
}

describe("RecipePhotoStudio", () => {
  it("defaults a missing-cover upload to a Spoon-backed editorial cover", async () => {
    const user = userEvent.setup();
    let captured: FormData | null = null;
    renderStudio({}, (formData) => {
      captured = formData;
    });

    expect(await screen.findByRole("heading", { name: "Photo studio" })).toBeInTheDocument();
    expect(screen.getByText("Add first photo")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Post as Spoon" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Editorialize cover" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();

    await user.upload(screen.getByLabelText("Recipe photo"), makeFile("finished-pasta.png", "image/png"));
    expect(screen.getByTestId("recipe-photo-picker")).toHaveTextContent("finished-pasta.png");

    await user.click(screen.getByRole("button", { name: "Spoon details" }));
    await user.type(screen.getByLabelText("Note"), "Ate this for Tuesday dinner.");
    await user.type(screen.getByLabelText("Next time"), "More lemon.");
    await user.type(screen.getByLabelText("Cooked at"), "2026-07-14T19:30");
    await user.type(screen.getByLabelText("Editorial direction"), "brighter window light");
    await user.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.get("intent")).toBe("createFirstPhotoCover");
    expect(captured!.get("postAsSpoon")).toBe("true");
    expect(captured!.get("generateEditorial")).toBe("true");
    expect(captured!.get("activateWhenReady")).toBe("true");
    expect(captured!.get("note")).toBe("Ate this for Tuesday dinner.");
    expect(captured!.get("nextTime")).toBe("More lemon.");
    expect(captured!.get("cookedAt")).toBe("2026-07-14T19:30");
    expect(captured!.get("promptAddition")).toBe("brighter window light");
    expect((captured!.get("photo") as File).name).toBe("finished-pasta.png");
  });

  it("hides Spoon fields when the photo should only become a cover", async () => {
    const user = userEvent.setup();
    let captured: FormData | null = null;
    renderStudio({ hasActiveCover: true }, (formData) => {
      captured = formData;
    });

    expect(await screen.findByText("Add cover photo")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Post as Spoon" }));

    expect(screen.queryByRole("button", { name: "Spoon details" })).toBeNull();
    await user.upload(screen.getByLabelText("Recipe photo"), makeFile("cover-only.png", "image/png"));
    await user.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.get("intent")).toBe("createFirstPhotoCover");
    expect(captured!.get("postAsSpoon")).toBeNull();
    expect(captured!.get("generateEditorial")).toBe("true");
    expect((captured!.get("photo") as File).name).toBe("cover-only.png");
  });

  it("shows when the active original cover is being editorialized", async () => {
    renderStudio({
      hasActiveCover: true,
      activeCoverProcessing: {
        coverId: "cover-processing",
        activeVariant: "image",
        targetVariant: "stylized",
        status: "processing",
        generationStatus: "processing",
      },
    });

    expect(await screen.findByRole("heading", { name: "Photo studio" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Editorializing cover");
  });

  it("blocks empty submits and rejects invalid photo files inline", async () => {
    const user = userEvent.setup({ applyAccept: false });
    let captured: FormData | null = null;
    renderStudio({}, (formData) => {
      captured = formData;
    });

    fireEvent.submit(await screen.findByTestId("recipe-photo-studio-form"));
    expect(captured).toBeNull();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();

    await user.upload(screen.getByLabelText("Recipe photo"), makeFile("photo.gif", "image/gif"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Photos must be JPG, PNG, or WebP.");
    expect(screen.getByTestId("recipe-photo-picker")).toHaveTextContent("No photo selected");
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();

    await user.upload(screen.getByLabelText("Recipe photo"), makeFile("huge.png", "image/png", 6 * 1024 * 1024));
    expect(await screen.findByRole("alert")).toHaveTextContent(/5\s*mb/i);
  });

  it("clears the selected photo when the picker is cancelled", async () => {
    const user = userEvent.setup();
    renderStudio();
    const input = await screen.findByLabelText("Recipe photo") as HTMLInputElement;
    await user.upload(input, makeFile("chosen.png", "image/png"));
    expect(screen.getByTestId("recipe-photo-picker")).toHaveTextContent("chosen.png");

    Object.defineProperty(input, "files", { value: [], configurable: true });
    fireEvent.change(input);

    expect(screen.getByTestId("recipe-photo-picker")).toHaveTextContent("No photo selected");
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
  });

  it("omits editorial fields when editorialization is off", async () => {
    const user = userEvent.setup();
    let captured: FormData | null = null;
    renderStudio({}, (formData) => {
      captured = formData;
    });

    await user.upload(await screen.findByLabelText("Recipe photo"), makeFile("verbatim.png", "image/png"));
    await user.click(screen.getByRole("checkbox", { name: "Editorialize cover" }));
    await user.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.get("generateEditorial")).toBeNull();
    expect(captured!.get("promptAddition")).toBeNull();
    expect((captured!.get("photo") as File).name).toBe("verbatim.png");
  });
});
