import { type FormEvent, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { CheckCircle2, Play, ShieldOff, Terminal, XCircle } from "lucide-react";
import { API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Code, Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";

type PlaygroundParam = {
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
};

type PlaygroundEndpoint = {
  id: string;
  label: string;
  method: "GET";
  path: string;
  description: string;
  scopes: readonly string[];
  params: readonly PlaygroundParam[];
};

export const PLAYGROUND_ENDPOINTS: readonly PlaygroundEndpoint[] = [
  {
    id: "root",
    label: "Discovery",
    method: "GET",
    path: "/api/v1",
    description: "API version, docs, auth links, and supported resources.",
    scopes: [],
    params: [],
  },
  {
    id: "health",
    label: "Health",
    method: "GET",
    path: "/api/v1/health",
    description: "Health, optional auth summary, and expanded scopes for the current bearer.",
    scopes: [],
    params: [],
  },
  {
    id: "recipes",
    label: "Recipe Search",
    method: "GET",
    path: "/api/v1/recipes",
    description: "Search public recipe summaries from the Chef graph.",
    scopes: ["recipes:read"],
    params: [
      { name: "query", label: "Query", defaultValue: "", placeholder: "pasta" },
      { name: "limit", label: "Limit", defaultValue: "10", placeholder: "20" },
    ],
  },
  {
    id: "cookbooks",
    label: "Cookbook Search",
    method: "GET",
    path: "/api/v1/cookbooks",
    description: "Search public cookbook summaries and active recipe counts.",
    scopes: ["cookbooks:read"],
    params: [
      { name: "query", label: "Query", defaultValue: "", placeholder: "weeknight" },
      { name: "limit", label: "Limit", defaultValue: "10", placeholder: "20" },
    ],
  },
] as const;

type PlaygroundResponse = {
  status: number;
  statusText: string;
  requestId: string | null;
  body: string;
};

function defaultParams(endpoint: PlaygroundEndpoint): Record<string, string> {
  return Object.fromEntries(endpoint.params.map((param) => [param.name, param.defaultValue]));
}

export function playgroundPath(endpoint: PlaygroundEndpoint, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const param of endpoint.params) {
    const value = params[param.name]?.trim();
    if (value) search.set(param.name, value);
  }
  const query = search.toString();
  return query ? `${endpoint.path}?${query}` : endpoint.path;
}

function curlFor(path: string, useAuth: boolean) {
  const headers = useAuth ? "\n  -H 'Authorization: Bearer sj_token'" : "";
  return `curl 'https://spoonjoy.app${path}'${headers}`;
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function playgroundRequestId(
  cryptoLike: Pick<Crypto, "randomUUID"> | null | undefined = globalThis.crypto,
  now = Date.now(),
) {
  if (cryptoLike && "randomUUID" in cryptoLike) {
    return `pg_${cryptoLike.randomUUID()}`;
  }
  return `pg_${now}`;
}

export async function playgroundResponseFromFetchResult(result: Response): Promise<PlaygroundResponse> {
  const text = await result.text();
  let body = text;
  try {
    body = prettyJson(JSON.parse(text) as unknown);
  } catch {
    body = text || "(empty response)";
  }
  return {
    status: result.status,
    statusText: result.statusText || (result.ok ? "OK" : "ERROR"),
    requestId: result.headers.get("X-Request-Id"),
    body,
  };
}

export function playgroundNetworkError(error: unknown): PlaygroundResponse {
  return {
    status: 0,
    statusText: "NETWORK ERROR",
    requestId: null,
    body: error instanceof Error ? error.message : "Request failed",
  };
}

export function meta() {
  return [
    { title: "Spoonjoy API Playground | Spoonjoy" },
    {
      name: "description",
      content: "Try safe Spoonjoy API v1 requests from the developer playground.",
    },
  ];
}

export function loader() {
  return {
    endpoints: PLAYGROUND_ENDPOINTS,
    scopeRequirements: API_V1_SCOPE_REQUIREMENTS,
  };
}

export default function DeveloperPlayground() {
  const { endpoints } = useLoaderData<typeof loader>();
  const [selectedId, setSelectedId] = useState(endpoints[0].id);
  const selected = endpoints.find((endpoint) => endpoint.id === selectedId)!;
  const [paramsByEndpoint, setParamsByEndpoint] = useState<Record<string, Record<string, string>>>(() => (
    Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, defaultParams(endpoint)]))
  ));
  const [useAuth, setUseAuth] = useState(false);
  const [token, setToken] = useState("");
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const [isSending, setIsSending] = useState(false);

  const params = paramsByEndpoint[selected.id]!;
  const path = useMemo(() => playgroundPath(selected, params), [selected, params]);
  const curl = curlFor(path, useAuth);

  function updateParam(name: string, value: string) {
    setParamsByEndpoint((current) => ({
      ...current,
      [selected.id]: {
        ...current[selected.id]!,
        [name]: value,
      },
    }));
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const headers: Record<string, string> = { "X-Request-Id": playgroundRequestId() };
    if (useAuth && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;

    setIsSending(true);
    try {
      const result = await fetch(path, { method: selected.method, headers });
      setResponse(await playgroundResponseFromFetchResult(result));
    } catch (error) {
      setResponse(playgroundNetworkError(error));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <CookbookPage className="sj-developer-playground">
      <CookbookHeader eyebrow="API v1" title="Spoonjoy API Playground" action={(
        <Button href="/developers" plain>
          <Terminal data-slot="icon" aria-hidden="true" />
          Docs
        </Button>
      )}>
        <Text className="text-lg/8">
          Run safe read-only Spoonjoy requests against the live v1 API. Auth stays off unless a request needs it.
        </Text>
      </CookbookHeader>

      <form onSubmit={sendRequest} className="grid gap-6 border-t border-[var(--sj-border-strong)] py-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section aria-label="Endpoints" className="grid content-start gap-2">
          {endpoints.map((endpoint) => (
            <button
              key={endpoint.id}
              type="button"
              onClick={() => setSelectedId(endpoint.id)}
              className={`grid gap-2 border p-4 text-left transition ${
                endpoint.id === selected.id
                  ? "border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))]"
                  : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)] hover:border-[var(--sj-border-strong)]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-sj-ui text-sm/5 font-bold text-[var(--sj-ink)]">{endpoint.label}</span>
                <Badge color="green">{endpoint.method}</Badge>
              </span>
              <span className="break-words font-mono text-xs/5 text-[var(--sj-ink-soft)]">{endpoint.path}</span>
            </button>
          ))}
        </section>

        <section className="grid gap-5">
          <div className="border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CookbookSectionTitle className="my-0">{selected.label}</CookbookSectionTitle>
                <p className="mt-2 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">{selected.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge color="green">{selected.method}</Badge>
                {selected.scopes.length ? selected.scopes.map((scope) => (
                  <Badge key={scope} color="zinc">{scope}</Badge>
                )) : <Badge color="zinc">Anonymous</Badge>}
              </div>
            </div>

            {selected.params.length ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {selected.params.map((param) => (
                  <label key={param.name} className="grid gap-2 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                    {param.label}
                    <input
                      value={params[param.name]}
                      onChange={(event) => updateParam(param.name, event.target.value)}
                      placeholder={param.placeholder}
                      className="min-h-11 border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 text-base font-normal text-[var(--sj-ink)] outline-none focus:border-[var(--sj-brass)]"
                    />
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 border-t border-[var(--sj-border)] pt-5">
              <label className="flex items-center gap-3 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                <input
                  type="checkbox"
                  checked={useAuth}
                  onChange={(event) => setUseAuth(event.target.checked)}
                  className="size-4 accent-[var(--sj-brass)]"
                />
                Attach bearer token
              </label>
              {useAuth ? (
                <input
                  aria-label="Bearer token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder="sj_..."
                  className="min-h-11 border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 font-mono text-sm text-[var(--sj-ink)] outline-none focus:border-[var(--sj-brass)]"
                />
              ) : (
                <p className="flex items-center gap-2 text-sm/6 text-[var(--sj-ink-soft)]">
                  <ShieldOff className="size-4 text-[var(--sj-brass)]" aria-hidden="true" />
                  This request will not send an Authorization header.
                </p>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              <p className="break-words font-mono text-sm/6 text-[var(--sj-ink)]">
                <Code>{path}</Code>
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                {curl}
              </pre>
            </div>

            <div className="mt-5">
              <Button type="submit" disabled={isSending}>
                <Play data-slot="icon" aria-hidden="true" />
                {isSending ? "Sending" : "Send Request"}
              </Button>
            </div>
          </div>

          <section className="border border-[var(--sj-border-strong)] bg-[var(--sj-photo-charcoal)] p-5 text-[var(--sj-on-photo)]" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CookbookSectionTitle className="my-0 text-[var(--sj-on-photo)]">Response</CookbookSectionTitle>
              {response ? (
                <span className="inline-flex items-center gap-2 font-sj-ui text-sm font-semibold">
                  {response.status >= 200 && response.status < 300 ? (
                    <CheckCircle2 className="size-4 text-[var(--sj-on-photo-warm)]" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4 text-[var(--sj-tomato)]" aria-hidden="true" />
                  )}
                  {response.status} {response.statusText}
                </span>
              ) : null}
            </div>
            {response?.requestId ? (
              <p className="mt-3 font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">Request ID: {response.requestId}</p>
            ) : null}
            <pre className="mt-4 min-h-64 overflow-x-auto whitespace-pre-wrap font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">
              {response ? response.body : "No response yet."}
            </pre>
          </section>
        </section>
      </form>
    </CookbookPage>
  );
}
