import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canShare, copyText, share } from "~/lib/ouro/share";

let shared: ShareData[] = [];
let copied: string[] = [];

/** Gives the page a share sheet that takes the data, refuses it, or is closed; or none. */
function stubShare(behaviour: "share" | "abort" | "refuse" | "absent", canShareResult: boolean | "absent" = true) {
  const shareValue =
    behaviour === "absent"
      ? undefined
      : (data: ShareData) => {
          if (behaviour === "abort") return Promise.reject(new DOMException("Closed", "AbortError"));
          if (behaviour === "refuse") return Promise.reject(new DOMException("Denied", "NotAllowedError"));
          shared.push(data);
          return Promise.resolve();
        };
  Object.defineProperty(navigator, "share", { configurable: true, value: shareValue });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShareResult === "absent" ? undefined : () => canShareResult });
}

function stubClipboard(behaviour: "write" | "refuse" | "absent") {
  const value =
    behaviour === "absent"
      ? undefined
      : {
          writeText: (text: string) => {
            if (behaviour === "refuse") return Promise.reject(new DOMException("Denied", "NotAllowedError"));
            copied.push(text);
            return Promise.resolve();
          },
        };
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => value });
}

beforeEach(() => {
  shared = [];
  copied = [];
  stubShare("absent");
  stubClipboard("write");
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const name of ["share", "canShare", "clipboard"]) delete (navigator as unknown as Record<string, unknown>)[name];
});

describe("canShare", () => {
  it("is false without a share sheet", () => {
    expect(canShare({ url: "https://example.com" })).toBe(false);
  });

  it("asks the browser whether it can share the data, without the empty fields", () => {
    const ask = vi.fn(() => true);
    stubShare("share");
    Object.defineProperty(navigator, "canShare", { configurable: true, value: ask });
    expect(canShare({ url: "https://example.com", title: "", text: "Notes" })).toBe(true);
    expect(ask).toHaveBeenCalledWith({ url: "https://example.com", text: "Notes" });
  });

  it("is false when the browser says it cannot share the data", () => {
    stubShare("share", false);
    expect(canShare({ url: "https://example.com" })).toBe(false);
  });

  it("is true with a share sheet that has no canShare to ask", () => {
    stubShare("share", "absent");
    expect(canShare({ url: "https://example.com" })).toBe(true);
  });
});

describe("share", () => {
  it("opens the share sheet with the url, title and text", async () => {
    stubShare("share");
    await expect(share({ url: "https://example.com/a", title: "A", text: "About A" })).resolves.toBe("shared");
    expect(shared).toEqual([{ url: "https://example.com/a", title: "A", text: "About A" }]);
    expect(copied).toEqual([]);
  });

  it("says cancelled when the person closes the sheet, and copies nothing", async () => {
    stubShare("abort");
    await expect(share({ url: "https://example.com/a" })).resolves.toBe("cancelled");
    expect(copied).toEqual([]);
  });

  it("copies the link when the sheet refuses", async () => {
    stubShare("refuse");
    await expect(share({ url: "https://example.com/a" })).resolves.toBe("copied");
    expect(copied).toEqual(["https://example.com/a"]);
  });

  it("copies the link where there is no share sheet", async () => {
    await expect(share({ url: "https://example.com/b", title: "B" })).resolves.toBe("copied");
    expect(copied).toEqual(["https://example.com/b"]);
  });

  it("says failed when neither the sheet nor the clipboard works", async () => {
    stubClipboard("absent");
    vi.spyOn(document, "execCommand").mockReturnValue(false);
    await expect(share({ url: "https://example.com/b" })).resolves.toBe("failed");
  });
});

describe("copyText", () => {
  it("writes through the Clipboard API", async () => {
    await expect(copyText("hello")).resolves.toBe(true);
    expect(copied).toEqual(["hello"]);
  });

  it("copies through a hidden selection without the Clipboard API, and gives focus back", async () => {
    stubClipboard("absent");
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    let selected = "";
    vi.spyOn(document, "execCommand").mockImplementation(() => {
      selected = String(document.getSelection());
      return true;
    });
    try {
      await expect(copyText("by selection")).resolves.toBe(true);
      expect(selected).toBe("by selection");
      expect(document.querySelector("textarea")).toBeNull();
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it("falls back to a selection when the Clipboard API refuses", async () => {
    stubClipboard("refuse");
    vi.spyOn(document, "execCommand").mockReturnValue(true);
    await expect(copyText("x")).resolves.toBe(true);
  });

  it("resolves false, without throwing, when the selection copy throws", async () => {
    stubClipboard("absent");
    vi.spyOn(document, "execCommand").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(copyText("x")).resolves.toBe(false);
  });
});
