import { act as reactAct } from "react";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * React's `act`, with the act environment switched on only while it runs, as
 * `vitest-browser-react` does. Tests drive real browser events through
 * `userEvent`, outside `act`, and Base UI updates state after them; with the
 * flag on for the whole file, React warns about every such update.
 *
 * @example
 * await act(() => root.render(<Sheet … />));
 */
export async function act(callback: () => unknown): Promise<void> {
  const environment = globalThis as ActEnvironment;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await reactAct(async () => {
      await callback();
    });
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}
