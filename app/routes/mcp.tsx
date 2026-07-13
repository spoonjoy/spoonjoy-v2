import type { Route } from "./+types/mcp";
import type { ReactNode } from "react";
import { useLoaderData } from "react-router";
import {
  BookOpen,
  Braces,
  Cable,
  ChefHat,
  KeyRound,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Terminal,
} from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";
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
  const cloudflare = context.cloudflare;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  const cfEnv = cloudflare?.env;
  const db = await getRequestDb(context);

  return handleMcpHttpRequest({
    request,
    db,
    cloudflareEnv: cfEnv ?? null,
    waitUntil,
    tokenLimiter: cfEnv?.API_TOKEN_RATE_LIMITER,
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
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
      content: "Connect AI assistants to your Spoonjoy kitchen with the remote MCP endpoint for recipes, cookbooks, search, and shopping lists.",
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

const capabilities = [
  {
    title: "Find kitchen memory",
    body: "Search public recipes plus your private kitchen data when your token has access.",
    icon: Search,
  },
  {
    title: "Work with recipes",
    body: "Create, read, edit, fork, delete, spoon, and upload user-provided images through the shared Spoonjoy operation layer.",
    icon: ChefHat,
  },
  {
    title: "Organize cookbooks",
    body: "List cookbooks, inspect cookbook contents, create collections, and add or remove recipes you own.",
    icon: BookOpen,
  },
  {
    title: "Manage the shopping list",
    body: "Read and update owner-scoped shopping list items from the assistant that you authorize.",
    icon: ShoppingBasket,
  },
] as const;

const setupSteps = [
  {
    title: "Use OAuth when the client supports it",
    body: "claude.ai, Claude Desktop, and similar clients that understand MCP protected-resource discovery, dynamic registration, and PKCE can discover Spoonjoy auth from the endpoint challenge, then send you through normal sign-in and consent.",
    icon: ShieldCheck,
  },
  {
    title: "Use a bearer token for Claude Code",
    body: "Create an owner-scoped Spoonjoy token, store it like a password, then pass it as an Authorization header when adding the remote MCP server.",
    icon: Terminal,
  },
  {
    title: "Keep scopes tight",
    body: "Kitchen scopes unlock the recipe and cookbook tool surface. Shopping-list-only clients can use shopping-list scopes. Token lifecycle tools are available only to credentials with token scopes.",
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
            Spoonjoy MCP lets AI assistants use your kitchen as tools: recipes, cookbooks, search, and your shopping list,
            all scoped to the Spoonjoy account and permissions you authorize.
          </p>
        </CookbookHeader>

        <section className="min-w-0 border-y border-[var(--sj-border-strong)] py-5" aria-labelledby="mcp-tldr">
          <p id="mcp-tldr" className="sj-eyebrow">TL;DR</p>
          <p className="mt-3 max-w-4xl text-xl/8 text-[var(--sj-ink)]">
            Authorize Spoonjoy once, then your AI assistant can help with the kitchen you already keep here:
            finding recipes, organizing cookbooks, and updating your shopping list. OAuth-capable clients can
            guide you through sign-in and consent; Claude Code can connect with a Spoonjoy bearer token.
          </p>
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
              Visiting this URL shows setup help. MCP clients send JSON-RPC to the same URL with{" "}
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
            MCP deliberately excludes arbitrary URL import and AI cover generation. For broader REST and OpenAPI access, use the{" "}
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
              {'claude mcp add --transport http spoonjoy https://spoonjoy.app/mcp \\\n  --header "Authorization: Bearer sj_your_token_here"'}
            </CodeBlock>
          </div>

          <aside className="border-y border-[var(--sj-border-strong)] py-6">
            <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Auth Discovery</h2>
            <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">
              OAuth-ready MCP clients learn where to authorize from Spoonjoy's protected-resource metadata.
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
