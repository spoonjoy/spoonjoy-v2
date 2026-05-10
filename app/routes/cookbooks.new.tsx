import type { Route } from "./+types/cookbooks.new";
import { Form, redirect, data, useActionData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Fieldset, Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Heading } from "~/components/ui/heading";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { ValidationError } from "~/components/ui/validation-error";

interface ActionData {
  errors?: {
    title?: string;
    general?: string;
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
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
    <div className="sj-page px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="sj-eyebrow">New cookbook</p>
          <Heading level={1} className="mt-4 text-4xl/11 tracking-[-0.04em] sm:text-6xl/15">
            Make a collection worth coming back to.
          </Heading>
          <Text className="mt-4 max-w-2xl text-base/7">
            Start with a clear title. Add recipes next and let the cover become a living collage.
          </Text>
          <Link
            href="/cookbooks"
            className="sj-link mt-4 inline-flex"
          >
            ← Back to cookbooks
          </Link>
        </div>

        {/* istanbul ignore next -- @preserve */ actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mb-4" />
        )}

        <Form method="post" className="sj-panel rounded-[2rem] p-6">
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
      </div>
    </div>
  );
}
