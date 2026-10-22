"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { announce } from "~/lib/ouro/announce";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { rubberband, spring, type SpringHandle } from "~/lib/ouro/spring";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useDrag } from "~/lib/ouro/use-drag";
import { Menu } from "~/components/ouro/menu/menu";
import {
  contentClass,
  dropIndex,
  edgeSpeed,
  fillLabel,
  handleClass,
  itemClass,
  listClass,
  MAX_FRAME,
  moveItem,
  rootClass,
  scrollParent,
} from "~/components/ouro/reorderable/reorderable-styles";

/** One row of a `Reorderable`. */
export interface ReorderableItem {
  /** Identifies the row; `onReorder` reports the new order as these ids. Unique in the list. */
  id: string;
  /** Names the row for its handle ("Reorder Sear the ribs") and in announcements. It is the row's content too, unless you pass `content`. */
  label: string;
  /** What the row shows, in place of the label: an `Item`, or any content. */
  content?: ReactNode;
}

/**
 * The move `onReorder` reports: the row's id and its position before and after, counting from 0.
 *
 * @claim "The move `onReorder` reports: the row's" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > drops a row in place without reporting when it did not move)
 * @claim "The move `onReorder` reports: the row's" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > picks a row up with Space, moves it with the arrows, drops it with Space, and announces each step with its position)
 */
export interface ReorderableMove {
  id: string;
  from: number;
  to: number;
}

/** Props for {@link Reorderable}. */
export interface ReorderableProps {
  /**
   * Names the list for screen readers, such as "Steps". It is always required.
   *
   * @claim "It is always required" registry/ouro/components/ouro/reorderable/reorderable.test-d.ts verify:fileLine(registry/ouro/components/ouro/reorderable/reorderable.test-d.ts, /\{\sitems:\s\[\]\s\}>\(\)\.not\.toExtend<ReorderableProps>/)
   */
  label: string;
  /** The rows, in order: `{ id, label, content }`. Pass them in a new order to change the order from outside. */
  items: readonly ReorderableItem[];
  /**
   * Called once when the user drops a row in a new place, or moves it from its handle's
   * menu, with every id in the new order and the move. The list already shows the new
   * order; save it, or keep it in state.
   * @claim "Called once when the user drops" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the handle's menu, with no drag > opens a menu of moves on a click of the handle; a move is done at once, announced and reported)
   * @claim "Called once when the user drops" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > drops a row in place without reporting when it did not move)
   */
  onReorder?: ((ids: string[], move: ReorderableMove) => void) | undefined;
  /**
   * Each handle's accessible name; `{label}` is the row's label. @default "Reorder {label}"
   *
   * @claim "Each handle's accessible name; `{label}` is" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > renders a named list of rows, each with a handle that says how to use it)
   * @claim "Each handle's accessible name; `{label}` is" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > speaks and names with the labels the app passes)
   */
  handleLabel?: string | undefined;
  /**
   * How to use a handle from the keyboard, read after its name.
   * @default "Press Enter for a menu of moves. Press Space to pick up, then use the arrow keys to move, Space to drop, and Escape to cancel."
   */
  instructionsLabel?: string | undefined;
  /**
   * Read after a handle's name, in place of the instructions, while its row is picked up
   * from the keyboard.
   * @default "Picked up. Use the arrow keys to move, Space to drop, and Escape to cancel."
   */
  heldLabel?: string | undefined;
  /** The item of a handle's menu that moves the row up one place. @default "Move up" */
  moveUpLabel?: string | undefined;
  /** The item of a handle's menu that moves the row down one place. @default "Move down" */
  moveDownLabel?: string | undefined;
  /** The item of a handle's menu that moves the row to the start of the list. @default "Move to top" */
  moveToTopLabel?: string | undefined;
  /** The item of a handle's menu that moves the row to the end of the list. @default "Move to bottom" */
  moveToBottomLabel?: string | undefined;
  /** The item that closes a handle's menu on a phone, where it is a bottom sheet. @default "Close" */
  closeLabel?: string | undefined;
  /** Announced when a row is picked up; `{label}`, `{n}` (its position) and `{total}` are filled in. @default "{label} picked up. Position {n} of {total}." */
  pickedUpLabel?: string | undefined;
  /**
   * Announced on each move, with the arrow keys or from a handle's menu. @default "{label} moved. Position {n} of {total}."
   *
   * @claim "Announced on each move, with the" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the handle's menu, with no drag > opens a menu of moves on a click of the handle; a move is done at once, announced and reported)
   * @claim "Announced on each move, with the" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > opens the menu of moves on an arrow key, and moves the row with one only once it is picked up)
   */
  movedLabel?: string | undefined;
  /** Announced when a row is dropped. @default "{label} dropped. Position {n} of {total}." */
  droppedLabel?: string | undefined;
  /** Announced when a move is cancelled and the row goes back. @default "{label} put back. Position {n} of {total}." */
  canceledLabel?: string | undefined;
  /** Layout only: margins, or a height with `overflow-auto` (`max-h-80 overflow-auto`) to scroll the list in place. Appearance classes warn in development. */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `items`: `items={steps.map((step) => ({ id: step.id, label: step.title }))}`. */
  values?: { "Use items={[{ id, label, content }]}": never };
  /** Not a prop. Rows are data, with their content in `content`: `items={[{ id: "1", label: "Sear", content: <Item title="Sear" /> }]}`. */
  children?: { "Use items={[{ id, label, content: <Item ... /> }]}": never };
  /**
   * Not a prop. Each row's `content` is what it shows: `items={[{ id: "1", label: "Sear", content: <Item title="Sear" /> }]}`.
   *
   * @claim "Each row's `content` is what it" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > shows a row's label when it has no content)
   */
  renderItem?: { "Use items={[{ id, label, content: <Item ... /> }]}": never };
  /** Not a prop. Ouro UI uses `onReorder`: `onReorder={(ids) => save(ids)}`. */
  onChange?: { "Use onReorder={(ids) => save(ids)}": never };
  /** Not a prop. Ouro UI uses `onReorder`: `onReorder={(ids) => save(ids)}`. */
  onDragEnd?: { "Use onReorder={(ids) => save(ids)}": never };
  /** Not a prop. Reorderable is a vertical list. */
  axis?: { "Reorderable is a vertical list; remove axis": never };
}

