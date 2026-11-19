import { describe, expect, it, vi } from "vitest";
import { describeCommand, trackUserEventCommands } from "./command-deadline.ts";

type Track = (name: string, promise: Promise<unknown>, timeout: number, source?: Error) => Promise<unknown>;

/** A test deadline as Vitest keeps one: its remaining time, and the operations registered with it. */
function deadlineOf(track = vi.fn<Track>((_name, promise) => promise)) {
  return { derive: () => 14_000, track };
}

/** The browser runner's command entry point, as the test kit wraps it. */
interface Commands {
  triggerCommand: (command: string, args: unknown[], error?: Error) => Promise<unknown>;
}

describe("trackUserEventCommands", () => {
  it("registers a userEvent command with the running test's deadline, named with its text", () => {
    const track = vi.fn<Track>((_name, promise) => promise);
    const answer = Promise.resolve("done");
    const triggerCommand = vi.fn(() => answer);
    const state: { runner: { _deadline?: ReturnType<typeof deadlineOf> }; commands: Commands } = {
      runner: { _deadline: deadlineOf(track) },
      commands: { triggerCommand },
    };
    trackUserEventCommands(state);
    const args = ["one{Enter}", {}];
    expect(state.commands.triggerCommand("__vitest_keyboard", args)).toBe(answer);
    expect(triggerCommand).toHaveBeenCalledWith("__vitest_keyboard", args, undefined);
    expect(track).toHaveBeenCalledWith('keyboard "one{Enter}"', answer, 14_000, undefined);
  });

  it("leaves Vitest's own locator actions to the deadline they register themselves", () => {
    const track = vi.fn<Track>((_name, promise) => promise);
    const answer = Promise.resolve();
    const state: { runner: { _deadline?: ReturnType<typeof deadlineOf> }; commands: Commands } = {
      runner: { _deadline: deadlineOf(track) },
      commands: { triggerCommand: () => answer },
    };
    trackUserEventCommands(state);
    expect(state.commands.triggerCommand("__vitest_click", [{}])).toBe(answer);
    expect(track).not.toHaveBeenCalled();
  });

  it("does nothing when no test deadline is running", () => {
    const answer = Promise.resolve(1);
    const state: { runner: { _deadline?: ReturnType<typeof deadlineOf> }; commands: Commands } = { runner: {}, commands: { triggerCommand: () => answer } };
    trackUserEventCommands(state);
    expect(state.commands.triggerCommand("__vitest_type", ["", "a"])).toBe(answer);
  });

  it("passes a command's failure through unchanged", async () => {
    const failure = new Error("the frame closed");
    const state: { runner: { _deadline?: ReturnType<typeof deadlineOf> }; commands: Commands } = {
      runner: { _deadline: deadlineOf() },
      commands: { triggerCommand: () => Promise.reject(failure) },
    };
    trackUserEventCommands(state);
    await expect(state.commands.triggerCommand("__vitest_tab", [{}])).rejects.toBe(failure);
  });
});

describe("describeCommand", () => {
  it("names a command by its verb and the text it was given", () => {
    expect(describeCommand("__vitest_keyboard", ["one{Shift>}{Enter}{/Shift}two", {}])).toBe('keyboard "one{Shift>}{Enter}{/Shift}two"');
  });

  it("names a command with no text by its verb alone, and cuts a long text to sixty characters", () => {
    expect(describeCommand("__vitest_tab", [{ shift: true }])).toBe("tab");
    expect(describeCommand("__vitest_keyboard", ["x".repeat(80), {}])).toBe(`keyboard "${"x".repeat(60)}…"`);
  });
});
