import { useLoaderData } from "react-router";
import type { ReactNode } from "react";
import {
  Activity,
  BookOpen,
  Braces,
  KeyRound,
  Link as LinkIcon,
  RefreshCw,
  ShieldCheck,
  ShoppingBasket,
} from "lucide-react";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES, API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Code, Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";

const DEVELOPER_SCOPES = [
  "public:read",
  "recipes:read",
  "cookbooks:read",
  "shopping_list:read",
  "shopping_list:write",
  "tokens:read",
  "tokens:write",
  "offline_access",
] as const;

const scopeLabels: Record<string, string> = {
  "public:read": "Public read",
  "recipes:read": "Recipe graph read",
  "cookbooks:read": "Cookbook graph read",
  "shopping_list:read": "Shopping list read",
  "shopping_list:write": "Shopping list write",
  "tokens:read": "Token metadata read",
  "tokens:write": "Token mint and revoke",
  offline_access: "Refresh-capable authorization",
};

const exactEndpointScopes = new Set(["shopping_list:write", "tokens:read", "tokens:write"]);

const authModels = [
  {
    title: "Personal API tokens",
    body: "Best for one chef wiring their own tools. Token secrets are shown once, stored hashed, and scoped at creation time.",
    icon: KeyRound,
  },
  {
    title: "OAuth/PKCE apps",
    body: "Best for third-party apps. Dynamic registration, authorize, and token routes are exposed for delegated consent.",
    icon: ShieldCheck,
  },
  {
    title: "MCP clients",
    body: "Best for assistant-style clients that need a tool connection instead of raw REST calls.",
    icon: LinkIcon,
  },
  {
    title: "Delegated and device-style authorization",
    body: "Best for clients that need a chef to approve access from a constrained device or external runtime.",
    icon: Activity,
  },
] as const;

const guideSteps = [
  "Read public recipes and cookbooks anonymously before adding auth.",
  "Mint a personal token or register an OAuth client when a client needs private or mutating access.",
  "Use a stable mutation id for shopping-list writes, then retry with the same value when a network call is interrupted.",
  "Use the sync cursor to fetch shopping-list changes, including removed items.",
] as const;

export function meta() {
  return [
    { title: "Spoonjoy Developer Platform | Spoonjoy" },
    {
      name: "description",
      content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, and scoped tokens.",
    },
  ];
}

export function loader() {
  return {
    resources: API_V1_RESOURCES,
    scopeRequirements: API_V1_SCOPE_REQUIREMENTS,
    errorStatus: API_V1_ERROR_STATUS,
    openapiUrl: "/api/v1/openapi.json",
    scopes: [...DEVELOPER_SCOPES],
  };
}

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "green" : method === "POST" ? "amber" : method === "PATCH" ? "blue" : "red";
  return <Badge color={color}>{method}</Badge>;
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--sj-border-strong)] py-8">
      <CookbookSectionTitle className="my-0">{title}</CookbookSectionTitle>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function scopeText(scope: string, exact: boolean) {
  if (exact) return scope;
  return scopeLabels[scope]!;
}

function scopeTone(scope: string) {
  if (scope.includes("write")) return "amber";
  if (scope.includes("tokens")) return "red";
  if (scope.includes("shopping")) return "green";
  return "zinc";
}

