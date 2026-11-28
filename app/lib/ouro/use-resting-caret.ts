"use client";

import { useInsertionEffect, useLayoutEffect, useRef } from "react";

/**
 * A native host's permission and wake bridge for a resting caret.
 *
 * Keep `enabled` false until the host knows assistive technology is off and can wake
 * before native menus, dictation and input methods receive input. An ordinary web page
 * must leave this feature off. See the resting-caret guide for the host contract.
 *
 * @example
 * const policy: RestingCaretOptions = {
 *   enabled: host.caretRestPermitted,
 *   subscribeWake: host.subscribeCaretWake,
 *   onHeld: host.setCaretHeld,
 * };
 */
export interface RestingCaretOptions {
  /** The host permits temporarily making the focused editor read-only. Set false for assistive technology, voice input or unknown accessibility state. */
  enabled: boolean;
  /** The host says the window is covered or minimised. */
  occluded?: boolean | undefined;
  /** Subscribe to native wake requests. Wake synchronously before forwarding native input or opening an editing menu. Return the unsubscribe function. Keep this callback stable. */
  subscribeWake: (wake: () => void) => () => void;
  /** Called synchronously on rest and wake. While true, the host must hold native input-method keys, request a wake and forward them only after false. Keep this callback stable. */
  onHeld: (held: boolean) => void;
}

type Box = HTMLInputElement | HTMLTextAreaElement | HTMLDivElement;
type TextBox = HTMLInputElement | HTMLTextAreaElement;
type Reason = "idle" | "covered" | "hidden" | "background" | "blinks" | "composing";
const textBox = (box: Box): box is TextBox => box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement;
const wakeEvents = ["keydown", "pointerdown", "compositionstart", "compositionupdate", "compositionend", "beforeinput", "input", "paste", "dragenter", "dragover", "drop"] as const;
const afterIdle = 30_000;

// WebKit reconsiders its blink timer only when the selection changes. Restore it in
// the same task, including direction and scroll, without moving DOM focus.
function reconsider(box: Box) {
  const { scrollTop, scrollLeft } = box;
  if (textBox(box)) {
    const start = box.selectionStart;
    if (start === null) return;
    const end = box.selectionEnd!;
    const direction = box.selectionDirection!;
    if (box.value.length) box.setSelectionRange(start === 0 ? 1 : start - 1, start === 0 ? 1 : start - 1);
    else box.ownerDocument.getSelection()?.collapse(box.parentNode, 0);
    box.setSelectionRange(start, end, direction);
  } else {
    const selection = box.ownerDocument.getSelection();
    if (selection?.anchorNode && selection.focusNode && box.contains(selection.anchorNode)) {
      const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
      selection.removeAllRanges();
      selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    }
  }
  box.scrollTop = scrollTop;
  box.scrollLeft = scrollLeft;
}

function caretRect(box: Box): { left: number; top: number; height: number } | null {
  const style = getComputedStyle(box);
  const bounds = box.getBoundingClientRect();
  if (!textBox(box)) {
    const selection = box.ownerDocument.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !box.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    let rect = range.getClientRects()[0];
    if (!rect?.height) {
      const node = range.startContainer;
      const adjacent = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[range.startOffset] ?? node.childNodes[range.startOffset - 1] : node;
      if (adjacent) {
        const line = box.ownerDocument.createRange();
        line.selectNode(adjacent);
        rect = line.getClientRects()[0];
      }
    }
    if (rect?.height) return rect;
    return {
      left: bounds.left,
      top: bounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      height: parseFloat(style.fontSize),
    };
  }
  if (box.selectionStart === null || box.selectionStart !== box.selectionEnd) return null;
  const mirror = box.ownerDocument.createElement("div");
  // Copy the app's typography, direction, alignment and wrapping, not a second set of tokens.
  for (const property of style) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden",
    transform: "none", transition: "none", animation: "none",
    whiteSpace: box instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: "break-word", pointerEvents: "none",
  });
  mirror.setAttribute("aria-hidden", "true");
  mirror.textContent = box.value.slice(0, box.selectionStart);
  const marker = box.ownerDocument.createElement("span");
  marker.textContent = box.value.slice(box.selectionStart) || "\u200b";
  mirror.append(marker);
  box.ownerDocument.body.append(mirror);
  const rect = marker.getClientRects()[0]!;
  const origin = mirror.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight);
  const centre = box instanceof HTMLInputElement
    ? (box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - lineHeight) / 2
    : 0;
  const left = bounds.left + (style.direction === "rtl" ? rect.right : rect.left) - origin.left - box.scrollLeft;
  const top = bounds.top + rect.top - origin.top - box.scrollTop + centre;
  const height = rect.height;
  mirror.remove();
  return { left, top, height };
}

