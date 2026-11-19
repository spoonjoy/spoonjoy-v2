"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import { ChecklistRootUnchecked, ChecklistRow, type ChecklistVariant } from "~/components/ouro/checklist/checklist-parts";
import { emptyClass, rowPartNames } from "~/components/ouro/checklist/checklist-styles";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { announce } from "~/lib/ouro/announce";
import { useMergedRef } from "~/lib/ouro/refs";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** One row of a {@link Checklist}. */
export interface ChecklistItemData {
  /** Identifies the row: `onCheckedChange` gets it, and a row keeps its place and motion by it. */
  id: string;
  /** What to tick off, read as the row's checkbox name. */
  label: string;
  /** Supporting text under the label: a note, a substitution. */
  description?: ReactNode | undefined;
  /** Trailing text at the end of the row, such as an amount (`1 cup`) or a time; screen readers hear it after the label. */
  value?: ReactNode | undefined;
  /** Whether the row is checked. */
  checked: boolean;
  /** Disables the row's box and fades it. */
  disabled?: boolean | undefined;
  /**
   * An icon at the start of the row, in a soft tile, such as a step's picture. Screen readers
   * skip it, since the label names the row.
   */
  media?: ReactNode | undefined;
  /** A control of the row's own beside it (a button, a menu), its own tab stop; clicking it does not toggle the row. */
  action?: ReactNode | undefined;
  /** Not a field. Ouro UI uses `media`: `{ id, label, media: <Icon />, checked }`. */
  icon?: { 'Use media: <Icon />': never };
}

