import { afterEach, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { rotate } from "~/lib/ouro/testing/rotate";

// Three tests in order, rotating back after each as a touch test file does. Only the first
// leaves the page zoomed: it alone fails (its afterEach's rotate throws, naming it), and the
// next two start at zoom 1 in portrait, so they are not blamed.

afterEach(() => rotate(390, 844));

test.fails("a landscape test that leaves the page zoomed fails, named by rotate", async () => {
  await rotate(844, 390);
  await commands.setPageZoom(2);
});

test("the next test starts at zoom 1 in portrait", async () => {
  expect(await commands.pageZoom()).toBe(1);
  expect(innerWidth).toBe(390);
});

test("so does the one after it", async () => {
  expect(await commands.pageZoom()).toBe(1);
  expect(innerWidth).toBe(390);
});

test("rotate names the test and still resizes and resets the zoom when called mid-test", async () => {
  await commands.setPageZoom(2);
  await expect(rotate(844, 390)).rejects.toThrow(
    '"rotate names the test and still resizes and resets the zoom when called mid-test" had the page zoomed to 2.00 when rotate(844, 390) ran',
  );
  expect(await commands.pageZoom()).toBe(1);
  expect(innerWidth).toBe(844);
});
