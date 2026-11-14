import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Heading } from "~/components/ouro/text/heading";
import { Moment, MomentProvider } from "~/components/ouro/moment/moment";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The art is
// made-up placeholder art: plain shapes in `currentColor` (which the moment's kind sets) and
// the theme's variables, so it follows the theme and dark mode.

function Page({ children, width }: { children: ReactNode; width?: number }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 24, maxWidth: width }}>{children}</div>;
}

function Panel({ children }: { children: ReactNode }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "calc(var(--radius) + 4px)", background: "var(--card)", color: "var(--card-foreground)" }}>{children}</div>;
}

const ground = <ellipse cx="100" cy="136" rx="62" ry="6" fill="currentColor" opacity="0.12" />;

/** An open tray with a small moon above it: nothing here yet. */
function TrayArt() {
  return (
    <svg viewBox="30 8 140 140" fill="none">
      {ground}
      <circle cx="100" cy="30" r="12" style={{ fill: "var(--primary)" }} />
      <circle cx="132" cy="20" r="3" style={{ fill: "var(--primary)" }} opacity="0.45" />
      <circle cx="68" cy="42" r="2" fill="currentColor" opacity="0.4" />
      <path d="M46 78 100 58l54 20-54 20Z" fill="currentColor" opacity="0.1" />
      <path d="M46 78 100 98v32l-54-22Z" fill="currentColor" opacity="0.28" />
      <path d="M154 78 100 98v32l54-22Z" fill="currentColor" opacity="0.42" />
    </svg>
  );
}

/** A doorway with the sun behind it: come on in. */
function DoorwayArt() {
  return (
    <svg viewBox="36 16 128 128" fill="none">
      {ground}
      <circle cx="136" cy="44" r="18" style={{ fill: "var(--warning)" }} opacity="0.85" />
      <path d="M50 134V96a50 50 0 0 1 100 0v38Z" fill="currentColor" opacity="0.22" />
      <path d="M74 134v-34a26 26 0 0 1 52 0v34Z" style={{ fill: "var(--background)" }} />
      <path d="M74 134v-34a26 26 0 0 1 52 0v34" stroke="currentColor" strokeWidth="3" />
      <circle cx="58" cy="30" r="3" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** A filled disc with a tick: done. */
function TickArt() {
  return (
    <svg viewBox="40 16 120 128" fill="none">
      {ground}
      <circle cx="100" cy="70" r="46" fill="currentColor" opacity="0.14" />
      <circle cx="100" cy="70" r="30" fill="currentColor" />
      <path d="m86 71 10 10 19-21" style={{ stroke: "var(--background)" }} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A card whose line breaks off: something failed. */
function BrokenLineArt() {
  return (
    <svg viewBox="38 16 124 128" fill="none">
      {ground}
      <rect x="50" y="34" width="100" height="84" rx="14" fill="currentColor" opacity="0.1" />
      <path d="m66 96 16-18 14 10 10-14" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m120 62 16-16" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 9" />
      <circle cx="146" cy="38" r="12" fill="currentColor" />
      <path d="M146 32v6" style={{ stroke: "var(--background)" }} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="146" cy="44" r="2" style={{ fill: "var(--background)" }} />
    </svg>
  );
}

/** The tray, with its moon drifting up and down (an SVG animation, which pauses with reduced motion). */
function DriftingTrayArt() {
  return (
    <svg viewBox="30 8 140 140" fill="none">
      {ground}
      <circle cx="100" cy="30" r="12" style={{ fill: "var(--primary)" }}>
        <animateTransform attributeName="transform" type="translate" values="0 0; 0 -4; 0 0" dur="4s" repeatCount="indefinite" />
      </circle>
      <path d="M46 78 100 58l54 20-54 20Z" fill="currentColor" opacity="0.1" />
      <path d="M46 78 100 98v32l-54-22Z" fill="currentColor" opacity="0.28" />
      <path d="M154 78 100 98v32l54-22Z" fill="currentColor" opacity="0.42" />
    </svg>
  );
}

const meta = {
  title: "Feedback/Moment",
  component: Moment,
  parameters: { layout: "padded" },
  args: { title: "No messages yet", description: "Messages you send show up here.", art: <TrayArt /> },
  argTypes: {
    kind: { control: "inline-radio", options: ["empty", "loading", "error", "first-run", "success"] },
    size: { control: "inline-radio", options: ["default", "inline"] },
    art: { control: false },
  },
} satisfies Meta<typeof Moment>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Each kind with its placeholder art, in panels of their own; a phone's narrow pane holds the art at 96px. */
export const Kinds: Story = {
  parameters: { screenshot: { name: "moment-kinds" } },
  render: () => (
    <Page>
      <Heading level={2}>Inbox</Heading>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))" }}>
        <Panel>
          <Moment art={<TrayArt />} title="No messages yet" description="Messages you send show up here." action={<Button>New message</Button>} />
        </Panel>
        <Panel>
          <Moment kind="first-run" art={<DoorwayArt />} title="Welcome in" description="Three short steps and you're set." action={<Button>Start</Button>} secondaryAction={<Button variant="plain">Later</Button>} />
        </Panel>
        <Panel>
          <Moment kind="error" art={<BrokenLineArt />} title="Messages didn't load: you're offline" description="Check your connection, then try again." action={<Button variant="outline">Try again</Button>} />
        </Panel>
        <Panel>
          <Moment kind="success" art={<TickArt />} title="All caught up" description="You've read everything new." />
        </Panel>
        <Panel>
          <Moment kind="loading" title="Loading messages" description="This takes a moment." />
        </Panel>
      </div>
    </Page>
  ),
};

/** Quiet moments for a dense pane, and an inline "working" row. */
export const QuietAndInline: Story = {
  parameters: { screenshot: { name: "moment-quiet" } },
  render: () => (
    <Page width={420}>
      <Heading level={2}>Side panel</Heading>
      <Panel>
        <MomentProvider quiet>
          <Moment art={<TrayArt />} title="No drafts" description="Drafts you start show up here." />
          <Moment kind="error" art={<BrokenLineArt />} title="Not synced: no answer" description="We'll try again in a minute." action={<Button size="sm" variant="outline">Retry</Button>} />
        </MomentProvider>
      </Panel>
      <Panel>
        <div style={{ padding: "8px 12px" }}>
          <Moment size="inline" kind="loading" title="Syncing" description="12 of 40 messages" />
        </div>
      </Panel>
    </Page>
  ),
};

/** Send, and the moment turns from loading into a success that celebrates (only fading, with reduced motion). */
export const Celebration: Story = {
  render: function Render() {
    const [state, setState] = useState<"idle" | "sent">("idle");
    return (
      <Page width={480}>
        <Panel>
          {state === "idle" ? (
            <Moment kind="first-run" art={<DoorwayArt />} title="Say hello" description="Your first message starts the conversation." action={<Button onClick={() => setState("sent")}>Send hello</Button>} />
          ) : (
            <Moment kind="success" announce art={<TickArt />} title="Hello sent" description="Replies show up here." action={<Button variant="outline" onClick={() => setState("idle")}>Start over</Button>} />
          )}
        </Panel>
      </Page>
    );
  },
};

/** A dismissible welcome: the close button hides it and hands focus on. */
export const Dismissible: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <Page width={480}>
        <Panel>{open ? <Moment kind="first-run" art={<DoorwayArt />} title="Welcome in" description="Close this whenever you like." onDismiss={() => setOpen(false)} /> : <div style={{ padding: 16 }}>Closed.</div>}</Panel>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Show the welcome again
        </Button>
      </Page>
    );
  },
};

