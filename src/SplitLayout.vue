<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { EffectiveNode, SplitTabsController, SplitTabsPane } from "./controller.js";
import type { SplitTabStripLabels } from "./context.js";
import SplitPane from "./SplitPane.vue";
import SplitTabStrip from "./SplitTabStrip.vue";
import SplitTabsAnchor from "./SplitTabsAnchor.vue";

const props = defineProps<{ node: EffectiveNode; controller: SplitTabsController; labels: { divider: string };
  stripLabels?: SplitTabStripLabels | undefined; basis?: string | undefined }>();
defineSlots<{ pane?: (scope: { pane: SplitTabsPane }) => unknown }>();
const container = ref<HTMLElement | null>(null);
const resizing = ref(false);
const cut = computed(() => props.node.kind === "cut" ? props.controller.cuts.value.get(props.node.id) ?? null : null);
const firstBasis = computed(() => cut.value === null ? "100%" : `calc((100% - ${props.controller.dividerSize}px) * ${cut.value.ratio})`);
let pointer: number | null = null;
let handle: HTMLElement | null = null;
let startPosition = 0;
let moved = false;
function cleanup(): void {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", end);
  window.removeEventListener("pointercancel", end);
  if (pointer !== null) {
    try { handle?.releasePointerCapture(pointer); } catch { /* Window listeners do not require capture. */ }
  }
  pointer = null;
  handle = null;
  moved = false;
  resizing.value = false;
  container.value?.closest(".split-tabs")?.classList.remove("split-tabs--resizing");
}
function move(event: PointerEvent): void {
  if (event.pointerId !== pointer || cut.value === null || container.value === null) return;
  let rect = container.value.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) rect = container.value.closest(".split-tabs")?.getBoundingClientRect() ?? rect;
  const rows = cut.value.orientation === "rows";
  const position = rows ? event.clientY : event.clientX;
  if (!moved && position === startPosition) return;
  const available = (rows ? rect.height : rect.width) - props.controller.dividerSize;
  if (available <= 0) return;
  moved = true;
  props.controller.setRatioLive((position - (rows ? rect.top : rect.left) - props.controller.dividerSize / 2) / available, cut.value.id);
}
function end(event: PointerEvent): void {
  if (event.pointerId !== pointer) return;
  const current = cut.value;
  const commit = moved;
  cleanup();
  if (commit && current !== null) props.controller.commitRatio(current.ratio, current.id);
}
function start(event: PointerEvent): void {
  if (cut.value === null || resizing.value || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  pointer = event.pointerId;
  handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  startPosition = cut.value.orientation === "rows" ? event.clientY : event.clientX;
  resizing.value = true;
  container.value?.closest(".split-tabs")?.classList.add("split-tabs--resizing");
  try { handle?.setPointerCapture(pointer); } catch { /* Capture is best-effort. */ }
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
  event.preventDefault();
  props.controller.commitRatio(value, current.id);
}
watch(() => cut.value?.id, () => { if (resizing.value) cleanup(); }, { flush: "sync" });
onBeforeUnmount(cleanup);
</script>

<template>
  <SplitPane v-if="node.kind === 'pane'" :key="node.pane.id" :pane="node.pane" :basis="basis ?? '100%'">
    <slot name="pane" :pane="node.pane">
      <SplitTabStrip v-if="stripLabels" :controller="controller" :pane="node.pane.id" :labels="stripLabels" />
      <SplitTabStrip v-else :tabs="node.pane.tabs" :active="node.pane.active" :always-show="controller.isSplit.value"
        @select="controller.select(node.pane.id, $event)" />
      <SplitTabsAnchor part="body" />
    </slot>
  </SplitPane>
  <div v-else ref="container" class="split-tabs-cut" :class="[`split-tabs--${node.orientation}`, { 'split-tabs--resizing': resizing }]"
    :data-split-tabs-cut="node.id" :style="{ flexBasis: basis ?? '100%' }">
    <SplitLayout :node="node.first" :controller="controller" :labels="labels" :strip-labels="stripLabels" :basis="firstBasis">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
    </SplitLayout>
    <div class="split-tabs-divider" role="separator" tabindex="0" :data-cut="node.id"
      :aria-orientation="node.orientation === 'rows' ? 'horizontal' : 'vertical'" :aria-label="labels.divider"
      :aria-valuenow="Math.round(node.ratio * 100)" :aria-valuemin="0" :aria-valuemax="100"
      @pointerdown="start" @dblclick="controller.equalize(node.id)" @keydown="keydown" />
    <SplitLayout :node="node.second" :controller="controller" :labels="labels" :strip-labels="stripLabels" basis="0px">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
    </SplitLayout>
  </div>
</template>
