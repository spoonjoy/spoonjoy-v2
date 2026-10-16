"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { Children, createContext, isValidElement, useContext, useState } from "react";
import type { HTMLAttributes, JSX, ReactNode, Ref } from "react";
import { sizeFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** Avatar sizes: 24, 32, 40, 48, 64, 72 and 112px. */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/** The props Avatar adds to the `<span>` attributes it passes through. */
export interface AvatarOwnProps {
  /**
   * The person's or thing's name. Screen readers hear it, and the initials come from it
   * (the first letters of the first and last words) until the image loads, or when it
   * fails. Required, so no avatar is silent.
   */
  name: string;
  /** The image URL. Until it loads, and if it fails, the initials show. */
  src?: string | undefined;
  /**
   * What screen readers hear, when it should differ from `name`. Pass `alt=""` when the
   * name is already written next to the avatar, so it isn't read twice.
   */
  alt?: string | undefined;
  /** The letters to show instead of the ones taken from `name`, such as "AdL". */
  initials?: string | undefined;
  /**
   * 24, 32, 40, 48, 64, 72 or 112px (`2xl` and `3xl` for profile pages); the initials
   * grow with it. Avatar is always a circle. Inside an `AvatarGroup`, the group's size applies.
   * @default "md"
   */
  size?: AvatarSize | (string & { 'Use "xs", "sm", "md", "lg", "xl", "2xl" or "3xl"': never }) | undefined;
  /** Layout only: margins, grid placement (`ms-2`). Appearance classes warn in development; use `size`. */
  className?: string | undefined;
  ref?: Ref<HTMLSpanElement> | undefined;

  /** Not a prop. The initials come from `name`, or pass `initials`: `<Avatar name="Ada Lovelace" initials="AL" />`. */
  children?: { 'Use <Avatar name="Ada Lovelace" initials="AL" />': never };
  /** Not a prop. The initials come from `name`, or pass `initials`: `<Avatar name="Ada Lovelace" initials="AL" />`. */
  fallback?: { 'Use <Avatar name="Ada Lovelace" initials="AL" />': never };
}

/** Props for {@link Avatar}: its own props and the `<span>` attributes it passes through. */
export type AvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, keyof AvatarOwnProps | "role"> & AvatarOwnProps;

/** The props AvatarGroup adds to the `<div>` attributes it passes through. */
export interface AvatarGroupOwnProps {
  /** What the group is, for screen readers: "Cooks on this recipe". Required, so the group has a name. */
  label: string;
  /** The `Avatar`s, in order. */
  children: ReactNode;
  /** Shows at most this many avatars, then a "+N" count for the rest. @default all of them */
  max?: number | undefined;
  /**
   * How many there are in all, when you pass only the first few avatars (a recipe with
   * 120 cooks). The "+N" count is `total` minus the avatars shown.
   */
  total?: number | undefined;
  /** What screen readers hear for the "+N" count, for other languages. @default (count) => `${count} more` */
  moreLabel?: ((count: number) => string) | undefined;
  /** The size of every avatar in the group, and of the count. @default "md" */
  size?: AvatarSize | (string & { 'Use "xs", "sm", "md", "lg", "xl", "2xl" or "3xl"': never }) | undefined;
  /** Layout only: margins, grid placement (`mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}

/** Props for {@link AvatarGroup}: its own props and the `<div>` attributes it passes through. */
export type AvatarGroupProps = Omit<HTMLAttributes<HTMLDivElement>, keyof AvatarGroupOwnProps | "role"> & AvatarGroupOwnProps;

// Each size sets the box and the initials' type size together.
const sizes = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
  "2xl": "size-18 text-2xl",
  "3xl": "size-28 text-4xl",
} as const;

const sizeNames = Object.keys(sizes).map((name) => `"${name}"`).join(", ");

/** The group's size, which its avatars take. */
const GroupSize = createContext<AvatarSize | undefined>(undefined);

/** The first letters of the first and last words, by code point so emoji stay whole. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0]!.toUpperCase() : "");
  return first(words[0]) + (words.length > 1 ? first(words.at(-1)) : "");
}

function checkSize(size: unknown): AvatarSize | undefined {
  return typeof size === "string" && Object.hasOwn(sizes, size) ? (size as AvatarSize) : undefined;
}

/** The dev message for a size that is not one of Ouro UI's. */
function sizeWarning(component: string, size: unknown): readonly [string, string] {
  const written = typeof size === "string" ? `size="${size}"` : `size={${String(size)}}`;
  const fix = typeof size === "string" ? (sizeFor(`text-${size}`, ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]) ?? "md") : "md";
  return [`${written} is not a size; use ${sizeNames}`, `<${component} size="${fix}">`];
}

