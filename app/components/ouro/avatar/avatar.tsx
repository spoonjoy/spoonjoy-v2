"use client";

import { Children, createContext, isValidElement, useContext, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { HTMLAttributes, JSX, ReactNode, Ref } from "react";
import { sizeFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { isPictureReady, rememberPicture } from "~/lib/ouro/avatar-pictures";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Skeleton } from "~/components/ouro/skeleton/skeleton";
import { groupChatWith } from "~/components/ouro/avatar/avatar-styles";

/**
 * Avatar sizes: 24, 32, 40, 48, 64, 72 and 112px.
 *
 * @claim "Avatar sizes: 24, 32, 40, 48" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar > comes in sizes that grow in order, as circles)
 * @claim "Avatar sizes: 24, 32, 40, 48" registry/ouro/components/ouro/avatar/avatar.tsx verify:fileLine(registry/ouro/components/ouro/avatar/avatar.tsx, /"3xl": "size-ouro-28/)
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/**
 * A person's presence, drawn as a dot with its own shape: a check (available), a solid
 * dot (busy), a bar (do not disturb), a clock (away), a ring with a cross (offline) and a
 * ring with an arrow (out of office), so it never relies on color alone.
 * @claim "A person's presence, drawn as a dot" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar presence > draws each state in its own shape and tone)
 */
export type AvatarPresence = "available" | "busy" | "away" | "do-not-disturb" | "offline" | "out-of-office";

/**
 * Avatar's shapes: a squircle for a person, a squircle with a second edge behind it for a team,
 * a channel, an app or a bot, and a less-rounded app tile for an AI agent.
 */
export type AvatarShape = "circle" | "square" | "agent";

/** Where the initials' colors come from: a hue picked from the name, the theme's primary, or the neutral surface. */
export type AvatarColor = "colorful" | "brand" | "neutral";

/** One member of a group chat, as Avatar's `members` takes them. */
export interface AvatarMember {
  /** The member's name: their initial comes from it, and screen readers hear it in the group's name. */
  name: string;
  /** The member's picture. Until it loads, and if it fails, their initial shows in their hue. */
  src?: string | undefined;
  /** What their hue is picked from, when it should not be `name`, as Avatar's `idForColor`. */
  idForColor?: string | undefined;
  /** The letters to take their initial from, when it should not come from `name`. */
  initials?: string | undefined;
}

/** The props Avatar adds to the `<span>` attributes it passes through. */
export interface AvatarOwnProps {
  /**
   * The person's or thing's name. Screen readers hear it, and the initials come from it
   * (the first letters of the first and last words) until the image loads, or when it
   * fails. Required, so no avatar is silent. Pass `null` while the name is still loading: the
   * avatar keeps its size and shape and shimmers as a Skeleton, and screen readers hear
   * `nameLoadingLabel`.
   * @claim "Required, so no avatar is silent" registry/ouro/components/ouro/avatar/avatar.test-d.ts verify:fileLine(registry/ouro/components/ouro/avatar/avatar.test-d.ts, /expectTypeOf<\{\ssrc:\s"\/ana\.jpg"\s\}>\(\)\.not\.toExtend<AvatarProps>/)
   * @claim "Pass `null` while the name is" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar > shimmers in its own size and shape while the name loads, and says so)
   */
  name: string | null;
  /** What screen readers hear while `name` is `null`, for other languages. @default "Name loading" */
  nameLoadingLabel?: string | undefined;
  /** The image URL. Until it loads, and if it fails, the initials show. */
  src?: string | undefined;
  /**
   * What screen readers hear, when it should differ from `name`. Pass `alt=""` when the
   * name is already written next to the avatar, so it isn't read twice.
   */
  alt?: string | undefined;
  /**
   * The letters to show instead of the ones taken from `name`, such as "AnL". Like the initials
   * taken from `name`, they are drawn (CSS generated content), not written as text.
   */
  initials?: string | undefined;
  /**
   * An icon to show in place of the initials, such as a calendar for a meeting or a note for
   * notes to self. It is decorative: the avatar's label stays `name`.
   */
  icon?: ReactNode | undefined;
  /**
   * `"circle"` for a person (a squircle), `"square"` for a team, a channel, an app or a bot (a
   * squircle with a second edge peeking out behind it, and no presence dot), `"agent"` for an AI
   * agent (a less-rounded tile, white in light mode, with the glyph in its own color and a
   * presence dot). The initials, icon or picture fill the shape, centered. @default "circle"
   * @claim "a presence dot" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar shapes and icons > shows no presence on a square, and names the fix)
   */
  shape?: AvatarShape | (string & { 'Use "circle", "square" or "agent"; rounded is "square", hexagon is "agent", a group chat is members': never }) | undefined;
  /**
   * A group chat's members, which draw the avatar as the group: the person's squircle cut into
   * slices, one per member shown, with a gap between them that lets what lies behind show
   * through. Below 40px it shows the first two, side by side; from 40px up, the first three (one
   * half and two quarters). Each slice is the member's picture, or their initial in their own
   * hue. One member fills the whole avatar. A group draws no presence dot and takes no `shape`:
   * a person is the circle, a group chat `members`, and a team, a channel, an app or a bot
   * `shape="square"`.
   *
   * Screen readers hear the group's name and who is in it: "The whole crew, group chat with
   * Captain Nemo, Professor Aronnax and 2 others" (`membersLabel` for other languages). Pass
   * `src` for a picture the group set for itself, which shows in place of the slices once it
   * loads.
   * @claim "Below 40px it shows the first two" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > cuts the avatar into two slices below 40px and three from 40px, at every size)
   * @claim "with a gap between them that lets" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > leaves a gap between the slices that shows what lies behind)
   * @claim "Each slice is the member's picture" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > shows each member's picture, or their initial in their own hue until it loads)
   * @claim "One member fills the whole avatar" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > fills the whole avatar with one member)
   * @claim "A group draws no presence dot" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > draws no presence and takes no shape, and names the fix)
   * @claim "Screen readers hear the group's name" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > says the group's name and who is in it)
   * @claim "which shows in place of the slices" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > shows the group's own picture in place of the slices once it loads)
   */
  members?: readonly AvatarMember[] | undefined;
  /**
   * The words screen readers hear after a group's name, for other languages, from its members'
   * names. @default "group chat with" the first two names, then the rest's count ("and 2 others")
   * @claim "the first two names, then the rest's count" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > says the group's name and who is in it)
   */
  membersLabel?: ((names: readonly string[]) => string) | undefined;
  /**
   * How the initials are colored. `"colorful"` picks one of eight hues from `idForColor`
   * (else `name`), so the same person always gets the same one, and the initials keep at
   * least 4.5:1 against it in light and dark. `"brand"` tints with the theme's primary;
   * `"neutral"` is the plain secondary surface. The hues are the theme tokens `--avatar-1`
   * to `--avatar-8` (`ouro-base`). @default "colorful"
   * @claim "picks one of eight hues from" registry/ouro/theme/ouro-base.css verify:fileLine(registry/ouro/theme/ouro-base.css, /--avatar-8:/)
   * @claim "picks one of eight hues from" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > picks the same hue for the same name, and spreads names across the hues)
   * @claim "picks one of eight hues from" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > keeps the initials at least 4.5:1 on every hue and on brand (%s))
   */
  color?: AvatarColor | (string & { 'Use "colorful", "brand" or "neutral"': never }) | undefined;
  /**
   * What `color="colorful"` picks the hue from, when it should not be `name`: a stable id,
   * so people who share a name can differ and a rename keeps the color.
   * @claim "so people who share a name" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > picks the hue from idForColor when given, so one name can take two colors)
   */
  idForColor?: string | undefined;
  /**
   * 24, 32, 40, 48, 64, 72 or 112px (`2xl` and `3xl` for profile pages); the initials and
   * the presence dot grow with it. Inside an `AvatarGroup`, the group's size applies.
   * @default "md"
   * @claim "24, 32, 40, 48, 64, 72" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar > shows initials from the name, and the name to screen readers)
   * @claim "the presence dot grow with it" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar presence > sits on the lower end corner at every size, with the avatar cut away round it)
   * @claim "24, 32, 40, 48, 64, 72" registry/ouro/components/ouro/avatar/avatar.tsx verify:fileLine(registry/ouro/components/ouro/avatar/avatar.tsx, /"3xl": "size-ouro-28/)
   */
  size?: AvatarSize | (string & { 'Use "xs", "sm", "md", "lg", "xl", "2xl" or "3xl"': never }) | undefined;
  /** Layout only: margins, grid placement (`ms-2`). Appearance classes warn in development; use `size`. */
  className?: string | undefined;
  ref?: Ref<HTMLSpanElement> | undefined;

  /** Not a prop. The initials come from `name`, or pass `initials`: `<Avatar name="Ana Lind" initials="AL" />`. */
  children?: { 'Use <Avatar name="Ana Lind" initials="AL" />': never };
  /** Not a prop. The initials come from `name`, or pass `initials`: `<Avatar name="Ana Lind" initials="AL" />`. */
  fallback?: { 'Use <Avatar name="Ana Lind" initials="AL" />': never };
  /** Not a prop. A group chat's people are `members`: `<Avatar name="Crew" members={[{ name: "Ana Lind", src }]} />`. */
  participants?: { 'Use members={[{ name, src }]}': never };
  /** Not a prop. A group chat's people are `members`: `<Avatar name="Crew" members={[{ name: "Ana Lind", src }]} />`. */
  people?: { 'Use members={[{ name, src }]}': never };
  /** Not a prop. A group chat's people are `members`: `<Avatar name="Crew" members={[{ name: "Ana Lind", src }]} />`. */
  users?: { 'Use members={[{ name, src }]}': never };
}

/** An Avatar with a presence dot and the words it says. */
export interface AvatarPresenceProps {
  /**
   * The person's presence, as a dot on the lower end corner. Each state has its own shape
   * and a named tone (available: success; busy and do not disturb: destructive; away:
   * warning; offline: muted; out of office: primary). The avatar is cut away in a
   * circle round the dot (a bite), so whatever lies behind the avatar, a photo or a gradient
   * too, shows through the gap. The dot lies over the corner and takes no room, so
   * the initials, icon or picture stay in the middle with or without it, and the dot stays
   * below the letters at every size.
   * @claim "The dot lies over the corner" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar presence > keeps the initials in the middle with or without a dot, and the dot off them (%s))
   * @claim "The dot lies over the corner" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar presence > keeps an icon and a picture in the middle with a dot, as without one)
   * @claim "Each state has its own shape" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar presence > draws each state in its own shape and tone)
   */
  presence: AvatarPresence | (string & { 'dnd is "do-not-disturb"; ooo is "out-of-office"': never });
  /**
   * What the dot says, such as "Busy" or "In a meeting": screen readers hear it after the
   * name ("Ana Lind, Busy"). Required with `presence`, so no dot is silent.
   * @claim "Required with `presence`, so no dot" registry/ouro/components/ouro/avatar/avatar.test-d.ts verify:fileLine(registry/ouro/components/ouro/avatar/avatar.test-d.ts, /presence:\s"busy"\s\}>\(\)\.not\.toExtend<AvatarProps>/)
   */
  presenceLabel: string;
}

/** An Avatar without a presence dot. */
export interface AvatarNoPresenceProps {
  /** Leave it out for no dot; pass it with `presenceLabel` to show one. */
  presence?: undefined;
  /** Read only with `presence`. */
  presenceLabel?: string | undefined;
}

/**
 * Props for {@link Avatar}: its own props, `presence` with `presenceLabel` or neither, and
 * the `<span>` attributes it passes through.
 */
export type AvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, keyof AvatarOwnProps | "presence" | "presenceLabel" | "role"> &
  AvatarOwnProps &
  (AvatarPresenceProps | AvatarNoPresenceProps);

/** The props AvatarGroup adds to the `<div>` attributes it passes through. */
export interface AvatarGroupOwnProps {
  /** What the group is, for screen readers: "Cooks on this recipe". Required, so the group has a name. */
  label: string;
  /** The `Avatar`s, in order. */
  children: ReactNode;
  /** Shows at most this many avatars, then a "+N" count for the rest. @default unlimited */
  max?: number | undefined;
  /**
   * How many there are in all, when you pass only the first few avatars (a recipe with
   * 120 cooks). The "+N" count is `total` minus the avatars shown.
   * @claim "How many there are in all" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::AvatarGroup > counts from total when more people exist than avatars passed)
   */
  total?: number | undefined;
  /** What screen readers hear for the "+N" count, for other languages. @default (count) => `${count} more` */
  moreLabel?: ((count: number) => string) | undefined;
  /**
   * The size of every avatar in the group, and of the count. @default "md"
   *
   * @claim "The size of every avatar in" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::AvatarGroup > passes its size to every avatar and the count)
   */
  size?: AvatarSize | (string & { 'Use "xs", "sm", "md", "lg", "xl", "2xl" or "3xl"': never }) | undefined;
  /** Layout only: margins, grid placement (`mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}

/** Props for {@link AvatarGroup}: its own props and the `<div>` attributes it passes through. */
export type AvatarGroupProps = Omit<HTMLAttributes<HTMLDivElement>, keyof AvatarGroupOwnProps | "role"> & AvatarGroupOwnProps;

// Each size sets the box and the initials' type size together. The box reads the fixed-size tokens, so a
// density that changes --spacing leaves the avatar its size.
const sizes = {
  xs: "size-ouro-6 [--ouro-edge:0.105rem] text-[0.625rem]",
  sm: "size-ouro-8 [--ouro-edge:0.14rem] text-xs",
  md: "size-ouro-10 [--ouro-edge:0.175rem] text-sm",
  lg: "size-ouro-12 [--ouro-edge:0.21rem] text-base",
  xl: "size-ouro-16 [--ouro-edge:0.28rem] text-xl",
  "2xl": "size-ouro-18 [--ouro-edge:0.315rem] text-2xl",
  "3xl": "size-ouro-28 [--ouro-edge:0.49rem] text-4xl",
} as const;

// How far each avatar after the first slides under the one before, by the group's size: 4px for 24 to 47px,
// 8px for 48 to 95px and 12px from 96px, the common design-system scale. A share of the avatar's fixed size, so
// --spacing leaves the overlap where it is.
const overlaps = {
  xs: "*:not-first:-ms-ouro-1",
  sm: "*:not-first:-ms-ouro-1",
  md: "*:not-first:-ms-ouro-1",
  lg: "*:not-first:-ms-ouro-2",
  xl: "*:not-first:-ms-ouro-2",
  "2xl": "*:not-first:-ms-ouro-2",
  "3xl": "*:not-first:-ms-ouro-3",
} as const;

const sizeNames = Object.keys(sizes).map((name) => `"${name}"`).join(", ");

// A team's second edge peeks out behind it, up and to the end, cut off by a gap in the
// surface's color. An agent's tile is white in light mode and a slightly lighter surface in
// dark, with a hairline over its art.
const squareEdgeClass =
  "[--ouro-edge-color:color-mix(in_oklab,var(--foreground)_20%,transparent)] dark:[--ouro-edge-color:color-mix(in_oklab,var(--foreground)_30%,transparent)] shadow-[0_0_0_1.4px_var(--ouro-avatar-ring,var(--background)),var(--ouro-edge-x,var(--ouro-edge))_calc(var(--ouro-edge)*-1)_0_0_var(--ouro-edge-color)] rtl:[--ouro-edge-x:calc(var(--ouro-edge)*-1)]";
const agentTileClass =
  "bg-white dark:bg-[color-mix(in_oklab,white_14%,var(--background))] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-black/7 after:content-[''] dark:after:border-white/12 forced-colors:after:border-[CanvasText]";

// The presence dot: its whole size, the ring (padding in the surface's color) and where its
// center falls, near the circle's edge at the lower end corner.
const presenceSizes = {
  xs: "size-[8px] -end-[2.1px] -bottom-[2.1px]",
  sm: "size-[9px] -end-[2px] -bottom-[2px]",
  md: "size-[11px] -end-[2.3px] -bottom-[2.3px]",
  lg: "size-[13px] -end-[2.7px] -bottom-[2.7px]",
  xl: "size-[18px] -end-[3.9px] -bottom-[3.9px]",
  "2xl": "size-[20px] -end-[4.3px] -bottom-[4.3px]",
  "3xl": "size-[31px] -end-[6.6px] -bottom-[6.6px]",
} as const;

// Where the dot's center falls (--ouro-bite-c, from the lower end corner) and the radius of
// its ring (--ouro-bite-r): the avatar's surface is cut away there, so what lies behind the
// avatar shows through the gap, as a ring in the surface's color could not. ouro-base cuts it from
// the surface's clip path, only while a dot is drawn (data-ouro-bite).
const biteSizes = {
  xs: "[--ouro-bite-c:1.9px] [--ouro-bite-r:5.5px]",
  sm: "[--ouro-bite-c:2.5px] [--ouro-bite-r:6.1px]",
  md: "[--ouro-bite-c:3.2px] [--ouro-bite-r:7.5px]",
  lg: "[--ouro-bite-c:3.8px] [--ouro-bite-r:8.9px]",
  xl: "[--ouro-bite-c:5.1px] [--ouro-bite-r:12.2px]",
  "2xl": "[--ouro-bite-c:5.7px] [--ouro-bite-r:13.6px]",
  "3xl": "[--ouro-bite-c:8.9px] [--ouro-bite-r:21.1px]",
} as const;
// Below 40px a glyph cannot be read, so the dot is a plain colour; from 40px up it carries its glyph.
const plainSizes: readonly AvatarSize[] = ["xs", "sm"];

// Each hue tints the surface and colors the initials, mixed toward the theme's background and
// foreground so the pair keeps at least 4.5:1 in light and dark.
// A tint is its surface classes (with the dark scheme's own step) and its ink.
type Tint = readonly [fill: string, ink: string];
const hues: readonly Tint[] = [
  ["bg-[color-mix(in_oklab,var(--avatar-1)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-1)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-1)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-1)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-2)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-2)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-2)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-2)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-3)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-3)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-3)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-3)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-4)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-4)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-4)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-4)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-5)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-5)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-5)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-5)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-6)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-6)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-6)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-6)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-7)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-7)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-7)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-7)_18%,var(--foreground))]"],
  ["bg-[color-mix(in_oklab,var(--avatar-8)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--avatar-8)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--avatar-8)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--avatar-8)_18%,var(--foreground))]"],
] as const;
const brand: Tint = ["bg-[color-mix(in_oklab,var(--primary)_18%,var(--background))] dark:bg-[color-mix(in_oklab,var(--primary)_46%,var(--background))]", "text-[color-mix(in_oklab,var(--primary)_70%,var(--foreground))] dark:text-[color-mix(in_oklab,var(--primary)_18%,var(--foreground))]"];
const neutral: Tint = ["bg-secondary", "text-secondary-foreground"];

const shapes = ["circle", "square", "agent"] as const;

const colors = ["colorful", "brand", "neutral"] as const;
const presences = ["available", "busy", "away", "do-not-disturb", "offline", "out-of-office"] as const;

/** The group's size, which its avatars take. */
const GroupSize = createContext<AvatarSize | undefined>(undefined);

// Stryker disable next-line ArrowFunction: React only calls the cleanup, so one that returns undefined behaves the same.
const subscribeNever = () => () => {};

/**
 * The picture's status: `idle` without one, `loading` while the browser fetches it, then `loaded`
 * or `error`. The picture is drawn once it has loaded, so the initials show until then and after a
 * failure. A picture the browser has already shows on the first paint, and so does one the app marked
 * ready with `markPicturesReady`.
 */
function useImageStatus(src: string | undefined): "idle" | "loading" | "loaded" | "error" {
  // In server HTML and while it hydrates, no picture is ready: the initials, as the server drew them.
  const ready = useSyncExternalStore(
    subscribeNever,
    () => isPictureReady(src as string),
    // Stryker disable next-line ArrowFunction: undefined reads as false where ready is read.
    () => false,
  );
  // The status of the picture last asked for: an avatar with no picture never sets state, so it never draws twice.
  const [fetched, setFetched] = useState<{ src: string; status: "loading" | "loaded" | "error" } | null>(null);
  useLayoutEffect(() => {
    if (!src || ready) return;
    let current = true;
    let shown: "loading" | "loaded" | "error" | undefined;
    // A status the avatar already shows sets no state, so a cached picture's late load event draws nothing again.
    const settle = (status: "loading" | "loaded" | "error") => {
      if (!current || status === shown) return;
      shown = status;
      setFetched({ src, status });
    };
    const image = new window.Image();
    image.onload = () => {
      rememberPicture(src, image);
      settle("loaded");
    };
    image.onerror = () => settle("error");
    image.src = src;
    // Before paint, so a picture already in the browser's cache is there on the avatar's first frame.
    // An image is complete as its address is set only when the browser holds that picture ready.
    settle(image.complete ? "loaded" : "loading");
    return () => {
      current = false;
    };
  }, [src, ready]);
  if (src === undefined) return "idle";
  if (!src) return "error";
  if (fetched?.src === src) return fetched.status;
  return ready ? "loaded" : "idle";
}

/** The first letters of the first and last words, by code point so emoji stay whole. */
// An agent with no icon or picture shows this sparkle in its hue, not an initial.
function AgentGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-ouro-avatar-glyph="">
      <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />
      <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z" />
    </svg>
  );
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0]!.toUpperCase() : "");
  return first(words[0]) + (words.length > 1 ? first(words.at(-1)) : "");
}

