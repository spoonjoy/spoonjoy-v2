import type { Route } from "./+types/users.$identifier";
import { Form, redirect, useLoaderData } from "react-router";
import { Settings } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { RecipeGrid } from "~/components/pantry/RecipeGrid";
import { CookbookCard } from "~/components/pantry/CookbookCard";

const DEFAULT_CHEF_AVATAR = "/images/chef-rj.png";

function joinedLabel(createdAt: Date) {
  return `Joined ${createdAt.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })}`;
}

export function meta({ data }: Route.MetaArgs) {
  const username = data?.profile.username ?? "Chef";
  return [
    { title: `${username} - Spoonjoy` },
    { name: "description", content: `Open ${username}'s Spoonjoy kitchen.` },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const identifier = params.identifier;
  if (!identifier) {
    throw new Response("User not found", { status: 404 });
  }

  const database = await getRequestDb(context);
  const currentUserId = await getUserId(request);

  const userByUsername = await database.user.findUnique({
    where: { username: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });

  const profileUser = userByUsername ?? await database.user.findUnique({
    where: { id: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });

  if (!profileUser) {
    throw new Response("User not found", { status: 404 });
  }

  if (!userByUsername && identifier === profileUser.id) {
    return redirect(`/users/${profileUser.username}`);
  }

  const [recipes, cookbooks] = await Promise.all([
    database.recipe.findMany({
      where: {
        chefId: profileUser.id,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        servings: true,
      },
    }),
    database.cookbook.findMany({
      where: { authorId: profileUser.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { recipes: true },
        },
        recipes: {
          take: 4,
          orderBy: { createdAt: "desc" },
          include: {
            recipe: {
              select: {
                imageUrl: true,
                title: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    profile: {
      id: profileUser.id,
      username: profileUser.username,
      photoUrl: profileUser.photoUrl,
      joinedLabel: joinedLabel(profileUser.createdAt),
    },
    isOwner: currentUserId === profileUser.id,
    recipes,
    cookbooks,
  };
}

export default function UserProfile() {
  const { profile, isOwner, recipes, cookbooks } = useLoaderData<typeof loader>();
  const profileHref = `/users/${profile.username}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <section className="rounded-sm border border-zinc-300 bg-stone-50/70 p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70 sm:p-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar
              src={profile.photoUrl ?? DEFAULT_CHEF_AVATAR}
              alt={profile.username}
              initials={profile.username.charAt(0).toUpperCase()}
              className="size-16 border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <div>
              <Heading level={1} className="font-serif text-3xl/9 tracking-tight">
                {profile.username}
              </Heading>
              <Text className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                {profile.joinedLabel} • {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} • {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
              <Link href={`/?chef=${profile.username}`} className="mt-2 inline-block text-sm text-blue-600 no-underline hover:underline">
                Open kitchen view
              </Link>
            </div>
          </div>

          {isOwner ? (
            <div className="flex items-center gap-2">
              <Button href="/account/settings" plain aria-label="Open settings">
                <Settings data-slot="icon" className="size-4" />
                Settings
              </Button>
              <Form method="post" action="/logout">
                <Button type="submit" variant="destructive">Logout</Button>
              </Form>
            </div>
          ) : null}
        </header>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <section>
            <RecipeGrid
              recipes={recipes.map((recipe) => ({
                id: recipe.id,
                title: recipe.title,
                description: recipe.description ?? undefined,
                imageUrl: recipe.imageUrl,
                servings: recipe.servings ?? undefined,
                chefName: profile.username,
              }))}
              emptyTitle={isOwner ? "No recipes yet" : "No public recipes yet"}
              emptyMessage={isOwner ? "Create your first recipe to start your kitchen." : `${profile.username} has not shared any recipes yet.`}
              emptyCtaHref={isOwner ? "/recipes/new" : null}
            />
          </section>

          <aside>
            <div className="mb-4 flex items-center justify-between gap-3">
              <Subheading level={2}>Cookbooks</Subheading>
              <Text className="text-xs">{cookbooks.length} total</Text>
            </div>

            {cookbooks.length === 0 ? (
              <div className="rounded-sm border border-dashed border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
                <Text>
                  {isOwner ? "No cookbooks yet." : `${profile.username} has not shared any cookbooks yet.`}
                </Text>
              </div>
            ) : (
              <div className="space-y-4">
                {cookbooks.map((cookbook) => (
                  <CookbookCard
                    key={cookbook.id}
                    id={cookbook.id}
                    title={cookbook.title}
                    recipeCount={cookbook._count.recipes}
                    recipeImages={cookbook.recipes.map((item) => ({
                      imageUrl: item.recipe.imageUrl,
                      title: item.recipe.title,
                    }))}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>

        <div className="mt-8 border-t border-zinc-300 pt-4 text-sm dark:border-zinc-700">
          <Link href={profileHref} className="text-zinc-500 no-underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Canonical profile: {profileHref}
          </Link>
        </div>
      </section>
    </div>
  );
}
