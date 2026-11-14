import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { useReducedMotion } from "~/lib/ouro/use-reduced-motion";

function Reduced({ serverDefault }: { serverDefault?: boolean }) {
  return <output>{String(useReducedMotion(serverDefault))}</output>;
}

describe("useReducedMotion", () => {
  it("answers serverDefault on the server, false unless set, and the provider's setting over it", () => {
    const html = renderToString(
      <>
        <Reduced />
        <Reduced serverDefault />
        <OuroProvider motion="reduced">
          <Reduced />
        </OuroProvider>
        <OuroProvider motion="full">
          <Reduced serverDefault />
        </OuroProvider>
      </>,
    );
    expect([...html.matchAll(/<output>(\w+)<\/output>/g)].map((match) => match[1])).toEqual(["false", "true", "true", "false"]);
  });
});
