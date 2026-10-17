import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Private CI observer: runs inside the existing watch evaluation, with no extra pre-input await.
export const B2_OBSERVER = `
  if (action === "expect" && expected.type === "touchend") {
    const rows = [...document.querySelectorAll('[data-ouro="swipe-actions"]')];
    const row = rows[1];
    if (rows.length === 3 && row.textContent.includes("Short ribs")) {
      if (view.__b2Native) view.__b2Native.remove();
      const label = (node) => node && node.nodeType === 1 ? {
        tag: node.tagName, id: node.id, ouro: node.getAttribute("data-ouro"),
        role: node.getAttribute("role"), text: node.textContent.slice(0, 80),
      } : { node: node && node.nodeName };
      const style = (node) => {
        const css = getComputedStyle(node);
        return { node: label(node), rect: node.getBoundingClientRect().toJSON(),
          scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
          touchAction: css.touchAction, overflowY: css.overflowY, position: css.position,
          overscrollBehaviorY: css.overscrollBehaviorY };
      };
      const metrics = () => {
        const ancestors = [];
        for (let node = row; node; node = node.parentElement) ancestors.push(style(node));
        let host;
        try { host = { inner: [parent.innerWidth, parent.innerHeight], scroll: [parent.scrollX, parent.scrollY],
          frame: view.frameElement && view.frameElement.getBoundingClientRect().toJSON(),
          visual: parent.visualViewport && { width: parent.visualViewport.width, height: parent.visualViewport.height,
            scale: parent.visualViewport.scale, offsetLeft: parent.visualViewport.offsetLeft, offsetTop: parent.visualViewport.offsetTop } }; }
        catch (error) { host = { error: String(error) }; }
        return { at: performance.now(), inner: [innerWidth, innerHeight], scroll: [scrollX, scrollY],
          visual: visualViewport && { width: visualViewport.width, height: visualViewport.height,
            scale: visualViewport.scale, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop },
          scroller: document.scrollingElement && style(document.scrollingElement), ancestors, host,
          open: row.getAttribute("data-open"), settling: row.hasAttribute("data-ouro-settling"),
          transform: getComputedStyle(row.querySelector("[data-ouro-swipe-actions-track]")).transform };
      };
      const from = [expected.x - 12, expected.y + 200];
      const data = { from, to: [expected.x, expected.y],
        installedAt: performance.now(), events: [], snapshots: [] };
      const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "contextmenu",
        "touchstart", "touchmove", "touchend", "touchcancel", "scroll"];
      const listener = (event) => {
        if (data.events.length >= 160) return;
        const entry = { type: event.type, at: performance.now(), timeStamp: event.timeStamp,
          trusted: event.isTrusted, cancelable: event.cancelable, prevented: event.defaultPrevented,
          target: label(event.target), inRow: row.contains(event.target),
          pointerType: event.pointerType, x: event.clientX, y: event.clientY,
          changed: event.changedTouches && [...event.changedTouches].map(t => [t.clientX, t.clientY]),
          scroll: [scrollX, scrollY] };
        data.events.push(entry);
        queueMicrotask(() => { entry.prevented = event.defaultPrevented; });
        if (event.type === "touchstart") {
          data.targetRow = label(event.target.closest('[data-ouro="swipe-actions"]'));
        }
        if (event.type === "touchend" || event.type === "touchcancel")
          data.snapshots.push({ type: event.type, ...metrics() });
      };
      for (const type of types) view.addEventListener(type, listener, { capture: true, passive: true });
      view.__b2Native = { data, metrics, remove() {
        for (const type of types) view.removeEventListener(type, listener, true);
      } };
    }
  }
`;

let sequence = 0;
export async function saveB2(data: unknown) {
  const directory = join(process.env.RUNNER_TEMP ?? "/tmp", "b2-native");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `gesture-${++sequence}.json`), JSON.stringify(data, null, 2));
}
