import { describe, it, expect, vi } from "vitest";
import {
  RecipeLlmError,
  htmlToPlainText,
  createOpenAIRecipeLlmRunner,
  type OpenAIRecipeLlmClient,
  type RecipeLlmEnv,
} from "~/lib/recipe-import-llm.server";

function ok(content: string): { choices: { message: { content: string; refusal?: string | null } }[] } {
  return { choices: [{ message: { content } }] };
}

function makeClient(
  impl: OpenAIRecipeLlmClient["chat"]["completions"]["create"],
): OpenAIRecipeLlmClient {
  return { chat: { completions: { create: impl } } };
}

describe("htmlToPlainText", () => {
  it("strips <script> blocks completely", () => {
    expect(htmlToPlainText("<p>hi</p><script>x=1</script>")).toContain("hi");
    expect(htmlToPlainText("<p>hi</p><script>secret()</script>")).not.toContain("secret");
  });

  it("strips <style> blocks completely", () => {
    expect(htmlToPlainText("<style>.x{}</style><p>hi</p>")).not.toContain(".x{}");
  });

  it("strips <nav> blocks completely", () => {
    expect(htmlToPlainText("<nav>menu</nav><p>main</p>")).not.toContain("menu");
  });

  it("strips <footer> blocks completely", () => {
    expect(htmlToPlainText("<p>body</p><footer>foot</footer>")).not.toContain("foot");
  });

  it("decodes named entities", () => {
    expect(htmlToPlainText("a &amp; b")).toContain("a & b");
    expect(htmlToPlainText("&lt;tag&gt;")).toContain("<tag>");
    expect(htmlToPlainText("&quot;hi&quot;")).toContain('"hi"');
    expect(htmlToPlainText("it&#39;s")).toContain("it's");
  });

  it("collapses runs of whitespace to single space", () => {
    expect(htmlToPlainText("a    b\t\tc")).toContain("a b c");
  });

  it("preserves newlines between block elements", () => {
    const text = htmlToPlainText("<p>one</p><p>two</p><li>three</li>");
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).toContain("three");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("returns empty string for input with only nav/footer/script", () => {
    expect(htmlToPlainText("<nav>x</nav><footer>y</footer><script>z</script>").trim()).toBe("");
  });

  it("handles malformed HTML without throwing", () => {
    expect(() => htmlToPlainText("<p>unclosed")).not.toThrow();
  });

  it("truncates output above 50,000 chars", () => {
    const long = "<p>" + "a".repeat(60_000) + "</p>";
    expect(htmlToPlainText(long).length).toBeLessThanOrEqual(50_000);
  });
});

describe("createOpenAIRecipeLlmRunner", () => {
  const env: RecipeLlmEnv = { OPENAI_API_KEY: "k" };

  it("throws when OPENAI_API_KEY missing", () => {
    expect(() => createOpenAIRecipeLlmRunner({})).toThrow(RecipeLlmError);
  });

  it("uses gpt-4o-mini by default and forwards prompt + json_schema", async () => {
    const create = vi.fn(async () =>
      ok(
        JSON.stringify({
          title: "Soup",
          description: null,
          servings: null,
          ingredients: [],
          steps: [],
        }),
      ),
    );
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await runner.extract("text");
    const call = create.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.response_format.type).toBe("json_schema");
    expect(call.messages[1].content).toBe("text");
  });

  it("uses RECIPE_LLM_MODEL when set", async () => {
    const create = vi.fn(async () =>
      ok(
        JSON.stringify({
          title: "x",
          description: null,
          servings: null,
          ingredients: [],
          steps: [],
        }),
      ),
    );
    const runner = createOpenAIRecipeLlmRunner(
      { OPENAI_API_KEY: "k", RECIPE_LLM_MODEL: "gpt-4o" },
      { clientFactory: () => makeClient(create) },
    );
    await runner.extract("t");
    expect(create.mock.calls[0][0].model).toBe("gpt-4o");
  });

  it("uses RECIPE_LLM_TIMEOUT_MS when set, else 30_000 default", () => {
    const factory = vi.fn(() =>
      makeClient(async () =>
        ok(
          JSON.stringify({
            title: "x",
            description: null,
            servings: null,
            ingredients: [],
            steps: [],
          }),
        ),
      ),
    );
    createOpenAIRecipeLlmRunner(
      { OPENAI_API_KEY: "k", RECIPE_LLM_TIMEOUT_MS: "1234" },
      { clientFactory: factory },
    );
    expect(factory).toHaveBeenCalledWith({ apiKey: "k", timeout: 1234 });
    factory.mockClear();
    createOpenAIRecipeLlmRunner(
      { OPENAI_API_KEY: "k" },
      { clientFactory: factory },
    );
    expect(factory).toHaveBeenCalledWith({ apiKey: "k", timeout: 30_000 });
  });

  it("ignores invalid RECIPE_LLM_TIMEOUT_MS and uses default", () => {
    const factory = vi.fn(() =>
      makeClient(async () =>
        ok(
          JSON.stringify({
            title: "x",
            description: null,
            servings: null,
            ingredients: [],
            steps: [],
          }),
        ),
      ),
    );
    createOpenAIRecipeLlmRunner(
      { OPENAI_API_KEY: "k", RECIPE_LLM_TIMEOUT_MS: "not-a-number" },
      { clientFactory: factory },
    );
    expect(factory).toHaveBeenCalledWith({ apiKey: "k", timeout: 30_000 });
  });

  it("returns parsed JSON matching schema", async () => {
    const payload = {
      title: "Pasta",
      description: "Tasty",
      servings: "4",
      ingredients: ["1 cup flour"],
      steps: ["Boil"],
    };
    const create = vi.fn(async () => ok(JSON.stringify(payload)));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    const result = await runner.extract("text");
    expect(result).toEqual(payload);
  });

  it("throws RecipeLlmError on OpenAI 401 authentication", async () => {
    const err = Object.assign(new Error("auth"), { status: 401 });
    const create = vi.fn(async () => {
      throw err;
    });
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toBeInstanceOf(RecipeLlmError);
    await expect(runner.extract("t")).rejects.toThrow(/authentication/i);
  });

  it("throws RecipeLlmError on OpenAI 403 authentication", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const create = vi.fn(async () => {
      throw err;
    });
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(/authentication/i);
  });

  it("throws RecipeLlmError on OpenAI 429 rate limit", async () => {
    const err = Object.assign(new Error("too many"), { status: 429 });
    const create = vi.fn(async () => {
      throw err;
    });
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(/rate limit/i);
  });

  it("throws RecipeLlmError on OpenAI 5xx temporary", async () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502 });
    const create = vi.fn(async () => {
      throw err;
    });
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(/temporary/i);
  });

  it("throws RecipeLlmError when refusal is set", async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { refusal: "no", content: null } }],
    }));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create as never),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError when content is empty", async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: "" } }],
    }));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create as never),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError when content is missing", async () => {
    const create = vi.fn(async () => ({ choices: [{ message: {} }] }));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create as never),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError when response choices is empty", async () => {
    const create = vi.fn(async () => ({ choices: [] }));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create as never),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError when content is non-JSON", async () => {
    const create = vi.fn(async () => ok("not json"));
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError when response fails schema validation", async () => {
    const create = vi.fn(async () =>
      ok(JSON.stringify({ title: 42, ingredients: "not array" })),
    );
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });

  it("throws RecipeLlmError on generic error without status", async () => {
    const create = vi.fn(async () => {
      throw new Error("network down");
    });
    const runner = createOpenAIRecipeLlmRunner(env, {
      clientFactory: () => makeClient(create),
    });
    await expect(runner.extract("t")).rejects.toThrow(RecipeLlmError);
  });
});

describe("RecipeLlmError", () => {
  it("is an Error", () => {
    const e = new RecipeLlmError("x");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("x");
  });
});
