// Move in: bring a kitchen over from another recipe app. The person picks the app, drops its
// backup zip, watches it come in, and lands on what arrived and what didn't. Behind the move_in
// flag until moved-in recipes can be kept private. Where the Worker has a jobs queue, the move-in
// runs there and the page only shows how far it has got; elsewhere each poll keeps it running.
import { Utensils } from "lucide-react";
import { useEffect, useRef } from "react";
import { data, Form as RouterForm, redirect, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/move-in";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { ChoiceCard } from "~/components/ouro/choice-card/choice-card";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
import { FileField } from "~/components/ouro/file-field/file-field";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Form } from "~/components/ouro/form/form";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Spinner } from "~/components/ouro/spinner/spinner";
import { Text } from "~/components/ouro/text/text";
import {
  FINISHED,
  MOVE_IN_ERROR_MESSAGES,
  MOVE_IN_UPLOAD_MAX_BYTES,
  moveInPorts,
  nudgeMoveIn,
  readMoveInProgress,
  runForAWhile,
  startMoveIn,
  startMoveInJob,
  timeLeft,
  type MoveInEnv,
  type MoveInProgress,
} from "~/domains/move-in";
import { isFlagOn } from "~/domains/platform";
import { cloudflarePlatform } from "~/domains/platform/index.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { getCloudflareEnv } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { CookbookPage } from "~/components/cookbook/page";

/** How long one request keeps a move-in running after it answers; a Worker allows about 30 seconds. */
const RUN_BUDGET_MS = 20_000;
/** How often the page asks for more while a move-in runs. */
const POLL_MS = 3_000;
// A server-side move-in needs no page to keep it going, so while it shows no change the page asks
// half as often each time, down to this.
const POLL_MAX_MS = 30_000;