export default function Developers() {
  const { resources, scopeRequirements, errorStatus, openapiUrl, scopes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage className="sj-developer-page">
      <CookbookHeader eyebrow="API v1" title="Spoonjoy Developer Platform" action={(
        <Button href={openapiUrl} plain>
          <Braces data-slot="icon" aria-hidden="true" />
          OpenAPI JSON
        </Button>
      )}>
        <Text className="text-lg/8">
          Build clients on Spoonjoy's public-by-default Chef graph, then add scoped auth only when a workflow needs private
          shopping-list state, token management, or delegated access.
        </Text>
      </CookbookHeader>

      <section className="grid gap-4 border-b border-[var(--sj-border-strong)] py-6 md:grid-cols-4">
        {[
          ["Version", "v1"],
          ["Base path", "REST v1"],
          ["Spec", "Machine-readable"],
          ["Errors", `${Object.keys(errorStatus).length} codes`],
        ].map(([label, value]) => (
          <div key={label} className="border-l border-[var(--sj-border)] pl-4">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">{label}</p>
            <p className="mt-1 break-words font-sj-display text-2xl/8 font-semibold text-[var(--sj-ink)]">{value}</p>
          </div>
        ))}
      </section>

      <SectionShell title="Reference">
        <div className="grid gap-3">
          {resources.map((resource) => {
            const methodRows = resource.methods.map((method) => ({
              method,
              requirement: scopeRequirements.find((row) => row.path === resource.path && row.method === method),
            }));

            return (
              <article
                key={resource.name}
                data-testid={`developer-resource-${resource.name}`}
                className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)_minmax(12rem,18rem)]"
              >
                <div>
                  <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                    {resource.name}
                  </p>
                  <p className="mt-1 break-words font-sj-ui text-sm/6 font-semibold text-[var(--sj-ink)]">{resource.path}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {methodRows.map(({ method, requirement }) => (
                    <span key={method} className="inline-flex items-center gap-2">
                      <MethodBadge method={method} />
                      {requirement?.scopes.length ? (
                        requirement.scopes.map((scope) => (
                          <Badge key={scope} color={scopeTone(scope) as "amber" | "green" | "red" | "zinc"}>
                            {scopeText(scope, resource.name === "tokens" || resource.name === "shopping-list-items")}
                          </Badge>
                        ))
                      ) : (
                        <Badge>Anonymous</Badge>
                      )}
                    </span>
                  ))}
                </div>
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  {resource.auth === "bearer" ? "Authenticated chef surface." : "Anonymous callers allowed; bearer callers are scope checked."}
                </p>
              </article>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="Scopes">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scopes.map((scope) => (
            <div key={scope} className="border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_70%,transparent)] p-4">
              <p className="font-sj-ui text-sm/5 font-bold text-[var(--sj-ink)]">
                {exactEndpointScopes.has(scope) ? scopeLabels[scope] : scope}
              </p>
              <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{scopeLabels[scope]}</p>
            </div>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Auth">
        <div className="grid gap-4 md:grid-cols-2">
          {authModels.map(({ title, body, icon: Icon }) => (
            <article key={title} className="border-y border-[var(--sj-border)] py-5">
              <Icon className="size-5 text-[var(--sj-brass)]" aria-hidden="true" />
              <h3 className="mt-3 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{title}</h3>
              <Text className="mt-2">{body}</Text>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Sync And Safety">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <div className="space-y-4 text-base/7 text-[var(--sj-ink-soft)]">
            <p>
              Idempotent shopping-list mutations use <Code>clientMutationId</Code> so clients can retry add, check,
              and remove calls without duplicating writes.
            </p>
            <p>
              Shopping-list reads support cursor sync and return tombstones for removed items. Checked and deleted
              state uses server-order last-writer-wins semantics.
            </p>
            <p>
              Spoonjoy endpoints are rate limited by IP and credential where applicable. Treat <Code>429</Code> as
              retryable, use backoff, and keep the same mutation id when retrying a write.
            </p>
          </div>
          <div className="border border-[var(--sj-border-strong)] bg-[var(--sj-photo-charcoal)] p-5 text-[var(--sj-on-photo)]">
            <ShoppingBasket className="size-5 text-[var(--sj-on-photo-warm)]" aria-hidden="true" />
            <p className="font-sj-ui mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-on-photo-muted)]">
              Sample flow
            </p>
            <ol className="mt-3 space-y-3 text-sm/6 text-[var(--sj-on-photo-muted)]">
              {guideSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </div>
      </SectionShell>

      <SectionShell title="Client Starting Points">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Public catalog", "GET /api/v1/recipes and GET /api/v1/cookbooks need no token.", BookOpen],
            ["Private list", "Use shopping-list read and write scopes for pantry-style clients.", RefreshCw],
            ["Machine errors", "Every v1 error returns ok false, requestId, code, message, and status.", Braces],
          ].map(([title, body, Icon]) => (
            <article key={title as string} className="border-t border-[var(--sj-border)] pt-4">
              <Icon className="size-5 text-[var(--sj-brass)]" aria-hidden="true" />
              <h3 className="mt-3 font-sj-display text-xl/7 font-semibold text-[var(--sj-ink)]">{title as string}</h3>
              <Text className="mt-1">{body as string}</Text>
            </article>
          ))}
        </div>
      </SectionShell>
    </CookbookPage>
  );
}