const itemsFix = 'items={[{ id: "1", label: "Sear the ribs", content: <Item title="Sear the ribs" /> }]}';
const reorderFix = "onReorder={(ids) => save(ids)}";

/** A pointer drag in progress. */
interface Drag {
  id: string;
  /** Where the row was in the order when the drag began. */
  from: number;
  row: HTMLElement;
  rows: HTMLElement[];
  /** The centers of the rows' places, in the viewport, when the drag began. */
  centers: number[];
  /** How far a passed row moves to make room. */
  shift: number;
  maxScroll: number;
  /** The pointer's place in the viewport, and how far it has moved from where it pressed. */
  y: number;
  moved: number;
  /** How far the dragged row is from its place, and the place it would drop in. */
  delta: number;
  to: number;
  frame: number;
  /** When the last frame ran, and the part of a px it did not scroll. */
  time: number;
  carry: number;
  place: () => void;
  stop: () => void;
}

function GripIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <circle cx="5.5" cy="3.5" r="1.25" />
      <circle cx="10.5" cy="3.5" r="1.25" />
      <circle cx="5.5" cy="8" r="1.25" />
      <circle cx="10.5" cy="8" r="1.25" />
      <circle cx="5.5" cy="12.5" r="1.25" />
      <circle cx="10.5" cy="12.5" r="1.25" />
    </svg>
  );
}

