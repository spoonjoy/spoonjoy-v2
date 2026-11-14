import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Emoji, EmojiText, type EmojiCatalogue, type EmojiItem } from "~/components/ouro/emoji/emoji";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

// A made-up catalogue: simple emoji drawn here as SVG, a few animated (SMIL), one with skin tones,
// and a custom category an organization would add. An app passes its own set.
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
const wobble = '<animateTransform attributeName="transform" type="rotate" values="-10 16 16;10 16 16;-10 16 16" dur="0.9s" repeatCount="indefinite"/>';
const ink = "#5b3a1e";
const face = (mouth: string, extra = "") => `<circle cx="16" cy="16" r="14" fill="#ffc83d"/><circle cx="11" cy="13" r="2" fill="${ink}"/><circle cx="21" cy="13" r="2" fill="${ink}"/>${mouth}${extra}`;
const smile = `<path d="M10 19q6 6 12 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
const drawings: Record<string, string> = {
  smile: face(smile),
  laugh: face(`<path d="M9 18h14q-1 8-7 8t-7-8z" fill="${ink}"/>`),
  wow: face(`<ellipse cx="16" cy="22" rx="3" ry="3.6" fill="${ink}"/>`),
  sad: face(`<path d="M11 23q5-5 10 0" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`, '<path d="M22 16q2 4 0 5q-2-1 0-5z" fill="#4aa8ff"/>'),
  heart: '<path d="M16 28C6 20 3 15 3 10.5a6.5 6.5 0 0 1 13-2a6.5 6.5 0 0 1 13 2C29 15 26 20 16 28z" fill="#e8435a"/>',
  star: '<path d="m16 3 3.9 8.2 9 1.1-6.6 6.2 1.7 8.9L16 23l-8 4.4 1.7-8.9-6.6-6.2 9-1.1z" fill="#ffb400"/>',
  party: '<path d="M5 28 12 9l11 11z" fill="#7c5cff"/><circle cx="22" cy="6" r="2" fill="#e8435a"/><circle cx="27" cy="12" r="2" fill="#2bb673"/><circle cx="17" cy="4" r="1.6" fill="#ffb400"/>',
  check: '<rect x="3" y="3" width="26" height="26" rx="7" fill="#2bb673"/><path d="m9 16.5 4.5 4.5L23 11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  fern: '<path d="M16 29V5" stroke="#2f7d4f" stroke-width="2" stroke-linecap="round"/><path d="M16 9q-6-1-8-5q6 0 8 5zm0 0q6-1 8-5q-6 0-8 5zm0 6q-7-1-10-5q7 0 10 5zm0 0q7-1 10-5q-7 0-10 5zm0 6q-7-1-10-5q7 0 10 5zm0 0q7-1 10-5q-7 0-10 5z" fill="#4caf73"/>',
  mug: '<path d="M6 10h16v12a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5z" fill="#b5651d"/><path d="M22 13h2a4 4 0 0 1 0 8h-2" stroke="#b5651d" stroke-width="2.4" fill="none"/><path d="M10 4q2 2 0 4m5-4q2 2 0 4" stroke="#9aa0a6" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
};
const hand = (fill: string) =>
  `<g fill="${fill}" stroke="${ink}" stroke-width="0.8"><rect x="8.5" y="4" width="3.4" height="14" rx="1.7"/><rect x="12.4" y="2.5" width="3.4" height="15" rx="1.7"/><rect x="16.3" y="3" width="3.4" height="15" rx="1.7"/><rect x="20.2" y="5" width="3.2" height="13" rx="1.6"/><rect x="3.5" y="13" width="9" height="3.6" rx="1.8" transform="rotate(35 8 15)"/><rect x="8.5" y="12" width="15" height="17" rx="6"/></g>`;
const tones = ["#f7dece", "#e0bb95", "#bf8f68", "#9b643d", "#594539"];
const still = (name: string) => svg(drawings[name]!);
const animated = (body: string) => svg(`<g>${body}${wobble}</g>`);
const emoji = (id: string, name: string, shortcodes: string[], keywords: string[], extra: Partial<EmojiItem> = {}): EmojiItem => ({ id, name, shortcodes, keywords, src: still(id), ...extra });
const wave: EmojiItem = {
  id: "wave",
  name: "Waving hand",
  shortcodes: ["wave"],
  keywords: ["hello", "bye"],
  text: "👋",
  src: svg(hand("#ffc83d")),
  animatedSrc: animated(hand("#ffc83d")),
  skinTones: tones.map((fill, index) => ({ id: `wave-tone${index + 1}`, src: svg(hand(fill)), animatedSrc: animated(hand(fill)) })),
};
// A filmstrip: square frames stacked top to bottom, stepped through at its fps while it plays.
const eyes = {
  open: `<circle cx="11" cy="13" r="2" fill="${ink}"/><circle cx="21" cy="13" r="2" fill="${ink}"/>`,
  half: `<ellipse cx="11" cy="13.5" rx="2.2" ry="1" fill="${ink}"/><ellipse cx="21" cy="13.5" rx="2.2" ry="1" fill="${ink}"/>`,
  shut: `<path d="M8.8 13.5h4.4M18.8 13.5h4.4" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`,
};
const blinkFrame = (open: string, top: number) => `<g transform="translate(0 ${top})"><circle cx="16" cy="16" r="14" fill="#ffc83d"/>${open}${smile}</g>`;
const blinkFrames = [eyes.open, eyes.open, eyes.open, eyes.half, eyes.shut, eyes.half];
const blink: EmojiItem = {
  id: "blink",
  name: "Blinking face",
  shortcodes: ["blink"],
  keywords: ["sleepy"],
  width: 32,
  height: 32,
  src: svg(blinkFrame(eyes.open, 0)),
  filmstrip: {
    src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="${32 * blinkFrames.length}" viewBox="0 0 32 ${32 * blinkFrames.length}">${blinkFrames.map((open, index) => blinkFrame(open, index * 32)).join("")}</svg>`)}`,
    fps: 8,
  },
};
const catalogue: EmojiCatalogue = {
  categories: [
    {
      id: "smileys",
      label: "Smileys",
      items: [
        emoji("smile", "Smiling face", ["smile"], ["happy"], { text: "🙂", animatedSrc: animated(drawings.smile!) }),
        emoji("laugh", "Laughing face", ["laugh", "lol"], ["funny"], { text: "😆", animatedSrc: animated(drawings.laugh!) }),
        emoji("wow", "Surprised face", ["wow"], ["amazed"], { text: "😮" }),
        emoji("sad", "Sad face", ["sad"], ["tear"], { text: "😢" }),
        wave,
        blink,
      ],
    },
    {
      id: "symbols",
      label: "Symbols",
      items: [
        emoji("heart", "Red heart", ["heart"], ["love"], { text: "❤️", animatedSrc: animated(drawings.heart!) }),
        emoji("star", "Star", ["star"], ["favorite"], { text: "⭐" }),
        emoji("party", "Party popper", ["party", "tada"], ["celebrate"], { text: "🎉", animatedSrc: animated(drawings.party!) }),
        emoji("check", "Check mark", ["check", "done"], ["yes"], { text: "✅" }),
      ],
    },
    {
      id: "custom",
      label: "Fernwood",
      items: [emoji("fern", "Fernwood fern", ["fern"], ["team", "logo"], { custom: true }), emoji("mug", "Team coffee", ["coffee_time"], ["break"], { custom: true })],
    },
  ],
};

const find = (id: string) => catalogue.categories.flatMap((category) => category.items).find((item) => item.id === id)!;
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: "14px", lineHeight: "20px", color: "var(--foreground)" };
const bubble: CSSProperties = { maxWidth: 360, padding: "8px 12px", borderRadius: 12, background: "var(--muted)", color: "var(--foreground)", fontSize: "14px", lineHeight: "20px" };

const meta = {
  title: "Chat/Emoji",
  component: Emoji,
  parameters: { layout: "centered" },
  args: { item: find("party") },
  argTypes: {
    item: { control: false },
    skinTone: { control: "inline-radio", options: ["default", "light", "medium-light", "medium", "medium-dark", "dark"] },
    play: { control: "boolean" },
  },
} satisfies Meta<typeof Emoji>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One emoji from the app's catalogue, the size of the text around it. An animated one plays while the mouse is on it. */
export const Playground: Story = {
  render: (args) => (
    <p style={{ ...row, margin: 0 }}>
      Release day <Emoji {...args} /> is here
    </p>
  ),
};

/**
 * In a button, an animated emoji plays while the button is under the mouse or has focus, and
 * stays still otherwise and with reduced motion. The blinking face is a filmstrip, its frames
 * stacked in one image; the others are animated images.
 */
export const InButtons: Story = {
  render: () => (
    <div style={row}>
      {["smile", "laugh", "heart", "party", "blink"].map((id) => (
        <Button key={id} variant="soft" tone="secondary" aria-label={find(id).name}>
          <Emoji item={find(id)} alt="" />
        </Button>
      ))}
    </div>
  ),
};

/** An emoji with tones in each of them. */
export const SkinTones: Story = {
  render: () => (
    <div style={{ ...row, fontSize: "24px" }}>
      {(["default", "light", "medium-light", "medium", "medium-dark", "dark"] as const).map((tone) => (
        <Emoji key={tone} item={wave} skinTone={tone} />
      ))}
    </div>
  ),
};

// What stands in while a picture loads: a soft disc, as an image's address and as an element in the theme's colours.
const waiting = svg('<circle cx="16" cy="16" r="13" fill="#a1a1aa" fill-opacity="0.35"/>');
const disc = (
  <svg viewBox="0 0 32 32" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="13" fill="var(--muted)" />
  </svg>
);
// A picture that cannot load, so its placeholder stays.
const missing: EmojiItem = { id: "missing", name: "Missing star", src: "data:image/png;base64,AAAA" };

/**
 * `placeholder` stands in, in the emoji's own box, until each picture has loaded and decoded;
 * the picture then fades in, at once with reduced motion. The last picture cannot load, so its
 * placeholder stays. Load again draws them afresh.
 */
export const Placeholder: Story = {
  render: function Render() {
    const [round, setRound] = useState(0);
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
        <p key={round} style={{ ...row, margin: 0, fontSize: "24px", lineHeight: "32px" }}>
          {["smile", "heart", "party"].map((id) => (
            <Emoji key={id} item={find(id)} placeholder={waiting} />
          ))}
          <Emoji item={wave} skinTone="medium" placeholder={disc} />
          <Emoji item={missing} placeholder={waiting} />
        </p>
        <Button variant="soft" tone="secondary" onClick={() => setRound((count) => count + 1)}>
          Load again
        </Button>
      </div>
    );
  },
};

/** `EmojiText` draws a message's tokens and emoji text as the catalogue's images, and leaves a token it does not know as typed. */
export const InMessages: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={bubble}>
        <EmojiText text="Shipped the release notes :party: thanks for the reviews :heart: and :fern: (and :unknown: stays text)" catalogue={catalogue} />
      </div>
      <div style={bubble}>
        <EmojiText text="Typed on a phone: 👋 see you at standup ✅" catalogue={catalogue} />
      </div>
      <div style={bubble}>
        <EmojiText text=":laugh: :laugh:" catalogue={catalogue} enlarge />
      </div>
    </div>
  ),
};
