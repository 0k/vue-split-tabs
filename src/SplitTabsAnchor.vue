<script setup lang="ts">
import { inject, onBeforeUnmount, ref, watch } from "vue";
import { paneKey, splitTabsKey } from "./context.js";
const props = defineProps<{ part: string }>();
const context = inject(splitTabsKey);
const pane = inject(paneKey);
const element = ref<HTMLElement | null>(null);
let registered: string | null = null;
function unregister(): void {
  if (registered !== null && context?.anchors.get(registered) === element.value) context.anchors.delete(registered);
  registered = null;
}
watch([element, () => props.part], () => {
  unregister();
  if (element.value === null || context === undefined || pane === undefined) return;
  registered = `${pane}:${props.part}`;
  context.anchors.set(registered, element.value);
}, { flush: "post" });
onBeforeUnmount(unregister);
</script>

<template><div ref="element" class="split-tabs-anchor" /></template>