/**
 * A list the user puts in order: recipe steps, a queue, favorites. Each row has a drag
 * handle, a 44px target on a touch screen. Dragging it moves the row with the pointer, the
 * other rows make room, and holding it near the top or bottom edge scrolls the list or
 * the page. Let go and the row drops into the gap the others made for it, springing there
 * from where it was, and it can be picked up again on the way. A touch that starts
 * anywhere else on a row scrolls as usual.
 *
 * Dragging is never the only way. A tap or click on a handle, Enter, or a screen reader's
 * activation opens a menu with Move up, Move down, Move to top and Move to bottom; the
 * ones that cannot apply are disabled. From the keyboard, Space on a handle also picks the
 * row up: the up and down arrow keys move it, Space drops it and Escape cancels, which
 * puts it back. Moving focus away drops it where it is. Every move is announced to screen
 * readers with the row's position ("Sear the ribs moved. Position 3 of 7."), and each
 * spoken string and menu item is a prop with an English default.
 *
 * The list shows the new order at once and keeps it; `onReorder` reports it, once per
 * drop. With reduced motion the other rows jump out of the way instead of sliding, and a
 * dropped row is in its place at once.
 *
 * Use `ItemGroup` instead for a list whose order the user does not change, and
 * `Resizable` to change sizes, not order.
 *
 * @group Lists
 * @see https://ourostack.github.io/ouro-ui/docs/reorderable
 *
 * @example
 * <Reorderable
 *   label="Steps"
 *   items={steps.map((step) => ({ id: step.id, label: step.title, content: <Item title={step.title} description={step.text} /> }))}
 *   onReorder={(ids) => setSteps(ids.map((id) => steps.find((step) => step.id === id)!))}
 * />
 * @claim "Every move is announced to screen" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the handle's menu, with no drag > opens a menu of moves on a click of the handle; a move is done at once, announced and reported)
 * @claim "Each row has a drag handle" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the handle's menu, with no drag > moves a row to the top and to the bottom, and disables the moves that cannot apply)
 * @claim "Every move is announced to screen" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > says the position again at either end instead of moving)
 * @claim "Dragging is never the only way" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the handle's menu, with no drag > opens a menu of moves on a click of the handle; a move is done at once, announced and reported)
 * @claim "Dragging is never the only way" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > picks a row up with Space, moves it with the arrows, drops it with Space, and announces each step with its position)
 * @claim "), and each spoken string and menu item" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > speaks and names with the labels the app passes)
 * @claim "), and each spoken string and menu item" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > from the keyboard > picks a row up with Space, moves it with the arrows, drops it with Space, and announces each step with its position)
 */
