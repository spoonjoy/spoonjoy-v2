import type {} from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

export const touchHostGeometry = (async (ctx, selector: string) => {
  const row = ctx.iframe.locator(selector);
  const physical = await row.boundingBox();
  if (!physical) throw new Error("Touch host probe row is not visible");
  const local = await row.evaluate((element) => ({
    box: element.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number },
    inner: { width: innerWidth, height: innerHeight },
    outer: { width: outerWidth, height: outerHeight },
    screen: { width: screen.width, height: screen.height, orientation: screen.orientation.type },
    dpr: devicePixelRatio,
    visual: visualViewport && {
      width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
      x: visualViewport.offsetLeft, y: visualViewport.offsetTop,
    },
    coarse: matchMedia("(pointer: coarse)").matches,
    landscape: matchMedia("(orientation: landscape)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  const host = await ctx.page.evaluate(() => ({
    inner: { width: innerWidth, height: innerHeight },
    outer: { width: outerWidth, height: outerHeight },
    screen: { width: screen.width, height: screen.height, orientation: screen.orientation.type },
    dpr: devicePixelRatio,
    visual: visualViewport && {
      width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
      x: visualViewport.offsetLeft, y: visualViewport.offsetTop,
    },
  }));
  const scale = { x: physical.width / local.box.width, y: physical.height / local.box.height };
  return {
    local, physical, host, scale,
    origin: { x: physical.x - local.box.x * scale.x, y: physical.y - local.box.y * scale.y },
  };
}) satisfies BrowserCommand<[selector: string]>;

export const touchHostWrongPoint = (async (ctx) => {
  const box = await ctx.iframe.locator("[data-host-probe-spacer]").boundingBox();
  if (!box) throw new Error("Touch host probe spacer is not visible");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await ctx.page.touchscreen.tap(point.x, point.y);
  return point;
}) satisfies BrowserCommand<[]>;

