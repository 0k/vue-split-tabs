<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref } from "vue";
import type { Orientation } from "./controller.js";
import { paneKey, splitTabsKey, type SplitTabStripProps } from "./context.js";

const { splitButtons = true, ...props } = defineProps<SplitTabStripProps>();
const emit = defineEmits<{ select: [id: string] }>();
const context = inject(splitTabsKey, undefined);
const root = ref<HTMLElement | null>(null);
const injectedPane = inject(paneKey, 0);
const pane = computed(() => props.pane ?? injectedPane);
const current = computed(() => props.controller?.panes.value.find((p) => p.index === pane.value));
const tabs = computed(() => props.controller === undefined ? props.tabs ?? [] : current.value?.tabs ?? []);
const active = computed(() => props.controller === undefined ? props.active ?? "" : current.value?.active ?? "");
const split = computed(() => props.controller?.isSplit.value ?? false);
const visible = computed(() => split.value || props.alwaysShow || tabs.value.length > 1);
const options = computed<Orientation[]>(() => {
  const fits = props.controller?.fits.value;
  return fits === undefined ? [] : (["rows", "cols"] as const).filter((o) => fits[o]);
});
type Direction = Orientation | "down" | "up" | "right" | "left";
interface IconAction { direction: Direction; orientation: Orientation | null; label: string }
const arrows: Record<Direction, string> = {
  down: "M12 8v8m-3-3 3 3 3-3", up: "M12 16V8m-3 3 3-3 3 3",
  right: "M8 12h8m-3-3 3 3-3 3", left: "M16 12H8m3-3-3 3 3 3",
  rows: "", cols: "",
};
const actions = computed<IconAction[]>(() => {
  const labels = props.labels;
  if (!splitButtons || labels === undefined) return [];
  if (split.value) {
    const direction = props.controller?.orientation.value === "rows" ? pane.value === 0 ? "down" : "up" : pane.value === 0 ? "right" : "left";
    return [{ direction, orientation: null, label: labels.sendToOther }];
  }
  if (!props.controller?.canOfferSplit.value) return [];
  return options.value.map((o) => ({ direction: o, orientation: o, label: labels[o] }));
});
function horizontal(direction: Direction): boolean { return direction === "rows" || direction === "down" || direction === "up"; }
function send(id: string, orientation: Orientation | null): void {
  if (orientation === null) props.controller?.moveToOther(id);
  else props.controller?.split(id, orientation);
}

const marker = computed(() => {
  const target = context?.drag.target.value;
  return target?.kind === "place" && target.pane === pane.value ? target : null;
});
function start(event: PointerEvent, id: string): void {
  if (root.value !== null) context?.drag.start(event, id, root.value, props.labels);
}
function select(id: string, event: MouseEvent): void {
  if (context?.drag.consumeClick(id, event)) { event.preventDefault(); event.stopPropagation(); return; }
  props.controller?.select(pane.value, id);
  emit("select", id);
}
async function reorder(event: KeyboardEvent, id: string): Promise<void> {
  if (!event.altKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
  const controller = props.controller ?? context?.controller;
  const index = tabs.value.indexOf(id);
  if (controller === undefined || index < 0) return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  if (index + direction < 0 || index + direction >= tabs.value.length) return;
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const before = direction === -1 ? tabs.value[index - 1] ?? null : tabs.value[index + 2] ?? null;
  controller.place(id, pane.value, before);
  await nextTick();
  button?.focus();
}
onBeforeUnmount(() => context?.drag.cancelOwner(root.value));
</script>

<template>
  <div v-show="visible" ref="root" class="split-tab-strip" :class="{ 'split-tab-strip--draggable': !!context }">
    <div v-for="id in tabs" :key="id" class="split-tab-strip-item" :data-split-tabs-tab="id"
      :class="{
        'split-tab-strip-item--dragging': context?.drag.id.value === id,
        'split-tab-strip-item--drag-armed': context?.drag.armed.value === id,
        'split-tab-strip-item--active': active === id,
      }">
      <span class="split-tab-strip-title" :class="{ 'split-tab-strip-title--active': active === id }">
        <button type="button" class="split-tab-strip-tab" :class="[tabClass, { 'split-tab-strip-tab--active': active === id }]"
          :aria-pressed="active === id" @click="select(id, $event)" @pointerdown="start($event, id)" @keydown="reorder($event, id)">
          <slot name="tab" :id="id" :active="active === id">{{ id }}</slot>
        </button>
        <button v-if="labels?.close && controller?.isOptional(id)" type="button" class="split-tab-strip-close" :class="iconClass"
          :aria-label="labels.close" :title="labels.close" @pointerdown.stop @click.stop="controller.close(id)">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 6 12 12M6 18 18 6" stroke-linecap="round" />
          </svg>
        </button>
      </span>
      <button v-for="action in actions" :key="action.direction" type="button" class="split-tab-strip-send"
        :class="iconClass" :data-orientation="action.orientation ?? undefined"
        :aria-label="action.label" :title="action.label" @click="send(id, action.orientation)">
        <svg viewBox="0 0 24 24" aria-hidden="true" :data-direction="action.direction" fill="none" stroke="currentColor" stroke-width="2">
          <template v-if="horizontal(action.direction)">
            <rect x="3" y="3" width="18" height="7" />
            <rect x="3" y="14" width="18" height="7" />
            <path d="M3 12h18" />
          </template>
          <template v-else><rect x="3" y="3" width="7" height="18" /><rect x="14" y="3" width="7" height="18" /><path d="M12 3v18" /></template>
          <path v-if="arrows[action.direction]" :d="arrows[action.direction]" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <div v-if="marker?.marker" class="split-tab-strip-marker" aria-hidden="true" :data-before="marker.beforeId ?? ''"
      :style="{ left: `${marker.marker.left}px`, top: `${marker.marker.top}px`, height: `${marker.marker.height}px` }" />
    <div v-if="$slots.end" class="split-tab-strip-end"><slot name="end" /></div>
  </div>
</template>
