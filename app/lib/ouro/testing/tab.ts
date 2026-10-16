import { server, userEvent } from "vitest/browser";

/**
 * Presses Tab, or Shift+Tab with `{ shift: true }`, so that focus moves to the next tab stop
 * in every browser. Use it instead of `userEvent.keyboard("{Tab}")`.
 *
 * WebKit on a Mac follows the system's "Keyboard navigation" setting: with it off, the
 * default, Tab skips buttons, links and every control that is not a text field, so a test
 * that tabs to one passes on Linux and fails on a developer's Mac. Option+Tab is WebKit's
 * key for "every control, whatever the setting", so this presses that there and plain Tab
 * everywhere else.
 *
 * @example
 * before.focus();
 * await pressTab();
 * expect(document.activeElement).toBe(radio);
 * await pressTab({ shift: true });
 */
export async function pressTab({ shift = false }: { shift?: boolean } = {}): Promise<void> {
  const tab = tabSkipsControls() ? "{Alt>}{Tab}{/Alt}" : "{Tab}";
  await userEvent.keyboard(shift ? `{Shift>}${tab}{/Shift}` : tab);
}

/**
 * Whether this is WebKit on a Mac, where plain Tab may skip buttons and links. It asks the
 * test server, not the user agent, which Playwright's WebKit may report as a Mac's on Linux too.
 */
function tabSkipsControls(): boolean {
  return server.platform === "darwin" && server.browser === "webkit";
}
