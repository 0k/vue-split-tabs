<script setup lang="ts">
import { inject, onBeforeUnmount, provide, type ComponentPublicInstance } from "vue";
import { paneKey, splitTabsKey } from "./context.js";
import type { SplitTabsPane } from "./controller.js";
const props = defineProps<{ pane: SplitTabsPane; basis: string }>();
provide(paneKey, props.pane.id);
const pick = inject(splitTabsKey, undefined)?.pick;
let overlay: Element | null = null;
function setOverlay(element: Element | ComponentPublicInstance | null): void {
  if (overlay !== null) pick?.overlays.delete(overlay);
  overlay = element instanceof Element ? element : null;
  if (overlay !== null) pick?.overlays.add(overlay);
}
onBeforeUnmount(() => setOverlay(null));
</script>

<template>
  <div class="split-tabs-pane" :data-split-tabs-pane="pane.index" :data-pane-id="pane.id" :style="{ flexBasis: basis }">
    <slot />
    <div v-if="pick && pick.mode.value !== null" :ref="setOverlay" class="split-tabs-pane-number" aria-hidden="true"
      :data-mode="pick.mode.value" :data-current="pick.source.value === pane.id ? '' : undefined"
      @click="pick.mode.value === 'pick' && pick.choose(pane.id)">
      <span class="split-tabs-pane-number-badge">{{ pick.numberOf(pane.id) }}</span>
    </div>
  </div>
</template>
