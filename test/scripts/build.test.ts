import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BUILD_COMMANDS,
  filterStream,
  isDirectInvocation,
  main,
  maybeRunMain,
  runBuild,
  runCommand,
  writeFilteredLine,
  type Command,
} from "../../scripts/build";

class TextSink extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(String(chunk));
    callback();
  }

  text() {
    return this.chunks.join("");
  }
}

function childProcessStub() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe("build wrapper", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("filters only the exact benign Vite cancellation diagnostic", async () => {
    const sink = new TextSink();
    writeFilteredLine(sink, "client ok");
    writeFilteredLine(sink, "✘ [ERROR] The build was canceled");
    writeFilteredLine(sink, "The build was canceled while compiling app code");

    expect(sink.text()).toBe("client ok\nThe build was canceled while compiling app code\n");

    const stream = new PassThrough();
    const filtered = new TextSink();
    const promise = filterStream(stream, filtered);
    stream.write("first line\n");
    stream.write("✘ [ERROR] The build was canceled\n");
    stream.end("last line without newline");

    await promise;
    expect(filtered.text()).toBe("first line\nlast line without newline\n");

    const nullSink = new TextSink();
    await filterStream(null, nullSink);
    expect(nullSink.text()).toBe("");
  });

  it("runs a command with streamed filtered output and returns its exit code", async () => {
    const stdout = new TextSink();
    const stderr = new TextSink();
    const calls: Array<{ command: string; args: readonly string[]; cwd: string; envValue?: string }> = [];
    const child = childProcessStub();

    const exit = runCommand(
      { command: "pnpm", args: ["exec", "react-router", "build"] },
      {
        cwd: "/tmp/spoonjoy",
        env: { ...process.env, SPOONJOY_TEST_VALUE: "yes" },
        stdout,
        stderr,
        spawnImpl(command, args, options) {
          calls.push({
            command,
            args,
            cwd: options.cwd,
            envValue: options.env.SPOONJOY_TEST_VALUE,
          });
          queueMicrotask(() => {
            child.stdout.write("building\n✘ [ERROR] The build was canceled\n");
            child.stderr.write("stderr kept\n");
            child.stdout.end();
            child.stderr.end();
            child.emit("close", 0, null);
          });
          return child;
        },
      },
    );

    await expect(exit).resolves.toBe(0);
    expect(calls).toEqual([{
      command: "pnpm",
      args: ["exec", "react-router", "build"],
      cwd: "/tmp/spoonjoy",
      envValue: "yes",
    }]);
    expect(stdout.text()).toBe("building\n");
    expect(stderr.text()).toBe("stderr kept\n");
  });

  it("defaults command options, treats null close codes as success, and reports failures", async () => {
    await expect(runCommand(
      { command: process.execPath, args: ["-e", ""] },
      {},
    )).resolves.toBe(0);

    const successChild = childProcessStub();
    await expect(runCommand(
      { command: "pnpm", args: ["run", "api:playground:generate"] },
      {
        spawnImpl() {
          queueMicrotask(() => {
            successChild.stdout.end();
            successChild.stderr.end();
            successChild.emit("close", null, null);
          });
          return successChild;
        },
      },
    )).resolves.toBe(0);

    const signalChild = childProcessStub();
    await expect(runCommand(
      { command: "pnpm", args: ["exec", "react-router", "build"] },
      {
        spawnImpl() {
          queueMicrotask(() => {
            signalChild.stdout.end();
            signalChild.stderr.end();
            signalChild.emit("close", null, "SIGTERM");
          });
          return signalChild;
        },
      },
    )).rejects.toThrow("exited with signal SIGTERM");

    const errorChild = childProcessStub();
    await expect(runCommand(
      { command: "pnpm", args: ["exec", "react-router", "build"] },
      {
        spawnImpl() {
          queueMicrotask(() => {
            errorChild.stdout.end();
            errorChild.stderr.end();
            errorChild.emit("error", new Error("spawn failed"));
          });
          return errorChild;
        },
      },
    )).rejects.toThrow("spawn failed");
  });

  it("runs build commands in order and stops after the first failing command", async () => {
    const calls: Command[] = [];
    const exit = await runBuild({
      commands: [
        { command: "first", args: ["one"] },
        { command: "second", args: ["two"] },
        { command: "third", args: ["three"] },
      ],
      async runCommandImpl(command) {
        calls.push(command);
        return command.command === "second" ? 7 : 0;
      },
    });

    expect(exit).toBe(7);
    expect(calls.map((command) => command.command)).toEqual(["first", "second"]);
  });

  it("uses the default build command list and records nonzero main exit codes", async () => {
    const child = childProcessStub();
    const exit = await runBuild({
      commands: [DEFAULT_BUILD_COMMANDS[0]],
      spawnImpl(command, args) {
        expect(command).toBe("pnpm");
        expect(args).toEqual(["run", "api:playground:generate"]);
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
        return child;
      },
    });
    expect(exit).toBe(0);

    const defaultCalls: Command[] = [];
    expect(await runBuild({
      async runCommandImpl(command) {
        defaultCalls.push(command);
        return 0;
      },
    })).toBe(0);
    expect(defaultCalls).toEqual(DEFAULT_BUILD_COMMANDS);

    await main({
      commands: [],
      async runCommandImpl() {
        throw new Error("no commands should run");
      },
    });
    expect(process.exitCode).toBeUndefined();

    await main({
      commands: [{ command: "failing", args: [] }],
      async runCommandImpl() {
        return 2;
      },
    });
    expect(process.exitCode).toBe(2);
  });

  it("detects direct invocation without running on import", async () => {
    const scriptPath = resolve("/tmp/scripts/build.ts");
    const scriptUrl = pathToFileURL(scriptPath).href;
    expect(isDirectInvocation(scriptUrl, scriptPath)).toBe(true);
    expect(isDirectInvocation(scriptUrl, "/tmp/scripts/other.ts")).toBe(false);
    expect(isDirectInvocation(scriptUrl, undefined)).toBe(false);
    expect(isDirectInvocation()).toBe(false);

    let runs = 0;
    await maybeRunMain();
    await maybeRunMain({
      metaUrl: scriptUrl,
      argvPath: "/tmp/scripts/other.ts",
      mainImpl: async () => {
        runs += 1;
      },
    });
    await maybeRunMain({
      metaUrl: scriptUrl,
      argvPath: scriptPath,
      mainOptions: { commands: [] },
      mainImpl: async (options) => {
        expect(options).toEqual({ commands: [] });
        runs += 1;
      },
    });

    expect(runs).toBe(1);
  });
});
