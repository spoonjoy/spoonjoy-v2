import type { Route } from "./+types/mcp";
import type { ReactNode } from "react";
import { useLoaderData } from "react-router";
import {
  BookOpen,
  Braces,
  Cable,
  ChefHat,
  FilePen,
  KeyRound,
  Import,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { handleMcpPostRouteRequest } from "~/lib/mcp/http-mcp-route.server";
import { Badge } from "~/components/ui/badge";
import { CookbookHeader, CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";

/**
 * Remote MCP connector endpoint (Streamable HTTP, `application/json`).
 *
 * POST remains a thin shell over `handleMcpHttpRequest` so the real protocol
 * logic stays in the coverage-measured lib. GET renders the human-facing
 * connector landing page below.
 */
async function handleMcpPost({ request, context }: Route.ActionArgs) {
  return handleMcpPostRouteRequest(request, context);
}

type McpLandingData = {
  endpoint: string;
  protectedResourceMetadataUrl: string;
};

function landingData(requestUrl: string): McpLandingData {
  const origin = new URL(requestUrl).origin;
  return {
    endpoint: `${origin}/mcp`,
    protectedResourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp`,
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Spoonjoy MCP" },
    {
      name: "description",
      content: "Connect agents to Spoonjoy for complex kitchen work: creating recipes, importing from messy sources, organizing cookbooks, and updating shopping lists.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  return landingData(request.url);
}

export async function action(args: Route.ActionArgs) {
  return handleMcpPost(args);
}

const protocolFacts = [
  ["Endpoint", "POST /mcp"],
  ["Transport", "Streamable HTTP, stateless"],
  ["Payload", "JSON-RPC initialize, tools/list, tools/call"],
  ["Auth", "Authorization: Bearer on every request"],
  ["Streaming", "no SSE, no batching"],
] as const;

const taskGradient = [
  {
    label: "Easy",
    title: "Use the app",
    body: "Find, follow, spoon, and cook recipes directly in Spoonjoy. Browsing should stay fast, visual, and under your hands.",
    icon: ChefHat,
  },
  {
    label: "Middle",
    title: "Generative UI later",
    body: "Planning, guided editing, and review will eventually want UI that forms around the task. That layer is not here yet.",
    icon: Sparkles,
  },
  {
    label: "Complex",
    title: "Use an agent",
    body: "Author or import recipes from messy sources, normalize ingredients and steps, reorganize cookbooks, and make scoped list changes.",
    icon: FilePen,
  },
] as const;

const capabilities = [
  {
    title: "Import through an agent",
    body: "Let an agent read a source you provide, interpret the recipe, and call create_recipe with structured steps, ingredients, images, and source notes.",
    icon: Import,
  },
  {
    title: "Author real recipes",
    body: "Draft, revise, fork, delete, spoon, and upload user-provided images through the same operation layer the app uses.",
    icon: FilePen,
  },
  {
    title: "Organize cookbooks",
    body: "Create collections, inspect cookbook contents, and add or remove recipes when the organization work gets too fiddly for clicks.",
    icon: BookOpen,
  },
  {
    title: "Manage the shopping list",
    body: "Turn meal decisions into owner-scoped shopping-list changes from the agent you authorize.",
    icon: ListChecks,
  },
] as const;

const setupSteps = [
  {
    title: "Use OAuth when the agent supports it",
    body: "claude.ai, Claude Desktop, and similar MCP clients can discover Spoonjoy auth from the endpoint challenge, then send you through normal sign-in and consent.",
    icon: ShieldCheck,
  },
  {
    title: "Use a bearer token for Claude Code",
    body: "Create an owner-scoped Spoonjoy token, store it like a password, then pass it as an Authorization header when adding the remote MCP server.",
    icon: Terminal,
  },
  {
    title: "Give the agent the smallest useful scope",
    body: "Kitchen scopes unlock recipe and cookbook writes. Shopping-list-only agents can use shopping-list scopes. Token lifecycle tools require token scopes.",
    icon: KeyRound,
  },
] as const;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 text-sm/6 text-[var(--sj-on-photo)] shadow-[var(--sj-shadow-soft)]">
      <code className="font-mono whitespace-pre">{children}</code>
    </pre>
  );
}

function ActionLink({
  href,
  children,
  plain = false,
}: {
  href: string;
  children: ReactNode;
  plain?: boolean;
}) {
  const tone = plain
    ? "border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_72%,transparent)] text-[var(--sj-ink)] hover:border-[var(--sj-border-strong)] hover:bg-[var(--sj-flour)]"
    : "border-[var(--sj-action)] bg-[var(--sj-action)] text-[var(--sj-on-photo)] hover:border-[var(--sj-action-deep)] hover:bg-[var(--sj-action-deep)]";

  return (
    <a
      href={href}
      className={`${tone} font-sj-ui inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--sj-radius-control)] border px-4 py-2 text-base/6 font-semibold tracking-normal transition sm:min-h-10 sm:px-3.5 sm:py-1.5 sm:text-sm/6`}
    >
      {children}
    </a>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-[var(--sj-border)] py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-brass)]">{label}</dt>
      <dd className="min-w-0 font-sj-ui text-sm/6 font-semibold text-[var(--sj-ink)]">{value}</dd>
    </div>
  );
}

export default function McpPage() {
  const { endpoint, protectedResourceMetadataUrl } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
        <CookbookHeader
          eyebrow="Remote connector"
          title="Spoonjoy MCP"
          action={(
            <>
              <ActionLink href="/api" plain>
                <Braces data-slot="icon" aria-hidden="true" />
                Developer Platform
              </ActionLink>
              <ActionLink href="/login">
                <Cable data-slot="icon" aria-hidden="true" />
                Sign In
              </ActionLink>
            </>
          )}
        >
          <p>
            Spoonjoy MCP gives an authorized agent tools for kitchen work that is too detailed for ordinary app clicks:
            creating recipes, importing from messy sources, reshaping cookbooks, and updating your shopping list.
          </p>
        </CookbookHeader>

        <section className="min-w-0 border-y border-[var(--sj-border-strong)] py-5" aria-labelledby="mcp-tldr">
          <p id="mcp-tldr" className="sj-eyebrow">TL;DR</p>
          <p className="mt-3 max-w-4xl text-xl/8 text-[var(--sj-ink)]">
            Use the app for easy things like finding and following recipes. Use an agent through MCP when the work
            becomes multi-step: turn a page, photo, or notes into a structured Spoonjoy recipe, revise it, organize it,
            and make the shopping-list changes around it. The middle eventually wants generative UI; for now, MCP is
            the agent lane.
          </p>
        </section>

        <section>
          <CookbookSectionTitle>Where MCP Fits</CookbookSectionTitle>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
            {taskGradient.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="border-t border-[var(--sj-border-strong)] pt-5">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-[var(--sj-herb)]" aria-hidden="true" />
                    <p className="sj-eyebrow">{item.label}</p>
                  </div>
                  <h2 className="font-sj-display mt-4 text-2xl/7 font-semibold text-[var(--sj-ink)]">{item.title}</h2>
                  <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{item.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 border-y border-[var(--sj-border-strong)] py-6">
            <div className="flex flex-wrap gap-2">
              <Badge color="green">Owner-scoped</Badge>
              <Badge color="amber">OAuth protected</Badge>
              <Badge color="zinc">Streamable HTTP</Badge>
            </div>
            <h2 className="font-sj-display mt-5 max-w-3xl text-3xl/9 font-semibold text-[var(--sj-ink)]">
              The browser page is the guide. The protocol call is authenticated POST JSON-RPC.
            </h2>
            <p className="mt-3 max-w-3xl text-base/7 text-[var(--sj-ink-soft)]">
              Visiting this URL shows setup help. MCP is not a better way to browse Spoonjoy; it is the bridge for
              agent work where reading, transforming, and writing structured kitchen data belong together. MCP clients
              send JSON-RPC to the same URL with{" "}
              <code className="font-sj-ui font-semibold text-[var(--sj-ink)]">POST</code>; every request, including{" "}
              <code className="font-sj-ui font-semibold text-[var(--sj-ink)]">initialize</code>, needs a valid bearer token
              or an OAuth access token bound to this resource.
            </p>
            <div className="mt-6">
              <CodeBlock>{endpoint}</CodeBlock>
            </div>
          </div>

          <dl className="min-w-0 border-y border-[var(--sj-border-strong)] py-3">
            {protocolFacts.map(([label, value]) => (
              <FactRow key={label} label={label} value={value} />
            ))}
          </dl>
        </section>

        <section>
          <CookbookSectionTitle>What It Can Use</CookbookSectionTitle>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="sj-card p-5">
                  <Icon className="size-6 text-[var(--sj-tomato)]" aria-hidden="true" />
                  <h3 className="font-sj-display mt-4 text-xl/6 font-semibold text-[var(--sj-ink)]">{item.title}</h3>
                  <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{item.body}</p>
                </article>
              );
            })}
          </div>
          <p className="mt-4 max-w-3xl text-sm/6 text-[var(--sj-ink-soft)]">
            MCP deliberately has no arbitrary URL import tool. For imports, let the agent read the source you provide and
            create structured Spoonjoy data through <code className="font-sj-ui font-semibold text-[var(--sj-ink)]">create_recipe</code>.
            AI cover generation also stays out of MCP. For broader REST and OpenAPI access, use the{" "}
            <a className="font-semibold text-[var(--sj-tomato)] underline-offset-4 hover:underline" href="/api">
              API guide
            </a>.
          </p>
        </section>

        <section>
          <CookbookSectionTitle>How To Connect</CookbookSectionTitle>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
            {setupSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <article key={step.title} className="border-t border-[var(--sj-border-strong)] pt-5">
                  <div className="flex items-center gap-3">
                    <span className="font-sj-ui flex size-8 items-center justify-center border border-[var(--sj-border)] text-sm font-bold text-[var(--sj-brass)]">
                      {index + 1}
                    </span>
                    <Icon className="size-5 text-[var(--sj-herb)]" aria-hidden="true" />
                  </div>
                  <h3 className="font-sj-display mt-4 text-2xl/7 font-semibold text-[var(--sj-ink)]">{step.title}</h3>
                  <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{step.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)]">
          <div>
            <CookbookSectionTitle>Claude Code</CookbookSectionTitle>
            <p className="mb-4 max-w-3xl text-sm/6 text-[var(--sj-ink-soft)]">
              After you create a Spoonjoy token, add the remote server with an explicit bearer header:
            </p>
            <CodeBlock>
              {'TOKEN=sj_your_token_here\nclaude mcp add --transport http \\\n  spoonjoy \\\n  https://spoonjoy.app/mcp \\\n  --header "Authorization: Bearer $TOKEN"'}
            </CodeBlock>
          </div>

          <aside className="border-y border-[var(--sj-border-strong)] py-6">
            <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Auth Discovery</h2>
            <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">
              OAuth-ready MCP agents learn where to authorize from Spoonjoy's protected-resource metadata.
            </p>
            <div className="mt-4 overflow-hidden border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-3">
              <a
                className="break-words font-sj-ui text-sm/6 font-semibold text-[var(--sj-tomato)] underline-offset-4 hover:underline"
                href="/.well-known/oauth-protected-resource/mcp"
              >
                Protected-resource metadata
              </a>
              <p className="mt-2 break-words font-mono text-xs/5 text-[var(--sj-ink-soft)]">
                {protectedResourceMetadataUrl}
              </p>
            </div>
          </aside>
        </section>
      </div>
    </CookbookPage>
  );
}
