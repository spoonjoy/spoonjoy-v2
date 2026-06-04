import type { Route } from "./+types/agent.connect";
import { Form, redirect, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";

type LoaderData = {
  code: string;
  error: string | null;
};

function normalizeUserCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

async function redirectForCode(request: Request, context: Route.LoaderArgs["context"], code: string): Promise<void> {
  const userCode = normalizeUserCode(code);
  if (!userCode) return;
  const db = await getRequestDb(context);
  const connection = await db.agentConnectionRequest.findUnique({ where: { userCode } });
  if (!connection) return;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  throw redirect(`/agent/connect/${connection.id}?code=${encodeURIComponent(userCode)}${from === null ? "" : `&from=${encodeURIComponent(from)}`}`);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  await redirectForCode(request, context, code);
  return {
    code: normalizeUserCode(code),
    error: code ? "That connection code was not found or has expired." : null,
  } satisfies LoaderData;
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const code = normalizeUserCode(formData.get("code")?.toString() ?? "");
  await redirectForCode(request, context, code);
  return { code, error: "That connection code was not found or has expired." } satisfies LoaderData;
}

export default function AgentConnectLookup() {
  const data = useLoaderData<typeof loader>();

  return (
    <main className="mx-auto flex min-h-[70svh] w-full max-w-xl flex-col justify-center px-6 py-12">
      <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        Agent access
      </p>
      <Heading className="mt-3">Enter Connection Code</Heading>
      <Text className="mt-5 text-lg/7">
        Enter the short Spoonjoy code shown by your device, CLI, or agent. You will sign in before approving access.
      </Text>
      <Form method="post" className="mt-8 grid gap-4">
        <label className="grid gap-2 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
          Connection code
          <input
            name="code"
            defaultValue={data.code}
            autoComplete="one-time-code"
            placeholder="ABCD-2345"
            className="min-h-12 border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 font-sj-ui text-xl font-semibold tracking-[0.12em] text-[var(--sj-ink)] outline-none focus:border-[var(--sj-brass)]"
          />
        </label>
        {data.error ? <Text role="alert">{data.error}</Text> : null}
        <div>
          <Button type="submit">Continue</Button>
        </div>
      </Form>
    </main>
  );
}
