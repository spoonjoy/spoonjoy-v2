// Fake, token-shaped secrets, one per category the scrubbers must remove, shared by the Worker
// tail summary tests (scripts/summarize-worker-tail.jq) and the QA error log tests
// (app/lib/qa-error-logs.server.ts) so the two scrubbers are held to the same fixtures.
// None is a real credential.
import { expect } from "vitest";

export const FAKE_SECRETS = {
  cookieHeader: "fakeCookieHeaderValue0001",
  setCookieHeader: "fakeSetCookieValue0002",
  sessionCookie: "eyJmYWtlIjoic2Vzc2lvbiJ9.FakeSig0003",
  agentCodeCookie: "fakeAgentCode0004",
  bearer: "fakeBearer0005",
  basicAuth: "ZmFrZTpmYWtlMDAwNg",
  apiToken: "sj_FAKEfakeFAKEfake0007abcdefghijklmnopqrstu",
  deviceCode: "sjdc_FAKEfakeFAKEfake0008abcdefghijklmnopqrs",
  oauthCode: "oac_FAKEfakeFAKEfake0009abcdefghijklmnopqrst",
  connectionKey: "ocn_FAKEocn0010abcdefgh",
  refreshToken: "ort_FAKEfakeFAKEfake0011abcdefghijklmnopqrst",
  clientToken: "oct_FAKEfakeFAKEfake0012abcdefghijklmnopqrst",
  connectionId: "conn_eyJmYWtlIjoiY29ubjAwMTMifQ",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlMDAxNCJ9.ZmFrZXNpZzAwMTQ",
  hex: "fa4efa4efa4efa4e0015deadbeefcafebabe0015",
  email: "fake.chef0016@example.com",
  query: "fakeQueryCode0017",
  fragment: "fakeFragmentToken0018",
  userinfo: "fakeUserPass0019",
};

export const secretLine = [
  `Cookie: theme=dark; sid=${FAKE_SECRETS.cookieHeader}`,
  `Set-Cookie: __session=${FAKE_SECRETS.setCookieHeader}; Path=/; HttpOnly`,
].join("\n");

export const secretMessage = [
  `cookie __session=${FAKE_SECRETS.sessionCookie} and __agent_code=${FAKE_SECRETS.agentCodeCookie}`,
  `Authorization: Bearer ${FAKE_SECRETS.bearer}`,
  `Authorization: Basic ${FAKE_SECRETS.basicAuth}`,
  `tokens ${FAKE_SECRETS.apiToken} ${FAKE_SECRETS.deviceCode} ${FAKE_SECRETS.oauthCode} ${FAKE_SECRETS.connectionKey}`,
  `${FAKE_SECRETS.refreshToken} ${FAKE_SECRETS.clientToken} ${FAKE_SECRETS.connectionId} ${FAKE_SECRETS.jwt}`,
  `digest ${FAKE_SECRETS.hex} for ${FAKE_SECRETS.email}`,
  `fetch https://chef:${FAKE_SECRETS.userinfo}@api.example.test/v1/login?code=${FAKE_SECRETS.query}&x=1 and /oauth/cb#access_token=${FAKE_SECRETS.fragment}`,
].join(" | ");

export function expectNoSecrets(raw: string) {
  for (const [name, secret] of Object.entries(FAKE_SECRETS)) {
    expect(raw, `${name} leaked`).not.toContain(secret);
    // A partly redacted secret is still a leak: its distinctive tail must be gone too.
    expect(raw, `${name} leaked in part`).not.toContain(secret.slice(-10));
  }
}