export function Reorderable(props: ReorderableProps): JSX.Element {
  const {
    label,
    items,
    onReorder,
    handleLabel = "Reorder {label}",
    instructionsLabel = "Press Enter for a menu of moves. Press Space to pick up, then use the arrow keys to move, Space to drop, and Escape to cancel.",
    heldLabel = "Picked up. Use the arrow keys to move, Space to drop, and Escape to cancel.",
    moveUpLabel = "Move up",
    moveDownLabel = "Move down",
    moveToTopLabel = "Move to top",
    moveToBottomLabel = "Move to bottom",
    closeLabel = "Close",
    pickedUpLabel = "{label} picked up. Position {n} of {total}.",
    movedLabel = "{label} moved. Position {n} of {total}.",
    droppedLabel = "{label} dropped. Position {n} of {total}.",
    canceledLabel = "{label} put back. Position {n} of {total}.",
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    values,
    children,
    renderItem,
    onChange,
    onDragEnd,
    axis,
  } = props;

  useAppearanceClassNameCheck(
    "Reorderable",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; style the content you give each row`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Reorderable",
    process.env.NODE_ENV !== "production"
      ? () => [
          !label && ["label is required; it names the list for screen readers", '<Reorderable label="Steps">'],
          new Set(items.map((item) => item.id)).size !== items.length && [
            "two rows have the same id, so only the first shows",
            'give each row its own id: items={[{ id: "1", label: "…" }, { id: "2", label: "…" }]}',
          ],
          items.some((item) => !item.label) && ["a row has no label; it names the row's handle", '{ id: "1", label: "Sear the ribs" }'],
          values !== undefined && ["values is not a prop", itemsFix],
          children !== undefined && ["children is not a prop; rows are data", itemsFix],
          renderItem !== undefined && ["renderItem is not a prop; each row's content is in its item", itemsFix],
          onChange !== undefined && ["onChange is not a prop", reorderFix],
          onDragEnd !== undefined && ["onDragEnd is not a prop", reorderFix],
          axis !== undefined && ["axis is not a prop; Reorderable is a vertical list", '<Reorderable label="Steps" items={…}>'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const byId = new Map<string, ReorderableItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  const ids = [...byId.keys()];
  // The list keeps its own order until `items` arrive in another one (or with other rows).
  const key = JSON.stringify(ids);
  const [state, setState] = useState({ key, order: ids });
  /** The row picked up from the keyboard, and the order to go back to on Escape. */
  const [grab, setGrab] = useState<{ id: string; origin: string[] } | null>(null);
  /** The row a pointer is dragging. */
  const [dragging, setDragging] = useState<string | null>(null);
  /** The row whose menu of moves is open. */
  const [menu, setMenu] = useState<string | null>(null);
  const current = state.key === key;
  if (!current) {
    setState({ key, order: ids });
    if (grab) setGrab(null);
    if (menu !== null) setMenu(null);
  }
  const order = current ? state.order : ids;
  const grabbed = current ? grab : null;
  const total = order.length;

  const instructionsId = useId();
  const heldId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  /** The handle a pointer last pressed, and the drag it became. */
  const pressed = useRef<string | null>(null);
  const drag = useRef<Drag | undefined>(undefined);
  /** Whether the last press on a handle became a drag, whose click is not an activation. */
  const dragged = useRef(false);
  /** The rows a press stopped on their way to rest: they go on if the press is only a tap. */
  const caught = useRef<Array<{ row: HTMLElement; value: number; dropped: boolean }>>([]);
  /** The row whose handle takes focus back after React moves its element, which drops focus. */
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    listRef.current!.children[order.indexOf(id)]!.querySelector("button")!.focus();
  });

  /**
   * The springs carrying rows to rest after a drop, by row element. Each row carries `data-ouro-settling` while its spring runs.
   *
   * @claim "Each row carries `data-ouro-settling` while its" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > with a pointer > moves the row with the pointer, makes room in the rows it passes, and reports the drop once)
   */
  const springs = useRef(new Map<HTMLElement, SpringHandle>());
  /** Set by a drop for the layout effect that follows it: where each row was on screen, the dropped row and how it was let go. */
  const dropped = useRef<{ tops: Map<HTMLElement, number>; row: HTMLElement; velocity: number; flick: boolean } | undefined>(undefined);

  /** Puts a row `value` px below its place. Only that row's own `transform` changes. */
  const shiftRow = (row: HTMLElement, value: number) => {
    row.style.transform = value === 0 ? "" : `translateY(${value}px)`;
  };
  /** Keeps a row's spring, or forgets it, and marks the list as settling while any row is, for tests to wait on. The dropped row is marked for its style. */
  const track = (row: HTMLElement, handle: SpringHandle | undefined, isDropped = false) => {
    if (handle) springs.current.set(row, handle);
    else springs.current.delete(row);
    row.toggleAttribute("data-dropped", isDropped);
    listRef.current!.toggleAttribute("data-ouro-settling", springs.current.size > 0);
  };
  /** Stops a row's spring where it is and returns how far the row is from its place. */
  const holdRow = (row: HTMLElement) => {
    const handle = springs.current.get(row);
    if (!handle) return 0;
    const { value } = handle.stop();
    track(row, undefined);
    shiftRow(row, value);
    return value;
  };
  /** Springs a row from `from` px below its place into it, with the velocity it already has and a little bounce after a flick. */
  const settleRow = (row: HTMLElement, from: number, velocity: number, flick: boolean, isDropped: boolean) => {
    const handle = spring({
      from,
      to: 0,
      velocity,
      damping: flick ? 0.8 : 1,
      element: row,
      onUpdate: (value) => shiftRow(row, value),
      onRest: () => track(row, undefined),
    });
    // With reduced motion the spring was a jump, and the row is in its place already.
    if (!handle.running) return;
    // Until the first frame the row stays where it was on screen.
    shiftRow(row, from);
    track(row, handle, isDropped);
  };

  // After a drop the rows are in their new places in the list itself. Each one starts
  // where it was on screen a moment ago and springs into its place. A list the app
  // changed under the drag has nothing to spring from: its rows are simply there.
  useLayoutEffect(() => {
    const drop = dropped.current;
    if (!drop) return;
    dropped.current = undefined;
    const rows = [...listRef.current!.children] as HTMLElement[];
    for (const row of rows) {
      holdRow(row);
      shiftRow(row, 0);
    }
    for (const row of rows) {
      const before = drop.tops.get(row);
      const from = before === undefined ? 0 : before - row.getBoundingClientRect().top;
      if (Math.abs(from) < 0.5) continue;
      if (row === drop.row) settleRow(row, from, drop.velocity, drop.flick, true);
      else settleRow(row, from, 0, false, false);
    }
  });

  // A list unmounted mid-drag or mid-settle stops listening and moving.
  useEffect(() => {
    const running = springs.current;
    return () => {
      drag.current?.stop();
      for (const handle of running.values()) handle.stop();
    };
  }, []);

  const say = (template: string, id: string, index: number) => announce(fillLabel(template, byId.get(id)!.label, index + 1, total));

  const drop = (held: { id: string; origin: string[] }) => {
    const from = held.origin.indexOf(held.id);
    const to = order.indexOf(held.id);
    setGrab(null);
    say(droppedLabel, held.id, to);
    if (to !== from) onReorder?.(order, { id: held.id, from, to });
  };

  /** A move chosen from a handle's menu: done at once, announced and reported. */
  const moveTo = (id: string, to: number) => {
    const from = order.indexOf(id);
    const next = moveItem(order, from, to);
    // The row's element moves, which drops focus when the handle has it back from the menu.
    refocus.current = id;
    setState({ key, order: next });
    say(movedLabel, id, to);
    onReorder?.(next, { id, from, to });
  };

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>, id: string) => {
    // The pointer's click that ends a drag is not an activation. A click from the keyboard
    // or a screen reader (`detail` 0) always is, except while a pointer is dragging.
    if (dragging !== null || (dragged.current && event.detail !== 0)) return;
    // A row picked up from the keyboard is dropped by any other activation of its handle.
    if (grabbed?.id === id) return drop(grabbed);
    // A tap, a click, Enter or a screen reader's activation: the menu of moves, which needs no drag.
    setMenu(menu === id ? null : id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === " ") {
      // Space picks the row up and drops it. Its click would open the menu instead.
      event.preventDefault();
      if (event.repeat) return;
      if (grabbed?.id === id) return drop(grabbed);
      setGrab({ id, origin: order });
      say(pickedUpLabel, id, order.indexOf(id));
      return;
    }
    if (grabbed?.id !== id) {
      // As on any menu button, an arrow key opens the menu of moves.
      if (event.key === "ArrowUp" || event.key === "ArrowDown") setMenu(id);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // The arrow moves the row, not the page.
      event.preventDefault();
      const from = order.indexOf(id);
      const to = Math.min(Math.max(from + (event.key === "ArrowUp" ? -1 : 1), 0), total - 1);
      if (to !== from) {
        refocus.current = id;
        setState({ key, order: moveItem(order, from, to) });
      }
      // At either end the position is said again, so the user hears why nothing moved.
      say(movedLabel, id, to);
    } else if (event.key === "Escape") {
      // This Escape puts the row back; it does not also close a Dialog or Sheet around the list.
      event.preventDefault();
      event.stopPropagation();
      refocus.current = id;
      setState({ key, order: grabbed.origin });
      setGrab(null);
      say(canceledLabel, id, grabbed.origin.indexOf(id));
    }
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // A button clicks when Space comes up; this Space has done its work.
    if (event.key === " ") event.preventDefault();
  };

  const onBlur = (_event: ReactFocusEvent<HTMLButtonElement>, id: string) => {
    // Focus that left because React moved the row comes straight back; focus the user moved drops the row where it is.
    if (grabbed?.id === id && refocus.current === null) drop(grabbed);
  };

  /** Ends the drag: the rows spring to rest, and a drop in a new place is reported. The velocity only feeds the dropped row's spring. */
  const finish = (commit: boolean, velocity: number, flick: boolean) => {
    const held = drag.current!;
    held.stop();
    setDragging(null);
    const { id, from, row, to } = held;
    const changed = order[from] !== id;
    // The rows spring to rest from where they are on screen now.
    dropped.current = { tops: new Map(changed ? [] : held.rows.map((other) => [other, other.getBoundingClientRect().top])), row, velocity, flick };
    // The app changed the rows under the drag: there is nothing to report.
    if (changed) return;
    // The row drops in the gap the others have made for it on screen, however fast it was let go.
    if (commit && to !== from) {
      const next = moveItem(order, from, to);
      setState({ key, order: next });
      say(droppedLabel, id, to);
      onReorder?.(next, { id, from, to });
    } else say(commit ? droppedLabel : canceledLabel, id, from);
  };

  const dragProps = useDrag({
    axis: "y",
    // The handle takes every touch (`touch-none`), so a sideways move is not a scroll.
    crossAxis: "ignore",
    onPress: () => {
      // Rows still springing into place stop under the pointer, where they are.
      caught.current = ([...listRef.current!.children] as HTMLElement[])
        .filter((row) => springs.current.has(row))
        .map((row) => ({ row, dropped: row.hasAttribute("data-dropped"), value: holdRow(row) }));
    },
    onPressEnd: () => {
      // Only a tap: the rows go on into their places.
      for (const { row, value, dropped: isDropped } of caught.current.splice(0)) settleRow(row, value, 0, false, isDropped);
    },
    onStart: ({ event }) => {
      const id = pressed.current!;
      // Rows the press stopped on their way into place stay where they are: the dragged
      // one is caught there, and from here the drag places the others.
      const stopped = new Map(caught.current.splice(0).map(({ row, value }) => [row, value]));
      dragged.current = true;
      setMenu(null);
      const list = listRef.current!;
      const rows = [...list.children] as HTMLElement[];
      const from = order.indexOf(id);
      const row = rows[from]!;
      // Each row's place is where it is on screen, less what it is still displaced by.
      const rects = rows.map((other) => {
        const displaced = stopped.get(other) ?? 0;
        const rect = other.getBoundingClientRect();
        return { top: rect.top - displaced, bottom: rect.bottom - displaced, height: rect.height, displaced };
      });
      const own = rects[from]!;
      const first = rects[0]!;
      const last = rects[rects.length - 1]!;
      const scroller = scrollParent(list);
      const escape = (pressedKey: KeyboardEvent) => {
        if (pressedKey.key !== "Escape") return;
        pressedKey.preventDefault();
        pressedKey.stopPropagation();
        finishRef.current(false, 0, false);
      };
      /**
       * Each frame: scrolls while the pointer is near the top or bottom edge of what scrolls, by the time the frame took, so as fast on any screen.
       *
       * @claim "Each frame: scrolls while the pointer" registry/ouro/components/ouro/reorderable/reorderable.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.test.tsx::Reorderable > with a pointer > scrolls a list that scrolls in place while the pointer is held near its bottom edge, then near its top)
       * @claim "Each frame: scrolls while the pointer" registry/ouro/components/ouro/reorderable/reorderable.touch.test.tsx verify:testExists(registry/ouro/components/ouro/reorderable/reorderable.touch.test.tsx::Reorderable on a phone > scrolls the page while the finger holds a row near the bottom edge, and drops it where it ends up)
       */
      const tick = (now: number) => {
        const held = drag.current!;
        const box = scroller === document.documentElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
        // A frame after a pause (a background tab) scrolls as one long frame, not as the whole pause.
        const wanted = edgeSpeed(held.y, box.top, box.bottom) * Math.min(Math.max(now - held.time, 0), MAX_FRAME) + held.carry;
        held.time = now;
        // Whole px now; the rest waits for a later frame.
        held.carry = wanted % 1;
        // Only as far as it could scroll when the drag began: a row pulled past the end of the list must not make more to scroll into.
        const next = Math.min(Math.max(scroller.scrollTop + Math.trunc(wanted), 0), held.maxScroll);
        if (next !== scroller.scrollTop) {
          scroller.scrollTop = next;
          held.place();
        }
        held.frame = requestAnimationFrame(tick);
      };
      const held: Drag = {
        id,
        from,
        row,
        rows,
        centers: rects.map((rect) => rect.top + rect.height / 2),
        // Each passed row moves by the dragged row's height and the space between rows.
        shift: own.height + (rects.length > 1 ? rects[1]!.top - first.bottom : 0),
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
        y: event.clientY,
        moved: 0,
        delta: own.displaced,
        to: from,
        frame: requestAnimationFrame(tick),
        time: event.timeStamp,
        carry: 0,
        /** Puts the dragged row under the pointer, where the pointer took hold of it, and the rows it has passed out of its way. */
        place: () => {
          const wanted = own.displaced + held.moved + scroller.scrollTop - startScroll;
          // Past either end of the list the row resists instead of stopping dead.
          const min = first.top - own.top;
          const max = last.bottom - own.bottom;
          const span = last.bottom - first.top;
          held.delta = wanted < min ? min + rubberband(wanted - min, span) : wanted > max ? max + rubberband(wanted - max, span) : wanted;
          held.to = dropIndex(held.centers, from, held.centers[from]! + held.delta);
          rows.forEach((other, index) =>
            shiftRow(other, index === from ? held.delta : from < index && index <= held.to ? -held.shift : held.to <= index && index < from ? held.shift : 0),
          );
        },
        stop: () => {
          document.removeEventListener("keydown", escape, true);
          cancelAnimationFrame(held.frame);
          drag.current = undefined;
        },
      };
      const startScroll = scroller.scrollTop;
      document.addEventListener("keydown", escape, true);
      drag.current = held;
      setDragging(id);
    },
    onMove: ({ delta, event }) => {
      const held = drag.current;
      // Escape ended the drag while the pointer was still down: its later moves are nobody's.
      if (!held) return;
      held.moved = delta;
      held.y = event.clientY;
      held.place();
    },
    onEnd: ({ velocity, flick, cancelled }) => {
      if (drag.current) finish(!cancelled, cancelled ? 0 : velocity, !cancelled && flick);
    },
  });
  // Escape is heard by a listener the drag attached once; it ends the drag with the latest render's rows.
  const finishRef = useRef(finish);
  useLayoutEffect(() => {
    finishRef.current = finish;
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button === 0 && event.isPrimary && !drag.current) {
      // Keep the press from selecting text or starting a native drag.
      event.preventDefault();
      if (grabbed) drop(grabbed);
      pressed.current = id;
      dragged.current = false;
    }
    dragProps.onPointerDown(event);
  };

  return (
    <div data-ouro="reorderable" className={cn(rootClass, className)}>
      <ol ref={listRef} role="list" aria-label={label} data-ouro-reorderable-list="" data-dragging={dragging !== null ? "" : undefined} className={listClass}>
        {order.map((id) => {
          const item = byId.get(id)!;
          const index = order.indexOf(id);
          return (
            <li
              key={id}
              data-ouro-reorderable-item=""
              data-dragging={dragging === id ? "" : undefined}
              data-grabbed={grabbed?.id === id ? "" : undefined}
              className={itemClass}
            >
              <Menu
                // The handle opens its menu itself, on a press that was not a drag; the menu only asks to close.
                open={menu === id}
                onOpenChange={(next) => {
                  if (!next) setMenu(null);
                }}
                closeLabel={closeLabel}
                trigger={
                  <button
                    ref={dragProps.ref}
                    type="button"
                    data-ouro-reorderable-handle=""
                    data-ouro-control="reorderable"
                    data-ouro-part="handle"
                    aria-label={fillLabel(handleLabel, item.label, index + 1, total)}
                    // A menu button, so no `aria-pressed`: a picked-up row is said by the announcer and by the handle's description.
                    aria-describedby={grabbed?.id === id ? heldId : instructionsId}
                    data-grabbed={grabbed?.id === id ? "" : undefined}
                    className={handleClass}
                    onClick={(event) => onClick(event, id)}
                    onKeyDown={(event) => onKeyDown(event, id)}
                    onKeyUp={onKeyUp}
                    onBlur={(event) => onBlur(event, id)}
                    onPointerDown={(event) => onPointerDown(event, id)}
                    onPointerMove={dragProps.onPointerMove}
                    onPointerUp={dragProps.onPointerUp}
                    onPointerCancel={dragProps.onPointerCancel}
                  >
                    <TouchTarget />
                    <GripIcon />
                  </button>
                }
                items={[
                  { label: moveUpLabel, disabled: index === 0, onClick: () => moveTo(id, index - 1) },
                  { label: moveDownLabel, disabled: index === total - 1, onClick: () => moveTo(id, index + 1) },
                  { label: moveToTopLabel, disabled: index === 0, onClick: () => moveTo(id, 0) },
                  { label: moveToBottomLabel, disabled: index === total - 1, onClick: () => moveTo(id, total - 1) },
                ]}
              />
              <div data-ouro-reorderable-content="" className={contentClass}>
                {item.content ?? item.label}
              </div>
            </li>
          );
        })}
      </ol>
      <span id={instructionsId} hidden>
        {instructionsLabel}
      </span>
      <span id={heldId} hidden>
        {heldLabel}
      </span>
    </div>
  );
}
