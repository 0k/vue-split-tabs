<script setup lang="ts">
import { inject } from "vue";
import type { SplitTabsTabSet } from "./projection.js";
import { splitTabsKey } from "./context.js";
import SplitTabStrip from "./SplitTabStrip.vue";

defineProps<{ tabSet: SplitTabsTabSet; basis: string }>();
const context = inject(splitTabsKey)!;
const bar = context.bar;
</script>

<template>
  <div class="split-tabs-tabset" :data-tabset-id="tabSet.id" :data-side="tabSet.side"
    :style="{ flexBasis: basis, '--split-tabs-bar-width': `${tabSet.barWidth}px` }">
    <SplitTabStrip class="split-tabs-bar" :data-bar-id="tabSet.id" :controller="context.controller" :tab-set="tabSet.id"
      :labels="bar?.labels.value ?? {}" :always-show="tabSet.showsBar" :tab-class="bar?.tabClass.value ?? ''" :icon-class="bar?.iconClass.value ?? ''">
      <template v-if="bar?.slots.tab" #tab="scope"><component :is="bar.slots.tab" v-bind="scope" /></template>
      <template v-if="bar?.slots['bar-start']" #start><component :is="bar.slots['bar-start']" v-bind="{ tabSet }" /></template>
      <template v-if="bar?.slots['bar-end']" #end><component :is="bar.slots['bar-end']" v-bind="{ tabSet }" /></template>
    </SplitTabStrip>
    <slot />
  </div>
</template>
