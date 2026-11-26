// Move in: bring a kitchen over from another recipe app, or from another Spoonjoy (spoonjoy.app, or a
// cook's own server). The person picks the app, then gives its server's address and an API token, or
// drops its backup zip, watches it come in, and lands on what arrived and what didn't. Behind the move_in
// flag until moved-in recipes can be kept private. Where the Worker has a jobs queue, the move-in
// runs there and the page only shows how far it has got; elsewhere each poll keeps it running.
import { Utensils } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { data, Form as RouterForm, redirect, useActionData, useFetcher, useLoaderData, useNavigate, useNavigation, type ShouldRevalidateFunctionArgs } from "react-router";
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
import { TextField } from "~/components/ouro/text-field/text-field";
import {
  FINISHED,
  MOVE_IN_BACKUP_MAX_BYTES,
  MOVE_IN_ERROR_MESSAGES,
  MOVE_IN_UPLOAD_MAX_BYTES,
  nudgeMoveIn,
  readMoveInOrganizerCounts,
  readMoveInProgress,
  moveInAppOf,
  readsAServer,
  startMoveIn,
  startServerMoveIn,
  timeLeft,
  WAITING_ON_SOURCE,
  type MoveInEnv,
  type MoveInOrganizerCounts,
  type MoveInProgress,
} from "~/domains/move-in";
import { getDb } from "~/lib/db.server";
import { keepRunning, reportMoveIn, signedInWithFlag, startQueuedMoveIn } from "~/lib/move-in-route.server";
import { UPLOAD_STOPPED_MESSAGE, formatBytes, uploadBackup } from "~/lib/move-in-upload";
import { revalidateUnlessNetworkFailure, submitOrReportLostRequest } from "~/lib/network-failure";
import { enforceRateLimit } from "~/lib/rate-limit.server";
import { CookbookPage } from "~/components/cookbook/page";

/** How often the page asks for more while a move-in runs. */
const POLL_MS = 3_000;
// A server-side move-in needs no page to keep it going, so while it shows no change the page asks
// half as often each time, down to this.
const POLL_MAX_MS = 30_000;