/**
 * One member's slice of a group's avatar: their picture once it loads, else their initial (one
 * letter, which a slice has room for) in their hue. A quarter's letter is smaller than a half's.
 */
function GroupSlice({ member, tint, quarter }: { member: AvatarMember; tint: Tint | undefined; quarter: boolean }): JSX.Element {
  const image = useImageStatus(member.src);
  const [fill, ink] = tint ?? hueOf(member.idForColor ?? member.name);
  const loaded = image === "loaded";
  return (
    <span
      data-ouro-avatar-slice=""
      data-image={image}
      // Its initial is drawn from this element's own attribute, so an unloaded slice is one element, not two.
      data-ouro-avatar-initials={loaded ? undefined : Array.from(member.initials ?? initialsOf(member.name))[0]}
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden",
        fill,
        ink,
        quarter ? "text-[0.75em]" : "row-span-2",
        // Forced colours paint every fill as the page, so each slice keeps an edge of its own (in CanvasText, as forced colours draw every border).
        "forced-colors:border",
        !loaded && "before:block before:whitespace-nowrap before:content-[attr(data-ouro-avatar-initials)] before:[text-box:trim-both_cap_alphabetic]",
      )}
    >
      {loaded && <img src={member.src} alt="" className="size-full object-cover" />}
    </span>
  );
}