/** Props for {@link Checklist}. */
export interface ChecklistProps {
  /**
   * What the list is ("Ingredients"), shown above the rows and read as the group's name.
   * Required: a group needs a name. To hide it visually, keep it and add `hideLabel`.
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the group's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * How the rows look. `plain`: open rows, the box at their start. `outline`: each row a card
   * with a hairline border, and its tick a circle at the row's end that fills with the primary
   * tone when ticked and the warning tone while out of order, for steps with their own icons
   * (`media`). Another value renders `plain` and warns in development.
   *
   * @default "plain"
   * @claim "`outline`: each row a card with" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist outline > frames each row as a card and puts a round tick at its end, which fills with the tone)
   * @claim "Another value renders `plain` and warns" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist development messages > renders plain rows for an unknown variant, and names the fix)
   */
  variant?: ChecklistVariant | (string & { 'Use "plain" or "outline"': never }) | undefined;
  /**
   * The rows, in order. Adding one brings it in; removing one lets it leave before it goes, and
   * an id added back while its row leaves returns that row in place.
   */
  items: readonly ChecklistItemData[];
  /**
   * Called with a row's id and its new state when it is checked or unchecked. Required: a checklist without it never changes.
   *
   * @claim "Required: a checklist without it never" registry/ouro/components/ouro/checklist/checklist.test-d.ts verify:fileLine(registry/ouro/components/ouro/checklist/checklist.test-d.ts, /\{\slabel:\s"Ingredients";\sitems:\sChecklistItemData\[\]\s\}>\(\)\.not\.toExtend<ChecklistProps>/)
   */
  onCheckedChange: (id: string, checked: boolean) => void;
  /** Shows a "Clear checked" button while something is checked, and is called when it is pressed. */
  onClearChecked?: (() => void) | undefined;
  /** The clear button's text. Translate it here. @default "Clear checked" */
  clearLabel?: string | undefined;
  /**
   * Says the rows are steps to do in order. `true`: the rows' own order. An array of ids: that
   * order, for steps shown in another (shuffled, sorted). A row ticked while a step before it is
   * still unticked is out of order: its box turns the warning tone instead of the primary, it is
   * not struck through, a note under it names the step that comes first, and that note is
   * announced. Once the steps before it are ticked it reads as done on its own. Disabled rows
   * and ids left out of the array never hold a row back.
   *
   * @claim "A row ticked while a step before" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > marks a step ticked before the one that comes first, names that step, and announces it)
   * @claim "Once the steps before it are ticked" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > reads a step as done on its own once the steps before it are ticked)
   * @claim "Disabled rows and ids left out" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > follows an order of ids for steps shown in another order, past disabled rows)
   * @claim "An array of ids: that order" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > follows an order of ids for steps shown in another order, past disabled rows)
   */
  ordered?: boolean | readonly string[] | undefined;
  /**
   * The note an out-of-order row shows and announces, from the label of the step that comes
   * first. Translate it here. @default (first) => `${first} comes first`
   */
  outOfOrderLabel?: ((first: string) => string) | undefined;
  /**
   * What shows when there are no rows: text, or an `Empty`.
   *
   * @claim "What shows when there are no" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > shows the empty state once the last row has left)
   */
  empty?: ReactNode | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style checklists in your theme.
   */
  className?: string | undefined;
  /** The group element, a `<div role="group">`. */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `onCheckedChange`, which gets the row's id and its new state. */
  onChange?: { 'Use onCheckedChange={(id, checked) => setChecked(id, checked)}': never };
  /**
   * Not a prop. Each item says whether it is checked: `items={[{ id, label, checked: true }]}`.
   *
   * @claim "Each item says whether it is" registry/ouro/components/ouro/checklist/checklist.test-d.ts verify:fileLine(registry/ouro/components/ouro/checklist/checklist.test-d.ts, /\{\sid:\s"oats";\slabel:\s"rolled\soats"\s\}>\(\)\.not\.toExtend<ChecklistItemData>/)
   */
  isChecked?: { 'Use items={[{ id, label, checked: true }]}': never };
  /** Not a prop. Ouro UI uses `onCheckedChange`, which gets the row's id and its new state. */
  onToggle?: { 'Use onCheckedChange={(id, checked) => setChecked(id, checked)}': never };
  /** Not a prop. Ouro UI uses `onCheckedChange`, which gets the row's id and its new state. */
  onCheck?: { 'Use onCheckedChange={(id, checked) => setChecked(id, checked)}': never };
  /** Not a prop. A checklist is named by its `label`: `<Checklist label="Ingredients">`. */
  legend?: { 'Use <Checklist label="Ingredients">': never };
  /** Not a prop. Steps to do in order are `ordered`: `<Checklist ordered>`, or `ordered={["boil", "pour"]}`. */
  sequential?: { 'Use <Checklist ordered>': never };
}

/** The variants a checklist has; another value renders `plain`. */
const variants: readonly string[] = ["plain", "outline"];

/** The default note for a row ticked out of order. */
const comesFirst = (first: string) => `${first} comes first`;

/**
 * Each checked row that a step before it holds back, with the label of the first unticked step
 * before it. Disabled rows, which a person can't tick, hold nothing back.
 *
 * @claim "Each checked row that a step" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > reads a step as done on its own once the steps before it are ticked)
 * @claim "Disabled rows, which a person can't" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > follows an order of ids for steps shown in another order, past disabled rows)
 */
function outOfOrder(items: readonly ChecklistItemData[], ordered: boolean | readonly string[] | undefined): Map<string, string> {
  const held = new Map<string, string>();
  if (!ordered) return held;
  const byId = new Map(items.map((item) => [item.id, item]));
  const steps = (ordered === true ? items : ordered.map((id) => byId.get(id))).filter((item) => item !== undefined);
  let first: ChecklistItemData | undefined;
  for (const step of steps) {
    if (step.checked && first) held.set(step.id, first.label);
    else if (!step.checked && !step.disabled) first ??= step;
  }
  return held;
}

/**
 * The current notes, plus the last note of each row that is leaving, so it leaves as it was.
 *
 * @claim "The current notes, plus the last" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist ordered > lets a row leave as it was, out of order, without reading as done on its way out)
 */
