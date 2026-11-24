import { describe, expect, it } from "vitest";
import { mapAtMost } from "~/lib/map-at-most";

describe("mapAtMost", () => {
  it("keeps the answers in the items' order, with at most the limit running at once", async () => {
    let running = 0;
    let most = 0;
    const answers = await mapAtMost(2, [30, 10, 20, 5], async (ms, index) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running--;
      return `${index}:${ms}`;
    });
    expect(answers).toEqual(["0:30", "1:10", "2:20", "3:5"]);
    expect(most).toBe(2);
  });

  it("runs nothing for no items", async () => {
    expect(await mapAtMost(3, [], async () => 1)).toEqual([]);
  });

  it("starts no more items once one fails, and passes its error on", async () => {
    const started: number[] = [];
    await expect(mapAtMost(1, [1, 2, 3], async (n) => (started.push(n), n === 2 ? Promise.reject(new Error("bad")) : n))).rejects.toThrow("bad");
    expect(started).toEqual([1, 2]);
  });
});
