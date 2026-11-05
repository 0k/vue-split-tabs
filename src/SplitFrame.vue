<script setup lang="ts">
import { provide } from "vue";
import { tabSetKey } from "./context.js";
import type { SplitTabsFrame } from "./projection.js";
import SplitTabSet from "./SplitTabSet.vue";

// A tab set showing a layout or an inner bar: its bar frames that content.
const props = defineProps<{ frame: SplitTabsFrame; basis: string; depth: number }>();
provide(tabSetKey, props.frame.id);
</script>

<template>
  <SplitTabSet class="split-tabs-frame" :tab-set="frame" :basis="basis" :data-frame-id="frame.id"
    :data-split-tabs-node="frame.id" :data-depth="depth">
    <div class="split-tabs-frame-content">
      <slot name="content" />
      <div v-if="$slots.default" class="split-tabs-frame-slot"><slot /></div>
    </div>
  </SplitTabSet>
</template>
