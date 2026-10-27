<script setup lang="ts">
import { computed, inject } from "vue";
import { splitTabsKey } from "./context.js";
const props = defineProps<{ tab: string; part: string }>();
const context = inject(splitTabsKey);
const pane = computed(() => context?.controller.paneOf(props.tab) ?? null);
const anchor = computed(() => pane.value === null ? undefined : context?.anchors.get(`${pane.value}:${props.part}`));
const visible = computed(() => pane.value !== null && context?.controller.panes.value.find((p) => p.index === pane.value)?.active === props.tab);
</script>

<template>
  <Teleport :to="anchor" :disabled="!anchor" defer>
    <div v-show="visible" class="split-tabs-keep"><slot /></div>
  </Teleport>
</template>
