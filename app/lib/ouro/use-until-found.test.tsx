import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useUntilFound } from "~/lib/ouro/use-until-found";
import { act } from "~/lib/ouro/testing/act";

function Probe() {
  return <span>{String(useUntilFound())}</span>;
}

describe("useUntilFound", () => {
  it("is false in server HTML, so hydration matches", () => {
    expect(renderToString(<Probe />)).toContain("false");
  });

  it("follows whether the browser supports onbeforematch", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe(String("onbeforematch" in document.body));
    await act(async () => root.unmount());
    host.remove();
  });
});
