import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { Orientation, PaneIndex, SplitSide, SplitTabsController } from "./controller.js";

interface PreviewRect { left: number; top: number; width: number; height: number }
interface Marker { left: number; top: number; height: number }
interface PlaceTarget { kind: "place"; pane: PaneIndex; beforeId: string | null; marker: Marker | null; shade: PreviewRect | null }
interface SplitTarget { kind: "split"; orientation: Orientation; side: SplitSide; marker: null; shade: PreviewRect; label: string }
export type TabDropTarget = PlaceTarget | SplitTarget;
export interface TabDrag {
  id: Ref<string | null>;
  armed: Ref<string | null>;
  target: ShallowRef<TabDropTarget | null>;
  start(event: PointerEvent, id: string, owner: HTMLElement, labels?: { rows: string; cols: string }): void;
  consumeClick(id: string, event: MouseEvent): boolean;
  cancelOwner(owner: HTMLElement | null): void;
  dispose(): void;
}
interface Source {
  id: string; owner: HTMLElement; button: HTMLElement; touchLike: boolean;
  pointerId: number; x: number; y: number;
  labels: { rows: string; cols: string } | undefined;
}

export function previewStyle(rect: PreviewRect): Record<string, string> {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

export function createTabDrag(controller: SplitTabsController, root: Ref<HTMLElement | null>): TabDrag {
  const id = ref<string | null>(null);
  const armed = ref<string | null>(null);
  const target = shallowRef<TabDropTarget | null>(null);
  let source: Source | null = null;
  let ghost: HTMLElement | null = null;
  let highlight: HTMLElement | null = null;
  let suppressed: string | null = null;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function clearSuppression(): void {
    if (suppressTimer !== null) clearTimeout(suppressTimer);
    suppressTimer = null;
    suppressed = null;
  }
  function blockTouchMove(event: TouchEvent): void {
    if (armed.value !== null && event.cancelable) event.preventDefault();
  }
  function arm(): void {
    holdTimer = null;
    if (source === null) return;
    armed.value = source.id;
    if (source.touchLike) window.addEventListener("touchmove", blockTouchMove, { passive: false });
    try { source.button.setPointerCapture(source.pointerId); }
    catch { /* Window listeners work without capture. */ }
  }

  function clearTarget(): void {
    highlight?.classList.remove("split-tabs-pane--drop-target");
    highlight = null;
    target.value = null;
  }
  function paneRect(pane: HTMLElement): PreviewRect {
    const bounds = pane.getBoundingClientRect();
    const host = root.value?.getBoundingClientRect();
    return { left: bounds.left - (host?.left ?? 0), top: bounds.top - (host?.top ?? 0), width: bounds.width, height: bounds.height };
  }
  function insertion(strip: HTMLElement | null, pane: PaneIndex, x: number | null): PlaceTarget {
    if (strip === null) return { kind: "place", pane, beforeId: null, marker: null, shade: null };
    const items = [...strip.querySelectorAll<HTMLElement>(".split-tab-strip-item")].filter((item) => item.closest(".split-tab-strip") === strip);
    const before = x === null ? undefined : items.find((item) => { const r = item.getBoundingClientRect(); return x < r.left + r.width / 2; });
    const last = items[items.length - 1];
    const bounds = strip.getBoundingClientRect();
    const scaleX = strip.offsetWidth > 0 ? bounds.width / strip.offsetWidth : 1;
    const scaleY = strip.offsetHeight > 0 ? bounds.height / strip.offsetHeight : 1;
    const edge = before?.getBoundingClientRect().left ?? last?.getBoundingClientRect().right ?? bounds.left;
    return {
      kind: "place", pane, beforeId: before?.dataset.splitTabsTab ?? null,
      marker: {
        left: (edge - bounds.left) / (scaleX || 1) + strip.scrollLeft - strip.clientLeft,
        top: strip.scrollTop,
        height: strip.clientHeight || bounds.height / (scaleY || 1),
      },
      shade: null,
    };
  }
  function findTarget(event: PointerEvent): void {
    clearTarget();
    const host = root.value;
    if (host === null || source === null || typeof document.elementFromPoint !== "function") return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit === null || hit.closest(".split-tabs") !== host) return;
    if (hit.closest(".split-tab-strip-end") !== null) return;
    const pane = hit.closest<HTMLElement>("[data-split-tabs-pane]");
    const index = pane?.dataset.splitTabsPane;
    if (pane === null || (index !== "0" && index !== "1")) return;
    const paneIndex: PaneIndex = index === "0" ? 0 : 1;
    const strip = hit.closest<HTMLElement>(".split-tab-strip");
    if (strip !== null) {
      target.value = insertion(strip, paneIndex, event.clientX);
    } else if (controller.isSplit.value) {
      if (paneIndex === controller.paneOf(source.id)) return;
      const end = insertion(pane.querySelector<HTMLElement>(".split-tab-strip"), paneIndex, null);
      target.value = { ...end, shade: paneRect(pane) };
    } else {
      if (!controller.canOfferSplit.value || source.labels === undefined) return;
      const r = pane.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const x = (event.clientX - r.left) / r.width;
      const y = (event.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const edges: { orientation: Orientation; side: SplitSide; distance: number }[] = [];
      if (controller.fits.value.cols) {
        if (x <= 1 / 3) edges.push({ orientation: "cols", side: "start", distance: x });
        if (x >= 2 / 3) edges.push({ orientation: "cols", side: "end", distance: 1 - x });
      }
      if (controller.fits.value.rows) {
        if (y <= 1 / 3) edges.push({ orientation: "rows", side: "start", distance: y });
        if (y >= 2 / 3) edges.push({ orientation: "rows", side: "end", distance: 1 - y });
      }
      const edge = edges.sort((a, b) => a.distance - b.distance)[0];
      if (edge === undefined) return;
      const rect = host.getBoundingClientRect();
      const cols = edge.orientation === "cols";
      const width = cols ? (rect.width - controller.dividerSize) / 2 : rect.width;
      const height = cols ? rect.height : (rect.height - controller.dividerSize) / 2;
      target.value = {
        kind: "split", orientation: edge.orientation, side: edge.side, marker: null,
        label: source.labels[edge.orientation],
        shade: {
          left: cols && edge.side === "end" ? width + controller.dividerSize : 0,
          top: !cols && edge.side === "end" ? height + controller.dividerSize : 0,
          width, height,
        },
      };
    }
    if (target.value?.kind === "place" && paneIndex !== controller.paneOf(source.id)) {
      highlight = pane;
      highlight.classList.add("split-tabs-pane--drop-target");
    }
  }
  function move(event: PointerEvent): void {
    if (source === null || event.pointerId !== source.pointerId) return;
    const distance = Math.hypot(event.clientX - source.x, event.clientY - source.y);
    if (source.touchLike && armed.value !== source.id) {
      if (distance > 6) cleanup();
      return;
    }
    if (id.value === null && distance <= 6) return;
    if (id.value === null) {
      id.value = source.id;
      ghost = document.createElement("div");
      ghost.className = "split-tabs-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      const theme = root.value === null ? null : getComputedStyle(root.value);
      for (const variable of [
        "--split-tabs-ghost-background", "--split-tabs-ghost-color", "--split-tabs-ghost-opacity",
        "--split-tabs-ghost-shadow", "--split-tabs-ghost-z-index", "--split-tabs-button-padding",
      ]) {
        const value = theme?.getPropertyValue(variable);
        if (value) ghost.style.setProperty(variable, value);
      }
      for (const child of source.button.childNodes) ghost.appendChild(child.cloneNode(true));
      for (const child of ghost.querySelectorAll<HTMLElement>("a,button,input,select,textarea,[tabindex]")) child.tabIndex = -1;
      document.body.appendChild(ghost);
    }
    event.preventDefault();
    if (ghost !== null) { ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`; }
    findTarget(event);
  }
  function cleanup(): void {
    if (id.value !== null && source?.touchLike === false) {
      clearSuppression();
      suppressed = id.value;
      suppressTimer = setTimeout(() => {
        suppressed = null;
        suppressTimer = null;
      }, 0);
    }
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("touchmove", blockTouchMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", keydown);
    if (source !== null) {
      try { source.button.releasePointerCapture(source.pointerId); }
      catch { /* Capture may have ended before the gesture. */ }
    }
    ghost?.remove();
    ghost = null;
    source = null;
    id.value = null;
    armed.value = null;
    clearTarget();
  }
  function end(event: PointerEvent): void {
    if (source === null || event.pointerId !== source.pointerId) return;
    if (id.value !== null) findTarget(event);
    const tab = id.value;
    const drop = target.value;
    cleanup();
    if (tab === null || drop === null) return;
    if (drop.kind === "place") controller.place(tab, drop.pane, drop.beforeId);
    else controller.splitAt(tab, drop.orientation, drop.side);
  }
  function cancel(event: PointerEvent): void { if (event.pointerId === source?.pointerId) cleanup(); }
  function keydown(event: KeyboardEvent): void { if (event.key === "Escape") cleanup(); }
  return {
    id, armed, target,
    start(event, tab, owner, labels) {
      if (
        source !== null || root.value === null || (event.pointerType === "mouse" && event.button !== 0)
        || !(event.currentTarget instanceof HTMLElement)
      ) return;
      const pane = controller.paneOf(tab);
      if (pane === null) return;
      clearSuppression();
      const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
      source = {
        id: tab, owner, button: event.currentTarget, pointerId: event.pointerId,
        x: event.clientX, y: event.clientY, labels, touchLike,
      };
      if (touchLike) holdTimer = setTimeout(arm, 350);
      else arm();
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", keydown);
    },
    consumeClick(tab, event) {
      if (!(event.detail > 0)) return false;
      const suppress = suppressed === tab;
      clearSuppression();
      return suppress;
    },
    cancelOwner(owner) { if (source?.owner === owner) cleanup(); },
    dispose() { cleanup(); clearSuppression(); },
  };
}
