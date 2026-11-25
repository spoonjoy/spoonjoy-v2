import type { Route } from "./+types/users.$identifier.fellow-chefs";
import { redirect, useLoaderData } from "react-router";
import { Heading } from "~/components/ouro/text/heading";
import { Link } from "~/components/ouro/link/link";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { hidesChef, loadRequestViewerHides } from "~/lib/moderation.server";
import {
  listFellowChefs,
  fellowChefListFromRows,
  fellowChefListQueries,
  DEFAULT_LIMIT,
  type FellowChefListResult,
  type FellowChefRow,
  type ListFellowChefsOptions,
} from "~/lib/fellow-chefs.server";
import { d1ReadBatch, requestD1, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { FellowChefList } from "~/components/users/FellowChefList";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";

interface SerializedFellowChefRow extends Omit<FellowChefRow, "latestInteractionAt"> {
  latestInteractionAt: string;
}

interface FellowChefsLoaderData {
  profileUsername: string;
  viewerIsOwner: boolean;
  rows: SerializedFellowChefRow[];
  total: number;
  page: number;
  pageSize: number;
}

function parsePage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

export function meta({ data }: Route.MetaArgs) {
  if (!data?.profileUsername) {
    return [
      { title: "Fellow chefs - Spoonjoy" },
      { name: "description", content: "Fellow chefs on Spoonjoy." },
    ];
  }
  return [
    { title: `Fellow chefs · ${data.profileUsername} - Spoonjoy` },
    {
      name: "description",
      content: `Chefs ${data.profileUsername} has cooked, forked, or saved from.`,
    },
  ];
}

type ProfileUser = { id: string; username: string };

interface FellowChefReads {
  /** The chef the address names, by username and by id; the username wins when both match. */
  profile(identifier: string): Promise<{ userByUsername: ProfileUser | null; userById: ProfileUser | null }>;
  fellowChefs(userId: string, opts: ListFellowChefsOptions): Promise<FellowChefListResult>;
}

function fellowChefReadsOnD1(d1: D1ReadDatabase): FellowChefReads {
  const user = (row: D1Row | undefined): ProfileUser | null => (row ? { id: String(row.id), username: String(row.username) } : null);
  return {
    async profile(identifier) {
      const [byUsername, byId] = await d1ReadBatch(d1, [
        [`SELECT "id", "username" FROM "User" WHERE "username" = ?`, identifier],
        [`SELECT "id", "username" FROM "User" WHERE "id" = ?`, identifier],
      ]);
      return { userByUsername: user(byUsername![0]), userById: user(byId![0]) };
    },
    async fellowChefs(userId, opts) {
      const [rows, count] = await d1ReadBatch(d1, fellowChefListQueries("viewer", userId, opts));
      return fellowChefListFromRows(rows!, count!);
    },
  };
}

function fellowChefReadsOnPrisma(database: Awaited<ReturnType<typeof getRequestDb>>): FellowChefReads {
  const select = { id: true, username: true } as const;
  return {
    async profile(identifier) {
      const userByUsername = await database.user.findUnique({ where: { username: identifier }, select });
      const userById = userByUsername ? null : await database.user.findUnique({ where: { id: identifier }, select });
      return { userByUsername, userById };
    },
    fellowChefs: (userId, opts) => listFellowChefs(database, userId, opts),
  };
}

export async function loader({
  request,
  context,
  params,
}: Route.LoaderArgs): Promise<FellowChefsLoaderData | Response> {
  const identifier = params.identifier;
  if (!identifier) {
    throw new Response("User not found", { status: 404 });
  }

  // On the Worker the page reads from D1, so it builds no Prisma client: on merge-group run 45528383350 a wedged
  // Prisma engine failed fellow-chefs.data with every other Prisma page in its isolate. Prisma is only the fallback
  // where there is no binding.
  const d1 = requestD1(context);
  const reads = d1 ? fellowChefReadsOnD1(d1) : fellowChefReadsOnPrisma(await getRequestDb(context));
  const currentUserId = await getUserId(request, context.cloudflare?.env);

  const { userByUsername, userById } = await reads.profile(identifier);
  const profileUser = userByUsername ?? userById;

  if (!profileUser) {
    throw new Response("User not found", { status: 404 });
  }

  const hides = await loadRequestViewerHides(context, currentUserId);
  if (hidesChef(hides, profileUser.id)) {
    throw new Response("User not found", { status: 404 });
  }

  if (!userByUsername && identifier === profileUser.id) {
    return redirect(`/users/${profileUser.username}/fellow-chefs`);
  }

  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = DEFAULT_LIMIT;
  const offset = (page - 1) * pageSize;

  const result = await reads.fellowChefs(profileUser.id, { limit: pageSize, offset });

  return {
    profileUsername: profileUser.username,
    viewerIsOwner: currentUserId === profileUser.id,
    rows: result.rows.filter((row) => !hidesChef(hides, row.chefId)).map((row) => ({
      ...row,
      latestInteractionAt: row.latestInteractionAt.toISOString(),
    })),
    total: result.total,
    page,
    pageSize,
  };
}

export default function FellowChefsPage() {
  const { profileUsername, viewerIsOwner, rows, total, page, pageSize } =
    useLoaderData<typeof loader>();

  const emptyStateText = viewerIsOwner
    ? "You haven't cooked, forked, or saved any recipes from other chefs yet. Spoon a recipe to start."
    : `@${profileUsername} hasn't cooked, forked, or saved any recipes from other chefs yet.`;

  const basePath = `/users/${profileUsername}/fellow-chefs`;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const renderRows = rows.map((row) => ({
    ...row,
    latestInteractionAt: new Date(row.latestInteractionAt),
  }));

  return (
    <CookbookPage>
      <section className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Chef profile" title="Fellow chefs" size="lg" divider>
          <Heading level={2} size="sm" className="leading-6">
            {viewerIsOwner ? "Your kitchen network" : `${profileUsername}'s kitchen network`}
          </Heading>
        </PageHeader>

        <div className="mt-6">
          <FellowChefList label="Fellow chefs" rows={renderRows} emptyStateText={emptyStateText} />
        </div>

        {(hasPrev || hasNext) && (
          <nav
            className="mt-6 flex items-center justify-between border-t border-[var(--sj-border)] pt-4 text-sm"
            aria-label="Pagination"
          >
            {hasPrev ? (
              <Link href={`${basePath}?page=${page - 1}`}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs uppercase tracking-[0.14em]">
              Page {page} of {totalPages}
            </p>
            {hasNext ? (
              <Link href={`${basePath}?page=${page + 1}`}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </CookbookPage>
  );
}