function keepLeaving(notes: Map<string, string>, before: Map<string, string>, entries: ReadonlyArray<{ key: string; phase: string }>): Map<string, string> {
  const next = new Map(notes);
  const leaving = new Set(entries.filter((entry) => entry.phase === "leaving").map((entry) => entry.key));
  for (const [key, note] of before) if (leaving.has(key)) next.set(key, note);
  return next;
}

/** A row and where it is in its life. */
interface Presence<T> {
  item: T;
  key: string;
  phase: "entering" | "present" | "leaving";
  /**
   * Bumped on every change of phase, so an exit or entrance that finishes late changes nothing.
   *
   * @claim "Bumped on every change of phase" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > keeps a removed row until its exit finishes)
   * @claim "Bumped on every change of phase" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > ends in the last state when toggled twice during its animation)
   */
  generation: number;
}

/** Merges the new items into the rows on screen: new keys enter, missing ones leave in place, and a leaving key that is back returns. */
function merge<T>(previous: Array<Presence<T>>, items: readonly T[], key: (item: T) => string): Array<Presence<T>> {
  const before = new Map(previous.map((entry) => [entry.key, entry]));
  const next: Array<Presence<T>> = items.map((item) => {
    const id = key(item);
    const entry = before.get(id);
    if (!entry) return { item, key: id, phase: "entering", generation: 0 };
    return entry.phase === "leaving" ? { item, key: id, phase: "present", generation: entry.generation + 1 } : { ...entry, item };
  });
  const kept = new Set(next.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (kept.has(entry.key)) return;
    // A leaving row stays after the row it followed (kept, or already placed here), or first.
    const at = index === 0 ? 0 : next.findIndex((other) => other.key === previous[index - 1]!.key) + 1;
    next.splice(at, 0, entry.phase === "leaving" ? entry : { ...entry, phase: "leaving", generation: entry.generation + 1 });
  });
  return next;
}

/**
 * Waits until a row's own finite animations end: a style flush and a frame (so the browser has
 * created the transitions), then every animation on the row or one of its parts whose iterations
 * are finite, cancelled ones included. An endless animation in the row's action (a spinner) never
 * holds it.
 * @claim "Waits until a row's own finite" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > keeps a removed row until its exit finishes)
 * @claim "An endless animation in the row's" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > exits even when its action animates forever)
 */
async function settled(row: HTMLElement): Promise<void> {
  void getComputedStyle(row).opacity;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const owned = row.getAnimations({ subtree: true }).filter((animation) => {
    const target = (animation.effect as KeyframeEffect).target!;
    return (target === row || rowPartNames.includes(target.getAttribute("data-ouro-part") ?? "")) && Number.isFinite(animation.effect!.getComputedTiming().iterations);
  });
  await Promise.allSettled(owned.map((animation) => animation.finished));
}

/**
 * Keeps removed items rendered while their rows leave, and marks added ones as entering until
 * they are in. The first render's items are present from the start.
 */
function useExitRetention<T>(items: readonly T[], key: (item: T) => string): { entries: Array<Presence<T>>; rows: Map<string, HTMLElement> } {
  const [state, setState] = useState(() => ({ items, entries: items.map((item): Presence<T> => ({ item, key: key(item), phase: "present", generation: 0 })) }));
  let entries = state.entries;
  if (state.items !== items) {
    entries = merge(state.entries, items, key);
    setState({ items, entries });
  }
  const [rows] = useState(() => new Map<string, HTMLElement>());
  const [waiting] = useState(() => new Set<string>());
  const finish = useCallback((done: Presence<T>) => {
    setState((current) => ({
      ...current,
      entries: current.entries.flatMap((entry) => {
        if (entry.key !== done.key || entry.generation !== done.generation) return [entry];
        return done.phase === "leaving" ? [] : [{ ...entry, phase: "present" as const, generation: entry.generation + 1 }];
      }),
    }));
  }, []);
  useEffect(() => {
    for (const entry of entries) {
      const id = `${entry.key}\n${entry.generation}`;
      if (entry.phase === "present" || waiting.has(id)) continue;
      waiting.add(id);
      void settled(rows.get(entry.key)!).then(() => {
        waiting.delete(id);
        finish(entry);
      });
    }
  });
  return { entries, rows };
}