export function meta() {
  return [{ title: "Move in - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

async function signedInWithFlag(request: Request, context: Route.LoaderArgs["context"]) {
  const env = getCloudflareEnv(context);
  const userId = await requireUserId(request, "/login", env);
  if (!isFlagOn("move_in", env, userId)) throw new Response("Not found", { status: 404 });
  if (!env?.DB || !env.PHOTOS) throw new Response("Move-in needs its database and photo storage, and this server has neither.", { status: 503 });
  // The jobs port is always there and only refuses on enqueue, so without a queue the page runs the move-in itself.
  const jobs = env.JOBS ? cloudflarePlatform(env).jobs : null;
  return { userId, env: { DB: env.DB, PHOTOS: env.PHOTOS } as unknown as MoveInEnv, workerEnv: env, jobs };
}

/** Reports a move-in the page couldn't run or queue; the next poll tries again. */
async function report(workerEnv: Env, userId: string, phase: "run" | "queue", error: unknown) {
  await captureException(resolvePostHogServerConfig(workerEnv), {
    error,
    distinctId: userId,
    route: "/move-in",
    extras: { phase },
  });
}

/** Keeps the move-in running after the response, inside the request's waitUntil. */
function keepRunning(context: Route.ActionArgs["context"], { env, workerEnv }: { env: MoveInEnv; workerEnv: Env }, jobId: string, userId: string) {
  const ctx = context.cloudflare?.ctx;
  if (!ctx) return;
  // The page's next poll resumes the move-in; the report says how often runs stop, and why.
  const run = runForAWhile(jobId, moveInPorts(env, () => new Date()), { budgetMs: RUN_BUDGET_MS }).catch((error: unknown) => report(workerEnv, userId, "run", error));
  ctx.waitUntil(run);
}

export interface MoveInView {
  jobId: string;
  status: MoveInProgress["job"]["status"];
  finished: boolean;
  archiveName: string | null;
  recipes: { found: number; done: number; created: number; already: number; updated: number; unchanged: number; skipped: number; failed: number };
  /** Photos found in the backup, and how many of those are on their recipes now. */
  photos: { found: number; in: number };
  failure: string | null;
  notes: Array<{ seq: number; level: "info" | "warn" | "error"; message: string }>;
  /** Recipes that got a number because the cook already had one by that name. */
  renamed: Array<{ seq: number; message: string }>;
  /** The newest recipes in, newest first, with their photos. */
  latest: MoveInProgress["latest"];
  /** It runs on the server, so the page can be closed. */
  runsOnServer: boolean;
  /** "About 4 minutes left", from the rate so far; null until there is enough to go on. */
  timeLeft: string | null;
}

function view(progress: MoveInProgress, runsOnServer: boolean, now: Date): MoveInView {
  const recipes = progress.counts.recipes ?? { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const photos = progress.counts.photos ?? { found: 0, created: 0, unchanged: 0 };
  const failure = [...progress.events].reverse().find((event) => event.kind === "job-failed")?.message ?? null;
  const done = recipes.created + recipes.updated + recipes.unchanged + recipes.skipped + recipes.failed;
  // Recipes begin to come in once the backup has been read, so the rate counts from then, not from the
  // job's start, which also takes in its time waiting to run and reading the backup.
  const recipesBegan = progress.events.find((event) => event.kind === "phase-done")?.createdAt;
  return {
    jobId: progress.job.id,
    status: progress.job.status,
    finished: FINISHED.includes(progress.job.status),
    archiveName: progress.job.archiveName,
    recipes: {
      found: recipes.found,
      done,
      created: recipes.created,
      // Already here: from an earlier move-in, whether it changed since or not.
      already: recipes.updated + recipes.unchanged,
      updated: recipes.updated,
      unchanged: recipes.unchanged,
      skipped: recipes.skipped,
      failed: recipes.failed,
    },
    photos: { found: photos.found, in: photos.created + photos.unchanged },
    failure,
    notes: progress.events.flatMap((event) =>
      (event.level === "info" && event.kind !== "item-kept") || event.kind === "job-failed" ? [] : [{ seq: event.seq, level: event.level, message: event.message }]),
    latest: progress.latest,
    renamed: progress.events.flatMap((event) => (event.kind === "item-renamed" ? [{ seq: event.seq, message: event.message }] : [])),
    runsOnServer,
    timeLeft: FINISHED.includes(progress.job.status) || !recipesBegan ? null : timeLeft({ done, found: recipes.found, startedAt: recipesBegan, now }),
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { userId, env, jobs } = await signedInWithFlag(request, context);
  const jobId = new URL(request.url).searchParams.get("job");
  const maxBytes = MOVE_IN_UPLOAD_MAX_BYTES;
  if (!jobId) return { move: null, maxBytes };
  const progress = await readMoveInProgress(env.DB, { ownerId: userId, jobId });
  if (!progress) throw new Response("Not found", { status: 404 });
  return { move: view(progress, jobs !== null, new Date()), maxBytes };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { userId, env, workerEnv, jobs } = await signedInWithFlag(request, context);
  const fail = (code: keyof typeof MOVE_IN_ERROR_MESSAGES, status = 400) => data({ error: MOVE_IN_ERROR_MESSAGES[code] }, { status });
  if (Number(request.headers.get("Content-Length") ?? 0) > MOVE_IN_UPLOAD_MAX_BYTES + 1024 * 1024) return fail("backup-too-large", 413);

  const form = await request.formData();
  if (form.get("intent") === "continue") {
    const jobId = String(form.get("jobId") ?? "");
    const progress = await readMoveInProgress(env.DB, { ownerId: userId, jobId });
    if (!progress) throw new Response("Not found", { status: 404 });
    // On the server, the page only picks up a move-in whose segments stopped coming.
    if (jobs) await nudgeMoveIn(jobs, progress.job, new Date()).catch((error: unknown) => report(workerEnv, userId, "queue", error));
    else keepRunning(context, { env, workerEnv }, jobId, userId);
    return { error: null };
  }

  const file = form.get("backup");
  if (!(file instanceof File) || file.size === 0) return fail("no-file");
  const started = await startMoveIn({
    env,
    ownerId: userId,
    app: String(form.get("app") ?? ""),
    file: { name: file.name, size: file.size, data: file },
    now: new Date(),
  });
  if (!started.ok) return fail(started.code, started.code === "backup-too-large" ? 413 : 400);
  // A move-in that couldn't be queued waits for the page, which queues it once it has been quiet a while.
  if (jobs) await startMoveInJob(jobs, started.jobId).catch((error: unknown) => report(workerEnv, userId, "queue", error));
  else keepRunning(context, { env, workerEnv }, started.jobId, userId);
  return redirect(`/move-in?job=${started.jobId}`);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function UploadForm({ error, maxBytes }: { error: string | null; maxBytes: number }) {
  const busy = useNavigation().state === "submitting";
  return (
    <Form method="post" render={<RouterForm encType="multipart/form-data" />} className="gap-6">
      {error ? <Alert tone="destructive" title="That backup didn't move in" description={error} /> : null}
      <ChoiceCard
        legend="Where are you coming from?"
        name="app"
        defaultValue="mealie"
        required
        items={[{ value: "mealie", label: "Mealie", description: "From a backup zip: in Mealie, open Settings, then Backups, make a backup and download it." }]}
      />
      <FileField
        label="Backup zip"
        name="backup"
        accept=".zip,application/zip"
        maxSize={maxBytes}
        required
        prompt="Drop the backup's .zip file here"
        description="Drop the zip just as you downloaded it, without unzipping it. It is deleted once your recipes are in."
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Checking the backup…" : "Move in"}
        </Button>
      </div>
    </Form>
  );
}

function Progress({ move }: { move: MoveInView }) {
  const fetcher = useFetcher();
  // The latest fetcher, so the timer neither restarts on every render nor posts while one is out.
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });
  const { jobId, runsOnServer } = move;
  const done = move.recipes.done;
  const found = move.recipes.found;
  // Asks how the move-in is going, from 3 s after the last change. A move-in this page keeps going
  // is asked at that pace, seen or not. A server-side one is asked less often each time it shows no
  // change, not at all while the page is out of sight, and at once when the page is back in view. A
  // change in the count, or in the recipes found once the backup is read, starts the pace over.
  useEffect(() => {
    let wait = POLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      const current = latest.current;
      const unseen = runsOnServer && document.visibilityState === "hidden";
      if (current.state === "idle" && !unseen) current.submit({ intent: "continue", jobId }, { method: "post", encType: "multipart/form-data" });
      if (runsOnServer) wait = Math.min(wait * 2, POLL_MAX_MS);
      timer = setTimeout(ask, wait);
    };
    const back = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      wait = POLL_MS;
      ask();
    };
    timer = setTimeout(ask, wait);
    if (runsOnServer) document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [jobId, runsOnServer, done, found]);
  const counted = move.recipes.found > 0;
  return (
    <section aria-labelledby="move-in-progress" className="flex flex-col gap-4">
      <h2 id="move-in-progress" className="text-lg font-semibold">Moving in</h2>
      <div role="status" className="flex items-center gap-3">
        <Spinner label="Moving in" />
        <div className="flex flex-col">
          <Text>
            {counted ? `${move.recipes.done} of ${plural(move.recipes.found, "recipe")} in so far.` : "Reading the backup…"}
          </Text>
          {move.timeLeft ? <Text tone="muted">{move.timeLeft}</Text> : null}
        </div>
      </div>
      {move.latest.length ? (
        <ItemGroup aria-label="Just moved in" variant="divided">
          {move.latest.map((recipe) => (
            <Item
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              // A recipe whose photo isn't in yet keeps its place in the photo's own slot (its size and corners), filled
              // muted with a utensils mark; the next poll brings the photo.
              media={
                recipe.photoUrl ? (
                  <img src={recipe.photoUrl} alt="" />
                ) : (
                  <span aria-hidden="true" className="flex items-center justify-center bg-muted text-muted-foreground">
                    <Utensils className="size-ouro-5" />
                  </span>
                )
              }
            />
          ))}
        </ItemGroup>
      ) : null}
      <Text tone="muted">
        {move.runsOnServer ? "You can close this page; your recipes keep moving in without it." : "You can leave this page; the move carries on when you come back."}
      </Text>
    </section>
  );
}

function Finished({ move }: { move: MoveInView }) {
  const { created, already, updated } = move.recipes;
  // When nothing moved or changed, counts of 0 recipes and every photo would read as if something had.
  const moved = created > 0 || updated > 0;
  const items = [
    ...(moved ? [{ term: "Recipes moved in", details: String(created) }, { term: "Photos", details: `${move.photos.in} of ${move.photos.found}` }] : []),
    ...(move.recipes.skipped ? [{ term: "Left out", details: String(move.recipes.skipped) }] : []),
    ...(move.recipes.failed ? [{ term: "Didn't move in", details: String(move.recipes.failed) }] : []),
  ];
  const heading = created ? `${plural(created, "recipe")} moved in` : already ? "Everything was already here" : "Nothing new to move in";
  return (
    <section aria-labelledby="move-in-done" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="move-in-done" className="text-lg font-semibold">{heading}</h2>
        {already ? <Text tone="muted">{`${already} already here, ${updated} changed.`}</Text> : null}
      </div>
      {items.length ? <DescriptionList items={items} /> : null}
      {move.renamed.length ? (
        <Collapsible title={`${plural(move.renamed.length, "recipe")} got a number, because you already had one by that name`}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {move.renamed.map((note) => (
              <li key={note.seq}>
                <Text>{note.message}</Text>
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
      {move.notes.length ? (
        <section aria-labelledby="move-in-notes" className="flex flex-col gap-2">
          <h3 id="move-in-notes" className="font-semibold">What to look over</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {move.notes.map((note) => (
              <li key={note.seq}>
                <Text tone={note.level === "error" ? "destructive" : "default"}>{note.message}</Text>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button href="/my-recipes">See your recipes</Button>
        <Button href="/move-in" variant="outline" tone="secondary">Move in another backup</Button>
      </div>
    </section>
  );
}

export default function MoveIn() {
  const { move, maxBytes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    // The app's layout owns the page's one main landmark; this is its content.
    <CookbookPage>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Move in"
          title="Bring your kitchen with you."
          description="Your recipes come over with their photos, steps and ingredients. Nothing changes in the app you're leaving."
          divider
        />
        {!move || move.status === "failed" ? (
          <UploadForm error={actionData?.error ?? move?.failure ?? null} maxBytes={maxBytes} />
        ) : move.finished ? (
          <Finished move={move} />
        ) : (
          <Progress move={move} />
        )}
      </div>
    </CookbookPage>
  );
}
