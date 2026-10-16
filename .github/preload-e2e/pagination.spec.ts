import { expect, test as base } from "../../e2e/fixtures";
import { openStory } from "../../e2e/ouro/story";

const test = base.extend<{ preloadAudit: void }>({
  preloadAudit: [
    async ({ page }, use, testInfo) => {
      const records: unknown[] = [];
      const pending: Promise<void>[] = [];
      page.on("request", (request) => {
        records.push({ epoch: Date.now(), type: "request", url: request.url(), resource: request.resourceType() });
      });
      page.on("requestfailed", (request) => {
        records.push({ epoch: Date.now(), type: "requestfailed", url: request.url(), resource: request.resourceType(), failure: request.failure() });
      });
      page.on("response", (response) => {
        records.push({ epoch: Date.now(), type: "response", url: response.url(), status: response.status() });
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) records.push({ epoch: Date.now(), type: "navigation", url: frame.url() });
      });
      page.on("console", (message) => {
        records.push({ epoch: Date.now(), type: "console", kind: message.type(), text: message.text(), location: message.location() });
        if (message.text().includes("load preload assets")) {
          pending.push(Promise.all(message.args().map((argument) => argument.evaluate((value) => {
            if (value instanceof ProgressEvent) {
              const target = value.target;
              return {
                type: value.type,
                xhr: target instanceof XMLHttpRequest ? {
                  status: target.status, statusText: target.statusText, readyState: target.readyState, responseURL: target.responseURL,
                } : null,
              };
            }
            return typeof value === "string" ? value : Object.prototype.toString.call(value);
          }))).then(
            (arguments_) => { records.push({ epoch: Date.now(), type: "preload-warning-arguments", arguments: arguments_ }); },
            (error: unknown) => { records.push({ epoch: Date.now(), type: "preload-warning-inspection-failed", message: String(error) }); },
          ));
        }
      });
      try {
        await use();
      } finally {
        await Promise.all(pending);
        await testInfo.attach("preload-network.json", { body: Buffer.from(JSON.stringify(records, null, 2)), contentType: "application/json" });
      }
    },
    { auto: true },
  ],
});

test("pagination links go to each page's address and mark the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-pagination--in-context");
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByRole("link", { name: "Page 6", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Next" })).toHaveAttribute("href", "?page=7");
  await nav.getByRole("link", { name: "Page 12", exact: true }).click();
  await expect(page).toHaveURL(/[?&]page=12$/);
});