/** A row's enabled box, which focus can move to. */
const boxOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[role="checkbox"]:not([data-disabled])');

/**
 * A list of things to tick off, such as a recipe's ingredients or a shopping list: each row a
 * checkbox the whole row toggles, with an optional value and action. Checking a row fills its
 * box, draws its tick and then a strike through its label, and softens its text; rows enter and
 * leave as `items` changes, and "Clear checked" shows while something is checked. With `ordered`,
 * the rows are steps: one ticked before an earlier step reads as not yet done and names the step
 * that comes first, until that step is ticked.
 *
 * Use `CheckboxGroup` instead when the choices submit with a form; use `Checklist` for progress a
 * person ticks off.
 *
 * @group Lists
 * @see https://ui.ouroboros.bot/docs/checklist
 *
 * @example
 * <Checklist
 *   label="Ingredients"
 *   items={[{ id: "oats", label: "rolled oats", value: "1 cup", checked: checked.has("oats") }]}
 *   onCheckedChange={(id, isChecked) => toggle(id, isChecked)}
 *   onClearChecked={clearAll}
 * />
 * @claim "A list of things to tick" registry/ouro/components/ouro/checklist/checklist.test.tsx verify:testExists(registry/ouro/components/ouro/checklist/checklist.test.tsx::Checklist > checks a row from anywhere on it, and reports the id)
 */
