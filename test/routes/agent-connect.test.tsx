import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup as cleanupDom, render, screen } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import AgentConnectLookup, { action as lookupAction, loader as lookupLoader } from "~/routes/agent.connect";
import AgentConnect, { action, loader } from "~/routes/agent.connect.$requestId";
import { startAgentConnection } from "~/lib/agent-connection.server";
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

  it("looks up connection codes, preserves from links, and renders missing-code copy", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const compactCode = started.request.userCode.toLowerCase().replace("-", "");

    await expect(lookupLoader(lookupArgs(new UndiciRequest(
      `http://localhost/agent/connect?code=${compactCode}&from=pebble`,
    )))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/agent/connect/${started.request.id}?code=${encodeURIComponent(started.request.userCode)}&from=pebble`,
      );
      return true;
    });

    const missing = await lookupLoader(lookupArgs(new UndiciRequest("http://localhost/agent/connect?code=nope")));
    expect(missing).toEqual({
      code: "NOPE",
      error: "That connection code was not found or has expired.",
    });

    await expect(lookupAction(lookupArgs(lookupFormRequest("http://localhost/agent/connect", compactCode))))
      .rejects.toSatisfy((response: Response) => {
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(
          `/agent/connect/${started.request.id}?code=${encodeURIComponent(started.request.userCode)}`,
        );
        return true;
      });

    const failedAction = await lookupAction(lookupArgs(lookupFormRequest("http://localhost/agent/connect", "missing")));
    expect(failedAction).toEqual({
      code: "MISS-ING",
      error: "That connection code was not found or has expired.",
    });

    renderLookupWithData(missing);
    expect(await screen.findByRole("heading", { name: "Enter Connection Code" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("NOPE")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("not found or has expired");
  });

  it("renders the lookup form without an error before a code is entered", async () => {
    const empty = await lookupLoader(lookupArgs(new UndiciRequest("http://localhost/agent/connect")));
    expect(empty).toEqual({ code: "", error: null });

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

    renderLookupWithData(empty);
    expect(await screen.findByRole("heading", { name: "Enter Connection Code" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ABCD-2345")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("redirects pending unauthenticated approvals to login with the connection URL preserved", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    const request = new UndiciRequest(`http://localhost/agent/connect/${started.request.id}?code=${started.request.userCode}`);

    await expect(loader(routeArgs(request, started.request.id))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/login?redirectTo=${encodeURIComponent(`/agent/connect/${started.request.id}?code=${started.request.userCode}`)}`,
      );
      return true;
    });
  });

  it("treats pending links with the wrong code as unavailable before login", async () => {
    const started = await startAgentConnection(db, { now: activeNow });
    await expect(loader(routeArgs(
      new UndiciRequest(`http://localhost/agent/connect/${started.request.id}?code=WRNG-0000`),
      started.request.id,
    ))).resolves.toEqual({
      status: "missing",
      agentName: "this agent",
      userCode: null,
      scopes: [],
      userEmail: null,
      expiresAt: null,
    });
  });

  it("loads a pending connection for the signed-in approver and returns missing links safely", async () => {
    const started = await startAgentConnection(db, {
      agentName: "slugger",
      now: activeNow,
    });
    const cookie = await sessionCookie(userId);
    const request = new UndiciRequest(`http://localhost/agent/connect/${started.request.id}?code=${started.request.userCode}`, {
      headers: { Cookie: cookie },
    });

    await expect(loader(routeArgs(request, started.request.id))).resolves.toMatchObject({
      status: "pending",
      agentName: "slugger",
      userCode: started.request.userCode,
      userEmail,
      scopes: ["shopping_list:read", "shopping_list:write"],
    });

    await expect(loader(routeArgs(new UndiciRequest("http://localhost/agent/connect/missing"), "missing")))
      .resolves.toMatchObject({ status: "missing", userCode: null, userEmail: null, expiresAt: null });
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

    await expect(loader(routeArgs(
      new UndiciRequest(`http://localhost/agent/connect/${started.request.id}`),
      started.request.id,
    ))).resolves.toMatchObject({
      status: "denied",
      agentName: "slugger",
      userCode: started.request.userCode,
      userEmail: null,
      scopes: ["shopping_list:read", "shopping_list:write"],
    });
  });

  it("approves, denies, rejects bad intents, and redirects unauthenticated actions", async () => {
    const approveTarget = await startAgentConnection(db, { now: activeNow });
    const denyTarget = await startAgentConnection(db, { now: activeNow });
    const cookie = await sessionCookie(userId);

    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${approveTarget.request.id}`, "approve", cookie, approveTarget.request.userCode),
      approveTarget.request.id,
    ))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/agent/connect/${approveTarget.request.id}`);
      return true;
    });
    await expect(db.agentConnectionRequest.findUnique({ where: { id: approveTarget.request.id } }))
      .resolves.toMatchObject({ status: "approved", approvedById: userId });

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

    const wrongCode = await action(routeArgs(
      formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "approve", cookie, "WRNG-0000"),
      denyTarget.request.id,
    ));
    expect((wrongCode as any).init.status).toBe(400);
    expect((wrongCode as any).data.error).toBe("Connection code is required");

    const missingCodeForm = new UndiciFormData();
    missingCodeForm.set("intent", "approve");
    const missingCode = await action(routeArgs(
      rawFormRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, missingCodeForm, cookie),
      denyTarget.request.id,
    ));
    expect((missingCode as any).init.status).toBe(400);
    expect((missingCode as any).data.error).toBe("Connection code is required");

    const missingConnection = await action(routeArgs(
      formRequest("http://localhost/agent/connect/missing", "approve", cookie, "ABCD-1234"),
      "missing",
    ));
    expect((missingConnection as any).init.status).toBe(400);
    expect((missingConnection as any).data.error).toBe("Connection code is required");

    await expect(action(routeArgs(
      formRequest(`http://localhost/agent/connect/${denyTarget.request.id}`, "approve"),
      denyTarget.request.id,
    ))).rejects.toSatisfy((response: Response) => {
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`/login?redirectTo=${encodeURIComponent(`/agent/connect/${denyTarget.request.id}`)}`);
      return true;
    });
  });

  it("renders pending, approved, denied, and unavailable connection states", async () => {
    renderWithData({
      status: "pending",
      agentName: "slugger",
      userCode: "ABCD-2345",
      userEmail,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: ["shopping_list:read", "kitchen:write", "spoonjoy:custom"],
    });
    expect(await screen.findByRole("heading", { name: "Connect Spoonjoy" })).toBeInTheDocument();
    expect(screen.getByText(/slugger wants permission/)).toBeInTheDocument();
    expect(screen.getByText("ABCD-2345")).toBeInTheDocument();
    expect(screen.getByText("Read your shopping list")).toBeInTheDocument();
    expect(screen.getByText("Use write-capable kitchen tools and shopping-list writes")).toBeInTheDocument();
    expect(screen.getByText("Custom delegated scope")).toBeInTheDocument();
    expect(screen.getByText(`You are approving as ${userEmail}.`)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("broad kitchen scopes");
    expect(screen.getByRole("button", { name: "Approve Access" })).toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "approved",
      agentName: "slugger",
      userCode: "EFGH-6789",
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
    });
    expect(await screen.findByRole("heading", { name: "Spoonjoy Connected" })).toBeInTheDocument();
    expect(screen.getByText(/can now use Spoonjoy/)).toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "claimed",
      agentName: "slugger",
      userCode: null,
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
    });
    expect(await screen.findByRole("heading", { name: "Spoonjoy Connected" })).toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "denied",
      agentName: "slugger",
      userCode: null,
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
    });
    expect(await screen.findByRole("heading", { name: "Connection Denied" })).toBeInTheDocument();

    cleanupDom();
    renderWithData({
      status: "expired",
      agentName: "slugger",
      userCode: null,
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
    });
    expect(await screen.findByRole("heading", { name: "Connection Expired" })).toBeInTheDocument();
  });

  it("renders a minimal pending connection without optional code, scopes, or email", async () => {
    renderWithData({
      status: "pending",
      agentName: "tiny client",
      userCode: null,
      userEmail: null,
      expiresAt: "2026-05-26T12:10:00.000Z",
      scopes: [],
    });

    expect(await screen.findByRole("heading", { name: "Connect Spoonjoy" })).toBeInTheDocument();
    expect(screen.queryByText("Code")).not.toBeInTheDocument();
    expect(screen.queryByText("Requested scopes")).not.toBeInTheDocument();
    expect(screen.queryByText(/You are approving as/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Access" })).toBeInTheDocument();
  });
});
