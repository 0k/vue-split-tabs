<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import type { EffectiveNode, SplitTabsController } from "./controller.js";
import type { SplitTabsFrame, SplitTabsPane } from "./projection.js";
import { splitTabsKey, type SplitTabsLabels } from "./context.js";
import SplitPane from "./SplitPane.vue";
import SplitFrame from "./SplitFrame.vue";
import SplitTabsAnchor from "./SplitTabsAnchor.vue";

const props = defineProps<{ node: EffectiveNode; controller: SplitTabsController; labels: SplitTabsLabels;
  basis?: string | undefined; depth: number }>();
defineSlots<{
  pane?: (scope: { pane: SplitTabsPane }) => unknown;
  frame?: (scope: { frame: SplitTabsFrame }) => unknown;
}>();
const context = inject(splitTabsKey, undefined);
const container = ref<HTMLElement | null>(null);
const resizing = ref(false);
const cut = computed(() => props.node.kind === "cut" ? props.controller.cuts.value.get(props.node.id) ?? null : null);
const firstBasis = computed(() => cut.value === null ? "100%" : `calc((100% - ${props.controller.dividerSize}px) * ${cut.value.ratio})`);
/** A dragged divider sticks to a parallel divider this close (centre on centre), shown by a guide. */
const SNAP_PX = 12;
/** Holding a divider still this long enters (or leaves) arrange mode. */
const HOLD_MS = 500;
const HOLD_SLOP_PX = 6;
/** Two presses this close on one divider: equal sizes (touch makes no reliable dblclick). */
const DOUBLE_PRESS_MS = 350;
let lastPress = 0;
let pointer: number | null = null;
let handle: HTMLElement | null = null;
let start = { x: 0, y: 0 };
let moved = false;
let hold: ReturnType<typeof setTimeout> | null = null;
let snaps: number[] = [];
function cleanup(): void {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", end);
  window.removeEventListener("pointercancel", end);
  if (hold !== null) clearTimeout(hold);
  hold = null;
  if (pointer !== null) {
    try { handle?.releasePointerCapture(pointer); } catch { /* Window listeners do not require capture. */ }
  }
  pointer = null;
  handle = null;
  moved = false;
  if (resizing.value && context !== undefined) context.modes.resizing.value = false;
  resizing.value = false;
  if (context !== undefined) context.guide.value = null;
}
// Centres of the other parallel dividers, in client coordinates. A divider is
// placed by its centre, so snapping onto another divider's centre lines both
// up exactly; dividers inside this cut move with it and are left out.
function snapTargets(rows: boolean): number[] {
  const host = container.value?.closest(".split-tabs");
  if (host === null || host === undefined || container.value === null) return [];
  return [...host.querySelectorAll<HTMLElement>(`.split-tabs--${rows ? "rows" : "cols"} > .split-tabs-divider`)]
    .filter(el => el.closest(".split-tabs") === host && !container.value!.contains(el))
    .map(el => { const r = el.getBoundingClientRect(); return rows ? r.top + r.height / 2 : r.left + r.width / 2; });
}
function move(event: PointerEvent): void {
  if (event.pointerId !== pointer || cut.value === null || container.value === null) return;
  let rect = container.value.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) rect = container.value.closest(".split-tabs")?.getBoundingClientRect() ?? rect;
  const rows = cut.value.orientation === "rows";
  if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 1) return;
  if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < HOLD_SLOP_PX && hold !== null) return;
  if (hold !== null) { clearTimeout(hold); hold = null; }
  const available = (rows ? rect.height : rect.width) - props.controller.dividerSize;
  if (available <= 0) return;
  moved = true;
  let position = rows ? event.clientY : event.clientX;
  const near = snaps.filter(t => Math.abs(t - position) <= SNAP_PX).sort((a, b) => Math.abs(a - position) - Math.abs(b - position))[0];
  const host = container.value.closest(".split-tabs")?.getBoundingClientRect();
  if (near !== undefined) {
    position = near;
    if (context !== undefined && host !== undefined) context.guide.value = { axis: rows ? "y" : "x", at: near - (rows ? host.top : host.left) };
  } else if (context !== undefined) context.guide.value = null;
  props.controller.setRatioLive((position - (rows ? rect.top : rect.left) - props.controller.dividerSize / 2) / available, cut.value.id);
}
function end(event: PointerEvent): void {
  if (event.pointerId !== pointer) return;
  const current = cut.value;
  const commit = moved;
  if (moved) lastPress = 0;
  cleanup();
  if (commit && current !== null) props.controller.commitRatio(current.ratio, current.id);
}
function press(event: PointerEvent): void {
  if (cut.value === null || resizing.value || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  if (lastPress !== 0 && event.timeStamp - lastPress < DOUBLE_PRESS_MS) {
    lastPress = 0;
    props.controller.equalize(cut.value.id);
    return;
  }
  lastPress = event.timeStamp;
  pointer = event.pointerId;
  handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  start = { x: event.clientX, y: event.clientY };
  snaps = snapTargets(cut.value.orientation === "rows");
  resizing.value = true;
  if (context !== undefined) context.modes.resizing.value = true;
  try { handle?.setPointerCapture(pointer); } catch { /* Capture is best-effort. */ }
  if (context !== undefined) {
    hold = setTimeout(() => {
      hold = null;
      if (moved) return;
      cleanup();
      context.modes.arranging.value = !context.modes.arranging.value;
    }, HOLD_MS);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
function keydown(event: KeyboardEvent): void {
  const current = cut.value;
  if (current === null) return;
  const rows = current.orientation === "rows";
  const available = (rows ? current.height : current.width) - props.controller.dividerSize;
  const step = (event.shiftKey ? 32 : 8) / available;
  let value: number;
  if (event.key === "Enter") { event.preventDefault(); props.controller.equalize(current.id); return; }
  if (event.key === "Home") value = 0;
  else if (event.key === "End") value = 1;
  else if (event.key === (rows ? "ArrowUp" : "ArrowLeft")) value = current.ratio - step;
  else if (event.key === (rows ? "ArrowDown" : "ArrowRight")) value = current.ratio + step;
  else return;
  if (event.altKey) return;
  event.preventDefault();
  props.controller.commitRatio(value, current.id);
}
watch(() => cut.value?.id, () => { if (resizing.value) cleanup(); }, { flush: "sync" });
onBeforeUnmount(cleanup);
</script>

<template>
  <SplitPane v-if="node.kind === 'pane'" :key="node.pane.id" :pane="node.pane" :basis="basis ?? '100%'">
    <slot name="pane" :pane="node.pane">
      <SplitTabsAnchor part="body" />
    </slot>
  </SplitPane>
  <SplitFrame v-else-if="node.kind === 'frame'" :key="node.frame.id" :frame="node.frame" :basis="basis ?? '100%'" :depth="depth">
    <slot name="frame" :frame="node.frame" />
    <template #content>
      <SplitLayout :node="node.content" :controller="controller" :labels="labels" basis="100%" :depth="depth + 1">
        <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
        <template v-if="$slots.frame" #frame="scope"><slot name="frame" v-bind="scope" /></template>
      </SplitLayout>
    </template>
  </SplitFrame>
  <div v-else ref="container" class="split-tabs-cut" :class="[`split-tabs--${node.orientation}`, { 'split-tabs--resizing': resizing }]"
    :data-split-tabs-cut="node.id" :data-split-tabs-node="node.id" :data-depth="depth" :style="{ flexBasis: basis ?? '100%' }">
    <SplitLayout :node="node.first" :controller="controller" :labels="labels" :basis="firstBasis" :depth="depth + 1">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
      <template v-if="$slots.frame" #frame="scope"><slot name="frame" v-bind="scope" /></template>
    </SplitLayout>
    <div class="split-tabs-divider" role="separator" tabindex="0" :data-cut="node.id"
      :aria-orientation="node.orientation === 'rows' ? 'horizontal' : 'vertical'" :aria-label="labels.divider"
      :aria-valuenow="Math.round(node.ratio * 100)" :aria-valuemin="0" :aria-valuemax="100"
      @pointerdown="press" @keydown="keydown" />
    <SplitLayout :node="node.second" :controller="controller" :labels="labels" basis="0px" :depth="depth + 1">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
      <template v-if="$slots.frame" #frame="scope"><slot name="frame" v-bind="scope" /></template>
    </SplitLayout>
  </div>
</template>
