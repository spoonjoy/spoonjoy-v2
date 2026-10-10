import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup as cleanupDom, fireEvent, render, screen } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import AgentConnectLookup, { action as lookupAction, loader as lookupLoader, meta as lookupMeta } from "~/routes/agent.connect";
import AgentConnect, { action, loader, meta } from "~/routes/agent.connect.$requestId";
import { startAgentConnection } from "~/lib/agent-connection.server";
import { rememberTypedCode } from "~/lib/agent-connection-route.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";

function routeArgs(request: Request, requestId: string) {
  return {
    request,
    params: { requestId },
    context: { cloudflare: { env: null } },
  } as any;
}

function lookupArgs(request: Request) {
  return {
    request,
    context: { cloudflare: { env: null } },
  } as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function formRequest(url: string, intent: string, cookie?: string, userCode?: string) {
  const formData = new UndiciFormData();
  formData.set("intent", intent);
  if (userCode) formData.set("userCode", userCode);
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  return new UndiciRequest(url, { method: "POST", body: formData, headers });
}

function rawFormRequest(url: string, formData: UndiciFormData, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  return new UndiciRequest(url, { method: "POST", body: formData, headers });
}

function lookupFormRequest(url: string, code: string) {
  const formData = new UndiciFormData();
  formData.set("code", code);
  return new UndiciRequest(url, { method: "POST", body: formData });
}

function renderWithData(data: unknown) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: AgentConnect,
      loader: () => data,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

function renderLookupWithData(data: unknown) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: AgentConnectLookup,
      loader: () => data,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("agent connect route", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  let userEmail: string;
  const activeNow = new Date("2099-05-26T12:00:00Z");

  it("returns the connect-an-agent document title for the lookup page", () => {
    expect(lookupMeta({} as any)).toEqual([
      { title: "Connect an agent - Spoonjoy" },
      { name: "description", content: "Connect an agent to your Spoonjoy kitchen." },
    ]);
  });

  it("titles the connection page by status", () => {
    expect(meta({ data: { status: "pending" } } as any)).toEqual([
      { title: "Connect Spoonjoy" },
      { name: "description", content: "Connect an agent to your Spoonjoy kitchen." },
    ]);
    expect(meta({ data: { status: "approved" } } as any)[0]).toEqual({ title: "Spoonjoy Connected" });
    expect(meta({ data: { status: "claimed" } } as any)[0]).toEqual({ title: "Spoonjoy Connected" });
    expect(meta({ data: { status: "denied" } } as any)[0]).toEqual({ title: "Connection Denied" });
    expect(meta({ data: { status: "missing" } } as any)[0]).toEqual({ title: "Connection Expired" });
    expect(meta({ data: undefined } as any)[0]).toEqual({ title: "Connection Expired" });
  });

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userEmail = `${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
    const user = await db.user.create({
      data: { email: userEmail, username: faker.internet.username() },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("sends a typed code to its request and remembers it there, but never takes the code from a link", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const compactCode = started.request.userCode.toLowerCase().replace("-", "");

    // A link with the code in it (older agents, or someone else's link) shows an empty form.
    await expect(lookupLoader(lookupArgs(new UndiciRequest(`http://localhost/agent/connect?code=${compactCode}`))))
      .resolves.toEqual({ code: "", error: null });

    // The redirect also sets the signed code cookie (asserted in agent-connect-cookie.test.ts,
    // which runs where Set-Cookie is readable). Here the cookie is built the same way.
    await expect(lookupAction(lookupArgs(lookupFormRequest("http://localhost/agent/connect", compactCode))))
      .rejects.toSatisfy((response: Response) => {
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(`/agent/connect/${started.request.id}`);
        return true;
      });
    const codeCookie = await rememberTypedCode(null, new Request("http://localhost/agent/connect"), started.request.id, started.request.userCode);

    // The approval page then shows the code as confirmed for that request only.
    const cookie = `${await sessionCookie(userId)}; ${codeCookie.split(";")[0]}`;
    await expect(loader(routeArgs(
      new UndiciRequest(`http://localhost/agent/connect/${started.request.id}`, { headers: { Cookie: cookie } }),
      started.request.id,
    ))).resolves.toMatchObject({ status: "pending", confirmedCode: started.request.userCode });
    const other = await startAgentConnection(db, { now: activeNow });
    await expect(loader(routeArgs(
      new UndiciRequest(`http://localhost/agent/connect/${other.request.id}`, { headers: { Cookie: cookie } }),
      other.request.id,
    ))).resolves.toMatchObject({ status: "pending", confirmedCode: null });

    const failedAction = await lookupAction(lookupArgs(lookupFormRequest("http://localhost/agent/connect", "missing")));
    expect(failedAction).toEqual({
      code: "MISS-ING",
      error: "That connection code was not found or has expired.",
    });

    renderLookupWithData({ code: "", error: null });
    expect(await screen.findByRole("heading", { name: "Enter Connection Code" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ABCD-2345")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a code posted to the lookup page from another site", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    for (const headers of [{ Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }, { Origin: "null" }]) {
      const formData = new UndiciFormData();
      formData.set("code", started.request.userCode);
      const response = await lookupAction(lookupArgs(new UndiciRequest("http://localhost/agent/connect", {
        method: "POST",
        body: formData,
        headers,
      })));
      expect((response as any).init.status).toBe(403);
      expect((response as any).init.headers).toBeUndefined();
    }
  });

  it("limits code guesses per address and per signed-in chef, before looking the code up", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const seen: string[] = [];
    // A limiter that has used up the budget for one key prefix only.
    const limiterRefusing = (prefix: string) => ({
      limit: async ({ key }: { key: string }) => {
        seen.push(key);
        return { success: !key.startsWith(prefix), reset: 42 };
      },
    });
    const lookup = (prefix: string, headers: Record<string, string>) => {
      const formData = new UndiciFormData();
      formData.set("code", started.request.userCode);
      return lookupAction({
        request: new UndiciRequest("http://localhost/agent/connect", { method: "POST", body: formData, headers }),
        context: { cloudflare: { env: { AUTH_IP_RATE_LIMITER: limiterRefusing(prefix) } } },
      } as any);
    };
    const expectRefused = (response: any) => {
      expect(response.init.status).toBe(429);
      expect(response.init.headers).toEqual({ "Retry-After": "42" });
      expect(response.data).toEqual({
        code: started.request.userCode,
        error: "Too many codes tried. Please wait a minute and try again.",
      });
    };
    const signedIn = { Cookie: await sessionCookie(userId) };

    // Even the right code is refused once this address has used its guesses.
    expectRefused(await lookup("agent-code:ip:203.0.113.7", { "CF-Connecting-IP": "203.0.113.7" }));
    // A chef who has used their guesses is refused from a fresh address too.
    expectRefused(await lookup(`agent-code:user:${userId}`, { ...signedIn, "CF-Connecting-IP": "198.51.100.9" }));
    // Lookups have their own budget, so they never use up the login and signup limit (keyed "ip:").
    expect(seen).toEqual([
      "agent-code:ip:203.0.113.7",
      "agent-code:ip:198.51.100.9",
      `agent-code:user:${userId}`,
    ]);

    // Within budget, the lookup goes through as before.
    await expect(lookup("agent-code:none", { ...signedIn, "CF-Connecting-IP": "198.51.100.9" })).rejects.toSatisfy(
      (response: Response) => response.status === 302
        && response.headers.get("Location") === `/agent/connect/${started.request.id}`,
    );
  });

  it("still looks codes up when the limiter is down", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const formData = new UndiciFormData();
    formData.set("code", started.request.userCode);
    await expect(lookupAction({
      request: new UndiciRequest("http://localhost/agent/connect", { method: "POST", body: formData }),
      context: { cloudflare: { env: { AUTH_IP_RATE_LIMITER: { limit: async () => { throw new Error("down"); } } } } },
    } as any)).rejects.toSatisfy((response: Response) => response.status === 302);
  });

  it("renders lookup errors for empty submissions", async () => {
    const emptyAction = await lookupAction(lookupArgs(lookupFormRequest("http://localhost/agent/connect", "")));
    expect(emptyAction).toEqual({
      code: "",
      error: "That connection code was not found or has expired.",
    });

    const emptyForm = await lookupAction(lookupArgs(rawFormRequest("http://localhost/agent/connect", new UndiciFormData())));
    expect(emptyForm).toEqual({
      code: "",
      error: "That connection code was not found or has expired.",
    });
  });

  it("redirects pending unauthenticated approvals to login without carrying a code along", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const request = new UndiciRequest(`http://localhost/agent/connect/${started.request.id}?code=${started.request.userCode}`);

    await expect(loader(routeArgs(request, started.request.id))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/login?redirectTo=${encodeURIComponent(`/agent/connect/${started.request.id}`)}`,
      );
      return true;
    });
  });

  it("loads a pending connection with the requester's details but without the code from the link", async () => {
    const started = await startAgentConnection(db, {
      agentName: "Spoonjoy for iPhone",
      now: new Date(Date.now() - 3 * 60_000),
      requester: { ip: "203.0.113.9", userAgent: "curl/8.7.1", country: "NZ" },
    });
    const cookie = await sessionCookie(userId);
    const request = new UndiciRequest(`http://localhost/agent/connect/${started.request.id}?code=${started.request.userCode}`, {
      headers: { Cookie: cookie, "CF-IPCountry": "US" },
    });

    const loaded = await loader(routeArgs(request, started.request.id));
    expect(loaded).toMatchObject({
      status: "pending",
      agentName: "Spoonjoy for iPhone",
      userEmail,
      scopes: ["shopping_list:read", "shopping_list:write"],
      confirmedCode: null,
      requester: { ip: "203.0.113.9", userAgent: "curl/8.7.1", country: "NZ", requestedMinutesAgo: 3 },
      approverCountry: "US",
    });
    expect(JSON.stringify(loaded)).not.toContain(started.request.userCode);

    await expect(loader(routeArgs(new UndiciRequest("http://localhost/agent/connect/missing"), "missing")))
      .resolves.toMatchObject({ status: "missing", userEmail: null, expiresAt: null });
  });

  it("lets unauthenticated users view already-finished connection links without loading a user", async () => {
    const started = await startAgentConnection(db, {
      agentName: "slugger",
      now: activeNow,
    });
    await db.agentConnectionRequest.update({
      where: { id: started.request.id },
      data: { status: "denied", deniedAt: activeNow },
    });

    const loaded = await loader(routeArgs(
      new UndiciRequest(`http://localhost/agent/connect/${started.request.id}`),
      started.request.id,
    ));
    expect(loaded).toMatchObject({
      status: "denied",
      agentName: "slugger",
      userEmail: null,
      scopes: ["shopping_list:read", "shopping_list:write"],
    });
    expect(JSON.stringify(loaded)).not.toContain(started.request.userCode);
  });

  it("approves and denies only with the code the chef typed, and redirects unauthenticated actions", async () => {
    const approveTarget = await startAgentConnection(db, { now: activeNow });
    const denyTarget = await startAgentConnection(db, { now: activeNow });
    const cookie = await sessionCookie(userId);

    // One click on Approve, with no typed code, does nothing.
    const noCode = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${approveTarget.request.id}?code=${approveTarget.request.userCode}`, "approve", cookie),
      approveTarget.request.id,
    ));
    expect((noCode as any).init.status).toBe(400);
    expect((noCode as any).data.error).toContain("doesn't match");
    await expect(db.agentConnectionRequest.findUnique({ where: { id: approveTarget.request.id } }))
      .resolves.toMatchObject({ status: "pending", approvedById: null });

    const wrongCode = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${approveTarget.request.id}`, "approve", cookie, "WRNG-0000"),
      approveTarget.request.id,
    ));
    expect((wrongCode as any).init.status).toBe(400);

    // Approval from another site is refused even with the right code.
    const crossSiteForm = new UndiciFormData();
    crossSiteForm.set("intent", "approve");
    crossSiteForm.set("userCode", approveTarget.request.userCode);
    const crossSite = await action(routeArgs(new UndiciRequest(`http://localhost/agent/connect/${approveTarget.request.id}`, {
      method: "POST",
      body: crossSiteForm,
      headers: { Cookie: cookie, Origin: "https://evil.example" },
    }), approveTarget.request.id));
    expect((crossSite as any).init.status).toBe(403);
    await expect(db.agentConnectionRequest.findUnique({ where: { id: approveTarget.request.id } }))
      .resolves.toMatchObject({ status: "pending" });

    const typed = approveTarget.request.userCode.toLowerCase().replace("-", " ");
    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${approveTarget.request.id}`, "approve", cookie, typed),
      approveTarget.request.id,
    ))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/agent/connect/${approveTarget.request.id}`);
      return true;
    });
    await expect(db.agentConnectionRequest.findUnique({ where: { id: approveTarget.request.id } }))
      .resolves.toMatchObject({ status: "approved", approvedById: userId });

    // A leaked link or a guessed request is not enough to cancel someone's connection: deny needs
    // the same code proof as approve.
    for (const userCode of [undefined, "WRNG-0000"]) {
      const refusedDeny = await action(routeArgs(
        formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "deny", cookie, userCode),
        denyTarget.request.id,
      ));
      expect((refusedDeny as any).init.status).toBe(400);
      expect((refusedDeny as any).data.error).toBe("That code doesn't match. To deny, type the code your agent shows you.");
    }
    await expect(db.agentConnectionRequest.findUnique({ where: { id: denyTarget.request.id } }))
      .resolves.toMatchObject({ status: "pending" });

    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "deny", cookie, denyTarget.request.userCode),
      denyTarget.request.id,
    ))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      return true;
    });
    await expect(db.agentConnectionRequest.findUnique({ where: { id: denyTarget.request.id } }))
      .resolves.toMatchObject({ status: "denied" });

    const invalid = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "later", cookie, denyTarget.request.userCode),
      denyTarget.request.id,
    ));
    expect((invalid as any).init.status).toBe(400);
    expect((invalid as any).data.error).toBe("Choose approve or deny");

    const missingConnection = await action(routeArgs(
      formRequest("http://localhost/agent/connect/missing", "approve", cookie, "ABCD-1234"),
      "missing",
    ));
    expect((missingConnection as any).init.status).toBe(404);

    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "approve"),
      denyTarget.request.id,
    ))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/login?redirectTo=${encodeURIComponent(`/agent/connect/${denyTarget.request.id}`)}`);
      return true;
    });
  });

  it("approves with the code remembered from the lookup page", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const codeCookie = await rememberTypedCode(null, new Request("http://localhost/agent/connect"), started.request.id, started.request.userCode);
    const cookie = `${await sessionCookie(userId)}; ${codeCookie.split(";")[0]}`;
    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${started.request.id}`, "approve", cookie),
      started.request.id,
    ))).rejects.toSatisfy((response: Response) => response.status === 302);
    await expect(db.agentConnectionRequest.findUnique({ where: { id: started.request.id } }))
      .resolves.toMatchObject({ status: "approved", approvedById: userId });
  });

  it("denies with the code remembered from the lookup page, but not with another request's code", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const other = await startAgentConnection(db, { now: activeNow });
    const otherCookie = await rememberTypedCode(null, new Request("http://localhost/agent/connect"), other.request.id, other.request.userCode);
    const refused = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${started.request.id}`, "deny", `${await sessionCookie(userId)}; ${otherCookie.split(";")[0]}`),
      started.request.id,
    ));
    expect((refused as any).init.status).toBe(400);
    await expect(db.agentConnectionRequest.findUnique({ where: { id: started.request.id } }))
      .resolves.toMatchObject({ status: "pending" });

    const codeCookie = await rememberTypedCode(null, new Request("http://localhost/agent/connect"), started.request.id, started.request.userCode);
    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${started.request.id}`, "deny", `${await sessionCookie(userId)}; ${codeCookie.split(";")[0]}`),
      started.request.id,
    ))).rejects.toSatisfy((response: Response) => response.status === 302);
    await expect(db.agentConnectionRequest.findUnique({ where: { id: started.request.id } }))
      .resolves.toMatchObject({ status: "denied" });
  });

  it("reports a request that asks for account scopes instead of approving it", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    await db.agentConnectionRequest.update({ where: { id: started.request.id }, data: { scopes: "account:write" } });
    const cookie = await sessionCookie(userId);
    const refused = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${started.request.id}`, "approve", cookie, started.request.userCode),
      started.request.id,
    ));
    expect((refused as any).init.status).toBe(400);
    expect((refused as any).data.error).toContain("account access");
  });

  it("shows an approval error from the action, and pending requests saved without requester details", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/",
        Component: AgentConnect,
        loader: () => ({
          status: "pending",
          agentName: "slugger",
          userEmail,
          expiresAt: "2026-05-26T12:10:00.000Z",
          scopes: ["shopping_list:read"],
          confirmedCode: null,
          requester: null,
        }),
        action: () => ({ error: "That code doesn't match. Type the code your agent shows you." }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const codeInput = await screen.findByLabelText("Type the code your agent shows you");
    expect(screen.queryByText("Request details")).not.toBeInTheDocument();
    // On its own, the scopes section draws its own top and bottom rules.
    expect(screen.getByText("Requested scopes").parentElement).toHaveClass("mt-6", "border-y");
    fireEvent.change(codeInput, { target: { value: "WRNG-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve access" }));
    expect(await screen.findByText("That code doesn't match. Type the code your agent shows you.")).toBeInTheDocument();
  });

  it("shows the lookup page's error", async () => {
    renderLookupWithData({ code: "", error: "That connection code was not found or has expired." });
    expect(await screen.findByRole("alert")).toHaveTextContent("That connection code was not found or has expired.");
  });

  it("renders pending, approved, denied, and unavailable connection states", async () => {
    renderWithData({
      status: "pending",
      agentName: "slugger",
      userEmail,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: ["shopping_list:read", "shopping_list:write", "kitchen:write", "spoonjoy:custom"],
      confirmedCode: null,
      requester: { ip: "203.0.113.9", country: "NZ", userAgent: "curl/8.7.1", requestedMinutesAgo: 2 },
      approverCountry: "US",
    });
    expect(await screen.findByRole("heading", { name: "Connect Spoonjoy" })).toBeInTheDocument();
    expect(screen.getByText(/calling itself "slugger" wants permission/)).toBeInTheDocument();
    expect(screen.getByText(/did not verify who made this request/)).toBeInTheDocument();
    // Deny needs the code, so a chef who didn't start the request is told to leave it, not deny it.
    expect(screen.getByText(/close this page\. Without its code, nobody can approve it, and it expires on its own\./)).toBeInTheDocument();
    expect(screen.queryByText(/Deny it unless/)).not.toBeInTheDocument();
    expect(screen.getByText("2 minutes ago")).toBeInTheDocument();
    // Under "Request details", the scopes section shares its rule: one divider, not two.
    expect(screen.getByText("Request details").parentElement).toHaveClass("border-y");
    const scopesSection = screen.getByText("Requested scopes").parentElement!;
    expect(scopesSection).toHaveClass("border-b");
    expect(scopesSection).not.toHaveClass("border-y", "mt-6");
    expect(scopesSection.previousElementSibling).toBe(screen.getByText("Request details").parentElement);
    expect(screen.getByText("203.0.113.9 (NZ)")).toBeInTheDocument();
    expect(screen.getByText("curl/8.7.1")).toBeInTheDocument();
    expect(screen.getByText("US")).toBeInTheDocument();
    expect(screen.getByText("Read your shopping list")).toBeInTheDocument();
    expect(screen.getByText("Create, change, and delete your recipes, cookbooks, and shopping list")).toBeInTheDocument();
    expect(screen.getByText("Custom delegated scope")).toBeInTheDocument();
    const warnings = screen.getByRole("list", { name: "Write access warnings" });
    expect(warnings).toHaveTextContent("shopping_list:write, this client can add, check off, and remove items");
    expect(warnings).toHaveTextContent("kitchen:write, this client can create, change, and delete your recipes");
    expect(screen.getByText(`You are approving as ${userEmail}.`)).toBeInTheDocument();
    expect(screen.getByText(/lasts 90 days/)).toBeInTheDocument();
    const codeInput = screen.getByLabelText("Type the code your agent shows you");
    expect(codeInput).toHaveValue("");
    expect(codeInput).toBeRequired();
    // Phones offer the code from a message, capitalize as the chef types, and never autocorrect it.
    expect(codeInput).toHaveAttribute("autocomplete", "one-time-code");
    expect(codeInput).toHaveAttribute("autocapitalize", "characters");
    expect(codeInput).toHaveAttribute("autocorrect", "off");
    expect(codeInput).toHaveAttribute("spellcheck", "false");
    expect(screen.getByRole("button", { name: "Approve access" })).toBeInTheDocument();
    // Deny needs the code too, so the browser asks for it before either button submits.
    expect(screen.getByRole("button", { name: "Deny" })).not.toHaveAttribute("formnovalidate");

    cleanupDom();
    renderWithData({
      status: "pending",
      agentName: "slugger",
      userEmail,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: ["shopping_list:read"],
      confirmedCode: "ABCD-2345",
      requester: { ip: null, country: null, userAgent: null, requestedMinutesAgo: 0 },
      approverCountry: null,
    });
    expect(await screen.findByText("ABCD-2345")).toBeInTheDocument();
    expect(screen.getByText("Code you entered")).toBeInTheDocument();
    expect(screen.queryByLabelText("Type the code your agent shows you")).not.toBeInTheDocument();
    expect(screen.getByText("an unknown IP address")).toBeInTheDocument();
    expect(screen.getByText("less than a minute ago")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Write access warnings" })).not.toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "pending",
      agentName: "slugger",
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: [],
      requester: { ip: "198.51.100.1", country: null, userAgent: null, requestedMinutesAgo: 1 },
    });
    expect(await screen.findByText("1 minute ago")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.1")).toBeInTheDocument();
    expect(screen.queryByText("Requested scopes")).not.toBeInTheDocument();
    expect(screen.queryByText(/You are approving as/)).not.toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "approved",
      agentName: "slugger",
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: ["kitchen:read", "kitchen:write"],
    });
    expect(await screen.findByRole("heading", { name: "Spoonjoy Connected" })).toBeInTheDocument();
    // The name is still only what the client called itself.
    expect(screen.getByText('A client calling itself "slugger" is now connected to your Spoonjoy kitchen.')).toBeInTheDocument();
    expect(screen.getByText("Access granted")).toBeInTheDocument();
    expect(screen.getByText("Create, change, and delete your recipes, cookbooks, and shopping list")).toBeInTheDocument();
    expect(screen.getByText(/lasts 90 days from approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connected apps and tokens" })).toHaveAttribute("href", "/account/settings");
    expect(screen.queryByText(/did not verify/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve access" })).not.toBeInTheDocument();

    cleanupDom();
    renderWithData({ status: "claimed", agentName: "slugger", userEmail: null, expiresAt: null, scopes: [] });
    expect(await screen.findByRole("heading", { name: "Spoonjoy Connected" })).toBeInTheDocument();
    expect(screen.queryByText("Access granted")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connected apps and tokens" })).toBeInTheDocument();

    cleanupDom();
    renderWithData({ status: "denied", agentName: "slugger", userEmail: null, expiresAt: null, scopes: [] });
    expect(await screen.findByRole("heading", { name: "Connection Denied" })).toBeInTheDocument();
    expect(screen.getByText('The client calling itself "slugger" was not given access to your Spoonjoy kitchen.')).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage connected apps and tokens" })).not.toBeInTheDocument();

    cleanupDom();
    renderWithData({ status: "expired", agentName: "slugger", userEmail: null, expiresAt: null });
    expect(await screen.findByRole("heading", { name: "Connection Expired" })).toBeInTheDocument();
  });
});
