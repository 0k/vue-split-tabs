<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { splitTabsKey } from "./context.js";

// Host content for one tab, mounted once.  By default it is teleported into
// the anchor of the pane showing it.  With `overlay`, it never moves in the
// DOM (an iframe would reload): it stays in the root's layer and is placed
// over that anchor.
const props = defineProps<{ tab: string; part: string; overlay?: boolean }>();
const context = inject(splitTabsKey);
watch([() => props.overlay, () => props.part], ([overlay, part], _previous, onCleanup) => {
  if (!overlay || context === undefined) return;
  context.overlayParts.set(part, (context.overlayParts.get(part) ?? 0) + 1);
  onCleanup(() => {
    const count = context.overlayParts.get(part)! - 1;
    if (count === 0) context.overlayParts.delete(part); else context.overlayParts.set(part, count);
  });
}, { immediate: true });
const pane = computed(() => context?.controller.paneOf(props.tab) ?? null);
const anchor = computed(() => pane.value === null ? undefined : context?.anchors.get(`${pane.value}:${props.part}`));
const visible = computed(() => pane.value !== null && context?.controller.panes.value.find(p => p.id === pane.value)?.view === props.tab);
const focused = computed(() => pane.value !== null && context?.controller.focus.value === pane.value);
const selected = computed(() => pane.value !== null && (context?.controller.selection.value.includes(pane.value) ?? false));
const placed = computed(() => {
  void context?.geometry.value;
  const root = context?.root.value;
  const el = anchor.value;
  if (!props.overlay || !visible.value || root == null || el === undefined) return { display: "none" };
  const r = el.getBoundingClientRect(), host = root.getBoundingClientRect();
  return { left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` };
});
</script>

<template>
  <Teleport v-if="overlay" :to="context?.layer" :disabled="!context" defer>
    <div class="split-tabs-keep split-tabs-keep--overlay" :class="{ 'split-tabs-keep--focused': focused, 'split-tabs-keep--selected': selected }"
      :data-split-tabs-keep="tab" :data-pane-of="pane ?? undefined" :style="placed"><slot /></div>
  </Teleport>
  <Teleport v-else :to="anchor" :disabled="!anchor" defer>
    <div v-show="visible" class="split-tabs-keep" :data-split-tabs-keep="tab"><slot /></div>
  </Teleport>
</template>
