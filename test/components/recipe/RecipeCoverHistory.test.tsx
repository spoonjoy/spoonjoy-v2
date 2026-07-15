import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestRoutesStub } from "../../utils";
import {
  RecipeCoverHistory,
  type RecipeCoverHistoryItem,
} from "~/components/recipe/RecipeCoverHistory";

const legacyChefPhotoLabel = ["Chef", "photo"].join(" ");
const legacySpoonjoyCookbookLabel = ["Spoonjoy", "cookbook"].join(" ");
const legacyCounterLabel = ["On", "the", "counter"].join(" ");
const legacyEditorializedChefPhotoLabel = ["Editorialized", "chef", "photo"].join(" ");

function renderHistory(
  covers: RecipeCoverHistoryItem[],
  onSubmit?: (formData: FormData) => void,
  spoonImages?: Array<{ id: string; photoUrl: string; cookedAt: string; chef: { username: string } }>,
) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () =>
        spoonImages === undefined ? (
          <RecipeCoverHistory covers={covers} />
        ) : (
          <RecipeCoverHistory covers={covers} spoonImages={spoonImages} />
        ),
      action: async ({ request }) => {
        onSubmit?.(await request.formData());
        return { success: true };
      },
    },
  ]);
  return render(<Stub />);
}

describe("RecipeCoverHistory", () => {
  it("renders an explicit empty history state", async () => {
    renderHistory([]);

    expect(await screen.findByRole("heading", { name: "Recipe covers" })).toBeInTheDocument();
    expect(screen.getByText("No cover selected")).toBeInTheDocument();
    expect(screen.getByText("No saved covers yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set no cover" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Spoon photos" })).toBeNull();
  });

  it("labels processing, editorial-failed, archived, invalid-date, and no-variant rows", async () => {
    renderHistory([
      {
        id: "processing-cover",
        status: "processing",
        generationStatus: "processing",
        sourceType: "spoon",
        createdAt: "not-a-date",
        isActive: false,
        activeVariant: null,
        variants: [],
      },
      {
        id: "failed-cover",
        status: "ready",
        generationStatus: "failed",
        sourceType: "spoon",
        createdAt: "2026-01-02T00:00:00.000Z",
        isActive: false,
        activeVariant: null,
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/failed-raw.jpg",
            provenanceLabel: legacyChefPhotoLabel,
            isActive: false,
          },
        ],
      },
      {
        id: "archived-cover",
        status: "archived",
        generationStatus: "succeeded",
        sourceType: "spoon",
        createdAt: "2026-01-03T00:00:00.000Z",
        isActive: false,
        activeVariant: null,
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/archived-raw.jpg",
            provenanceLabel: "Imported photo",
            isActive: false,
          },
        ],
      },
      {
        id: "archived-at-cover",
        status: "ready",
        generationStatus: "succeeded",
        sourceType: "spoon",
        archivedAt: "2026-01-04T00:00:00.000Z",
        createdAt: "2026-01-04T00:00:00.000Z",
        isActive: false,
        activeVariant: null,
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/archived-at-raw.jpg",
            provenanceLabel: legacyChefPhotoLabel,
            isActive: false,
          },
        ],
      },
      {
        id: "invalid-status-cover",
        status: "queued",
        generationStatus: "none",
        sourceType: "import",
        createdAt: "2026-01-05T00:00:00.000Z",
        isActive: false,
        activeVariant: null,
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/invalid-status.jpg",
            provenanceLabel: "Imported photo",
            isActive: false,
          },
        ],
      },
      {
        id: "failed-cover-row",
        status: "failed",
        generationStatus: "failed",
        sourceType: "spoon",
        createdAt: "2026-01-04T00:00:00.000Z",
        isActive: false,
        activeVariant: null,
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/failed-cover-row.jpg",
            provenanceLabel: legacyChefPhotoLabel,
            isActive: false,
          },
        ],
      },
    ]);

    expect(await screen.findByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Editorial failed")).toBeInTheDocument();
    expect(screen.getAllByText("Archived")).toHaveLength(2);
    expect(screen.getByText("Saved cover")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(5);
    expect(screen.getByText("No usable image variants.")).toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use Original photo cover" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Use Imported photo cover" })).toBeNull();
    expect(screen.queryByText(legacyChefPhotoLabel)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Regenerate with direction" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Archive cover" })).toHaveLength(3);
  });

  it("submits set-cover and no-cover forms", async () => {
    const submitted: Array<Record<string, string | null>> = [];
    const user = userEvent.setup();
    renderHistory(
      [
        {
          id: "cover-1",
          status: "ready",
          generationStatus: "succeeded",
          sourceType: "spoon",
          createdAt: "2026-01-01T00:00:00.000Z",
          isActive: true,
          activeVariant: "stylized",
          variants: [
            {
              variant: "image",
              imageUrl: "/photos/raw.jpg",
              provenanceLabel: legacyChefPhotoLabel,
              isActive: false,
            },
            {
              variant: "stylized",
              imageUrl: "/photos/editorial.jpg",
              provenanceLabel: legacyEditorializedChefPhotoLabel,
              isActive: true,
            },
          ],
        },
        {
          id: "cover-2",
          status: "ready",
          generationStatus: "none",
          sourceType: "import",
          createdAt: "2026-01-03T00:00:00.000Z",
          isActive: false,
          activeVariant: null,
          variants: [
            {
              variant: "image",
              imageUrl: "/photos/imported.jpg",
              provenanceLabel: "Imported photo",
              isActive: false,
            },
          ],
        },
      ],
      (formData) => {
        submitted.push({
          intent: formData.get("intent")?.toString() ?? null,
          coverId: formData.get("coverId")?.toString() ?? null,
          spoonId: formData.get("spoonId")?.toString() ?? null,
          variant: formData.get("variant")?.toString() ?? null,
          replacementCoverId: formData.get("replacementCoverId")?.toString() ?? null,
          replacementVariant: formData.get("replacementVariant")?.toString() ?? null,
          confirmNoCover: formData.get("confirmNoCover")?.toString() ?? null,
          activateWhenReady: formData.get("activateWhenReady")?.toString() ?? null,
          promptAddition: formData.get("promptAddition")?.toString() ?? null,
        });
      },
      [
        {
          id: "spoon-1",
          photoUrl: "/photos/spoon-source.jpg",
          cookedAt: "2026-01-02T00:00:00.000Z",
          chef: { username: "rowan" },
        },
      ],
    );

    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Active variant")).toBeInTheDocument();

    expect(screen.getByText("Original photo")).toBeInTheDocument();
    expect(screen.getByText("Editorial photo")).toBeInTheDocument();
    expect(screen.queryByText(legacyChefPhotoLabel)).toBeNull();
    expect(screen.queryByText(legacyEditorializedChefPhotoLabel)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Use Original photo cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "setRecipeCover",
        coverId: "cover-1",
        spoonId: null,
        variant: "image",
        replacementCoverId: null,
        replacementVariant: null,
        confirmNoCover: null,
        activateWhenReady: null,
        promptAddition: null,
      });
    });

    await user.click(screen.getByRole("button", { name: "Set no cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "setRecipeNoCover",
        coverId: null,
        spoonId: null,
        variant: null,
        replacementCoverId: null,
        replacementVariant: null,
        confirmNoCover: "true",
        activateWhenReady: null,
        promptAddition: null,
      });
    });

    expect(screen.getByRole("heading", { name: "Spoon photos" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editorialize spoon photo by rowan" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "createCoverFromSpoon",
        coverId: null,
        spoonId: "spoon-1",
        variant: null,
        replacementCoverId: null,
        replacementVariant: null,
        confirmNoCover: null,
        activateWhenReady: "true",
        promptAddition: "",
      });
    });

    await user.click(screen.getAllByRole("button", { name: "Regenerate with direction" })[0]);
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "regenerateRecipeCover",
        coverId: "cover-1",
        spoonId: null,
        variant: null,
        replacementCoverId: null,
        replacementVariant: null,
        confirmNoCover: null,
        activateWhenReady: "true",
        promptAddition: "",
      });
    });

    await user.click(screen.getByRole("button", { name: "Archive and use Imported photo Original cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "archiveRecipeCover",
        coverId: "cover-1",
        spoonId: null,
        variant: null,
        replacementCoverId: "cover-2",
        replacementVariant: "image",
        confirmNoCover: null,
        activateWhenReady: null,
        promptAddition: null,
      });
    });

    await user.click(screen.getByRole("button", { name: "Archive and set no cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "archiveRecipeCover",
        coverId: "cover-1",
        spoonId: null,
        variant: null,
        replacementCoverId: null,
        replacementVariant: null,
        confirmNoCover: "true",
        activateWhenReady: null,
        promptAddition: null,
      });
    });
  });

  it("submits AI placeholder, Spoon editorialization, and regeneration directions", async () => {
    const submitted: Array<Record<string, string | null>> = [];
    const user = userEvent.setup();
    renderHistory(
      [
        {
          id: "cover-1",
          status: "ready",
          generationStatus: "succeeded",
          sourceType: "spoon",
          createdAt: "2026-01-01T00:00:00.000Z",
          isActive: true,
          activeVariant: "image",
          variants: [
            {
              variant: "image",
              imageUrl: "/photos/raw.jpg",
              provenanceLabel: "Original photo",
              isActive: true,
            },
          ],
        },
      ],
      (formData) => {
        submitted.push({
          intent: formData.get("intent")?.toString() ?? null,
          coverId: formData.get("coverId")?.toString() ?? null,
          spoonId: formData.get("spoonId")?.toString() ?? null,
          activateWhenReady: formData.get("activateWhenReady")?.toString() ?? null,
          promptAddition: formData.get("promptAddition")?.toString() ?? null,
        });
      },
      [
        {
          id: "spoon-1",
          photoUrl: "/photos/spoon-source.jpg",
          cookedAt: "2026-01-02T00:00:00.000Z",
          chef: { username: "rowan" },
        },
      ],
    );

    await user.type(screen.getByLabelText("Placeholder direction"), "bright window light");
    await user.click(screen.getByRole("button", { name: "Generate placeholder cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "generateRecipeCoverPlaceholder",
        coverId: null,
        spoonId: null,
        activateWhenReady: "true",
        promptAddition: "bright window light",
      });
    });

    await user.type(screen.getByLabelText("Spoon photo direction for rowan"), "make the greens pop");
    await user.click(screen.getByRole("button", { name: "Editorialize spoon photo by rowan" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "createCoverFromSpoon",
        coverId: null,
        spoonId: "spoon-1",
        activateWhenReady: "true",
        promptAddition: "make the greens pop",
      });
    });

    await user.type(screen.getByLabelText("Regeneration direction"), "less shadow on the plate");
    await user.click(screen.getByRole("button", { name: "Regenerate with direction" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "regenerateRecipeCover",
        coverId: "cover-1",
        spoonId: null,
        activateWhenReady: "true",
        promptAddition: "less shadow on the plate",
      });
    });
  });

  it("normalizes stale cookbook and counter labels in history rows", async () => {
    renderHistory([
      {
        id: "stale-label-cover",
        status: "ready",
        generationStatus: "succeeded",
        sourceType: "ai-placeholder",
        createdAt: "2026-01-01T00:00:00.000Z",
        isActive: true,
        activeVariant: "image",
        variants: [
          {
            variant: "image",
            imageUrl: "/photos/generated.jpg",
            provenanceLabel: legacySpoonjoyCookbookLabel,
            isActive: true,
          },
          {
            variant: "stylized",
            imageUrl: "/photos/counter.jpg",
            provenanceLabel: legacyCounterLabel,
            isActive: false,
          },
        ],
      },
    ]);

    expect(await screen.findAllByText("Saved cover")).toHaveLength(2);
    expect(screen.queryByText(legacySpoonjoyCookbookLabel)).toBeNull();
    expect(screen.queryByText(legacyCounterLabel)).toBeNull();
  });
});
