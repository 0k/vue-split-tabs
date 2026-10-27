<script setup lang="ts">
import { provide } from "vue";
import { paneKey } from "./context.js";
import type { SplitTabsPane } from "./controller.js";
const props = defineProps<{ pane: SplitTabsPane; basis: string }>();
provide(paneKey, props.pane.index);
</script>

<template>
  <div class="split-tabs-pane" :data-split-tabs-pane="pane.index" :style="{ flexBasis: basis }">
    <slot />
  </div>
</template>
