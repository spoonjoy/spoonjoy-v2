import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements, type AnnouncementWatch } from "~/lib/ouro/testing/announcements";

let watch: AnnouncementWatch | undefined;
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  watch?.stop();
  await act(async () => root?.unmount());
  host?.remove();
  [watch, root, host] = [undefined, undefined, undefined];
});

async function render(node: ReactNode) {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  await act(async () => root!.render(node));
}

function Regions({ status, alert, hidden }: { status: string; alert: string; hidden?: string }) {
  return (
    <>
      <div role="status">{status}</div>
      <div role="alert">{alert}</div>
      <div aria-live="polite">
        <span aria-hidden="true">{hidden}</span>
      </div>
    </>
  );
}

it("records the text each live region exposes, polite and assertive, once per change", async () => {
  await render(<Regions status="" alert="" />);
  watch = watchAnnouncements();
  await render(<Regions status="Saved" alert="" />);
  await render(<Regions status="Saved" alert="" />);
  await render(<Regions status="Saved" alert="Failed to save" />);
  await expect.poll(() => watch!.count("Saved")).toBe(1);
  await expect.poll(() => watch!.matching("Failed").length).toBe(1);
  expect(watch.matching("Failed")[0]!.region.getAttribute("role")).toBe("alert");
  expect(watch.matching("Saved")[0]!.region.getAttribute("role")).toBe("status");
  expect(watch.changes.map((change) => change.text)).toEqual(["Saved", "Failed to save"]);
});

it("counts text replaced in place in a status region, not the text it was added with", async () => {
  watch = watchAnnouncements();
  await render(<div role="status">Uploading</div>);
  host!.querySelector('[role="status"]')!.firstChild!.textContent = "Uploaded";
  await expect.poll(() => watch!.count("Uploaded")).toBe(1);
  expect(watch.count("Uploading")).toBe(0);
});

it("leaves out text under aria-hidden, text outside a live region and changes after stop", async () => {
  await render(<Regions status="" alert="" />);
  watch = watchAnnouncements();
  await render(<Regions status="" alert="" hidden="Saved" />);
  const outside = document.body.appendChild(document.createElement("p"));
  outside.textContent = "Saved";
  await act(async () => {});
  expect(watch.count("Saved")).toBe(0);
  watch.stop();
  await render(<Regions status="Saved" alert="" />);
  await act(async () => {});
  expect(watch.count("Saved")).toBe(0);
  outside.remove();
});

/** Appends markup to the page outside React, as a portal or another library would. */
async function append(html: string): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  container.innerHTML = html;
  appended.push(container);
  await act(async () => {});
  return container;
}
const appended: HTMLElement[] = [];
afterEach(() => {
  for (const node of appended.splice(0)) node.remove();
});

it("leaves out a region added with only hidden text", async () => {
  watch = watchAnnouncements();
  await append('<div role="status"><span aria-hidden="true">Saved</span></div>');
  expect(watch.changes).toEqual([]);
});

it("leaves out text beside a live region in a subtree added around it", async () => {
  watch = watchAnnouncements();
  await append('<section><h2>Settings</h2><div role="status"></div><button>Saved</button></section>');
  expect(watch.changes).toEqual([]);
});

it("counts an alert added with its text, and leaves out a polite region's initial text", async () => {
  watch = watchAnnouncements();
  await append('<div role="status">Draft kept</div><div role="alert">Could not <span aria-hidden="true">(!)</span>save</div><div aria-live="assertive">Offline</div>');
  expect(watch.changes.map(({ region, text }) => [region.getAttribute("role") ?? region.getAttribute("aria-live"), text])).toEqual([
    ["alert", "Could not save"],
    ["assertive", "Offline"],
  ]);
});

it("counts a change in an existing status region once, its exposed text only", async () => {
  const container = await append('<div role="status"></div>');
  watch = watchAnnouncements();
  const region = container.querySelector('[role="status"]')!;
  region.innerHTML = '<p>Saved</p><span aria-hidden="true">✓</span><p>2 items</p><div aria-live="off">Saving…</div>';
  await act(async () => {});
  expect(watch.changes).toEqual([{ region, text: "Saved2 items" }]);
  expect(watch.count("Saved")).toBe(1);
});

