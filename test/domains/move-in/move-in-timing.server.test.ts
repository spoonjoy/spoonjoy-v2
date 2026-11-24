// @vitest-environment node
import { describe, expect, it } from "vitest";
import { moveInSegmentLine, timeMoveInPorts } from "~/domains/move-in/adapters/worker/move-in-timing.server";
import type { MoveInPorts } from "~/domains/move-in/application/run-move-in";

const job = { id: "movein_1" } as never;

function fakePorts(more: Partial<MoveInPorts> = {}): MoveInPorts {
  return {
    store: { loadJob: async () => null } as unknown as MoveInPorts["store"],
    openArchive: () => ({ size: 4, read: async () => new Uint8Array(2) }),
    ownerEmail: async () => null,
    writeRecipe: async () => {
      throw new Error("the database is down");
    },
    attachPhoto: async () => undefined,
    hasMovedInPhoto: async () => false,
    discardArchive: async () => undefined,
    now: () => new Date(0),
    ...more,
  };
}

describe("timeMoveInPorts", () => {
  it("counts and times each call by stage, a failed one too", async () => {
    let tick = 0;
    const { ports, times } = timeMoveInPorts(fakePorts(), () => (tick += 5));

    const backup = await ports.openArchive(job);
    expect(backup.size).toBe(4);
    await backup.read(0, 2);
    await ports.store.loadJob("movein_1");
    await expect(ports.writeRecipe({} as never)).rejects.toThrow("the database is down");

    expect(times).toMatchObject({
      backup: { calls: 2, ms: 10 },
      job: { calls: 1, ms: 5 },
      recipeWrites: { calls: 1, ms: 5 },
      photoWrites: { calls: 0, ms: 0 },
    });
  });

  it("leaves a Worker without organizers without them", () => {
    expect(timeMoveInPorts(fakePorts()).ports.organizers).toBeUndefined();
  });

  it("times organizers and keeps their switch as it was", async () => {
    const on = () => true;
    const { ports, times } = timeMoveInPorts(fakePorts({ organizers: { on, attach: async () => undefined } }));
    expect(ports.organizers?.on).toBe(on);
    await ports.organizers?.attach({} as never);
    expect(times.organizers.calls).toBe(1);
  });
});

describe("moveInSegmentLine", () => {
  it("is a move_in_segment line of numbers under fixed keys", () => {
    const { times } = timeMoveInPorts(fakePorts());
    const timing = { wallMs: 42, waitMs: 7, claimed: true, recipesFound: 500, stages: times };
    expect(JSON.parse(moveInSegmentLine({ ...timing, extra: "movein_1" } as never))).toEqual({ event: "move_in_segment", ...timing });
  });
});

it("times looking up the cook's email and deleting the backup", async () => {
  const { ports, times } = timeMoveInPorts(fakePorts(), () => 0);
  await ports.ownerEmail("chef-1");
  await ports.discardArchive(job);
  expect(times.job.calls).toBe(1);
  expect(times.backup.calls).toBe(1);
});
