<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowReactive } from "vue";
import type { SplitTabsController } from "./controller.js";
import { splitTabsKey, type SplitTabStripLabels } from "./context.js";
import SplitLayout from "./SplitLayout.vue";
import { createTabDrag, previewStyle } from "./drag.js";
import { createPanePick } from "./pick.js";

const props = defineProps<{ controller: SplitTabsController; labels: { divider: string }; stripLabels?: SplitTabStripLabels }>();
const c = props.controller;
const root = ref<HTMLElement | null>(null);
const drag = createTabDrag(c, root);
const pick = createPanePick(c);
defineExpose({ startExternalDrag: drag.startExternal });
provide(splitTabsKey, { controller: c, root, anchors: shallowReactive(new Map<string, HTMLElement>()), drag, pick });
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (root.value === null) return;
  if (root.value.clientWidth > 0 && root.value.clientHeight > 0) c.setContainerSize(root.value.clientWidth, root.value.clientHeight);
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry !== undefined) c.setContainerSize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => { observer?.disconnect(); drag.dispose(); pick.dispose(); });
</script>

<template>
  <div ref="root" class="split-tabs" :class="`split-tabs--${c.orientation.value ?? 'single'}`"
    :style="{ '--split-tabs-divider-size': `${c.dividerSize}px` }">
    <SplitLayout :node="c.layout.value" :controller="c" :labels="labels" :strip-labels="stripLabels">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
    </SplitLayout>
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
