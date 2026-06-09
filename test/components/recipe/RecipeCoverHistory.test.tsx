import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestRoutesStub } from "../../utils";
import {
  RecipeCoverHistory,
  type RecipeCoverHistoryItem,
} from "~/components/recipe/RecipeCoverHistory";

function renderHistory(covers: RecipeCoverHistoryItem[], onSubmit?: (formData: FormData) => void) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () => <RecipeCoverHistory covers={covers} />,
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
  });

  it("labels processing, failed, archived, invalid-date, and no-variant rows", async () => {
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
            provenanceLabel: "Chef photo",
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
    ]);

    expect(await screen.findByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Saved cover")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.getByText("No usable image variants.")).toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Chef photo cover" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use Imported photo cover" })).toBeNull();
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
              provenanceLabel: "Chef photo",
              isActive: false,
            },
            {
              variant: "stylized",
              imageUrl: "/photos/editorial.jpg",
              provenanceLabel: "Editorialized chef photo",
              isActive: true,
            },
          ],
        },
      ],
      (formData) => {
        submitted.push({
          intent: formData.get("intent")?.toString() ?? null,
          coverId: formData.get("coverId")?.toString() ?? null,
          variant: formData.get("variant")?.toString() ?? null,
          confirmNoCover: formData.get("confirmNoCover")?.toString() ?? null,
        });
      },
    );

    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Active variant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use Chef photo cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "setRecipeCover",
        coverId: "cover-1",
        variant: "image",
        confirmNoCover: null,
      });
    });

    await user.click(screen.getByRole("button", { name: "Set no cover" }));
    await waitFor(() => {
      expect(submitted).toContainEqual({
        intent: "setRecipeNoCover",
        coverId: null,
        variant: null,
        confirmNoCover: "true",
      });
    });
  });
});
