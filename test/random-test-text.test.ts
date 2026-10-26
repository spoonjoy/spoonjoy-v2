import { expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { containsObjectionableContent } from "~/lib/objectionable-terms";

// test/support/random-test-text.ts, loaded by test/setup.ts, redraws random strings the
// objectionable-content filter rejects. Without it, this seed draws three such strings here.
it("never draws a random string the objectionable-content filter rejects", () => {
  faker.seed(590);
  const rejected = Array.from({ length: 100_000 }, () => faker.string.alphanumeric(6)).filter((value) => containsObjectionableContent(value));
  expect(rejected).toEqual([]);
});
