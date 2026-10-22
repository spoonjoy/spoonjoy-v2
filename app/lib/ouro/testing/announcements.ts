export { watchAnnouncements };
export type { Announcement, AnnouncementWatch };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/** Text a live region exposed, and the region it appeared in. */
interface Announcement {
  /** The live region: `role="status"`, `role="alert"`, `role="log"` or an `aria-live` element. */
  region: Element;
  /** The text that appeared in it. */
  text: string;
}

/** What `watchAnnouncements` has seen so far. */
interface AnnouncementWatch {
  /**
   * Every announcement since the watch started, in order.
   *
   * @claim "Every announcement since the watch started" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::records the text each live region exposes, polite and assertive, once per change)
   * @claim "Every announcement since the watch started" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::counts text replaced in place in a status region, not the text it was added with)
   */
  changes: Announcement[];
  /** The announcements whose text includes `text`. */
  matching(text: string): Announcement[];
  /**
   * How many announcements include `text`: 1 means a screen reader heard it once.
   *
   * @claim "How many announcements include `text`: 1" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::records the text each live region exposes, polite and assertive, once per change)
   * @claim "How many announcements include `text`: 1" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::counts a change in an existing status region once, its exposed text only)
   */
  count(text: string): number;
  /** Stops watching; `changes` keeps what was seen. */
  stop(): void;
}

const liveSelector = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';

/**
 * Whether a node is exposed to assistive tech: no `aria-hidden="true"` on it or around it.
 *
 * @claim "Whether a node is exposed to" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::records the text each live region exposes, polite and assertive, once per change)
 * @claim "Whether a node is exposed to" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::leaves out text under aria-hidden, text outside a live region and changes after stop)
 */
function exposed(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !element?.closest('[aria-hidden="true"]');
}

/**
 * The live region a node's text belongs to, or null when there is none or `aria-live="off"` comes first.
 *
 * @claim "The live region a node's text" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::leaves out text under aria-hidden, text outside a live region and changes after stop)
 * @claim "The live region a node's text" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::records the text each live region exposes, polite and assertive, once per change)
 */
function regionOf(element: Element | null): Element | null {
  for (let node = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-live") === "off") return null;
    if (node.matches(liveSelector)) return node;
  }
  return null;
}

/** Whether a region speaks up at once: `role="alert"` or `aria-live="assertive"`, unless `aria-live` says otherwise. */
function assertive(region: Element): boolean {
  const live = region.getAttribute("aria-live");
  return live === null ? region.getAttribute("role") === "alert" : live === "assertive";
}

/**
 * The text nodes in `root` a screen reader gets from its region: leaving out subtrees under
 * `aria-hidden="true"`, under `aria-live="off"` and inside another live region, which speaks for itself.
 */
function exposedText(root: Node): Text[] {
  if (root instanceof Text) return [root];
  const silent = (element: Element) => element.getAttribute("aria-hidden") === "true" || element.getAttribute("aria-live") === "off";
  // The walker never offers its root to the filter, so the root is checked here.
  if (!(root instanceof Element) || silent(root)) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
      return silent(node) || node.matches(liveSelector) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  return texts;
}

/**
 * Records what live regions announce from now on, one change per region for each batch of DOM
 * changes: text added to or changed in place inside a live region that is already on the page,
 * and the text an assertive region (`role="alert"` or `aria-live="assertive"`) is added with.
 * A polite region (`role="status"`, `role="log"`, `aria-live="polite"`) added with its text
 * announces nothing until that text changes, as screen readers generally treat it. Only exposed
 * text counts: nothing under `aria-hidden="true"` or `aria-live="off"`, nothing outside a live
 * region (text added beside a region in the same subtree), and nothing from a render that leaves
 * the text as it was, so `count` says how many times a screen reader would hear a message.
 * Watches `document.body`, portals included; call `stop()` when the test ends.
 *
 * Use it to prove an announcement happens once per change (a toast, a saved state, a checklist
 * row). Use `getByRole("status")` instead when you only need the region's current text.
 *
 * @example
 * const announcements = watchAnnouncements();
 * await userEvent.click(page.getByRole("button", { name: "Save" }));
 * await expect.poll(() => announcements.count("Saved")).toBe(1);
 * expect(announcements.matching("Saved")[0]!.region.getAttribute("role")).toBe("status");
 * announcements.stop();
 * @claim "Records what live regions announce from" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::records the text each live region exposes, polite and assertive, once per change)
 * @claim "Records what live regions announce from" registry/ouro/lib/ouro/testing/announcements.test.tsx verify:testExists(registry/ouro/lib/ouro/testing/announcements.test.tsx::counts text replaced in place in a status region, not the text it was added with)
 */
function watchAnnouncements(): AnnouncementWatch {
  const changes: Announcement[] = [];
  const observer = new MutationObserver((records) => {
    // Each region's text nodes, as a set: a node added inside a subtree that was added too shows
    // up in both records, and is heard once.
    const spoken = new Map<Element, Set<Text>>();
    const add = (region: Element, texts: Text[]) => {
      const set = spoken.get(region) ?? new Set<Text>();
      for (const text of texts) set.add(text);
      spoken.set(region, set);
    };
    for (const record of records) {
      const parent = record.target instanceof Element ? record.target : record.target.parentElement;
      const nodes = record.type === "characterData" ? [record.target] : [...record.addedNodes];
      for (const node of nodes) {
        if (!exposed(node)) continue;
        const isRegion = node instanceof Element && node.matches(liveSelector);
        // Text added to, or changed in, a region already on the page.
        const region = regionOf(parent);
        if (region && !isRegion) add(region, exposedText(node));
        if (!(node instanceof Element)) continue;
        // Regions added with the node: only an assertive one speaks its first text.
        for (const added of [...(isRegion ? [node] : []), ...node.querySelectorAll(liveSelector)]) {
          if (assertive(added) && exposed(added) && regionOf(added) === added) add(added, exposedText(added));
        }
      }
    }
    for (const [region, texts] of spoken) {
      const ordered = [...texts].filter((text) => text.isConnected && region.contains(text));
      ordered.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const text = ordered.map((node) => node.data).join("");
      if (text.trim()) changes.push({ region, text });
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const matching = (text: string) => changes.filter((change) => change.text.includes(text));
  return { changes, matching, count: (text: string) => matching(text).length, stop: () => observer.disconnect() };
}
