interface Deadline {
  derive(): number;
  track(name: string, promise: Promise<unknown>, timeout: number, source?: Error): Promise<unknown>;
}

interface RunnerState {
  runner?: { _deadline?: Deadline | undefined };
  commands: { triggerCommand: (command: string, args: unknown[], error?: Error) => Promise<unknown> };
}

/** The commands `userEvent` sends (`ensureAwaited` in @vitest/browser), which Vitest does not register with the deadline. */
const USER_EVENT_COMMANDS = new Set(["__vitest_keyboard", "__vitest_type", "__vitest_tab", "__vitest_cleanup"]);

/** The command as a timeout names it: its verb, and its first string argument (the text typed) when it has one. */
export function describeCommand(command: string, args: unknown[]): string {
  const verb = command.slice("__vitest_".length);
  const text = args.find((arg): arg is string => typeof arg === "string");
  if (text === undefined) return verb;
  const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return `${verb} ${JSON.stringify(shown)}`;
}

/**
 * Wraps the browser runner's command entry point, which Vitest reads on every call, so a `userEvent` command
 * made while a deadline runs is tracked with it. Where no test deadline is running, it does nothing.
 * @claim "Wraps the browser runner's command entry point, which Vitest reads on every call, so a `userEvent` command made while a deadline runs is tracked with it." registry/ouro/lib/ouro/testing/command-deadline.test.ts verify:testExists(registry/ouro/lib/ouro/testing/command-deadline.test.ts::trackUserEventCommands > registers a userEvent command with the running test's deadline, named with its text)
 * @claim "Where no test deadline is running, it does nothing." registry/ouro/lib/ouro/testing/command-deadline.test.ts verify:testExists(registry/ouro/lib/ouro/testing/command-deadline.test.ts::trackUserEventCommands > does nothing when no test deadline is running)
 */
export function trackUserEventCommands(state: RunnerState | undefined = (globalThis as { __vitest_browser_runner__?: RunnerState }).__vitest_browser_runner__): void {
  const commands = state?.commands;
  if (!state || !commands) return;
  state.commands = new Proxy(commands, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "triggerCommand" || typeof value !== "function") return value;
      return (command: string, args: unknown[], error?: Error) => {
        const promise = value.call(target, command, args, error) as Promise<unknown>;
        const deadline = state.runner?._deadline;
        if (!USER_EVENT_COMMANDS.has(command) || !deadline) return promise;
        return deadline.track(describeCommand(command, args), promise, deadline.derive(), error);
      };
    },
  });
}