/**
 * Rest an existing editor's caret under a native host's explicit safety policy.
 *
 * Install this helper separately; omit it on ordinary web pages. Pass the actual editor
 * through a state callback ref, including when Composer changes between plain and rich text.
 * Pass the same `readOnly` and `disabled` state to the hook and the editor. Pass `inputType`
 * too when changing a TextField's native type.
 *
 * @example
 * const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
 * useRestingCaret(box, hostCaretPolicy, readOnly, disabled);
 * <TextArea ref={setBox} label="Draft" readOnly={readOnly} disabled={disabled} />
 */
export function useRestingCaret(box: Box | null, policy: RestingCaretOptions | undefined, readOnly: boolean, disabled: boolean, inputType?: string) {
  const current = useRef<{ cover: (covered: boolean) => void; refresh: () => void } | null>(null);
  const enabled = policy?.enabled === true && !readOnly && !disabled;
  const occluded = policy?.occluded;
  const subscribeWake = policy?.subscribeWake;
  const onHeld = policy?.onHeld;
  const caller = useRef<{ readOnly: boolean; disabled: boolean; occluded: boolean | undefined } | undefined>(undefined);
  // Layout cleanups run after React writes the new readOnly prop. Publish the committed
  // ownership first, so lifting our hold cannot overwrite that new caller-owned state.
  useInsertionEffect(() => { caller.current = { readOnly, disabled, occluded }; }, [readOnly, disabled, occluded]);
  useLayoutEffect(() => {
    if (!enabled || !box || !box.isConnected || !subscribeWake || !onHeld) return;
    // Date, email and other native editors expose no selection to preserve.
    if (textBox(box) && box.selectionStart === null) return;
    const doc = box.ownerDocument;
    const win = doc.defaultView!;
    const nativeCaret = win.CSS.supports("caret-animation", "manual");
    let animation: string;
    let animationPriority: string;
    const macWebKit = win.navigator.platform.startsWith("Mac") && win.navigator.vendor === "Apple Computer, Inc.";
    let active = true;
    let held = false;
    let composing = false;
    let covered = caller.current!.occluded;
    let lastInput = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let caret: HTMLSpanElement | undefined;
    const tabIndex = box.getAttribute("tabindex");
    const clearTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const draw = () => {
      if (!caret) return;
      const rect = caretRect(box);
      const field = box.getBoundingClientRect();
      caret.hidden = false;
      caret.style.left = "0px";
      caret.style.top = "0px";
      const origin = caret.getBoundingClientRect();
      const style = getComputedStyle(box);
      const visible = rect && rect.top >= field.top && rect.top + rect.height <= field.bottom + 1
        && rect.left >= field.left && rect.left <= field.right;
      caret.hidden = !visible;
      if (visible) {
        const x = Math.max(
          macWebKit ? Math.floor(rect.left - field.left - 0.25) : Math.ceil(rect.left - field.left - 0.01),
          parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        );
        const inset = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
        const y = Math.floor(rect.top - field.top - inset + 0.01) + inset;
        const snap = (value: number) => Math.round(value * win.devicePixelRatio) / win.devicePixelRatio;
        Object.assign(caret.style, {
          left: `${snap(field.left + x) - origin.left}px`,
          top: `${snap(field.top + y) - origin.top}px`,
          height: `${Math.round(rect.height)}px`,
          backgroundColor: style.caretColor,
        });
      }
    };
    const lift = () => {
      if (!held) return;
      held = false;
      if (nativeCaret) {
        if (box.style.getPropertyValue("caret-animation") === "manual") {
          box.style.setProperty("caret-animation", animation, animationPriority);
        }
      } else {
        if (textBox(box)) box.readOnly = caller.current!.readOnly;
        else {
          box.contentEditable = String(!caller.current!.readOnly && !caller.current!.disabled);
          if (tabIndex === null) {
            if (!caller.current!.readOnly || caller.current!.disabled) box.removeAttribute("tabindex");
          } else box.setAttribute("tabindex", tabIndex);
        }
        reconsider(box);
      }
      caret?.remove();
      caret = undefined;
      onHeld(false);
    };
    const update = () => {
      if (!active) return;
      clearTimer();
      const focused = doc.activeElement === box;
      const visible = doc.visibilityState !== "hidden";
      const foreground = doc.hasFocus();
      const idle = Date.now() - lastInput >= afterIdle;
      const reason: Reason = composing ? "composing" : !visible ? "hidden" : !foreground ? "background" : covered ? "covered" : idle ? "idle" : "blinks";
      box.dataset.caretRest = focused ? reason : "no-caret";
      if (focused && !composing && visible && foreground && !covered && !idle) {
        timer = setTimeout(update, afterIdle - (Date.now() - lastInput));
      }
      if (!focused || composing || (visible && (!foreground || (!covered && !idle)))) {
        lift();
        return;
      }
      if (!held) {
        if (textBox(box) ? box.readOnly : !box.isContentEditable) return;
        held = true;
        if (nativeCaret) {
          animation = box.style.getPropertyValue("caret-animation");
          animationPriority = box.style.getPropertyPriority("caret-animation");
          box.style.setProperty("caret-animation", "manual");
        }
        else {
          if (textBox(box)) box.readOnly = true;
          else {
            box.tabIndex = 0;
            box.contentEditable = "false";
          }
          reconsider(box);
        }
        onHeld(true);
        if (!held) return;
      }
      if (nativeCaret) return;
      if (visible && foreground) {
        if (!caret) {
          caret = doc.createElement("span");
          caret.setAttribute("aria-hidden", "true");
          caret.setAttribute("data-ouro-steady-caret", "");
          caret.style.cssText = `position:absolute;pointer-events:none;width:${macWebKit ? 2 : 1}px`;
          box.parentElement!.append(caret);
        }
        draw();
      } else {
        caret?.remove();
        caret = undefined;
      }
    };
    const wake = () => {
      if (!active) return;
      lastInput = Date.now();
      covered = false;
      const needsUpdate = held || timer === undefined;
      lift();
      if (needsUpdate) update();
    };
    const input = (event: Event) => {
      if (event.type === "compositionstart") composing = true;
      if (event.type === "compositionend") composing = false;
      wake();
      if (event.type === "compositionstart") update();
    };
    const arrive = () => {
      lastInput = Date.now();
      update();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    observer.observe(box.parentElement!);
    for (const type of wakeEvents) box.addEventListener(type, input, true);
    box.addEventListener("focus", arrive);
    box.addEventListener("blur", update);
    doc.addEventListener("visibilitychange", arrive);
    doc.addEventListener("selectionchange", draw);
    win.addEventListener("focus", arrive);
    win.addEventListener("blur", update);
    win.addEventListener("resize", draw);
    win.addEventListener("scroll", draw, true);
    current.current = { cover: (value) => { covered = value; arrive(); }, refresh: draw };
    const unsubscribe = subscribeWake(wake);
    if (!nativeCaret && doc.activeElement === box) reconsider(box);
    update();
    return () => {
      active = false;
      clearTimer();
      unsubscribe();
      current.current = null;
      for (const type of wakeEvents) box.removeEventListener(type, input, true);
      box.removeEventListener("focus", arrive);
      box.removeEventListener("blur", update);
      doc.removeEventListener("visibilitychange", arrive);
      doc.removeEventListener("selectionchange", draw);
      win.removeEventListener("focus", arrive);
      win.removeEventListener("blur", update);
      win.removeEventListener("resize", draw);
      win.removeEventListener("scroll", draw, true);
      observer.disconnect();
      lift();
      delete box.dataset.caretRest;
    };
  }, [box, enabled, subscribeWake, onHeld, inputType]);
  useLayoutEffect(() => current.current?.cover(occluded === true), [box, enabled, occluded]);
  useLayoutEffect(() => current.current?.refresh());
}