function avatarHint(token: string): string {
  if (token.startsWith("rounded")) return `remove "${token}"; Avatar is always a circle`;
  const size = sizeFor(token, ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);
  if (size) return `size="${size}"`;
  return `remove "${token}"; Avatar colors its initials from the theme`;
}

/**
 * A person's picture, or their initials until it loads or when it fails. `name` is
 * required: screen readers hear it, and the initials come from it. Built on Base UI's
 * Avatar, so server HTML holds the initials and the picture fades in once it loads.
 *
 * Use `AvatarGroup` instead to stack several, and `Badge` for a status label that isn't a person.
 *
 * @group Display
 * @see https://ourostack.github.io/ouro-ui/docs/avatar
 *
 * @example
 * <Avatar name="Ada Lovelace" src={user.photoUrl} />
 * <Avatar name="Grace Hopper" size="lg" />
 * <span className="flex items-center gap-2"><Avatar name={user.name} alt="" size="sm" />{user.name}</span>
 */
export function Avatar(props: AvatarProps): JSX.Element {
  const {
    name: nameProp,
    src,
    alt,
    initials,
    size: sizeProp,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    children,
    fallback,
    ...rest
  } = props;
  const name = nameProp ?? "";
  const groupSize = useContext(GroupSize);
  // A size that is not one of Ouro UI's (a type error) warns and renders md.
  const size = groupSize ?? checkSize(sizeProp) ?? "md";
  const [image, setImage] = useState<string>("idle");
  useAppearanceClassNameCheck(
    "Avatar",
    className,
    process.env.NODE_ENV !== "production" ? avatarHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Avatar",
    process.env.NODE_ENV !== "production"
      ? () => [
          nameProp === undefined && ["name is missing, so screen readers hear nothing", '<Avatar name="Ada Lovelace" src={url} />'],
          !groupSize && sizeProp !== undefined && !checkSize(sizeProp) && sizeWarning("Avatar", sizeProp),
          children !== undefined && ["Avatar takes name and initials, not children", '<Avatar name="Ada Lovelace" initials="AL" />'],
          fallback !== undefined && ["fallback is not a prop", '<Avatar name="Ada Lovelace" initials="AL" />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const label = alt ?? name;
  return (
    <BaseAvatar.Root
      {...rest}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-ouro="avatar"
      data-image={image}
      className={cn(
        "relative box-border inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full align-middle",
        "bg-secondary font-medium leading-none text-secondary-foreground select-none",
        sizes[size],
        className,
      )}
    >
      {src !== undefined && (
        <BaseAvatar.Image
          src={src}
          alt=""
          onLoadingStatusChange={setImage}
          className="size-full object-cover transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) data-starting-style:opacity-0"
        />
      )}
      <BaseAvatar.Fallback>{initials ?? initialsOf(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

/**
 * Avatars stacked with a slight overlap, such as the cooks on a recipe, with a "+N"
 * count after `max`. Its `label` names the group for screen readers, and its `size`
 * applies to every avatar in it.
 *
 * Use a list of `Avatar`s with names beside them instead when readers need to see who
 * each person is.
 *
 * @group Display
 * @see https://ourostack.github.io/ouro-ui/docs/avatar
 *
 * @example
 * <AvatarGroup label="Cooks" max={3} size="sm">
 *   {cooks.map((cook) => <Avatar key={cook.id} name={cook.name} src={cook.photoUrl} />)}
 * </AvatarGroup>
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
            '<AvatarGroup label="Cooks"><Avatar name="Ada Lovelace" /></AvatarGroup>',
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Each avatar after the first overlaps the one before; a ring in the page's background
  // keeps them apart.
  return (
    <div
      {...rest}
      role="group"
      aria-label={label}
      data-ouro="avatar-group"
      className={cn("flex items-center *:shadow-[0_0_0_2px_var(--background)] *:not-first:-ms-2", className)}
    >
      <GroupSize value={size}>{shown}</GroupSize>
      {more > 0 && (
        <span
          data-ouro-avatar-more=""
          className={cn(
            "relative box-border inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium leading-none text-foreground",
            sizes[size],
          )}
        >
          <span aria-hidden="true">{`+${more}`}</span>
          <span className="sr-only">{moreLabel(more)}</span>
        </span>
      )}
    </div>
  );
}
