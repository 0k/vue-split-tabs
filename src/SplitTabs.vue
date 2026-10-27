<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowReactive, watch } from "vue";
import type { SplitTabsController } from "./controller.js";
import { splitTabsKey, type SplitTabStripLabels } from "./context.js";
import SplitPane from "./SplitPane.vue";
import SplitTabStrip from "./SplitTabStrip.vue";
import SplitTabsAnchor from "./SplitTabsAnchor.vue";
import { createTabDrag, previewStyle } from "./drag.js";

const props = defineProps<{ controller: SplitTabsController; labels: { divider: string }; stripLabels?: SplitTabStripLabels }>();
const c = props.controller;
const root = ref<HTMLElement | null>(null);
const resizing = ref(false);
const drag = createTabDrag(c, root);
provide(splitTabsKey, { controller: c, root, anchors: shallowReactive(new Map<string, HTMLElement>()), drag });
const basis = computed(() => c.isSplit.value ? `calc((100% - ${c.dividerSize}px) * ${c.ratio.value})` : "100%");
let observer: ResizeObserver | undefined;
let pointerId: number | null = null;
let handle: HTMLElement | null = null;
let startPosition = 0;
let moved = false;
function cleanup(): void {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", end);
  window.removeEventListener("pointercancel", end);
  if (pointerId !== null) {
    try { handle?.releasePointerCapture(pointerId); }
    catch { /* Capture may already be released by the browser. */ }
  }
  pointerId = null;
  handle = null;
  moved = false;
  resizing.value = false;
}
function move(event: PointerEvent): void {
  if (pointerId !== event.pointerId || root.value === null || c.orientation.value === null) return;
  const rect = root.value.getBoundingClientRect();
  const rows = c.orientation.value === "rows";
  const available = (rows ? rect.height : rect.width) - c.dividerSize;
  if (available <= 0) return;
  const position = rows ? event.clientY : event.clientX;
  if (!moved && position === startPosition) return;
  moved = true;
  c.setRatioLive(((rows ? event.clientY - rect.top : event.clientX - rect.left) - c.dividerSize / 2) / available);
}
function end(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  const ratio = c.ratio.value;
  const commit = moved;
  cleanup();
  if (commit) c.commitRatio(ratio);
}
function start(event: PointerEvent): void {
  if (!c.isSplit.value || resizing.value || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  pointerId = event.pointerId;
  startPosition = c.orientation.value === "rows" ? event.clientY : event.clientX;
  moved = false;
  handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  resizing.value = true;
  try { handle?.setPointerCapture(pointerId); }
  catch { /* Window listeners work without capture. */ }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
function keydown(event: KeyboardEvent): void {
  if (root.value === null || c.orientation.value === null) return;
  const rect = root.value.getBoundingClientRect();
  const rows = c.orientation.value === "rows";
  const available = (rows ? rect.height : rect.width) - c.dividerSize;
  const step = (event.shiftKey ? 32 : 8) / available;
  let value: number;
  if (event.key === "Enter") value = 0.5;
  else if (event.key === "Home") value = 0;
  else if (event.key === "End") value = 1;
  else if (event.key === (rows ? "ArrowUp" : "ArrowLeft")) value = c.ratio.value - step;
  else if (event.key === (rows ? "ArrowDown" : "ArrowRight")) value = c.ratio.value + step;
  else return;
  event.preventDefault();
  c.commitRatio(value);
}
watch(c.orientation, () => { if (resizing.value) cleanup(); }, { flush: "sync" });
onMounted(() => {
  if (root.value === null || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry !== undefined) c.setContainerSize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => { observer?.disconnect(); cleanup(); drag.dispose(); });
</script>

<template>
  <div ref="root" class="split-tabs"
    :class="[`split-tabs--${c.orientation.value ?? 'single'}`, { 'split-tabs--resizing': resizing }]"
    :style="{ '--split-tabs-divider-size': `${c.dividerSize}px` }">
    <template v-for="pane in c.panes.value" :key="pane.index">
      <div v-if="pane.index === 1" class="split-tabs-divider" role="separator" tabindex="0"
        :aria-orientation="c.orientation.value === 'rows' ? 'horizontal' : 'vertical'"
        :aria-label="labels.divider" :aria-valuenow="Math.round(c.ratio.value * 100)" :aria-valuemin="0" :aria-valuemax="100"
        @pointerdown="start" @dblclick="c.commitRatio(0.5)" @keydown="keydown" />
      <SplitPane :pane="pane" :basis="pane.index === 0 ? basis : '0px'">
        <slot name="pane" :pane="pane">
          <SplitTabStrip v-if="stripLabels" :controller="c" :pane="pane.index" :labels="stripLabels" />
          <SplitTabStrip v-else :tabs="pane.tabs" :active="pane.active" :always-show="c.isSplit.value" @select="c.select(pane.index, $event)" />
          <SplitTabsAnchor part="body" />
        </slot>
      </SplitPane>
    </template>
    <div class="split-tabs-keep-holder"><slot name="keep" /></div>
    <div v-if="drag.target.value?.shade" class="split-tabs-drop-shade" aria-hidden="true"
      :data-zone="drag.target.value.kind === 'place' ? 'pane' : 'split'"
      :data-orientation="drag.target.value.kind === 'split' ? drag.target.value.orientation : undefined"
      :data-side="drag.target.value.kind === 'split' ? drag.target.value.side : undefined"
      :style="previewStyle(drag.target.value.shade)">
      <span v-if="drag.target.value.kind === 'split'">{{ drag.target.value.label }}</span>
    </div>
  </div>
</template>