/** Art with motion of its own: the moon drifts, and stops with reduced motion. */
export const AnimatedArt: Story = {
  render: () => (
    <Page width={480}>
      <Moment art={<DriftingTrayArt />} title="Nothing here yet" description="New things land in this tray." />
    </Page>
  ),
};

/** The main state of a large, otherwise empty pane: hero art up to 220px, 96px in a narrow pane. */
export const Hero: Story = {
  parameters: { screenshot: { name: "moment-hero" } },
  render: () => (
    <Page>
      <Panel>
        <Moment size="hero" art={<TrayArt />} title="Pick a conversation" description="It opens here, at the newest message." />
      </Panel>
    </Page>
  ),
};

/** A small round head: the placeholder for whoever asks. */
function AskerArt() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="10" r="4" fill="currentColor" />
      <path d="M5.5 19a7 7 0 0 1 13 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** An ask, docked in the conversation's header strip: one row in its own slot, never over the messages. Not now keeps it away for an hour. */
export const Ask: Story = {
  parameters: { screenshot: { name: "moment-ask" } },
  render: function Render() {
    const [shown, setShown] = useState(true);
    return (
      <Page width={640}>
        <Panel>
          <div style={{ display: "grid", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <strong>Launch planning</strong>
            {shown && (
              <Moment
                kind="ask"
                size="inline"
                art={<AskerArt />}
                title="Planner wants to show you the launch plan"
                action={<Button size="sm" onClick={() => setShown(false)}>Show me</Button>}
                onDismiss={() => setShown(false)}
                dismissLabel="Not now"
              />
            )}
          </div>
          <div style={{ padding: 16, color: "var(--muted-foreground)" }}>The conversation's messages stay where they are.</div>
        </Panel>
        <Button variant="outline" onClick={() => setShown(true)}>
          Ask again
        </Button>
      </Page>
    );
  },
};