export function meta() {
  return [{ title: "Move in - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

export interface MoveInView {
  jobId: string;
  status: MoveInProgress["job"]["status"];
  finished: boolean;
  archiveName: string | null;
  /** It reads the other app's server rather than a backup. */
  fromServer: boolean;
  /** The app it moves in from, as the form's choice names it. */
  app: string;
  recipes: { found: number; done: number; created: number; already: number; updated: number; unchanged: number; skipped: number; failed: number };
  /** Photos found in the backup, and how many of those are on their recipes now. */
  photos: { found: number; in: number };
  /** The tags, categories and tools this move-in put on its recipes, each counted once: none for a cook without organizers. */
  organizers: { tags: number; categories: number; tools: number };
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
  /** The source server asked the move-in to slow down, and it is waiting before it asks again. */
  waiting: boolean;
}

const NO_ORGANIZERS: MoveInOrganizerCounts = { tags: 0, categories: 0, tools: 0 };

function view(progress: MoveInProgress, organizers: MoveInOrganizerCounts, runsOnServer: boolean, now: Date): MoveInView {
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
    fromServer: readsAServer(progress.job.kind),
    app: moveInAppOf(progress.job.kind),
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
    organizers,
    failure,
    notes: progress.events.flatMap((event) =>
      (event.level === "info" && event.kind !== "item-kept") || event.kind === "job-failed" ? [] : [{ seq: event.seq, level: event.level, message: event.message }]),
    latest: progress.latest,
    renamed: progress.events.flatMap((event) => (event.kind === "item-renamed" ? [{ seq: event.seq, message: event.message }] : [])),
    runsOnServer,
    timeLeft: FINISHED.includes(progress.job.status) || !recipesBegan ? null : timeLeft({ done, found: recipes.found, startedAt: recipesBegan, now }),
    waiting: !FINISHED.includes(progress.job.status) && progress.job.lastError === WAITING_ON_SOURCE,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { userId, env, jobs } = await signedInWithFlag(request, context);
  const jobId = new URL(request.url).searchParams.get("job");
  // The page's script sends a backup in parts, up to this; the plain form, without it, takes up to MOVE_IN_UPLOAD_MAX_BYTES.
  const uploadMaxBytes = MOVE_IN_BACKUP_MAX_BYTES;
  if (!jobId) return { move: null, uploadMaxBytes };
  const progress = await readMoveInProgress(env.DB, { ownerId: userId, jobId });
  if (!progress) throw new Response("Not found", { status: 404 });
  // Only a finished move-in shows them: what is on its recipes now, each counted once.
  const { job } = progress;
  const organizers =
    FINISHED.includes(job.status) && job.sourceId
      ? await readMoveInOrganizerCounts(await getDb({ DB: env.DB as unknown as D1Database }), { ownerId: userId, sourceId: job.sourceId, jobId: job.id })
      : NO_ORGANIZERS;
  return { move: view(progress, organizers, jobs !== null, new Date()), uploadMaxBytes };
}

export async function action({ request, context }: Route.ActionArgs) {
  const gate = await signedInWithFlag(request, context);
  const { userId, env, workerEnv, jobs } = gate;
  const fail = (code: keyof typeof MOVE_IN_ERROR_MESSAGES, status = 400) => data({ error: MOVE_IN_ERROR_MESSAGES[code] }, { status });
  if (Number(request.headers.get("Content-Length") ?? 0) > MOVE_IN_UPLOAD_MAX_BYTES + 1024 * 1024) return fail("backup-too-large", 413);

  const form = await request.formData();
  if (form.get("intent") === "continue") {
    const jobId = String(form.get("jobId") ?? "");
    const progress = await readMoveInProgress(env.DB, { ownerId: userId, jobId });
    if (!progress) throw new Response("Not found", { status: 404 });
    // On the server, the page only picks up a move-in whose segments stopped coming.
    if (jobs) await nudgeMoveIn(jobs, progress.job, new Date()).catch((error: unknown) => reportMoveIn(workerEnv, userId, "queue", error));
    else keepRunning(context, { env, workerEnv }, jobId, userId);
    return { error: null };
  }

  const app = String(form.get("app") ?? "");
  const fromServer = form.get("from") === "server";
  // Checking a server asks the address the cook typed, so a cook, and a network, only get so many tries a minute.
  if (fromServer && !(await mayAskAServer(request, workerEnv, userId))) return fail("too-many-tries", 429);
  const started = fromServer
    ? await startServerMoveIn({
      env,
      ownerId: userId,
      app,
      address: String(form.get("address") ?? ""),
      token: String(form.get("token") ?? ""),
      fetch: (input, init) => fetch(input, init),
      now: new Date(),
    })
    : await startFromBackup(form.get("backup"), { env, ownerId: userId, app });
  if (!started) return fail("no-file");
  if (!started.ok) return fail(started.code, started.code === "backup-too-large" ? 413 : 400);
  await startQueuedMoveIn(context, gate, started.jobId);
  return redirect(`/move-in?job=${started.jobId}`);
}

// A submission that got no answer no longer shows the error page: in Journeys run 45399041506 one unanswered
// progress check replaced a running move-in with "That's on our side". A lost upload shows the no-answer
// message on the form. A lost progress check shows nothing and isn't sent again here, since the page asks
// again on its own a few seconds later.
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
  return submitOrReportLostRequest(serverAction, { intent: null, resend: null });
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateUnlessNetworkFailure(args, args.defaultShouldRevalidate);
}

async function mayAskAServer(request: Request, workerEnv: Env, userId: string): Promise<boolean> {
  const byCook = await enforceRateLimit({ ip: `move-in:${userId}`, ipLimiter: workerEnv.AUTH_IP_RATE_LIMITER });
  if (!byCook.allowed) return false;
  const byNetwork = await enforceRateLimit({ ip: request.headers.get("CF-Connecting-IP"), ipLimiter: workerEnv.API_IP_RATE_LIMITER });
  return byNetwork.allowed;
}

/** A move-in from an uploaded backup; null when no file came with the form. */
function startFromBackup(file: FormDataEntryValue | null, { env, ownerId, app }: { env: MoveInEnv; ownerId: string; app: string }) {
  if (!(file instanceof File) || file.size === 0) return null;
  return startMoveIn({ env, ownerId, app, file: { name: file.name, size: file.size, data: file }, now: new Date() });
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** How far the page's upload has got: bytes sent of the file's size, then the check once every part is in. */
type Sending = { sent: number; total: number; checking: boolean };

const APPS = [
  { value: "mealie", label: "Mealie" },
  { value: "spoonjoy", label: "Another Spoonjoy", description: "spoonjoy.app, or a Spoonjoy on your own server." },
] as const;

const FROM = [
  {
    value: "server",
    label: "From your server",
    description: "Its address and an API token: in Mealie, open your profile, then API Tokens, and make one.",
  },
  { value: "backup", label: "From a backup", description: "In Mealie, open Settings, then Backups, make a backup and download it." },
] as const;

/** What the server fields say for each app: where its address is, and where the cook makes its token. */
const SERVER_WORDS = {
  mealie: {
    placeholder: "https://recipes.example.com",
    address: "The address you open Mealie at. It has to open from anywhere on the internet, not only at home.",
    token: "Spoonjoy only reads your recipes with it, and forgets it once they're in. You can delete the token in Mealie then.",
  },
  spoonjoy: {
    placeholder: "https://spoonjoy.app",
    address: "The address you open that Spoonjoy at: https://spoonjoy.app, or your own server's. It has to open from anywhere on the internet.",
    token:
      "Make one on that Spoonjoy: sign in there, open /api/playground, and send POST /api/v1/tokens with a name and the scopes account:read and kitchen:read. Spoonjoy only reads your recipes with it, and forgets it once they're in.",
  },
} as const;

function UploadForm({ error, uploadMaxBytes, from: failedFrom, app: failedApp }: { error: string | null; uploadMaxBytes: number; from: "server" | "backup"; app: string }) {
  const submitting = useNavigation().state === "submitting";
  const [app, setApp] = useState<string>(failedApp);
  const [chosenFrom, setFrom] = useState<string>(failedFrom);
  // Another Spoonjoy moves in only from its server.
  const fromSpoonjoy = app === "spoonjoy";
  const from = fromSpoonjoy ? "server" : chosenFrom;
  const server = from === "server";
  const words = SERVER_WORDS[fromSpoonjoy ? "spoonjoy" : "mealie"];
  const navigate = useNavigate();
  const [sending, setSending] = useState<Sending | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const stoppedAlert = useRef<HTMLDivElement>(null);
  // The Stop button goes once the upload stops, so focus goes to the alert that says so, which also has it read out.
  useEffect(() => {
    if (stopped) stoppedAlert.current?.focus();
  }, [stopped]);
  // With JavaScript, the backup goes straight to storage in parts and the page shows how much has been sent;
  // without it, the plain form posts the file, up to the form's own limit. A server's address posts as it is.
  const send = async (event: FormEvent<HTMLFormElement>) => {
    const element = event.currentTarget;
    const form = new FormData(element);
    const file = (element.elements.namedItem("backup") as HTMLInputElement | null)?.files?.[0];
    // A page that isn't secure (http on a LAN address while testing) has no crypto.subtle to tell the file apart by,
    // so the plain form sends it instead.
    if (!file?.size || !globalThis.crypto?.subtle) return;
    event.preventDefault();
    setFailure(null);
    setStopped(false);
    setSending({ sent: 0, total: file.size, checking: false });
    stopper.current = new AbortController();
    const outcome = await uploadBackup(file, {
      app: String(form.get("app")),
      signal: stopper.current.signal,
      onProgress: (sent, total) => setSending({ sent, total, checking: false }),
      onChecking: () => setSending((now) => now && { ...now, checking: true }),
    });
    if (outcome.ok) {
      await navigate(`/move-in?job=${outcome.jobId}`);
      return;
    }
    setSending(null);
    setStopping(false);
    if (outcome.stopped) {
      // Back to the empty form, saying what happened.
      element.reset();
      setStopped(true);
      return;
    }
    setFailure(outcome.error);
  };
  const shown = failure ?? (sending || stopped ? null : error);
  const busy = submitting || sending !== null;
  return (
    <Form method="post" render={<RouterForm encType="multipart/form-data" />} className="gap-6" onSubmit={send}>
      {shown ? <Alert tone="destructive" title={server ? "Your kitchen didn't move in" : "That backup didn't move in"} description={shown} /> : null}
      {stopped ? <Alert ref={stoppedAlert} tabIndex={-1} title="Upload stopped" description={UPLOAD_STOPPED_MESSAGE} /> : null}
      <ChoiceCard legend="Where are you coming from?" name="app" value={app} onValueChange={setApp} required items={APPS} />
      {fromSpoonjoy ? (
        <input type="hidden" name="from" value="server" />
      ) : (
        <ChoiceCard legend="How do you want to bring it?" name="from" value={from} onValueChange={setFrom} required items={FROM} />
      )}
      {server ? (
        <>
          <TextField
            label="Server address"
            name="address"
            type="url"
            required
            autoComplete="url"
            placeholder={words.placeholder}
            description={words.address}
          />
          <TextField
            label="API token"
            name="token"
            type="password"
            required
            // A password manager would keep the token as a Spoonjoy password, and offer it at sign-in.
            autoComplete="new-password"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            description={words.token}
          />
        </>
      ) : (
        <FileField
          label="Backup zip"
          name="backup"
          accept=".zip,application/zip"
          maxSize={uploadMaxBytes}
          required
          disabled={busy}
          prompt="Drop the backup's .zip file here"
          description="Drop the zip just as you downloaded it, without unzipping it. It is deleted once your recipes are in."
        />
      )}
      {sending ? (
        <div role="status" className="flex items-center gap-3">
          <Spinner label={sending.checking ? "Checking the backup" : stopping ? "Stopping the upload" : "Sending the backup"} />
          <Text>
            {sending.checking
              ? "All of it arrived. Checking the backup…"
              : stopping
                ? "Stopping the upload…"
                : `${formatBytes(sending.sent)} of ${formatBytes(sending.total)} sent`}
          </Text>
        </div>
      ) : null}
      <div className="flex justify-end gap-3">
        {sending && !sending.checking ? (
          <Button
            type="button"
            variant="outline"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              stopper.current?.abort();
            }}
          >
            {stopping ? "Stopping…" : "Stop upload"}
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {sending && !sending.checking ? "Sending the backup…" : busy ? (server ? "Checking your server…" : "Checking the backup…") : "Move in"}
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
  // Each check sends the same plain form, so a check that got no answer and the next one that did
  // are the same request, which is how Journeys knows the page recovered.
  useEffect(() => {
    let wait = POLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      const current = latest.current;
      const unseen = runsOnServer && document.visibilityState === "hidden";
      if (current.state === "idle" && !unseen) current.submit({ intent: "continue", jobId }, { method: "post" });
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
            {counted ? `${move.recipes.done} of ${plural(move.recipes.found, "recipe")} in so far.` : move.fromServer ? "Reading your kitchen…" : "Reading the backup…"}
          </Text>
          {move.waiting ? <Text tone="muted">Waiting for your server…</Text> : move.timeLeft ? <Text tone="muted">{move.timeLeft}</Text> : null}
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

const ORGANIZER_ROWS = [["Tags", "tags"], ["Categories", "categories"], ["Tools", "tools"]] as const;

function Finished({ move }: { move: MoveInView }) {
  const { created, already, updated } = move.recipes;
  // When nothing moved or changed, counts of 0 recipes and every photo would read as if something had.
  const moved = created > 0 || updated > 0;
  const items = [
    ...(moved ? [{ term: "Recipes moved in", details: String(created) }, { term: "Photos", details: `${move.photos.in} of ${move.photos.found}` }] : []),
    ...(moved ? ORGANIZER_ROWS.filter(([, kind]) => move.organizers[kind]).map(([term, kind]) => ({ term, details: String(move.organizers[kind]) })) : []),
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
        <Button href="/move-in" variant="outline" tone="secondary">{move.fromServer ? "Move in again" : "Move in another backup"}</Button>
      </div>
    </section>
  );
}

export default function MoveIn() {
  const { move, uploadMaxBytes } = useLoaderData<typeof loader>();
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
          <UploadForm
            error={actionData?.error ?? move?.failure ?? null}
            uploadMaxBytes={uploadMaxBytes}
            from={move && !move.fromServer ? "backup" : "server"}
            app={move?.app ?? "mealie"}
          />
        ) : move.finished ? (
          <Finished move={move} />
        ) : (
          <Progress move={move} />
        )}
      </div>
    </CookbookPage>
  );
}