export function Checklist(props: ChecklistProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    variant: variantProp,
    items,
    onCheckedChange,
    onClearChecked,
    clearLabel = "Clear checked",
    ordered,
    outOfOrderLabel = comesFirst,
    empty,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    isChecked,
    onToggle,
    onCheck,
    legend,
    sequential,
  } = props;

  useAppearanceClassNameCheck(
    "Checklist",
    className,
    process.env.NODE_ENV !== "production"
      ? "<Checklist>, styled through your theme's tokens; className takes layout only"
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Checklist",
    process.env.NODE_ENV !== "production"
      ? () => {
          const change = ["onCheckedChange gets the row's id and its new state", "<Checklist onCheckedChange={(id, checked) => setChecked(id, checked)}>"] as const;
          const ids = items.map((item) => item.id);
          const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
          return [
            !label && ["label is required; it names the group for screen readers", '<Checklist label="Ingredients">'],
            repeated !== undefined && [`two items share the id "${repeated}"; each row needs its own`, 'items={[{ id: "oats", … }, { id: "milk", … }]}'],
            onChange !== undefined && [`onChange is not a prop; ${change[0]}`, change[1]],
            isChecked !== undefined && ["isChecked is not a prop; each item says whether it is checked", 'items={[{ id: "oats", label: "rolled oats", checked: true }]}'],
            onToggle !== undefined && [`onToggle is not a prop; ${change[0]}`, change[1]],
            onCheck !== undefined && [`onCheck is not a prop; ${change[0]}`, change[1]],
            legend !== undefined && ["legend is not a prop; a checklist is named by its label", '<Checklist label="Ingredients">'],
            sequential !== undefined && ["sequential is not a prop; steps to do in order are ordered", "<Checklist ordered>"],
            variantProp !== undefined && !variants.includes(variantProp) && [`variant="${variantProp}" is not a variant; use "plain" or "outline"`, '<Checklist variant="outline">'],
            items.some((item) => item.icon !== undefined) && ["an item's icon is not a field; an item's picture is its media", 'items={[{ id: "boil", label: "Boil the water", media: <KettleIcon />, checked: false }]}'],
            ...(Array.isArray(ordered) ? ordered : [])
              .filter((id: string) => !ids.includes(id))
              .map((id: string) => [`ordered names "${id}", which no item has; list the items' ids in the order to do them`, `ordered={[${ids.map((known) => JSON.stringify(known)).join(", ")}]}`] as const),
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const variant = (variants.includes(variantProp as string) ? variantProp : "plain") as ChecklistVariant;
  const root = useRef<HTMLDivElement>(null);
  const rootRef = useMergedRef(ref, root);
  const { entries, rows } = useExitRetention(items, (item) => item.id);
  const anyChecked = items.some((item) => item.checked);
  const clearing = useRef(false);
  const notes = useMemo(() => new Map([...outOfOrder(items, ordered)].map(([id, first]) => [id, outOfOrderLabel(first)])), [items, ordered, outOfOrderLabel]);
  // A row leaves as it was: one that was out of order keeps its note, and never reads as done on its way out.
  const [shown, setShown] = useState(() => ({ notes, all: notes }));
  let shownNotes = shown.all;
  if (shown.notes !== notes) {
    shownNotes = keepLeaving(notes, shown.all, entries);
    setShown({ notes, all: shownNotes });
  }

  // A row that has just gone out of order says which step comes first, once; one that is
  // already out of order on the first render, or stays so, says nothing more.
  const spoken = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const before = spoken.current;
    spoken.current = notes;
    if (!before) return;
    // Every row held back waits on the same first unticked step, so one note says it for all of them.
    const fresh = [...notes].find(([id]) => !before.has(id));
    if (fresh) announce(`${fresh[1]}.`);
  });

  /** Focuses the first enabled box after `from` among the rows still present, else the one before, else the group. */
  const refocus = (from: number) => {
    const present = (index: number) => entries[index]!.phase !== "leaving" && boxOf(rows.get(entries[index]!.key)!);
    for (let index = from + 1; index < entries.length; index += 1) {
      const box = present(index);
      if (box) return box.focus();
    }
    for (let index = Math.min(from, entries.length) - 1; index >= 0; index -= 1) {
      const box = present(index);
      if (box) return box.focus();
    }
    root.current!.focus();
  };

  // A focused row that starts to leave hands focus on before it turns inert, so focus never falls to the page.
  useLayoutEffect(() => {
    const active = document.activeElement;
    const leaving = entries.findIndex((entry) => entry.phase === "leaving" && rows.get(entry.key)?.contains(active));
    if (leaving !== -1) refocus(leaving);
  });
  // The clear button goes once nothing is checked; focus moves to the first row instead.
  useLayoutEffect(() => {
    if (anyChecked || !clearing.current) return;
    clearing.current = false;
    refocus(-1);
  });

  const register = (key: string) => (element: HTMLDivElement | null) => {
    if (element) rows.set(key, element);
    else rows.delete(key);
  };

  return (
    <ChecklistRootUnchecked
      label={label}
      hideLabel={hideLabel}
      description={description}
      className={className}
      ref={rootRef}
      reserve={onClearChecked !== undefined}
      variant={variant}
      actions={
        onClearChecked && anyChecked ? (
          <Button
            variant="plain"
            size="sm"
            data-ouro-control="checklist"
            data-ouro-part="clear"
            onClick={() => {
              clearing.current = true;
              onClearChecked();
            }}
          >
            {clearLabel}
          </Button>
        ) : undefined
      }
    >
      {entries.map(({ item, key, phase }) => (
        <ChecklistRow
          key={key}
          rowRef={register(key)}
          phase={phase}
          label={item.label}
          description={item.description}
          value={item.value}
          checked={item.checked}
          outOfOrder={shownNotes.get(item.id)}
          disabled={item.disabled}
          media={item.media}
          action={item.action}
          onCheckedChange={(checked) => onCheckedChange(item.id, checked)}
        />
      ))}
      {entries.length === 0 && empty !== undefined && (
        <div data-ouro-checklist-empty="" className={emptyClass}>
          {empty}
        </div>
      )}
    </ChecklistRootUnchecked>
  );
}