export const touchHostZoomGeometry = (async (ctx, selector: string, point: { x: number; y: number }) => {
  const geometry = await touchHostGeometry(ctx, selector);
  const session = await ctx.page.context().newCDPSession(ctx.page);
  let objectId: string | undefined;
  try {
    const metrics = await session.send("Page.getLayoutMetrics");
    const query = {
      x: Math.round(point.x + metrics.cssVisualViewport.pageX),
      y: Math.round(point.y + metrics.cssVisualViewport.pageY),
      ignorePointerEventsNone: false,
    };
    let hit: unknown;
    try {
      const { backendNodeId } = await session.send("DOM.getNodeForLocation", query);
      const { object } = await session.send("DOM.resolveNode", { backendNodeId });
      objectId = object.objectId;
      const { result } = await session.send("Runtime.callFunctionOn", {
        objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const node = this.nodeType ? this : this.element;
          const view = node && (node.ownerDocument || node).defaultView;
          return {
            node: node && node.nodeName,
            where: view && view.location.href,
            watched: Boolean(view && view.__ouroTouch),
            rect: node && node.getBoundingClientRect ? node.getBoundingClientRect().toJSON() : null,
            inner: view && { width: view.innerWidth, height: view.innerHeight }
          };
        }`,
      });
      hit = result.value;
    } catch (error) {
      hit = { error: error instanceof Error ? error.message : String(error) };
    }
    return { geometry, point, query, metrics, hit };
  } finally {
    try {
      if (objectId) await session.send("Runtime.releaseObject", { objectId });
    } finally {
      await session.detach();
    }
  }
}) satisfies BrowserCommand<[selector: string, point: { x: number; y: number }]>;

export const touchHostAudit = (async (ctx, action: "start" | "stop") => {
  return Promise.all(ctx.page.frames().map(async (frame) => ({
    where: frame.url(),
    value: await frame.evaluate((action) => {
      type Receipt = { type: string; trusted: boolean; x: number; y: number; target: string | null };
      type Audit = { records: Receipt[]; listener: (event: Event) => void };
      const view = globalThis as typeof globalThis & { __ouroHostProbeAudit?: Audit };
      if (action === "start") {
        if (view.__ouroHostProbeAudit) throw new Error("A previous diagnostic audit was not removed");
        const records: Receipt[] = [];
        const listener = (event: Event) => {
          const point = event.type === "touchstart" ? (event as TouchEvent).changedTouches[0]! : event as PointerEvent;
          records.push({
            type: event.type, trusted: event.isTrusted, x: point.clientX, y: point.clientY,
            target: event.target instanceof Element ? event.target.tagName : null,
          });
        };
        view.__ouroHostProbeAudit = { records, listener };
        for (const name of ["pointerdown", "touchstart"]) addEventListener(name, listener, { capture: true, passive: true });
        return { installed: true };
      }
      const audit = view.__ouroHostProbeAudit;
      if (!audit) throw new Error("The diagnostic audit did not start in this frame");
      for (const name of ["pointerdown", "touchstart"]) removeEventListener(name, audit.listener, { capture: true });
      delete view.__ouroHostProbeAudit;
      return { records: audit.records };
    }, action),
  })));
}) satisfies BrowserCommand<[action: "start" | "stop"]>;

export const touchHostPanAudit = (async (ctx, action: "start" | "stop") => {
  const touches = await ctx.iframe.locator("body").evaluate((_element, action) => {
    type TouchAudit = { records: unknown[]; record: (event: TouchEvent) => void };
    const view = globalThis as typeof globalThis & { __ouroHostPanTouches?: TouchAudit };
    if (action === "start") {
      if (view.__ouroHostPanTouches) throw new Error("A previous native pan touch audit was not removed");
      const records: unknown[] = [];
      const record = (event: TouchEvent) => records.push({
        epoch: Date.now(), type: event.type, trusted: event.isTrusted,
        points: Array.from(event.changedTouches).map((touch) => ({ x: touch.clientX, y: touch.clientY })),
      });
      view.__ouroHostPanTouches = { records, record };
      for (const type of ["touchstart", "touchend"] as const) addEventListener(type, record, { capture: true, passive: true });
      return { installed: true };
    }
    const audit = view.__ouroHostPanTouches;
    if (!audit) throw new Error("The native pan touch audit was not started");
    for (const type of ["touchstart", "touchend"] as const) removeEventListener(type, audit.record, true);
    delete view.__ouroHostPanTouches;
    return { records: audit.records };
  }, action);
  const result = await ctx.page.evaluate((action) => {
    type ViewportAudit = { records: unknown[]; record: (event?: Event) => void };
    const view = globalThis as typeof globalThis & { __ouroHostViewportAudit?: ViewportAudit };
    const viewport = visualViewport;
    if (!viewport) throw new Error("The native pan audit requires a visual viewport");
    if (action === "start") {
      if (view.__ouroHostViewportAudit) throw new Error("A previous native pan audit was not removed");
      const records: unknown[] = [];
      const record = (event?: Event) => records.push({
        when: performance.now(), epoch: Date.now(), type: event?.type ?? "snapshot", trusted: event?.isTrusted,
        left: viewport.pageLeft, top: viewport.pageTop, offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop,
        width: viewport.width, height: viewport.height, scale: viewport.scale,
      });
      view.__ouroHostViewportAudit = { records, record };
      for (const type of ["scroll", "scrollend", "resize"]) viewport.addEventListener(type, record);
      record();
      return { installed: true };
    }
    const audit = view.__ouroHostViewportAudit;
    if (!audit) throw new Error("The native pan audit was not started");
    audit.record();
    for (const type of ["scroll", "scrollend", "resize"]) viewport.removeEventListener(type, audit.record);
    delete view.__ouroHostViewportAudit;
    return { records: audit.records };
  }, action);
  if (action === "stop") process.stdout.write(`NATIVE_PAN_DIAGNOSTIC ${JSON.stringify({ ...result, touches })}\n`);
  return { ...result, touches };
}) satisfies BrowserCommand<[action: "start" | "stop"]>;
