// One press / drag gesture at a time, for the whole root: tab labels, panes
// (pointer chords or arrange mode), the selection, and drags handed over by the
// host.  Drop zones include the bin, the outer edge (split the
// whole area), the edge of a framed tab set (split beside it), a tab bar (a
// tab next to the others), a pane edge quarter (split that pane) and a
// pane's middle (a tab inside it).
import { nextTick, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { Side } from "./model.js";
import type { SplitTabsTabScope } from "./context.js";
import type { SplitTabsController, SplitTabsResult, SplitTabsSource, SplitTabsZone } from "./controller.js";

export interface PreviewRect { left: number; top: number; width: number; height: number }
type Zoned = (SplitTabsZone | { kind: "bin" }) & {
  /** Shaded area, or the insertion marker of a bar, in root coordinates. */
  shade: PreviewRect;
  marker: boolean;
  /** Opposite half created by a self-drop; present even when size refuses the drop. */
  newPane?: PreviewRect;
  /** Non-mutating one-tab bar overlay, in root coordinates; never a real hit-test target. */
  reveal?: { rect: PreviewRect; side: Side; tab: SplitTabsTabScope };
};
/** A drop target, with what a drop would do as the controller checked it. */
export type TabDropTarget = Zoned & { result: SplitTabsResult };
export type ExternalTabGhost = { label: string } | HTMLElement;
interface Press {
  pointerId: number; x: number; y: number; touchLike: boolean; owner: HTMLElement;
  /** What a drag would carry; null refuses the drag. */
  source: () => SplitTabsSource | null;
  ghost: HTMLElement | ExternalTabGhost | null;
  onTap: (() => void) | null;
  onLong: (() => void) | null;
  onHoldRelease: ((point: { x: number; y: number }) => boolean) | null;
  /** Touch must hold this long before a drag may start (0: move at once). */
  hold: number;
  external: { id: string; beforeDrop?: (target: TabDropTarget) => void } | null;
  /** Tab key whose immediate mouse click is suppressed after a drag. */
  clickKey: string | null;
}
export interface PressOptions {
  source: () => SplitTabsSource | null;
  ghost?: HTMLElement | null;
  onTap?: () => void;
  onLong?: () => void;
  /** Release of an armed label that never became a drag. */
  onHoldRelease?: (point: { x: number; y: number }) => boolean;
  hold?: number;
  clickKey?: string;
}
export interface TabDrag {
  /** A press, armed hold or drag is in progress. */
  active: Ref<boolean>;
  /** What is being dragged, once moving. */
  source: Ref<SplitTabsSource | null>;
  /** Tab key armed by a touch hold. */
  armed: Ref<string | null>;
  target: ShallowRef<TabDropTarget | null>;
  /** `tabSet:key` of a hidden tab about to spring open. */
  spring: Ref<string | null>;
  press(event: PointerEvent, options: PressOptions): void;
  startExternal(event: PointerEvent, id: string, ghost: ExternalTabGhost, beforeDrop?: (target: TabDropTarget) => void): void;
  consumeClick(key: string, event: MouseEvent): boolean;
  cancel(): void;
  /** Continue a library-owned drag while the shell blocks content in capture. */
  capture(event: PointerEvent): void;
  cancelOwner(owner: HTMLElement | null): void;
  /** Recheck the stationary pointer after rendered geometry changes. */
  refresh(): void;
  dispose(): void;
}

const MOUSE_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 450;
const EDGE_FRACTION = 0.25;
const FRAME_EDGE_PX = 12;
const FRAME_BAR_EDGE_PX = 5;
const ROOT_EDGE_PX = 10;
const SPRING_MS = 500;

export function previewStyle(rect: PreviewRect): Record<string, string> {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}
function nearestSide(r: DOMRect, x: number, y: number): { side: Side; dist: number } {
  const d: Record<Side, number> = { left: x - r.left, right: r.right - x, top: y - r.top, bottom: r.bottom - y };
  const side = (Object.keys(d) as Side[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  return { side, dist: d[side] };
}
const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function createTabDrag(controller: SplitTabsController, root: Ref<HTMLElement | null>, focusKeyboard: (pane: string) => void): TabDrag {
  const active = ref(false);
  const source = ref<SplitTabsSource | null>(null);
  const armed = ref<string | null>(null);
  const target = shallowRef<TabDropTarget | null>(null);
  const spring = ref<string | null>(null);
  let press: Press | null = null;
  let ghost: HTMLElement | null = null;
  let suppressed: string | null = null;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let longTimer: ReturnType<typeof setTimeout> | null = null;
  let springTimer: ReturnType<typeof setTimeout> | null = null;
  let longFired = false;
  let last: { x: number; y: number } | null = null;
  let revealKey = "";

  function clearSuppression(): void {
    if (suppressTimer !== null) clearTimeout(suppressTimer);
    suppressTimer = null;
    suppressed = null;
  }
  function blockTouchMove(event: TouchEvent): void {
    if ((armed.value !== null || source.value !== null) && event.cancelable) event.preventDefault();
  }
  function hostRect(): DOMRect { return root.value?.getBoundingClientRect() ?? new DOMRect(); }
  function relative(r: DOMRect): PreviewRect {
    const host = hostRect();
    return { left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height };
  }
  function half(r: DOMRect, side: Side): PreviewRect {
    const p = relative(r);
    if (side === "left") return { ...p, width: p.width / 2 };
    if (side === "right") return { ...p, left: p.left + p.width / 2, width: p.width / 2 };
    if (side === "top") return { ...p, height: p.height / 2 };
    return { ...p, top: p.top + p.height / 2, height: p.height / 2 };
  }
  function own(el: Element): boolean { return el.closest(".split-tabs") === root.value; }
  function all<T extends Element>(selector: string): T[] {
    return root.value === null ? [] : [...root.value.querySelectorAll<T>(selector)].filter(own);
  }
  function hits(x: number, y: number): Element[] {
    return typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
  }
  function carriedViews(): readonly string[] {
    const s = source.value;
    if (s === null) return [];
    if ("selection" in s) return controller.selection.value.flatMap(id => controller.describe(id)?.views ?? []);
    const key = "view" in s ? s.view : s.node;
    return controller.describe(key)?.views ?? [key];
  }
  function cluster(): { members: readonly string[]; frames: HTMLElement[]; rect: DOMRect; views: string[]; holder: string | null } | null {
    const plan = controller.plan.value, s = source.value;
    if (s === null || "selection" in s || controller.selection.value.length < 2 || !plan?.ok || plan.panes.length < 2) return null;
    const members = plan.panes;
    const views = members.flatMap(id => controller.tabSet(id)?.tabs.flatMap(key => controller.describe(key)?.views ?? []) ?? []);
    if (("node" in s && members.includes(s.node)) || carriedViews().some(view => views.includes(view))) return null;
    const frames = all<HTMLElement>("[data-frame-id]").filter(frame => {
      const panes = [...frame.querySelectorAll<HTMLElement>("[data-pane-id]")].filter(own);
      return panes.length > 0 && panes.every(pane => members.includes(pane.dataset.paneId!));
    });
    const boxes = [...all<HTMLElement>(".split-tabs-tabset[data-tabset-id]").filter(el => members.includes(el.dataset.tabsetId!)), ...frames]
      .map(el => el.getBoundingClientRect());
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map(r => r.left)), top = Math.min(...boxes.map(r => r.top));
    const rect = new DOMRect(left, top, Math.max(...boxes.map(r => r.right)) - left, Math.max(...boxes.map(r => r.bottom)) - top);
    return { members, frames, rect, views, holder: plan.holder };
  }
  function contentZone(r: DOMRect, x: number, y: number, id: string, shadeRect = r): Zoned | null {
    if (r.width <= 0 || r.height <= 0) return null;
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    const d: Record<Side, number> = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
    const side = (Object.keys(d) as Side[]).reduce((a, b) => (d[b] < d[a] ? b : a));
    if (d[side] < EDGE_FRACTION) return { kind: "split", target: id, side, shade: half(shadeRect, side), marker: false };
    return { kind: "inside", target: id, shade: relative(r), marker: false };
  }
  function previewBar(r: DOMRect, side: Side, thickness: number, tab: SplitTabsTabScope): { reveal: NonNullable<Zoned["reveal"]>; content: DOMRect } {
    const vertical = side === "left" || side === "right";
    const size = Math.min(thickness, vertical ? r.width : r.height);
    const bar = new DOMRect(side === "right" ? r.right - size : r.left, side === "bottom" ? r.bottom - size : r.top,
      vertical ? size : r.width, vertical ? r.height : size);
    const content = new DOMRect(r.left + (side === "left" ? size : 0), r.top + (side === "top" ? size : 0),
      r.width - (vertical ? size : 0), r.height - (vertical ? 0 : size));
    return { reveal: { rect: relative(bar), side, tab }, content };
  }
  function previewZone(preview: ReturnType<typeof previewBar>, x: number, y: number, id: string): Zoned | null {
    const { reveal } = preview, r = reveal.rect, box = hostRect();
    const sr = new DOMRect(r.left + box.left, r.top + box.top, r.width, r.height);
    if (!inside(sr, x, y)) return null;
    const vertical = reveal.side === "left" || reveal.side === "right";
    // Measure exactly the label the host rendered, not an estimate of its text width.
    const label = all<HTMLElement>(".split-tabs-bar-preview > .split-tab-strip-item")[0]?.getBoundingClientRect();
    const item = label !== undefined && label.width > 0 && label.height > 0 ? label : sr;
    const before = (vertical ? y < item.top + item.height / 2 : x < item.left + item.width / 2);
    const edge = vertical ? (before ? item.top : item.bottom) - box.top : (before ? item.left : item.right) - box.left;
    const shade = vertical ? { left: r.left, top: edge - 2, width: r.width, height: 4 }
      : { left: edge - 2, top: r.top, width: 4, height: r.height };
    return { kind: "bar", target: id, index: before ? 0 : null, shade, marker: true, reveal };
  }
  function zoneAt(x: number, y: number): Zoned | null {
    if (root.value === null) return null;
    const box = hostRect();
    if (!inside(box, x, y)) return null;
    const bin = all<HTMLElement>("[data-split-tabs-bin]")[0];
    if (bin !== undefined && inside(bin.getBoundingClientRect(), x, y)) {
      return { kind: "bin", shade: relative(bin.getBoundingClientRect()), marker: false };
    }
    const outer = nearestSide(box, x, y);
    if (outer.dist < ROOT_EDGE_PX) return { kind: "split", target: "root", side: outer.side, shade: half(box, outer.side), marker: false };
    const group = cluster();
    for (const frame of all<HTMLElement>("[data-frame-id]").reverse()) {
      if (group?.frames.includes(frame)) continue;
      const r = frame.getBoundingClientRect();
      if (!inside(r, x, y)) continue;
      const near = nearestSide(r, x, y);
      const band = near.side === (frame.dataset.side ?? "top") ? FRAME_BAR_EDGE_PX : FRAME_EDGE_PX;
      if (near.dist < band) return { kind: "split", target: frame.dataset.frameId!, side: near.side, shade: half(r, near.side), marker: false };
    }
    if (group !== null && inside(group.rect, x, y)) {
      if (group.holder !== null) return contentZone(group.rect, x, y, "selection");
      const preview = previewBar(group.rect, "top", controller.barThickness,
        { id: "", active: true, kind: "layout", views: group.views, title: null });
      const zone = previewZone(preview, x, y, "selection") ?? contentZone(preview.content, x, y, "selection", group.rect);
      return zone === null ? null : { ...zone, reveal: preview.reveal };
    }
    const strip = hits(x, y).map(el => el.closest<HTMLElement>(".split-tab-strip[data-tab-set]")).find(el => el !== null && own(el)) ?? null;
    if (strip !== null) {
      const vertical = strip.classList.contains("split-tab-strip--vertical");
      const items = [...strip.querySelectorAll<HTMLElement>(":scope > .split-tab-strip-item")].map(el => el.getBoundingClientRect());
      const pos = vertical ? y : x;
      let index = items.findIndex(t => pos < (vertical ? t.top + t.height / 2 : t.left + t.width / 2));
      if (index < 0) index = items.length;
      const sr = strip.getBoundingClientRect();
      const lastItem = items[items.length - 1];
      const edge = index < items.length ? (vertical ? items[index]!.top : items[index]!.left)
        : lastItem !== undefined ? (vertical ? lastItem.bottom : lastItem.right) : (vertical ? sr.top : sr.left);
      const s = relative(sr);
      const shade = vertical ? { left: s.left, top: edge - box.top - 2, width: s.width, height: 4 }
        : { left: edge - box.left - 2, top: s.top, width: 4, height: s.height };
      return { kind: "bar", target: strip.dataset.tabSet!, index, shade, marker: true };
    }
    const pane = all<HTMLElement>("[data-pane-id]").find(el => inside(el.getBoundingClientRect(), x, y));
    if (pane === undefined) return null;
    const r = pane.getBoundingClientRect();
    const id = pane.dataset.paneId!;
    const p = controller.panes.value.find(p => p.id === id), s = source.value;
    if (p !== undefined && !p.showsBar && s !== null && !("node" in s && s.node === id)
      && !("selection" in s && controller.plan.value?.panes.includes(id)) && !group?.members.includes(id)
      && !p.tabs.flatMap(key => controller.describe(key)?.views ?? []).some(view => carriedViews().includes(view))) {
      const set = all<HTMLElement>(".split-tabs-tabset[data-tabset-id]").find(el => el.dataset.tabsetId === id);
      const key = p.active, entry = controller.describe(key);
      if (set !== undefined && entry !== null) {
        const measured = set.getBoundingClientRect();
        const preview = previewBar(measured.width > 0 && measured.height > 0 ? measured : r, p.side,
          p.side === "left" || p.side === "right" ? p.barWidth : controller.barThickness,
          { id: key, active: true, ...entry, title: controller.titleOf(key) });
        return previewZone(preview, x, y, id) ?? contentZone(preview.content, x, y, id);
      }
    }
    return contentZone(r, x, y, id);
  }
  function check(zone: Zoned): TabDropTarget {
    let result: SplitTabsResult;
    const external = press?.external ?? null;
    if (zone.kind === "bin") result = external === null ? { ok: true } : { ok: false, reason: "unknown" };
    else result = controller.canMove(source.value!, zone);
    if (result.selfSplit && zone.kind === "split") {
      const r = zone.shade;
      const newPane = zone.side === "left" ? { ...r, left: r.left + r.width }
        : zone.side === "right" ? { ...r, left: r.left - r.width }
        : zone.side === "top" ? { ...r, top: r.top + r.height } : { ...r, top: r.top - r.height };
      return { ...zone, newPane, result };
    }
    return { ...zone, result } as TabDropTarget;
  }
  function locate(x: number, y: number): void {
    const zone = zoneAt(x, y);
    target.value = zone === null ? null : check(zone);
    const key = JSON.stringify(zone?.reveal ?? null);
    if (key !== revealKey) {
      revealKey = key;
      if (zone?.reveal) void nextTick(() => { if (source.value !== null && last !== null) locate(last.x, last.y); });
    }
  }
  function cancelSpring(): void {
    if (springTimer !== null) clearTimeout(springTimer);
    springTimer = null;
    spring.value = null;
  }
  // Spring-loaded tabs: resting on the label of a hidden tab opens it, so the drop can go into it.
  function springAt(x: number, y: number): void {
    const group = cluster();
    if (group !== null && inside(group.rect, x, y)) { cancelSpring(); return; }
    const item = hits(x, y).map(el => el.closest<HTMLElement>(".split-tab-strip-item")).find(el => el !== null && own(el)) ?? null;
    const strip = item?.closest<HTMLElement>(".split-tab-strip[data-tab-set]") ?? null;
    const key = item?.dataset.splitTabsTab;
    if (item === null || strip === null || key === undefined || item.classList.contains("split-tab-strip-item--active")) { cancelSpring(); return; }
    const id = `${strip.dataset.tabSet}:${key}`;
    if (spring.value === id) return;
    cancelSpring();
    spring.value = id;
    const tabSet = strip.dataset.tabSet!;
    springTimer = setTimeout(() => {
      springTimer = null;
      spring.value = null;
      if (source.value === null) return;
      controller.select(tabSet, key);
      setTimeout(() => { if (source.value !== null && last !== null) locate(last.x, last.y); }, 0);
    }, SPRING_MS);
  }
  function makeGhost(): void {
    if (press === null) return;
    ghost = document.createElement("div");
    ghost.className = "split-tabs-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const theme = root.value === null ? null : getComputedStyle(root.value);
    for (const variable of ["--split-tabs-ghost-background", "--split-tabs-ghost-color", "--split-tabs-ghost-opacity",
      "--split-tabs-ghost-shadow", "--split-tabs-ghost-z-index", "--split-tabs-button-padding"]) {
      const value = theme?.getPropertyValue(variable);
      if (value) ghost.style.setProperty(variable, value);
    }
    const content = press.ghost;
    if (content instanceof HTMLElement) for (const child of content.childNodes) ghost.appendChild(child.cloneNode(true));
    else if (content !== null) ghost.textContent = content.label;
    else ghost.classList.add("split-tabs-drag-ghost--pane");
    for (const child of ghost.querySelectorAll<HTMLElement>("a,button,input,select,textarea,[tabindex]")) child.tabIndex = -1;
    document.body.appendChild(ghost);
  }
  function clearTimers(): void {
    if (holdTimer !== null) clearTimeout(holdTimer);
    if (longTimer !== null) clearTimeout(longTimer);
    holdTimer = longTimer = null;
  }
  function begin(): boolean {
    if (press === null) return false;
    const s = press.source();
    if (s === null) { cleanup(); return false; }
    source.value = s;
    clearTimers();
    if (press.touchLike) window.addEventListener("touchmove", blockTouchMove, { passive: false });
    makeGhost();
    return true;
  }
  function move(event: PointerEvent): void {
    if (press === null || event.pointerId !== press.pointerId) return;
    if (source.value === null) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= MOUSE_THRESHOLD_PX) return;
      // A touch label press that moves before its hold is a scroll, not a drag.
      if (press.touchLike && press.hold > 0 && armed.value === null) { cleanup(); return; }
      if (!begin()) return;
    }
    event.preventDefault();
    last = { x: event.clientX, y: event.clientY };
    if (ghost !== null) { ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`; }
    springAt(event.clientX, event.clientY);
    locate(event.clientX, event.clientY);
  }
  function cleanup(expireClick = true): void {
    if (source.value !== null && press !== null && !press.touchLike && press.external === null && press.clickKey !== null) {
      clearSuppression();
      suppressed = press.clickKey;
      // An exit key can precede the release click by many tasks (notably in WebKit).
      // In that case the click, next press or disposal clears it, with no live listeners or timers.
      if (expireClick) suppressTimer = setTimeout(() => { suppressed = null; suppressTimer = null; }, 0);
    }
    clearTimers();
    cancelSpring();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("touchmove", blockTouchMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancelEvent);
    if (press !== null) {
      try { press.owner.releasePointerCapture(press.pointerId); } catch { /* Capture may have ended before the gesture. */ }
    }
    ghost?.remove();
    ghost = null;
    press = null;
    source.value = null;
    armed.value = null;
    target.value = null;
    revealKey = "";
    last = null;
    active.value = false;
  }
  function end(event: PointerEvent): void {
    if (press === null || event.pointerId !== press.pointerId) return;
    if (source.value === null) {
      const tap = longFired ? null : press.onTap;
      const held = armed.value !== null ? press.onHoldRelease : null;
      const key = press.clickKey;
      cleanup();
      if (held?.({ x: event.clientX, y: event.clientY })) {
        event.preventDefault();
        suppressed = key;
        suppressTimer = setTimeout(() => { suppressed = null; suppressTimer = null; }, 0);
        return;
      }
      tap?.();
      return;
    }
    locate(event.clientX, event.clientY);
    const drop = target.value;
    const s = source.value;
    const external = press.external;
    cleanup();
    if (drop === null || !drop.result.ok) return;
    if (drop.kind === "bin") {
      const result = "selection" in s ? controller.closeTarget() : controller.close("view" in s ? s.view : s.node);
      if (result.ok) focusKeyboard(controller.focus.value);
      return;
    }
    const hook = external?.beforeDrop;
    const result = external !== null
      ? controller.insert(external.id, drop as SplitTabsZone, hook === undefined ? undefined : () => hook(drop))
      : controller.move(s, drop as SplitTabsZone);
    if (result.ok) focusKeyboard(controller.focus.value);
  }
  function cancelEvent(event: PointerEvent): void { if (event.pointerId === press?.pointerId) cleanup(); }
  function listen(): void {
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancelEvent);
  }
  return {
    capture(event) {
      if (event.type === "pointermove") move(event);
      else if (event.type === "pointerup") end(event);
      else if (event.type === "pointercancel") cancelEvent(event);
    },
    active, source, armed, target, spring,
    refresh() { if (source.value !== null && last !== null) locate(last.x, last.y); },
    press(event, options) {
      if (press !== null || root.value === null || (event.pointerType === "mouse" && event.button !== 0)) return;
      // Secondary touch pointers never start a press.
      if (event.pointerType === "touch" && event.isPrimary === false) return;
      if (!(event.currentTarget instanceof HTMLElement)) return;
      clearSuppression();
      const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
      press = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY, touchLike, owner: event.currentTarget,
        source: options.source, ghost: options.ghost ?? null, onTap: options.onTap ?? null, onLong: options.onLong ?? null,
        onHoldRelease: options.onHoldRelease ?? null,
        hold: touchLike ? options.hold ?? 0 : 0, external: null, clickKey: options.clickKey ?? null,
      };
      longFired = false;
      active.value = true;
      try { press.owner.setPointerCapture(event.pointerId); } catch { /* Window listeners work without capture. */ }
      if (press.hold > 0) {
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (press === null) return;
          armed.value = press.clickKey ?? "";
          window.addEventListener("touchmove", blockTouchMove, { passive: false });
        }, press.hold);
      }
      if (press.onLong !== null) {
        longTimer = setTimeout(() => {
          longTimer = null;
          if (press === null || source.value !== null) return;
          longFired = true;
          press.onLong?.();
        }, LONG_PRESS_MS);
      }
      listen();
    },
    startExternal(event, id, content, beforeDrop) {
      if (press !== null || root.value === null) return;
      clearSuppression();
      press = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY, owner: root.value,
        touchLike: event.pointerType === "touch" || event.pointerType === "pen",
        source: () => ({ view: id }), ghost: content, onTap: null, onLong: null, onHoldRelease: null, hold: 0,
        external: beforeDrop === undefined ? { id } : { id, beforeDrop }, clickKey: null,
      };
      active.value = true;
      listen();
      if (begin()) {
        last = { x: event.clientX, y: event.clientY };
        if (ghost !== null) { ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`; }
        locate(event.clientX, event.clientY);
      }
    },
    consumeClick(key, event) {
      if (!(event.detail > 0)) return false;
      const suppress = suppressed === key;
      clearSuppression();
      return suppress;
    },
    cancel: () => cleanup(false),
    cancelOwner(owner) { if (press?.owner === owner) cleanup(); },
    dispose() { cleanup(); clearSuppression(); },
  };
}
