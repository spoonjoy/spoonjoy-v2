import type { ReactElement, ReactNode } from "react";
import { expect, it } from "vitest";
import { hasLazyType, serverElement, serverNodes } from "~/lib/ouro/server-element";

type Chunk = { status: "fulfilled"; value: unknown } | { status: "pending"; then: () => void } | { status: "rejected"; reason: unknown };

/**
 * What React's Flight client hands over for an element prop: a lazy wrapper whose `_init`
 * reads a chunk, returning its value, throwing the chunk while it loads, or throwing its error.
 */
function wrapper(chunk: Chunk): ReactElement {
  const read = (payload: Chunk) => {
    if (payload.status === "fulfilled") return payload.value;
    throw payload.status === "pending" ? payload : payload.reason;
  };
  return { $$typeof: Symbol.for("react.lazy"), _payload: chunk, _init: read } as unknown as ReactElement;
}
const holding = (value: unknown) => wrapper({ status: "fulfilled", value });

it("resolves a wrapper to the element inside it, with the element's own key", () => {
  const keyed = <button key="open">Edit</button>;
  expect(serverElement(holding(keyed))).toBe(keyed);
  // No key stays no key, so the element does not remount when a later payload sends it plain.
  const plain = <button>Edit</button>;
  expect(serverElement(holding(plain))).toBe(plain);
  expect(serverElement(holding(plain)).key).toBeNull();
});

it("resolves a wrapper that holds a wrapper", () => {
  const element = <button>Edit</button>;
  expect(serverElement(holding(holding(element)))).toBe(element);
});

it("returns a plain element, text or nothing unchanged", () => {
  const element = <button>Edit</button>;
  expect(serverElement(element)).toBe(element);
  expect(serverElement(undefined)).toBeUndefined();
  expect(serverElement(null)).toBeNull();
  expect(serverElement("Edit")).toBe("Edit");
  expect(serverNodes(element)).toBe(element);
  expect(serverNodes("Edit")).toBe("Edit");
});

it("keeps a wrapper that holds no element, or more than one, so cloning it still fails loudly", () => {
  const text = holding("text");
  expect(serverElement(text)).toBe(text);
  const two = holding([<i key="a" />, <b key="b" />]);
  expect(serverElement(two)).toBe(two);
});

it("gives every element of a list a wrapper holds, each with its own key", () => {
  const first = <i key="a" />;
  const second = <b key="b" />;
  expect(serverNodes(holding([first, second]))).toEqual([first, second]);
  expect((serverNodes(holding([first, second])) as ReactElement[]).map((element) => element.key)).toEqual(["a", "b"]);
  expect(serverNodes(holding(first))).toEqual([first]);
});

it("suspends on a wrapper that is still loading: it throws the pending chunk for React to wait on", () => {
  const chunk: Chunk = { status: "pending", then: () => {} };
  const thrown = (run: () => ReactNode) => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return "nothing thrown";
  };
  expect(thrown(() => serverElement(wrapper(chunk)))).toBe(chunk);
  expect(thrown(() => serverNodes(wrapper(chunk)))).toBe(chunk);
});

it("throws a failed wrapper's error, for the error boundary", () => {
  const reason = new Error("The server component failed");
  expect(() => serverElement(wrapper({ status: "rejected", reason }))).toThrow(reason);
  expect(() => serverNodes(wrapper({ status: "rejected", reason }))).toThrow(reason);
});

it("tells an element whose type is a lazy reference from one whose type is a component or a tag", () => {
  const Component = () => null;
  expect(hasLazyType({ type: holding(Component) })).toBe(true);
  expect(hasLazyType(<Component />)).toBe(false);
  expect(hasLazyType(<button />)).toBe(false);
});
