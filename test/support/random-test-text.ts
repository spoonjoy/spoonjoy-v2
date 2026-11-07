import { faker } from "@faker-js/faker";
import { containsObjectionableContent } from "~/lib/objectionable-terms";

// Digits other than the filter's letter swaps split a random string into whole words ("x9cum8y"
// holds one), so about one random six-character string in 50,000 spelled a word the filter rejects,
// and a write using it failed with a 400. With hundreds of them, unit runs failed at random (CI runs
// 40285660009 and 40287961480). Redraw until the string is clean.
const draw = faker.string.alphanumeric.bind(faker.string);
faker.string.alphanumeric = ((...args: Parameters<typeof draw>) => {
  for (;;) {
    const value = draw(...args);
    if (!containsObjectionableContent(value)) return value;
  }
}) as typeof faker.string.alphanumeric;
