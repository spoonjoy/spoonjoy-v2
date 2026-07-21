import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader as newRecipeLoader, action as newRecipeAction } from "~/routes/recipes.new";
import NewRecipe from "~/routes/recipes.new";
import { loader as editRecipeLoader, action as editRecipeAction } from "~/routes/recipes.$id.edit";
import EditRecipe from "~/routes/recipes.$id.edit";
import RecipesLayout from "~/routes/recipes";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

/**
 * Unit 9a: RecipeBuilder Route Integration Tests
 *
 * These tests verify that RecipeBuilder component is properly integrated with:
 * - recipes.new.tsx (create new recipe)
 * - recipes.$id.edit.tsx (edit existing recipe metadata)
 *
 * The RecipeBuilder component should replace inline form elements in both routes.
 * It provides:
 * - Image upload via RecipeImageUpload (not just URL input)
 * - Unified form handling for create and edit modes
 * - Proper error display and loading states
 */

describe("RecipeBuilder Route Integration", () => {
  let testUserId: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;

    // Create a recipe for edit tests
    const recipe = await db.recipe.create({
      data: {
        title: "Test Recipe " + faker.string.alphanumeric(6),
        description: "Test description",
        servings: "4",

        chefId: testUserId,
      },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("recipes.new.tsx - RecipeBuilder Integration", () => {
    describe("component rendering", () => {
      it("should render RecipeBuilder component in create mode", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        // RecipeBuilder should render with create mode
        // The submit button should say "Create Recipe"
        expect(await screen.findByRole("button", { name: "Create Recipe" })).toBeInTheDocument();

        // RecipeBuilder uses "Title" label, not "Recipe Title *"
        expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Servings/)).toBeInTheDocument();

        // RecipeBuilder has "Recipe Image" label for image upload, not "Image URL"
        expect(screen.getByLabelText(/Recipe Image/i)).toBeInTheDocument();
      });

      it("should render RecipeImageUpload component instead of URL input", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        await screen.findByRole("button", { name: "Create Recipe" });

        // Should NOT have an Image URL text input
        expect(screen.queryByLabelText(/Image URL/i)).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/https:\/\/example\.com/i)).not.toBeInTheDocument();

        // Should have RecipeImageUpload (look for upload button)
        expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
      });

      it("should have correct placeholder for title in create mode", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        await screen.findByRole("button", { name: "Create Recipe" });

        // RecipeBuilder uses "e.g., Chocolate Chip Cookies" placeholder
        expect(screen.getByPlaceholderText("e.g., Chocolate Chip Cookies")).toBeInTheDocument();
      });

      it("should render Cancel button that triggers onCancel", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
          {
            path: "/recipes",
            Component: () => <div>Recipe List</div>,
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        await screen.findByRole("button", { name: "Create Recipe" });

        // RecipeBuilder renders Cancel as a button that calls onCancel
        const cancelButton = screen.getByRole("button", { name: "Cancel" });
        expect(cancelButton).toBeInTheDocument();
      });
    });

    describe("form submission", () => {
      it("should handle form submission with image file", async () => {
        const user = userEvent.setup();
        let submittedData: any = null;

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
            action: async ({ request }) => {
              const formData = await request.formData();
              const imageFile = formData.get("image") as File | null;
              submittedData = {
                title: formData.get("title"),
                description: formData.get("description"),
                servings: formData.get("servings"),
                hasImage: imageFile !== null && imageFile.size > 0,
              };
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        await screen.findByRole("button", { name: "Create Recipe" });

        // Fill out form
        fireEvent.change(screen.getByLabelText(/^Title$/i), {
          target: { value: "My New Recipe" },
        });
        fireEvent.change(screen.getByLabelText(/Description/), {
          target: { value: "A delicious dish" },
        });
        fireEvent.change(screen.getByLabelText(/Servings/), {
          target: { value: "4" },
        });

        // Upload an image via RecipeImageUpload's file input
        const file = new File(["test image content"], "test.jpg", { type: "image/jpeg" });
        // Find the file input from RecipeImageUpload (aria-label="Upload recipe image")
        const uploadInput = screen.getByLabelText(/Upload recipe image/i);
        fireEvent.change(uploadInput, { target: { files: [file] } });

        // Submit form
        await user.click(screen.getByRole("button", { name: "Create Recipe" }));

        await waitFor(() => {
          expect(submittedData).not.toBeNull();
        });

        expect(submittedData.title).toBe("My New Recipe");
        expect(submittedData.description).toBe("A delicious dish");
        expect(submittedData.servings).toBe("4");
        expect(submittedData.hasImage).toBe(true);
      });

      it("should display validation errors from server", async () => {
        const actionData = {
          errors: {
            title: "Title is required",
            image: "Invalid image format",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "recipes-new",
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
        ]);

        render(
          <Stub
            initialEntries={["/recipes/new"]}
            hydrationData={{
              loaderData: { "recipes-new": null },
              actionData: { "recipes-new": actionData },
            }}
          />
        );

        await screen.findByRole("button", { name: "Create Recipe" });

        // RecipeBuilder should display these errors
        await waitFor(() => {
          expect(screen.getByText("Title is required")).toBeInTheDocument();
          expect(screen.getByText("Invalid image format")).toBeInTheDocument();
        });
      });

      it("should display general error with role=alert", async () => {
        const actionData = {
          errors: {
            general: "Failed to create recipe. Please try again.",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "recipes-new",
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
          },
        ]);

        render(
          <Stub
            initialEntries={["/recipes/new"]}
            hydrationData={{
              loaderData: { "recipes-new": null },
              actionData: { "recipes-new": actionData },
            }}
          />
        );

        await screen.findByRole("button", { name: "Create Recipe" });

        // RecipeBuilder uses role="alert" for general errors
        await waitFor(() => {
          expect(screen.getByRole("alert")).toHaveTextContent("Failed to create recipe. Please try again.");
        });
      });
    });

    describe("loading state", () => {
      it("should show loading state during submission", async () => {
        const user = userEvent.setup();

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/new",
            Component: NewRecipe,
            loader: () => null,
            action: async () => {
              // Simulate slow action
              await new Promise(resolve => setTimeout(resolve, 100));
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={["/recipes/new"]} />);

        const titleInput = await screen.findByLabelText(/^Title$/i);
        await user.type(titleInput, "Test Recipe");

        const submitButton = screen.getByRole("button", { name: "Create Recipe" });
        await user.click(submitButton);

        // RecipeBuilder sets aria-busy on submit button during loading
        await waitFor(() => {
          expect(submitButton).toHaveAttribute("aria-busy", "true");
        });
      });
    });
  });

  describe("recipes.$id.edit.tsx - RecipeBuilder Integration", () => {
    describe("component rendering", () => {
      it("should render RecipeBuilder component in edit mode", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: "Test description",
            servings: "4",
            steps: [],
          },
            coverImageUrl: "https://example.com/test.jpg",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        // RecipeBuilder should render with edit mode
        // The submit button should say "Save Recipe"
        expect(await screen.findByRole("button", { name: "Save Recipe" })).toBeInTheDocument();

        // RecipeBuilder uses "Title" label
        expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
      });

      it("should render RecipeImageUpload with existing image preview", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: "Test description",
            servings: "4",
            steps: [],
          },
            coverImageUrl: "https://example.com/test.jpg",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Should NOT have Image URL input
        expect(screen.queryByLabelText(/Image URL/i)).not.toBeInTheDocument();

        // Should show image preview (RecipeImageUpload shows the existing image)
        const image = screen.getByRole("img");
        expect(image).toHaveAttribute("src", "https://example.com/test.jpg");

        // Should have "Change Image" button for existing image
        expect(screen.getByRole("button", { name: /change image/i })).toBeInTheDocument();
      });

      it("should populate form fields with existing recipe data", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Existing Recipe Title",
            description: "Existing description text",
            servings: "6-8",
            steps: [],
          },
            coverImageUrl: "https://example.com/existing.jpg",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // RecipeBuilder should be populated with recipe data
        expect(screen.getByLabelText(/^Title$/i)).toHaveValue("Existing Recipe Title");
        expect(screen.getByLabelText(/Description/)).toHaveValue("Existing description text");
        expect(screen.getByLabelText(/Servings/)).toHaveValue("6-8");
      });

      it("should handle null description and servings", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Recipe with Nulls",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // RecipeBuilder should show empty strings for null values
        expect(screen.getByLabelText(/Description/)).toHaveValue("");
        expect(screen.getByLabelText(/Servings/)).toHaveValue("");
      });
    });

    describe("image handling in edit mode", () => {
      it("should allow clearing existing image", async () => {
        const user = userEvent.setup();
        let submittedData: any = null;

        const mockData = {
          recipe: {
            id: recipeId,
            title: "Recipe with Image",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "https://example.com/existing.jpg",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
            action: async ({ request }) => {
              const formData = await request.formData();
              submittedData = {
                clearImage: formData.get("clearImage"),
              };
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Click remove/clear image button
        const clearButton = screen.getByRole("button", { name: /remove|clear/i });
        await user.click(clearButton);

        // Submit form
        await user.click(screen.getByRole("button", { name: "Save Recipe" }));

        await waitFor(() => {
          expect(submittedData).not.toBeNull();
        });

        // RecipeBuilder should include clearImage flag when image is cleared
        expect(submittedData.clearImage).toBe("true");
      });

      it("should allow uploading new image to replace existing", async () => {
        const user = userEvent.setup();
        let submittedData: any = null;

        const mockData = {
          recipe: {
            id: recipeId,
            title: "Recipe with Image",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "https://example.com/existing.jpg",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
            action: async ({ request }) => {
              const formData = await request.formData();
              const imageFile = formData.get("image") as File | null;
              submittedData = {
                hasImage: imageFile !== null && imageFile.size > 0,
                imageFileName: imageFile?.name,
              };
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Click change image button - this triggers the RecipeImageUpload's file input click handler
        const changeButton = screen.getByRole("button", { name: /change image/i });
        await user.click(changeButton);

        // Upload new image via RecipeImageUpload's file input
        const file = new File(["new image content"], "new-image.jpg", { type: "image/jpeg" });
        const uploadInput = screen.getByLabelText(/Upload recipe image/i);
        await user.upload(uploadInput, file);

        // Submit form
        await user.click(screen.getByRole("button", { name: "Save Recipe" }));

        await waitFor(() => {
          expect(submittedData).not.toBeNull();
        });
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Save Recipe" })).toBeEnabled();
        });

        expect(submittedData.hasImage).toBe(true);
        expect(submittedData.imageFileName).toBe("new-image.jpg");
      });
    });

    describe("form submission in edit mode", () => {
      it("should include recipe ID in submission", async () => {
        const user = userEvent.setup();
        let submittedData: any = null;

        const mockData = {
          recipe: {
            id: recipeId,
            title: "Original Title",
            description: "Original description",
            servings: "4",
            steps: [],
          },
            coverImageUrl: "",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
            action: async ({ request }) => {
              const formData = await request.formData();
              submittedData = {
                id: formData.get("id"),
                title: formData.get("title"),
              };
              return { success: true };
            },
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Submit form without changes
        await user.click(screen.getByRole("button", { name: "Save Recipe" }));

        await waitFor(() => {
          expect(submittedData).not.toBeNull();
        });

        // RecipeBuilder should include recipe ID in edit mode submission
        expect(submittedData.id).toBe(recipeId);
      });

      it("should display validation errors from server in edit mode", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "",
          formattedSteps: [],
        };

        const actionData = {
          errors: {
            title: "Title must be 200 characters or less",
            description: "Description must be 2,000 characters or less",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "recipes-edit",
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(
          <Stub
            initialEntries={[`/recipes/${recipeId}/edit`]}
            hydrationData={{
              loaderData: { "recipes-edit": mockData },
              actionData: { "recipes-edit": actionData },
            }}
          />
        );

        await screen.findByRole("button", { name: "Save Recipe" });

        // RecipeBuilder should display these errors
        await waitFor(() => {
          expect(screen.getByText("Title must be 200 characters or less")).toBeInTheDocument();
          expect(screen.getByText("Description must be 2,000 characters or less")).toBeInTheDocument();
        });
      });
    });

    describe("step list section", () => {
      it("should still render step list section below RecipeBuilder", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: null,
            servings: null,
            coverImageUrl: "",
            steps: [
              {
                id: "step-1",
                stepNum: 1,
                stepTitle: "First Step",
                description: "Do the first thing",
                ingredients: [],
              },
            ],
          },
          formattedSteps: [
            {
              id: "step-1",
              stepNum: 1,
              stepTitle: "First Step",
              description: "Do the first thing",
              ingredients: [],
            },
          ],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Step list should still be rendered
        expect(screen.getByRole("heading", { name: "Recipe Steps" })).toBeInTheDocument();
        expect(screen.getByText("First Step")).toBeInTheDocument();
        expect(screen.getByText("Do the first thing")).toBeInTheDocument();
      });

      it("should render Add Step button in step section", async () => {
        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // Add Step button should still be in step section
        expect(screen.getByRole("link", { name: "+ Add Step" })).toBeInTheDocument();
      });
    });

    describe("cancel button behavior", () => {
      it("should navigate back to recipe on cancel", async () => {
        const user = userEvent.setup();

        const mockData = {
          recipe: {
            id: recipeId,
            title: "Test Recipe",
            description: null,
            servings: null,
            steps: [],
          },
            coverImageUrl: "",
          formattedSteps: [],
        };

        const Stub = createTestRoutesStub([
          {
            path: "/recipes/:id/edit",
            Component: EditRecipe,
            loader: () => mockData,
          },
          {
            path: "/recipes/:id",
            Component: () => <div data-testid="recipe-view">Recipe View Page</div>,
          },
        ]);

        render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

        await screen.findByRole("button", { name: "Save Recipe" });

        // RecipeBuilder Cancel button should navigate back
        const cancelButton = screen.getByRole("button", { name: "Cancel" });
        await user.click(cancelButton);

        await waitFor(() => {
          expect(screen.getByTestId("recipe-view")).toBeInTheDocument();
        });
      });
    });
  });

  describe("encType for image upload", () => {
    it("should use multipart/form-data encoding for new recipe form", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      await screen.findByRole("button", { name: "Create Recipe" });

      // Find the form element and check encType
      const form = document.querySelector("form");
      expect(form).toHaveAttribute("encType", "multipart/form-data");
    });

    it("should use multipart/form-data encoding for edit recipe form", async () => {
      const mockData = {
        recipe: {
          id: recipeId,
          title: "Test Recipe",
          description: null,
          servings: null,
          steps: [],
        },
          coverImageUrl: "",
        formattedSteps: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/:id/edit",
          Component: EditRecipe,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={[`/recipes/${recipeId}/edit`]} />);

      await screen.findByRole("button", { name: "Save Recipe" });

      // Find the main recipe form (not step reorder forms)
      const forms = document.querySelectorAll("form");
      const mainForm = Array.from(forms).find(f => f.querySelector('button[type="submit"]')?.textContent?.includes("Save Recipe"));
      expect(mainForm).toHaveAttribute("encType", "multipart/form-data");
    });
  });
});
