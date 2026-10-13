import type { Route } from "./+types/cookbooks.new";
import { Form as RouterForm, redirect, data, useActionData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { Button } from "~/components/ui/button";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/ui/text";
import { useFormErrors } from "~/hooks/use-form-errors";
import { CookbookPage, CookbookHeader, SettingsPanel } from "~/components/cookbook/page";
import {
  D1_WRITE_UNAVAILABLE_CODE,
  D1_WRITE_UNAVAILABLE_MESSAGE,
  d1UnavailableHeaders,
  formWriteToken,
  idForWriteToken,
  isD1Unavailable,
  retryD1Write,
} from "~/lib/d1-write-retry.server";
import { useWriteToken } from "~/hooks/use-write-token";

interface ActionData {
  errors?: {
    title?: string;
    general?: string;
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New cookbook - Spoonjoy" },
    { name: "description", content: "Create a new Spoonjoy cookbook." },
  ];
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

  // The cookbook's id comes from the form's token, made when the page opened, so a resubmit (after
  // a 503, or a double tap) finds the cookbook the first submit made and goes to it.
  const token = formWriteToken(formData.get("cookbookToken"));
  const cookbookId = token ? await idForWriteToken("cookbook", userId, token) : crypto.randomUUID();
  const made = async () =>
    (await database.cookbook.findFirst({ where: { id: cookbookId, authorId: userId }, select: { id: true } })) !== null;
  if (token && (await made())) {
    return redirect(`/cookbooks/${cookbookId}`);
  }

  try {
    // After a transient D1 error the create asks whether its cookbook is in; if so it is done, and
    // if not it runs again with the same id. A retry that loses to its earlier try, landing late,
    // fails on the title that try took, and the same check then finds the cookbook.
    await retryD1Write(
      { scope: "cookbook.create", applied: async () => ((await made()) ? true : null) },
      async () => {
        await database.cookbook.create({
          data: {
            id: cookbookId,
            title: title.trim(),
            authorId: userId,
          },
        });
        return true;
      },
    );

    return redirect(`/cookbooks/${cookbookId}`);
  } catch (error: any) {
    // The database was briefly unavailable: a retryable 503 the form shows, keeping the title,
    // with the same token, so creating again makes the cookbook once.
    if (isD1Unavailable(error)) {
      return data(
        { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true as const },
        { status: 503, headers: d1UnavailableHeaders() },
      );
    }
    // Check for unique constraint violation
    if (error.code === "P2002") {
      return data(
        { errors: { title: "You already have a cookbook with this title" } },
        { status: 400 }
      );
    }
    // A non-P2002 failure is an unexpected create fault (DB/infra), previously
    // flattened to this generic 500 with the real error discarded — capture it
    // (fire-and-forget, no-op without PostHog) so it isn't silent.
    const postHogConfig = resolvePostHogServerConfig(context.cloudflare?.env ?? {});
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error,
        distinctId: userId,
        route: new URL(request.url).pathname,
        method: request.method,
        extras: { action: "create_cookbook" },
      });
      const waitUntil = context.cloudflare?.ctx?.waitUntil;
      if (waitUntil) {
        waitUntil.call(context.cloudflare!.ctx!, capture);
      } else {
        void capture;
      }
    }
    return data(
      { errors: { general: "Failed to create cookbook. Please try again." } },
      { status: 500 }
    );
  }
}

export default function NewCookbook() {
  const actionData = useActionData<ActionData>();
  const formErrors = useFormErrors(actionData?.errors);
  // One cookbook per opening of the page: a create after a 503, or a double tap, makes it once.
  const [cookbookToken] = useWriteToken();

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <CookbookHeader eyebrow="New cookbook" title="Make a collection worth coming back to.">
          <Text className="mt-4 max-w-2xl text-base/7">
            Start with a clear title. Add recipes next and let the cover become a living collage.
          </Text>
          <Link
            href="/cookbooks"
            className="mt-4 inline-flex min-h-11 items-center"
          >
            ← Back to cookbooks
          </Link>
        </CookbookHeader>

        <SettingsPanel title="Cookbook title">
          <Form method="post" errors={formErrors} render={<RouterForm />} className="gap-6">
            <input type="hidden" name="cookbookToken" value={cookbookToken} />
            <TextField
              label="Cookbook Title"
              name="title"
              required
              placeholder="e.g., Family Favorites, Holiday Recipes"
            />

            <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-4 sm:flex-row sm:justify-end">
              <Button href="/cookbooks" plain>
                Cancel
              </Button>
              <Button type="submit">
                Create cookbook
              </Button>
            </div>
          </Form>
        </SettingsPanel>
      </div>
    </CookbookPage>
  );
}
