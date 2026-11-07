"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import { ChecklistRootUnchecked, ChecklistRow } from "~/components/ouro/checklist/checklist-parts";
import { emptyClass, rowPartNames } from "~/components/ouro/checklist/checklist-styles";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
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
  /** A control of the row's own beside it (a button, a menu), its own tab stop; clicking it does not toggle the row. */
  action?: ReactNode | undefined;
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
 * leave as `items` changes, and "Clear checked" shows while something is checked.
 *
 * Use `CheckboxGroup` instead when the choices submit with a form; use `Checklist` for progress a
 * person ticks off.
 *
 * @group Lists
 * @see https://ui.ouro.bot/docs/checklist
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
    items,
    onCheckedChange,
    onClearChecked,
    clearLabel = "Clear checked",
    empty,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    isChecked,
    onToggle,
    onCheck,
    legend,
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
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const root = useRef<HTMLDivElement>(null);
  const rootRef = useMergedRef(ref, root);
  const { entries, rows } = useExitRetention(items, (item) => item.id);
  const anyChecked = items.some((item) => item.checked);
  const clearing = useRef(false);

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
          disabled={item.disabled}
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
