import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Alert } from "~/components/ouro/alert/alert";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
import { Field } from "~/components/ouro/field/field";
import { FieldControl, FieldDescription } from "~/components/ouro/field/field-parts";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "40px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** The link a tap at this point would follow, if any. */
const linkAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-ouro="link"]') ?? null;
const links = (host: Element) => [...host.querySelectorAll<HTMLElement>('[data-ouro="link"]')];

it("gives a link on its own line a 44px box, centred on its text", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(
    <div>
      <Link href="/forgot">Forgot password?</Link>
    </div>,
  );
  const [link] = links(host);
  const rect = link!.getBoundingClientRect();
  expect(rect.height).toBe(44);
  // The box takes its room in the layout: its line is 44px too.
  expect(link!.parentElement!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  const y = rect.top + rect.height / 2;
  expect(linkAt(rect.left + 4, y - 21)).toBe(link);
  expect(linkAt(rect.left + 4, y + 21)).toBe(link);
});

it.each(["automatic", "forced"] as const)("gives a short %s standalone link a 44px-wide layout and hit target", async (mode) => {
  const shortLink = <Link href="/go" {...(mode === "forced" ? { inline: false } : {})}>Go</Link>;
  const host = await render(
    <div style={{ display: "inline-flex" }}>
      {mode === "forced" ? <Text>{shortLink}</Text> : shortLink}
    </div>,
  );
  const [link] = links(host);
  const rect = link!.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(host.firstElementChild!.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  // Both dimensions belong to the anchor itself, not an overlapping invisible child.
  for (let x = Math.ceil(rect.left); x < rect.right; x += 1) {
    expect(linkAt(x, rect.top + rect.height / 2)).toBe(link);
  }
});

it.each(["ancestry", "explicit"] as const)("does not widen a short link in %s running text", async (mode) => {
  const shortLink = <Link href="/go" {...(mode === "explicit" ? { inline: true } : {})}>Go</Link>;
  const host = await render(mode === "ancestry" ? <p>{shortLink}</p> : <div>{shortLink}</div>);
  const [link] = links(host);
  expect(getComputedStyle(link!).display).toBe("inline");
  expect(link!.getBoundingClientRect().width).toBeLessThan(44);
  expect(link!.getBoundingClientRect().height).toBeLessThan(30);
});

it("never lets one of two stacked links in an app's list take a tap on the other", async () => {
  const host = await render(
    <ul style={{ listStyle: "none", padding: 0, margin: 0, lineHeight: "24px", fontSize: 16 }}>
      <li>
        <Link href="/terms">Terms</Link>
      </li>
      <li>
        <Link href="/privacy">Privacy</Link>
      </li>
    </ul>,
  );
  const [terms, privacy] = links(host);
  const upper = terms!.getBoundingClientRect();
  const lower = privacy!.getBoundingClientRect();
  // A list item is not running text, so each link has its own 44px box, one under the other.
  expect(upper.height).toBe(44);
  expect(lower.top).toBeGreaterThanOrEqual(upper.bottom);
  for (let y = Math.ceil(upper.top); y < upper.bottom; y += 1) expect(linkAt(upper.left + 4, y)).toBe(terms);
  for (let y = Math.ceil(lower.top); y < lower.bottom; y += 1) expect(linkAt(lower.left + 4, y)).toBe(privacy);
});

it("takes no tap from the field above when it sits in the field's error", async () => {
  const host = await render(<TextField label="Recipe link" error={<>Already imported. <Link href="/recipes/soup">Open it</Link></>} />);
  const input = host.querySelector("input")!.getBoundingClientRect();
  const [link] = links(host);
  const box = link!.getBoundingClientRect();
  expect(box.height).toBeLessThan(30);
  const x = box.left + box.width / 2;
  for (let y = Math.ceil(input.top); y < input.bottom; y += 1) expect(linkAt(x, y)).toBeNull();
});

describe("a link in running text keeps to its line", () => {
  const sentence = (
    <>
      Read the <Link href="/terms">terms</Link> first.
    </>
  );
  it.each<[string, ReactNode]>([
    ["an app's <p>", <p key="p">{sentence}</p>],
    ["an app's <label>", <label key="label">{sentence}</label>],
    ["a Text", <Text key="text">{sentence}</Text>],
    ["a Text as a span", <Text key="span" as="span">{sentence}</Text>],
    ["a field's description", <TextField key="d" label="Email" description={sentence} />],
    ["a field's error", <TextField key="e" label="Email" error={sentence} />],
    ["a Field's helper text after the control", <Field key="f" label="Email"><FieldControl /><FieldDescription>{sentence}</FieldDescription></Field>],
    ["a Form's message", <Form key="form" errors={{ form: sentence }}><span /></Form>],
    ["an Alert", <Alert key="alert" title="Saved" description={sentence} />],
    ["an Item's description", <Item key="item" title="Short ribs" description={sentence} />],
    ["a DescriptionList detail", <DescriptionList key="dl" items={[{ term: "Source", details: sentence }]} />],
    ["a link marked inline", <div key="inline">Read the <Link href="/terms" inline>terms</Link> first.</div>],
  ])("in %s", async (_name, node) => {
    const host = await render(node);
    const [link] = links(host);
    expect(getComputedStyle(link!).display).toBe("inline");
    expect(link!.getBoundingClientRect().height).toBeLessThan(30);
  });
});

it("gives a link that is alone in a Text its box when it says inline={false}", async () => {
  const host = await render(
    <Text>
      <Link href="/forgot" inline={false}>
        Forgot password?
      </Link>
    </Text>,
  );
  expect(links(host)[0]!.getBoundingClientRect().height).toBe(44);
});
