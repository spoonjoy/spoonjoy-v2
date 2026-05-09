import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import DevtoolsWellKnown, { loader } from "~/routes/devtools-well-known";

describe("Devtools well-known route", () => {
  it("returns no content for the loader", () => {
    const response = loader({} as any);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(204);
  });

  it("renders nothing for the component", async () => {
    expect(DevtoolsWellKnown()).toBeNull();

    const Stub = createTestRoutesStub([
      {
        path: "/.well-known/appspecific/com.chrome.devtools.json",
        Component: DevtoolsWellKnown,
        loader: () => null,
      },
    ]);

    const { container } = render(
      <Stub initialEntries={["/.well-known/appspecific/com.chrome.devtools.json"]} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
