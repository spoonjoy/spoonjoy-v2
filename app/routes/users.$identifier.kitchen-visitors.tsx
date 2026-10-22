import type { Route } from "./+types/users.$identifier.kitchen-visitors";
import { redirect, useLoaderData } from "react-router";
import { Heading } from "~/components/ouro/text/heading";
import { Link } from "~/components/ouro/link/link";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import {
  listKitchenVisitors,
  DEFAULT_LIMIT,
  type FellowChefRow,
} from "~/lib/fellow-chefs.server";
import { FellowChefList } from "~/components/users/FellowChefList";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { formatRelativeTime } from "~/lib/time";

interface SerializedFellowChefRow extends Omit<FellowChefRow, "latestInteractionAt"> {
  latestInteractionAt: string;
  latestInteractionLabel: string;
}

interface KitchenVisitorsLoaderData {
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
      { title: "Kitchen visitors - Spoonjoy" },
      { name: "description", content: "Kitchen visitors on Spoonjoy." },
    ];
  }
  return [
    { title: `Kitchen visitors · ${data.profileUsername} - Spoonjoy` },
    {
      name: "description",
      content: `Chefs who have cooked, forked, or saved ${data.profileUsername}'s recipes.`,
    },
  ];
}

export async function loader({
  request,
  context,
  params,
}: Route.LoaderArgs): Promise<KitchenVisitorsLoaderData | Response> {
  const identifier = params.identifier;
  if (!identifier) {
    throw new Response("User not found", { status: 404 });
  }

  const database = await getRequestDb(context);
  const currentUserId = await getUserId(request, context.cloudflare?.env);

  const userByUsername = await database.user.findUnique({
    where: { username: identifier },
    select: { id: true, username: true },
  });

  const profileUser =
    userByUsername ??
    (await database.user.findUnique({
      where: { id: identifier },
      select: { id: true, username: true },
    }));

  if (!profileUser) {
    throw new Response("User not found", { status: 404 });
  }

  if (!userByUsername && identifier === profileUser.id) {
    return redirect(`/users/${profileUser.username}/kitchen-visitors`);
  }

  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page"));
  const pageSize = DEFAULT_LIMIT;
  const offset = (page - 1) * pageSize;

  const result = await listKitchenVisitors(database, profileUser.id, {
    limit: pageSize,
    offset,
  });
  const renderedAt = Date.now();

  return {
    profileUsername: profileUser.username,
    viewerIsOwner: currentUserId === profileUser.id,
    rows: result.rows.map((row) => ({
      ...row,
      latestInteractionAt: row.latestInteractionAt.toISOString(),
      latestInteractionLabel: formatRelativeTime(row.latestInteractionAt, renderedAt),
    })),
    total: result.total,
    page,
    pageSize,
  };
}

export default function KitchenVisitorsPage() {
  const { profileUsername, viewerIsOwner, rows, total, page, pageSize } =
    useLoaderData<typeof loader>();

  const emptyStateText = viewerIsOwner
    ? "No one has cooked, forked, or saved your recipes yet."
    : `No one has cooked, forked, or saved @${profileUsername}'s recipes yet.`;

  const basePath = `/users/${profileUsername}/kitchen-visitors`;
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
        <PageHeader eyebrow="Chef profile" title="Kitchen visitors" size="lg" divider>
          <Heading level={2} size="sm" className="leading-6">
            {viewerIsOwner
              ? "Chefs who've engaged with your recipes"
              : `Chefs who've engaged with ${profileUsername}'s recipes`}
          </Heading>
        </PageHeader>

        <div className="mt-6">
          <FellowChefList label="Kitchen visitors" rows={renderRows} emptyStateText={emptyStateText} />
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
