// The journeys' Secret type (e2e/journeys/support/secret.ts): a password can only be turned back
// into text by fillSecret, and every other way of printing one yields "[redacted]".
import { format, inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { Locator } from "@playwright/test";
import {
  REDACTED,
  Secret,
  createDisposableJourneyUser,
  fillSecret,
  parseCredentialsJson,
} from "../e2e/journeys/support/secret";

const PLANTED = "Planted-Secret-5a7e";

// A stand-in Locator that records what fillSecret does and runs its page function against a
// fake input, answering the exposed binding the way Playwright would.
function fakeField() {
  const calls: string[] = [];
  const bindings = new Map<string, () => string>();
  const input = { value: "", focused: false, events: [] as string[] };
  const field = {
    clear: vi.fn(async () => {
      calls.push("clear");
      input.value = "";
    }),
    page: () => ({
      exposeFunction: vi.fn(async (name: string, fn: () => string) => {
        calls.push("exposeFunction");
        bindings.set(name, fn);
      }),
    }),
    evaluate: vi.fn(async (_fn: unknown, name: string) => {
      calls.push("evaluate");
      input.value = bindings.get(name)!();
      input.events.push("input", "change");
      return undefined;
    }),
  };
  return { field: field as unknown as Locator, calls, bindings, input, mock: field };
}

describe("Secret", () => {
  it("prints as [redacted] however it is turned into text", () => {
    const secret = new Secret(PLANTED);

    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect("pw=" + secret).toBe(`pw=${REDACTED}`);
    expect(secret.toString()).toBe(REDACTED);
    expect(JSON.stringify(secret)).toBe(`"${REDACTED}"`);
    expect(JSON.stringify({ user: { password: secret } })).toBe(`{"user":{"password":"${REDACTED}"}}`);
    expect(inspect(secret)).toBe(REDACTED);
    expect(inspect({ password: secret }, { depth: 5 })).not.toContain(PLANTED);
    expect(format("%s %o %O %j", secret, secret, secret, secret)).not.toContain(PLANTED);
    expect(new Error(`bad password ${secret}`).message).toBe(`bad password ${REDACTED}`);
    expect(Object.values(secret)).not.toContain(PLANTED);
    expect(Object.isFrozen(secret)).toBe(true);
  });

  it("needs a non-empty string", () => {
    expect(() => new Secret("")).toThrow("A Secret needs a non-empty string.");
    expect(() => new Secret(42 as unknown as string)).toThrow("A Secret needs a non-empty string.");
  });

  it("generates distinct random secrets", async () => {
    const one = fakeField();
    const two = fakeField();
    await fillSecret(one.field, Secret.generate());
    await fillSecret(two.field, Secret.generate());

    expect(one.input.value).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(two.input.value).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(one.input.value).not.toBe(two.input.value);
  });
});

describe("fillSecret", () => {
  it("checks the field, then types the value through a one-shot binding, never as a call argument", async () => {
    const { field, calls, bindings, input, mock } = fakeField();

    await fillSecret(field, new Secret(PLANTED));

    expect(calls).toEqual(["clear", "exposeFunction", "evaluate"]);
    expect(input.value).toBe(PLANTED);
    expect(input.events).toEqual(["input", "change"]);
    // Nothing Playwright records as a call argument holds the value.
    expect(JSON.stringify([mock.clear.mock.calls, mock.evaluate.mock.calls.map(([, name]) => name)])).not.toContain(PLANTED);
    // The binding answers once only.
    const [binding] = [...bindings.values()];
    expect(() => binding()).toThrow("fillSecret: this secret was already read");
  });

  it("refuses anything that isn't a Secret", async () => {
    const { field, calls } = fakeField();

    await expect(fillSecret(field, { kind: "secret" } as unknown as Secret)).rejects.toThrow("fillSecret needs a Secret.");
    expect(calls).toEqual([]);
  });
});

describe("parseCredentialsJson", () => {
  it("turns every password in the credentials file into a Secret and keeps everything else", () => {
    const text = JSON.stringify({
      chef: { username: "qa_kitchen_chef", email: "chef@example.com", password: PLANTED },
      scratch: [{ username: "codex_e2e_s_ab_1", email: "s@example.com", password: `${PLANTED}-1` }],
      scratchDesktop: [{ username: "codex_e2e_s_ab_1d", email: "d@example.com", password: `${PLANTED}-1d` }],
    });

    const parsed = parseCredentialsJson(text) as {
      chef: { username: string; password: Secret };
      scratch: Array<{ password: Secret }>;
      scratchDesktop: Array<{ password: Secret }>;
    };

    expect(parsed.chef.username).toBe("qa_kitchen_chef");
    expect(parsed.chef.password).toBeInstanceOf(Secret);
    expect(parsed.scratch[0].password).toBeInstanceOf(Secret);
    expect(parsed.scratchDesktop[0].password).toBeInstanceOf(Secret);
    expect(JSON.stringify(parsed)).not.toContain(PLANTED);
    expect(inspect(parsed, { depth: 10 })).not.toContain(PLANTED);
  });

  it("reports a malformed file by path and position only, never its content", () => {
    function failure(text: string, path?: string): Error {
      try {
        parseCredentialsJson(text, path);
      } catch (error) {
        return error as Error;
      }
      throw new Error("expected parseCredentialsJson to throw");
    }

    // V8 quotes an excerpt of the input for an unexpected token; none of it may come through.
    const excerpt = failure(`{"chef":{"password":${PLANTED}}}`, ".journeys/credentials.json");
    expect(excerpt.message).toBe("The QA credentials file at .journeys/credentials.json is not valid JSON.");
    expect(excerpt.cause).toBeUndefined();
    expect(`${excerpt.message}\n${excerpt.stack}`).not.toContain(PLANTED.slice(0, 7));

    // Other errors carry a position, which is kept.
    const cut = failure(`{"chef":{"password":"${PLANTED}`, ".journeys/credentials.json");
    expect(cut.message).toMatch(/^The QA credentials file at \.journeys\/credentials\.json is not valid JSON \(position \d+\)\.$/);
    expect(cut.message).not.toContain(PLANTED.slice(0, 7));

    expect(failure("").message).toBe("The QA credentials file is not valid JSON.");
    // A well-formed file with an empty password fails as such, not as bad JSON.
    expect(failure('{"password":""}').message).toBe("A Secret needs a non-empty string.");
  });

  it("leaves a non-string password field alone", () => {
    expect(parseCredentialsJson('{"password":null,"count":2}')).toEqual({ password: null, count: 2 });
  });
});

describe("createDisposableJourneyUser", () => {
  it("returns a throwaway codex-e2e user whose password is a Secret", async () => {
    const user = createDisposableJourneyUser();

    expect(user.email).toMatch(/^codex-e2e-.+@example\.com$/);
    expect(user.username).toMatch(/^codex_e2e_/);
    expect(user.password).toBeInstanceOf(Secret);
    const { field, input } = fakeField();
    await fillSecret(field, user.password);
    expect(input.value).toMatch(/^E2E-/);
  });
});
