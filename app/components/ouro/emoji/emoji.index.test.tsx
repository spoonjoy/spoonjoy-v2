import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { EmojiCatalogue, EmojiCatalogueCategory, EmojiItem } from "~/components/ouro/emoji/emoji";
import { catalogueIndex, splitEmojiText } from "~/components/ouro/emoji/emoji-styles";

// Its own file, so the module's record of recent builds and the warning it logs once start empty. The
// warning's test comes last: once it has warned, the page hears it no more.

// The clock moves a second at each look, so builds are a second apart unless a test stops it.
let now = 0;
let step = 1000;
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  // Each test starts well past the builds of the one before.
  now += 60_000;
  step = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => (now += step));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Emoji that no other catalogue holds, `count` of them, each with its own text. */
let made = 0;
function freshEmoji(count = 3): EmojiItem[] {
  return Array.from({ length: count }, () => {
    made += 1;
    return { id: `emoji-${made}`, name: `Emoji ${made}`, shortcodes: [`e${made}`], text: String.fromCodePoint(0x1f600 + (made % 64)), src: `/emoji/${made}.png` };
  });
}

/** A catalogue as an app's helper makes it for each text run: a new object around the emoji it is given. */
const wrap = (categories: readonly EmojiCatalogueCategory[], id?: string): EmojiCatalogue => (id === undefined ? { categories } : { id, categories });

/** A copy of the categories with new category objects and new item arrays, around the same emoji objects. */
const copyCategories = (categories: readonly EmojiCatalogueCategory[]) => categories.map((category) => ({ ...category, items: [...category.items] }));

/** Builds of the index: each distinct index object is one. */
const buildsOf = (catalogues: readonly EmojiCatalogue[]) => new Set(catalogues.map(catalogueIndex)).size;

const ready = "the index of the same emoji was built more than 3 times within a second";
const warnings = () => warn.mock.calls.filter(([message]) => String(message).includes(ready));

