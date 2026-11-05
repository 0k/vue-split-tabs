<script setup lang="ts">
import { inject, onBeforeUnmount, ref, watch } from "vue";
import { splitTabsKey, tabSetKey } from "./context.js";
const props = defineProps<{ part: string }>();
const context = inject(splitTabsKey);
const pane = inject(tabSetKey);
const element = ref<HTMLElement | null>(null);
let registered: string | null = null;
function unregister(): void {
  if (registered !== null && context?.anchors.get(registered) === element.value) context.anchors.delete(registered);
  registered = null;
}
// Overlay content is positioned over this anchor: when the anchor's box changes without a layout
// change (a bar shown or hidden, host slot content resized), the overlay must follow at once.
let observer: ResizeObserver | null = null;
watch([element, () => props.part], () => {
  unregister();
  observer?.disconnect();
  observer = null;
  if (element.value === null || context === undefined || pane === undefined) return;
  registered = `${pane}:${props.part}`;
  context.anchors.set(registered, element.value);
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => { context.geometry.value++; });
  observer.observe(element.value);
}, { flush: "post" });
onBeforeUnmount(() => { unregister(); observer?.disconnect(); });
</script>

<template><div ref="element" class="split-tabs-anchor" :class="{ 'split-tabs-anchor--overlay': context?.overlayParts.has(part) }" /></template>
