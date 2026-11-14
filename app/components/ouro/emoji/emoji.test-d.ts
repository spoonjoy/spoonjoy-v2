import { createElement, type ComponentProps, type ReactElement } from "react";
import { expectTypeOf } from "vitest";
import {
  Emoji,
  EmojiText,
  type EmojiCatalogue,
  type EmojiCatalogueCategory,
  type EmojiFilmstrip,
  type EmojiItem,
  type EmojiItemTone,
  type EmojiProps,
  type EmojiSkinTone,
  type EmojiTextProps,
} from "~/components/ouro/emoji/emoji";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const party: EmojiItem = { id: "party", name: "Party popper", src: "/emoji/party.png" };
const catalogue: EmojiCatalogue = { categories: [{ id: "symbols", label: "Symbols", items: [party] }] };

// An item needs its id, name and still image; the rest is optional.
expectTypeOf<{ id: "party"; name: "Party popper"; src: "/party.png" }>().toExtend<EmojiItem>();
expectTypeOf<{
  id: "wave";
  name: "Waving hand";
  src: "/wave.png";
  srcSet: "/wave-2x.png 2x";
  animatedSrc: "/wave.gif";
  shortcodes: readonly ["wave"];
  keywords: readonly ["hello"];
  text: "👋";
  custom: false;
  filmstrip: EmojiFilmstrip;
  width: 64;
  height: 64;
  skinTones: readonly EmojiItemTone[];
}>().toExtend<EmojiItem>();
expectTypeOf<{ id: "party"; name: "Party popper" }>().not.toExtend<EmojiItem>();
expectTypeOf<{ src: "/blink-strip.png"; fps: 12 }>().toExtend<EmojiFilmstrip>();
expectTypeOf<{ src: "/blink-strip.png" }>().not.toExtend<EmojiFilmstrip>();
expectTypeOf<{ id: "wave-tone1"; src: "/wave-1.png"; animatedSrc: "/wave-1.gif"; text: "👋🏻" }>().toExtend<EmojiItemTone>();
expectTypeOf<{ id: "custom"; label: "Fernwood"; items: readonly EmojiItem[] }>().toExtend<EmojiCatalogueCategory>();
expectTypeOf<{ categories: readonly [] }>().toExtend<EmojiCatalogue>();

// Emoji draws an item, in a tone, playing or not; img attributes pass through.
expectTypeOf<{ item: EmojiItem }>().toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; skinTone: "medium"; play: true; alt: ""; className: "ms-1"; loading: "eager"; title: "Party" }>().toExtend<EmojiProps>();
expectTypeOf<ComponentProps<typeof Emoji>>().toEqualTypeOf<EmojiProps>();
expectTypeOf<EmojiProps["skinTone"]>().toExtend<EmojiSkinTone | (string & {}) | undefined>();
expectTypeOf<{ play: true }>().not.toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; skinTone: "tan" }>().not.toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; src: "/party.png" }>().not.toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; emoji: "🎉" }>().not.toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; animate: true }>().not.toExtend<EmojiProps>();
// A placeholder shows until the picture has decoded: an image's address, or an element.
expectTypeOf<{ item: EmojiItem; placeholder: "/emoji/waiting.png" }>().toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; placeholder: ReactElement }>().toExtend<EmojiProps>();
expectTypeOf<{ item: EmojiItem; placeholder: 0 }>().not.toExtend<EmojiProps>();

// EmojiText takes the text and the catalogue, not children.
expectTypeOf<{ text: "Shipped :party:"; catalogue: EmojiCatalogue }>().toExtend<EmojiTextProps>();
expectTypeOf<{ text: ":party:"; catalogue: EmojiCatalogue; enlarge: true; className: "mt-1"; id: "body" }>().toExtend<EmojiTextProps>();
expectTypeOf<ComponentProps<typeof EmojiText>>().toEqualTypeOf<EmojiTextProps>();
expectTypeOf<{ text: ":party:" }>().not.toExtend<EmojiTextProps>();
expectTypeOf<{ catalogue: EmojiCatalogue; children: ":party:" }>().not.toExtend<EmojiTextProps>();

// @ts-expect-error item is required.
createElement(Emoji, {});
// @ts-expect-error the text goes in text.
createElement(EmojiText, { catalogue, children: "Shipped :party:" });