/**
 * One of the hues for a key, the same on the server and in the browser: an FNV hash, mixed by
 * MurmurHash3's finalizer and scaled from its top bits. Without the mix, keys that differ only
 * in their last character (sequential ids) barely move the top bits, and all take one hue.
 * @claim "an FNV hash, mixed by MurmurHash3's" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > maps each name to its hue, the same in every browser and on the server)
 * @claim "Without the mix, keys that differ" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > spreads ids that differ only in their last character across the hues)
 */
function hueOf(key: string): Tint {
  let hash = 0x811c9dc5;
  for (const char of key.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hues[Math.floor(((hash >>> 0) / 2 ** 32) * hues.length)]!;
}

function checkSize(size: unknown): AvatarSize | undefined {
  return typeof size === "string" && Object.hasOwn(sizes, size) ? (size as AvatarSize) : undefined;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return (values as readonly unknown[]).includes(value) ? (value as T) : undefined;
}

/** The dev message for a size that is not one of Ouro UI's. */
function sizeWarning(component: string, size: unknown): readonly [string, string] {
  const written = typeof size === "string" ? `size="${size}"` : `size={${String(size)}}`;
  const fix = typeof size === "string" ? (sizeFor(`text-${size}`, ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]) ?? "md") : "md";
  return [`${written} is not a size; use ${sizeNames}`, `<${component} size="${fix}">`];
}