describe("catalogueIndex", () => {
  it("keeps the shapes of the 8 catalogues indexed most recently, and compiles again for one indexed before them", () => {
    const kept = freshEmoji();
    const first = catalogueIndex(wrap([{ id: "all", label: "All", items: kept }]));
    for (let other = 0; other < 7; other++) catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }]));
    // Seven others since: its shape is still kept.
    const moved = (version: number) => wrap([{ id: "all", label: "All", items: kept.map((item) => ({ ...item, src: `${item.src}?v=${version}` })) }]);
    expect(catalogueIndex(moved(1)).pattern).toBe(first.pattern);
    for (let other = 0; other < 8; other++) catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }]));
    // Eight others since: let go, so it compiles again.
    expect(catalogueIndex(moved(2)).pattern).not.toBe(first.pattern);
  });

  it("compiles nothing again for a catalogue whose emoji differ only in their pictures' addresses, and finds the new pictures", () => {
    const emoji = [...freshEmoji(), { ...freshEmoji(1)[0]!, skinTones: [{ id: `toned-${made}`, src: "/tone/1.png", text: "👋🏻" }] }];
    const before = catalogueIndex(wrap([{ id: "all", label: "All", items: emoji }]));
    // A CDN's addresses, signed afresh: new emoji objects, the same ids, text and shortcodes.
    const moved = emoji.map((item) => ({ ...item, src: `${item.src}?signature=2` }));
    const after = catalogueIndex(wrap([{ id: "all", label: "All", items: moved }]));
    expect(after).not.toBe(before);
    expect(after.pattern).toBe(before.pattern);
    expect(after.textPattern).toBe(before.textPattern);
    expect(after.textStarts).toBe(before.textStarts);
    expect(after.byId.get(moved[0]!.id)).toEqual({ item: moved[0], tone: "default" });
    expect(after.byText.get("👋🏻")).toEqual({ item: moved.at(-1), tone: "light" });
    expect(after.byToken.get(moved[1]!.shortcodes![0]!)!.item).toBe(moved[1]);
    // A change to what the emoji say compiles their patterns afresh.
    const renamed = catalogueIndex(wrap([{ id: "all", label: "All", items: moved.map((item, at) => (at === 0 ? { ...item, text: "🦊" } : item)) }]));
    expect(renamed.pattern).not.toBe(before.pattern);
    expect(renamed.byText.get("🦊")!.item.id).toBe(moved[0]!.id);
  });

  it("keeps a shape in use among the 8 most recent, not only the 8 built most recently", () => {
    const kept = freshEmoji();
    const first = catalogueIndex(wrap([{ id: "all", label: "All", items: kept }]));
    const moved = (version: number) => wrap([{ id: "all", label: "All", items: kept.map((item) => ({ ...item, src: `${item.src}?v=${version}` })) }]);
    for (let round = 0; round < 3; round++) {
      for (let other = 0; other < 7; other++) catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }]));
      expect(catalogueIndex(moved(round)).pattern).toBe(first.pattern);
    }
  });

  it("tells apart catalogues whose emoji say different things, and not those that say the same in other words", () => {
    const base = (): EmojiItem[] => [{ id: "a", name: "A", text: "🦊", shortcodes: ["ab", "c"], src: "/a.png", skinTones: [{ id: "a-1", src: "/a1.png", text: "🦊🏻" }] }];
    const patternOf = (items: EmojiItem[]) => catalogueIndex(wrap([{ id: "all", label: "All", items }])).pattern;
    const original = patternOf(base());
    expect(patternOf(base())).toBe(original);
    const changes: [string, (item: EmojiItem) => EmojiItem][] = [
      ["a shortcode", (item) => ({ ...item, shortcodes: ["ab", "d"] })],
      ["where shortcodes divide", (item) => ({ ...item, shortcodes: ["a", "bc"] })],
      ["no shortcodes", (item) => ({ ...item, shortcodes: undefined })],
      ["a tone's id", (item) => ({ ...item, skinTones: [{ id: "a-2", src: "/a1.png", text: "🦊🏻" }] })],
      ["a tone's text", (item) => ({ ...item, skinTones: [{ id: "a-1", src: "/a1.png", text: "🦊🏼" }] })],
      ["no tones", (item) => ({ ...item, skinTones: undefined })],
      ["no text", (item) => ({ ...item, text: undefined })],
    ];
    for (const [, change] of changes) expect(patternOf(base().map(change))).not.toBe(original);
    const bare = (): EmojiItem[] => [{ id: "b", name: "B", src: "/b.png", skinTones: [{ id: "b-1", src: "/b1.png" }] }];
    const spelledOut = (): EmojiItem[] => [{ id: "b", name: "B", text: "", shortcodes: [], src: "/b.png", skinTones: [{ id: "b-1", src: "/b1.png", text: "" }] }];
    expect(patternOf(spelledOut())).toBe(patternOf(bare()));
    expect(patternOf([{ id: "b", name: "B", src: "/b.png" }])).toBe(patternOf([{ id: "b", name: "B", src: "/b.png", skinTones: [] }]));
  });

  it("shares one index between fresh catalogue objects holding the same emoji", () => {
    const smileys = freshEmoji();
    const people = freshEmoji();
    const categories = [
      { id: "smileys", label: "Smileys", items: smileys },
      { id: "people", label: "People", items: people },
    ];
    // A new object around the same categories, and around new arrays of the same emoji.
    const fresh = [wrap(categories), ...Array.from({ length: 50 }, () => wrap(categories)), wrap(copyCategories(categories)), wrap(copyCategories(categories))];
    expect(buildsOf(fresh)).toBe(1);
    const index = catalogueIndex(fresh[0]!);
    expect(index.items).toEqual([...smileys, ...people]);
    // What a shared index finds is the emoji the catalogue holds.
    expect(splitEmojiText(`hi :${smileys[0]!.shortcodes![0]}:`, wrap(copyCategories(categories)))).toEqual(["hi ", { item: smileys[0], tone: "default", source: `:${smileys[0]!.shortcodes![0]}:` }]);
    expect(warnings()).toEqual([]);
  });

  it("makes no WeakMap per emoji, however many the catalogue holds", () => {
    // A WeakMap per emoji chains them, and a collector that marks WeakMaps a level at a time walks the chain in every collection.
    let weakMaps = 0;
    const Native = globalThis.WeakMap;
    vi.stubGlobal(
      "WeakMap",
      class extends Native<object, unknown> {
        constructor(entries?: readonly (readonly [object, unknown])[] | null) {
          super(entries);
          weakMaps += 1;
        }
      },
    );
    try {
      const items = freshEmoji(2000);
      const index = catalogueIndex(wrap([{ id: "all", label: "All", items }]));
      expect(catalogueIndex(wrap([{ id: "all", label: "All", items: [...items] }]))).toBe(index);
      // Catalogues with no emoji share one index too.
      expect(catalogueIndex(wrap([]))).toBe(catalogueIndex(wrap([{ id: "none", label: "None", items: [] }])));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(weakMaps).toBe(0);
  });

  it("keeps the lists of the 8 catalogues indexed most recently that start with the same emoji", () => {
    const [first] = freshEmoji(1);
    const catalogueOf = (rest: EmojiItem[]) => wrap([{ id: "all", label: "All", items: [first!, ...rest] }]);
    const kept = freshEmoji(2);
    const index = catalogueIndex(catalogueOf(kept));
    for (let other = 0; other < 7; other++) catalogueIndex(catalogueOf(freshEmoji(2)));
    // Seven others since, each starting with the same emoji: still kept.
    expect(catalogueIndex(catalogueOf([...kept]))).toBe(index);
    for (let other = 0; other < 8; other++) catalogueIndex(catalogueOf(freshEmoji(2)));
    // Eight others since: let go, so it is built again.
    expect(catalogueIndex(catalogueOf([...kept]))).not.toBe(index);
  });

  it("builds a new index for a catalogue whose emoji changed", () => {
    const items = freshEmoji();
    const before = wrap([{ id: "all", label: "All", items }]);
    const added = wrap([{ id: "all", label: "All", items: [...items, ...freshEmoji(1)] }]);
    const reordered = wrap([{ id: "all", label: "All", items: [...items].reverse() }]);
    const renewed = wrap([{ id: "all", label: "All", items: items.map((item) => ({ ...item, src: `${item.src}?v=2` })) }]);
    expect(buildsOf([before, added, reordered, renewed])).toBe(4);
    for (const changed of [before, added, reordered, renewed]) expect(catalogueIndex(changed).items).toEqual(changed.categories[0]!.items);
  });

  it("shares one index between catalogues with the same id, and keeps the most recent ids", () => {
    const first = catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }], "contoso-1"));
    // Every copy has new emoji objects, so only the id can say they are the same.
    expect(catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }], "contoso-1"))).toBe(first);
    const second = catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }], "contoso-2"));
    expect(second).not.toBe(first);
    // Sixteen ids are kept: a seventeenth lets the oldest go, and keeps the next.
    for (let id = 3; id <= 17; id += 1) catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji(1) }], `contoso-${id}`));
    expect(catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }], "contoso-2"))).toBe(second);
    expect(catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }], "contoso-1"))).not.toBe(first);
  });

  it("finds a fresh catalogue's index reading each emoji once, and the same object's without reading anything", () => {
    let reads = 0;
    const counted = (items: EmojiItem[]) =>
      new Proxy(items, {
        get(target, key, receiver) {
          if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    const categories = [
      { id: "smileys", label: "Smileys", items: counted(freshEmoji(40)) },
      { id: "people", label: "People", items: counted(freshEmoji(40)) },
    ];
    let looks = 0;
    const once: EmojiCatalogue = {
      get categories() {
        looks += 1;
        return categories;
      },
    };
    const index = catalogueIndex(once);
    reads = 0;
    looks = 0;
    // The same object: no look at its categories at all.
    expect(catalogueIndex(once)).toBe(index);
    expect(looks).toBe(0);
    // A new object around the same item arrays: a lookup per emoji, each read once, and no build, which would read them again.
    expect(catalogueIndex(wrap(categories))).toBe(index);
    expect(reads).toBe(80);
    reads = 0;
    expect(catalogueIndex(wrap(categories.map((category) => ({ ...category }))))).toBe(index);
    expect(reads).toBe(80);
  });

  it("finds an emoji the app pushed into the same array, in a fresh catalogue", () => {
    const custom = freshEmoji();
    const categories = [{ id: "custom", label: "Contoso", items: custom }];
    const before = catalogueIndex(wrap(categories));
    // An array the app changes in place, as a reactive store's array keeps its identity.
    const [added] = freshEmoji(1);
    custom.push(added!);
    const after = wrap(categories);
    expect(catalogueIndex(after)).not.toBe(before);
    expect(catalogueIndex(after).byId.get(added!.id)).toEqual({ item: added, tone: "default" });
    expect(splitEmojiText(`hi :${added!.shortcodes![0]}:`, after)).toEqual(["hi ", { item: added, tone: "default", source: `:${added!.shortcodes![0]}:` }]);
    // Taken out again, the emoji is gone from the next catalogue's index.
    custom.pop();
    expect(catalogueIndex(wrap(categories))).toBe(before);
    expect(catalogueIndex(wrap(categories)).byId.has(added!.id)).toBe(false);
  });

  it("keeps the ids used most recently, letting go of the one used longest ago", () => {
    const copy = (id: string) => wrap([{ id: "all", label: "All", items: freshEmoji(1) }], id);
    const first = catalogueIndex(copy("busy"));
    const second = catalogueIndex(copy("quiet"));
    for (let id = 3; id <= 16; id += 1) catalogueIndex(copy(`other-${id}`));
    // Sixteen ids now. Using the first again keeps it, so the seventeenth lets the second go instead.
    expect(catalogueIndex(copy("busy"))).toBe(first);
    catalogueIndex(copy("other-17"));
    expect(catalogueIndex(copy("busy"))).toBe(first);
    expect(catalogueIndex(copy("quiet"))).not.toBe(second);
  });

  it("stays quiet for many different catalogues, and for equivalent fresh ones however often an app makes them", () => {
    step = 0;
    // A page of examples, each with its own emoji, the same number of them.
    for (let count = 0; count < 20; count += 1) catalogueIndex(wrap([{ id: "all", label: "All", items: freshEmoji() }]));
    const categories = [{ id: "all", label: "All", items: freshEmoji(10) }];
    for (let count = 0; count < 1000; count += 1) splitEmojiText("plain words", wrap(copyCategories(categories)));
    expect(warnings()).toEqual([]);
  });

  it("warns once in development when the same emoji are indexed more than three times within a second", () => {
    step = 0;
    const items = freshEmoji();
    // Each copy holds new objects for the same emoji, as a helper that rebuilds them for each message does.
    const build = () => catalogueIndex(wrap([{ id: "all", label: "All", items: items.map((item) => ({ ...item })) }]));
    // Three in a second is still quiet, and so is a fourth once the first three are a second old.
    for (let count = 0; count < 3; count += 1) build();
    now += 1000;
    build();
    expect(warnings()).toEqual([]);
    // Four within the second warn, once however many follow.
    for (let count = 0; count < 3; count += 1) build();
    expect(warnings()).toHaveLength(1);
    for (let count = 0; count < 20; count += 1) build();
    expect(warnings()).toHaveLength(1);
    expect(String(warnings()[0]![0])).toMatch(/^\[ouro-ui\] EmojiCatalogue: .*new emoji objects.*Fix: build the catalogue once and pass that object every time .* or give every copy the same id/);
  });
});
