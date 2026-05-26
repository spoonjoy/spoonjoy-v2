import type { Route } from "./+types/cookbooks.new";
import { Form, redirect, data, useActionData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Fieldset, Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { ValidationError } from "~/components/ui/validation-error";
import { CookbookPage, CookbookHeader, SettingsPanel } from "~/components/cookbook/page";

interface ActionData {
  errors?: {
    title?: string;
    general?: string;
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request, "/login", context.cloudflare?.env);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const formData = await request.formData();

  const title = formData.get("title")?.toString() || "";

  const errors: ActionData["errors"] = {};

  // Validation
  if (!title || title.trim().length === 0) {
    errors.title = "Title is required";
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  const database = await getRequestDb(context);

  try {
    const cookbook = await database.cookbook.create({
      data: {
        title: title.trim(),
        authorId: userId,
      },
    });

    return redirect(`/cookbooks/${cookbook.id}`);
  } catch (error: any) {
    // Check for unique constraint violation
    if (error.code === "P2002") {
      return data(
        { errors: { title: "You already have a cookbook with this title" } },
        { status: 400 }
      );
    }
    return data(
      { errors: { general: "Failed to create cookbook. Please try again." } },
      { status: 500 }
    );
  }
}

export default function NewCookbook() {
  const actionData = useActionData<ActionData>();

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <CookbookHeader eyebrow="New cookbook" title="Make a collection worth coming back to.">
          <Text className="mt-4 max-w-2xl text-base/7">
            Start with a clear title. Add recipes next and let the cover become a living collage.
          </Text>
          <Link
            href="/cookbooks"
            className="sj-link mt-4 inline-flex min-h-11 items-center"
          >
            ← Back to cookbooks
          </Link>
        </CookbookHeader>

        {/* istanbul ignore next -- @preserve */ actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mb-4" />
        )}

        <SettingsPanel title="Cookbook title">
        <Form method="post">
          <Fieldset className="space-y-6">
            <Field>
              <Label>Cookbook Title *</Label>
              <Input
                type="text"
                name="title"
                required
                placeholder="e.g., Family Favorites, Holiday Recipes"
                data-invalid={/* istanbul ignore next -- @preserve */ actionData?.errors?.title ? true : undefined}
              />
              {/* istanbul ignore next -- @preserve */ actionData?.errors?.title && (
                <ErrorMessage>
                  {actionData.errors.title}
                </ErrorMessage>
              )}
            </Field>

            <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-4 sm:flex-row sm:justify-end">
              <Button href="/cookbooks" plain>
                Cancel
              </Button>
              <Button type="submit">
                Create Cookbook
              </Button>
            </div>
          </Fieldset>
        </Form>
        </SettingsPanel>
      </div>
    </CookbookPage>
  );
}