function avatarHint(token: string): string {
  if (token.startsWith("rounded")) return 'shape="square"';
  const size = sizeFor(token, ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);
  if (size) return `size="${size}"`;
  return `remove "${token}"; Avatar colors its initials from the name, or pass color="neutral"`;
}

/** The presence dot's glyph: a shape per state, so color is not the only cue. */
function PresenceGlyph({ presence, plain }: { presence: AvatarPresence; plain: boolean }): JSX.Element {
  const line = { fill: "none", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="block size-full">
      {presence === "available" && (
        <>
          <circle cx="8" cy="8" r="8" className="fill-success" />
          {!plain && <path d="M4.75 8.25 7 10.5l4.25-4.5" {...line} className="stroke-success-foreground" />}
        </>
      )}
      {presence === "busy" && <circle cx="8" cy="8" r="8" className="fill-destructive" />}
      {presence === "do-not-disturb" && (
        <>
          <circle cx="8" cy="8" r="8" className="fill-destructive" />
          {!plain && <path d="M4.5 8h7" {...line} className="stroke-destructive-foreground" />}
        </>
      )}
      {presence === "away" && (
        <>
          <circle cx="8" cy="8" r="8" className="fill-warning" />
          {!plain && <path d="M8 4.5v3.75l2.5 1.5" {...line} className="stroke-warning-foreground" />}
        </>
      )}
      {presence === "offline" && (
        <>
          <circle cx="8" cy="8" r="7" {...line} strokeWidth={2} className="stroke-muted-foreground" />
          {!plain && <path d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5" {...line} className="stroke-muted-foreground" />}
        </>
      )}
      {presence === "out-of-office" && (
        <>
          <circle cx="8" cy="8" r="7" {...line} strokeWidth={2} className="stroke-primary" />
          {!plain && <path d="M11 8H5.25M7.5 5.5 5 8l2.5 2.5" {...line} className="stroke-primary" />}
        </>
      )}
    </svg>
  );
}

/**
 * A person's picture, or their initials until it loads or when it fails, in a color picked
 * from the name. `name` is required: screen readers hear it, and the initials come from it.
 * `presence` adds a status dot that says what it shows (`presenceLabel`),
 * `shape="square"` marks a team, a channel, an app or a bot, and `shape="agent"` an AI
 * agent. `members` draws a group chat from its members' pictures or initials, so a group chat
 * never looks like a channel. Server HTML holds the initials, and the picture replaces
 * them at full strength the moment it loads, with no fade: a picture already in the browser's
 * cache is there on the avatar's first frame.
 *
 * The initials are drawn, not written: CSS generated content from a data attribute, which
 * paints exactly as text did but is no text in the page. So a link or button that wraps the
 * avatar and names itself (`<a aria-label="Ana Lind's profile">`) shows no visible text its
 * name must hold, and passes axe's `label-content-name-mismatch` (WCAG 2.5.3, Label in Name);
 * without a name of its own, it takes the avatar's: the person's name, never the letters. In a
 * test, find an avatar by its role and name (`getByRole("img", { name: "Ana Lind" })`), not by
 * its letters.
 *
 * Use `AvatarGroup` instead to show several people side by side (the cooks on a recipe), and
 * `Badge` for a status label that isn't a person.
 *
 * @claim "so a group chat never looks like a channel" registry/ouro/components/ouro/conversation-list/conversation-list.test.tsx verify:testExists(registry/ouro/components/ouro/conversation-list/conversation-list.test.tsx::ConversationList group chats > draws a group chat's avatar from its members, at the list's size)
 * @claim "with no fade" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar > draws a picture already in the cache at full strength on its first frame, with no fade)
 * @group Display
 * @see https://ui.ouroboros.bot/docs/avatar
 *
 * @example
 * <Avatar name="Ana Lind" src={user.photoUrl} presence="busy" presenceLabel="In a meeting" />
 * <Avatar name="Grace Hopper" size="lg" idForColor={user.id} />
 * <Avatar name="Design reviews" shape="square" />
 * <Avatar name="The whole crew" members={crew.map((person) => ({ name: person.name, src: person.photoUrl }))} />
 * <Avatar name="Halden" shape="agent" src={agent.photoUrl} />
 * <span className="flex items-center gap-2"><Avatar name={user.name} alt="" size="sm" />{user.name}</span>
 * @claim "in a color picked from the name" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar colors > picks the same hue for the same name, and spreads names across the hues)
 * @claim "which paints exactly as text did" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar's drawn letters > look exactly as written text did, in every size, shape, color and the group's count (%s))
 * @claim "and passes axe's `label-content-name-mismatch`" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar inside a link or button that has its own name > a link named "Ana Lind's profile" around %s has no label-content-name-mismatch) verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar inside a link or button that has its own name > the same link around initials written as text fails the rule, so the check can fail)
 * @claim "without a name of its own" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar inside a link or button that has its own name > names a link with no label of its own by the person's name, not the letters)
 */
export function Avatar(props: AvatarProps): JSX.Element {
  const {
    name: nameProp,
    nameLoadingLabel = "Name loading",
    src,
    alt,
    initials,
    icon,
    shape: shapeProp,
    color: colorProp,
    idForColor,
    presence: presenceProp,
    presenceLabel,
    size: sizeProp,
    members,
    membersLabel = groupChatWith,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    children,
    fallback,
    participants,
    people,
    users,
    ...rest
  } = props;
  const name = nameProp ?? "";
  const nameLoading = nameProp === null;
  // A group chat: drawn from its members, with no shape and no presence of its own.
  const group = !nameLoading && members !== undefined && members.length > 0;
  const misnamedMembers = participants !== undefined ? "participants" : people !== undefined ? "people" : users !== undefined ? "users" : undefined;
  const groupSize = useContext(GroupSize);
  // A size, shape, color or presence that is not one of Ouro UI's (a type error) warns and renders the default.
  const size = groupSize ?? checkSize(sizeProp) ?? "md";
  const shape = group ? "circle" : (oneOf(shapes, shapeProp) ?? "circle");
  const color = oneOf(colors, colorProp);
  // A team has no presence: a square draws no dot and says none; nor does a group.
  const presence = shape === "square" || group ? undefined : oneOf(presences, presenceProp);
  const image = useImageStatus(src);
  useAppearanceClassNameCheck(
    "Avatar",
    className,
    process.env.NODE_ENV !== "production" ? avatarHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Avatar",
    process.env.NODE_ENV !== "production"
      ? () => [
          nameProp === undefined && ["name is missing, so screen readers hear nothing", '<Avatar name="Ana Lind" src={url} />'],
          !groupSize && sizeProp !== undefined && !checkSize(sizeProp) && sizeWarning("Avatar", sizeProp),
          !group &&
            shapeProp === "group" && [
              'shape="group" is not a shape; a group chat is drawn from its members',
              `<Avatar name="${name}" members={[{ name: "Ana Lind", src: ana }, { name: "Ben Ito" }]} />`,
            ],
          shapeProp !== undefined &&
            shapeProp !== "group" &&
            !oneOf(shapes, shapeProp) && [
              `shape="${String(shapeProp)}" is not a shape; use "circle", "square", "agent"`,
              `<Avatar shape="${/agent|hex/i.test(String(shapeProp)) ? "agent" : "square"}">`,
            ],
          group &&
            shapeProp !== undefined && [
              `a group chat is drawn from its members, so shape="${String(shapeProp)}" does nothing; a channel or team is shape="square" with no members`,
              `<Avatar name="${name}" members={members} />`,
            ],
          group &&
            presenceProp !== undefined && ["a group chat shows no presence, so members draws no dot", `<Avatar name="${name}" members={members} />`],
          members !== undefined &&
            members.length === 0 && [
              "members is empty, so the avatar shows the group's initials",
              `<Avatar name="${name}" members={[{ name: "Ana Lind", src: ana }, { name: "Ben Ito" }]} />`,
            ],
          misnamedMembers !== undefined && [`${misnamedMembers} is not a prop; a group chat's people are members`, '<Avatar name="Crew" members={[{ name: "Ana Lind", src: ana }]} />'],
          !group &&
            shape === "square" &&
            presenceProp !== undefined && ["a team shows no presence, so a square draws no dot", `<Avatar name="${name}" shape="square" />`],
          colorProp !== undefined &&
            !oneOf(colors, colorProp) && [`color="${String(colorProp)}" is not a color; use "colorful", "brand", "neutral"`, '<Avatar color="colorful">'],
          presenceProp !== undefined &&
            shape !== "square" &&
            !presence && [
              `presence="${String(presenceProp)}" is not a presence; use ${presences.map((value) => `"${value}"`).join(", ")}`,
              '<Avatar presence="do-not-disturb" presenceLabel="Do not disturb">',
            ],
          presence &&
            !presenceLabel && [
              "presenceLabel is missing, so screen readers hear no presence",
              `<Avatar presence="${presence}" presenceLabel="${presence[0]!.toUpperCase()}${presence.slice(1).replaceAll("-", " ")}">`,
            ],
          children !== undefined && ["Avatar takes name and initials, not children", '<Avatar name="Ana Lind" initials="AL" />'],
          fallback !== undefined && ["fallback is not a prop", '<Avatar name="Ana Lind" initials="AL" />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // A presence's words follow the name, so a screen reader hears "Ana Lind, Busy"; with
  // alt="" (the name written beside it) only the presence is read.
  const spoken = presence ? presenceLabel || presence.replaceAll("-", " ") : "";
  const groupWords = group ? membersLabel(members!.map((member) => member.name)) : "";
  const label = [alt ?? (nameLoading ? nameLoadingLabel : [name, groupWords].filter(Boolean).join(", ")), spoken].filter(Boolean).join(", ");
  // Two slices below 40px, three from 40px up: a quarter of a smaller avatar is too small to tell who it is.
  // Stryker disable next-line ArrayDeclaration: the slices are read only for a group, so what a non-group holds here is never drawn.
  const slices = group ? members!.slice(0, plainSizes.includes(size) ? 2 : 3) : [];
  const glyph = icon !== undefined && icon !== null ? icon : shape === "agent" ? <AgentGlyph /> : undefined;
  const iconShown = glyph !== undefined;
  const tint = color === "neutral" ? neutral : color === "brand" ? brand : hueOf(idForColor ?? name);
  const [fill, ink] = tint;
  return (
    <span
      {...rest}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-ouro="avatar"
      data-image={image}
      data-shape={group ? "group" : shape}
      data-presence={presence}
      data-name-loading={nameLoading ? "" : undefined}
      className={cn(
        "relative box-border inline-flex shrink-0 items-center justify-center align-middle",
        "font-medium leading-none select-none",
        shape === "circle" ? "rounded-[44%]" : "rounded-[24%]",
        shape === "square" && squareEdgeClass,
        !nameLoading && !group && ink,
        presence && biteSizes[size],
        sizes[size],
        className,
      )}
    >
      <span
        data-ouro-avatar-surface=""
        data-ouro-bite={presence ? "" : undefined}
        className={cn(
          "absolute inset-0 rounded-[inherit]",
          // A group's slices: a half each, or a half and two quarters, with a hole between them, clipped to the
          // squircle where corner-shape draws it as where the clip path does. Its own picture fills the one cell.
          group ? "grid grid-rows-2 gap-[max(1px,calc(var(--ouro-edge)*0.6))] overflow-hidden" : "flex items-center justify-center",
          shape === "circle" ? "[--ouro-sq-r:44%]" : "[--ouro-sq-r:24%]",
          shape === "agent" ? agentTileClass : !nameLoading && !group && fill,
          group && image !== "loaded" && slices.length > 1 && "grid-cols-2",
          image !== "loaded" && iconShown && !nameLoading && !group && "*:size-[55%]",
          nameLoading && "overflow-hidden",
        )}
      >
        {image === "loaded" ? (
          <img src={src} alt="" className="row-span-2 size-full rounded-[inherit] object-cover" />
        ) : group ? (
          slices.map((member, index) => (
            <GroupSlice key={index} member={member} tint={color === "neutral" ? neutral : color === "brand" ? brand : undefined} quarter={index > 0 && slices.length > 2} />
          ))
        ) : nameLoading ? (
          // The avatar's own box and corners, so it is the avatar's exact shape; the presence dot stays whole outside it.
          <Skeleton className="size-full [border-radius:inherit]" />
        ) : iconShown ? (
          glyph
        ) : (
          // Drawn from the attribute, not written as text, so a control that wraps the avatar has no
          // visible text its name must contain (WCAG 2.5.3); the avatar's name is its aria-label.
          // Trimmed to the letters' cap height and baseline, so the letters themselves sit in the
          // middle, not their line with its room for accents and descenders.
          <span
            data-ouro-avatar-initials={initials ?? initialsOf(name)}
            className="block whitespace-nowrap [text-box:trim-both_cap_alphabetic] before:content-[attr(data-ouro-avatar-initials)]"
          />
        )}
      </span>
      {presence && (
        <span
          data-ouro-avatar-presence=""
          className={cn("pointer-events-none absolute box-border flex [--corner-shape:round] [corner-shape:round] rounded-full", presenceSizes[size])}
        >
          <PresenceGlyph presence={presence} plain={plainSizes.includes(size)} />
        </span>
      )}
    </span>
  );
}

/**
 * Avatars stacked with a slight overlap, such as the cooks on a recipe, with a "+N"
 * count after `max`. Its `label` names the group for screen readers, and its `size`
 * applies to every avatar in it. The overlap grows with the size: 4px for avatars from 24 to 47px,
 * 8px from 48 to 95px and 12px from 96px.
 *
 * Use a list of `Avatar`s with names beside them instead when readers need to see who
 * each person is, and `<Avatar members>` for a group chat's avatar, which keeps to one avatar's size.
 *
 * The "+N" count is drawn like Avatar's initials, not written, and screen readers hear
 * `moreLabel`, so a button that wraps the group and names itself shows no text its name must hold.
 *
 * @group Display
 * @see https://ui.ouroboros.bot/docs/avatar
 *
 * @example
 * <AvatarGroup label="Cooks" max={3} size="sm">
 *   {cooks.map((cook) => <Avatar key={cook.id} name={cook.name} src={cook.photoUrl} />)}
 * </AvatarGroup>
 * @claim "The overlap grows with the size: 4px for avatars from 24 to 47px, 8px from 48 to 95px and 12px from 96px." registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::AvatarGroup > overlaps by a step that grows with the size)
 * @claim "Its `label` names the group for" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar > shows initials from the name, and the name to screen readers)
 * @claim "Its `label` names the group for" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::AvatarGroup > stacks avatars in a labeled group, overlapping)
 * @claim "count is drawn like Avatar's initials" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar inside a link or button that has its own name > a button named for the group around an AvatarGroup and its +N count has no label-content-name-mismatch)
 */
export function AvatarGroup(props: AvatarGroupProps): JSX.Element {
  const { label, children, max, total, moreLabel = (count: number) => `${count} more`, size: sizeProp, className, ...rest } = props;
  const size = checkSize(sizeProp) ?? "md";
  const avatars = Children.toArray(children);
  const shown = max !== undefined && max >= 1 ? avatars.slice(0, max) : avatars;
  const more = Math.max(total ?? 0, avatars.length) - shown.length;
  useAppearanceClassNameCheck(
    "AvatarGroup",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `<div className="${token}"><AvatarGroup /></div>`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "AvatarGroup",
    process.env.NODE_ENV !== "production"
      ? () => [
          max !== undefined && max < 1 && [`max={${max}} hides every avatar`, "<AvatarGroup max={3}>"],
          total !== undefined &&
            total < avatars.length && [`total={${total}} is less than the ${avatars.length} avatars passed`, `<AvatarGroup total={${avatars.length}}>`],
          sizeProp !== undefined && !checkSize(sizeProp) && sizeWarning("AvatarGroup", sizeProp),
          avatars.some((child) => !isValidElement(child)) && [
            "AvatarGroup holds Avatars",
            '<AvatarGroup label="Cooks"><Avatar name="Ana Lind" /></AvatarGroup>',
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Each avatar after the first overlaps the one before; a ring in the surface's color
  // (--ouro-avatar-ring, else the page's background) keeps them apart.
  return (
    <div
      {...rest}
      role="group"
      aria-label={label}
      data-ouro="avatar-group"
      className={cn("flex items-center *:shadow-[0_0_0_2px_var(--ouro-avatar-ring,var(--background))]", overlaps[size], className)}
    >
      <GroupSize value={size}>{shown}</GroupSize>
      {more > 0 && (
        <span
          data-ouro-avatar-more=""
          className={cn(
            "relative box-border inline-flex shrink-0 items-center justify-center rounded-[44%] bg-muted font-medium leading-none text-foreground",
            sizes[size],
          )}
        >
          <span aria-hidden="true" data-ouro-avatar-count={`+${more}`} className="before:content-[attr(data-ouro-avatar-count)]" />
          <span className="sr-only">{moreLabel(more)}</span>
        </span>
      )}
    </div>
  );
}
