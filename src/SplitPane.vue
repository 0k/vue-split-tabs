<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type ComponentPublicInstance } from "vue";
import SplitTabSet from "./SplitTabSet.vue";
import { splitTabsKey, tabSetKey } from "./context.js";
import type { SplitTabsPane } from "./projection.js";
import type { SplitTabsSource } from "./controller.js";
import { heldForLayout, modifiersOf } from "./keymap.js";

const props = defineProps<{ pane: SplitTabsPane; basis: string }>();
provide(tabSetKey, props.pane.id);
const context = inject(splitTabsKey, undefined);
const pick = context?.pick;
const c = context?.controller;
const element = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver === "undefined" || element.value === null) return;
  observer = new ResizeObserver(() => { if (context) context.geometry.value++; });
  observer.observe(element.value);
});
onBeforeUnmount(() => observer?.disconnect());
const focused = computed(() => c?.focus.value === props.pane.id);
const selected = computed(() => c?.selection.value.includes(props.pane.id) ?? false);
const covered = computed(() => context !== undefined
  && (context.modes.arranging.value || context.modes.grab.value || context.modes.gesture.value));
const lettered = computed(() => pick !== undefined && (pick.mode.value === "select" || (pick.mode.value === "move" && pick.destination.value === null)
  || context!.modes.arranging.value));
const numbered = computed(() => pick !== undefined && ["pick", "preview", "display"].includes(pick.mode.value ?? ""));
let overlay: Element | null = null;
function setOverlay(element: Element | ComponentPublicInstance | null): void {
  if (overlay !== null) pick?.overlays.delete(overlay);
  overlay = element instanceof Element ? element : null;
  if (overlay !== null) pick?.overlays.add(overlay);
}
onBeforeUnmount(() => setOverlay(null));
// What dragging this pane carries: the selection when the pane is in it, else the pane.
function carried(): SplitTabsSource | null {
  if (c === undefined) return null;
  if (c.selection.value.length > 1 && c.selection.value.includes(props.pane.id)) return c.plan.value?.ok === true ? { selection: true } : null;
  return { node: props.pane.id };
}
// A plain press focuses the pane; everything about panes goes through the host's pointer chords or arrange mode.
function pressBody(event: PointerEvent): void {
  if (c === undefined || context === undefined || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (context.modes.arranging.value || context.modes.gesture.value) return;
  // The chord is held but no cover is up (its keys went to another document): act as the cover would.
  if (heldForLayout(context.chords.value, event)) { pressCover(event); return; }
  if (c.focus.value !== props.pane.id || c.selection.value.length > 0 || c.barFocus.value !== null) c.focusPane(props.pane.id);
}
function pressCover(event: PointerEvent): void {
  if (context === undefined || c === undefined || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  event.stopPropagation();
  // A finger of a multi-finger gesture is not a tap or a drag of this pane.
  if (context.modes.gesture.value) return;
  const id = props.pane.id;
  if (context.modes.arranging.value) {
    context.drag.press(event, {
      source: carried,
      onTap: () => { c.toggleSelected(id); },
      onLong: () => {
        if (c.focus.value !== id) c.selectRectangle(id); else c.toggleSelected(id);
        if (typeof navigator.vibrate === "function") navigator.vibrate(15);
      },
    });
    return;
  }
  const held = modifiersOf(event), chords = context.chords.value;
  if (held === "" || !heldForLayout(chords, event)) return;
  context.drag.press(event, {
    source: () => held === chords.move ? carried() : null,
    onTap: () => {
      if (held === chords.toggle) c.toggleSelected(id);
      else if (held === chords.rectangle) c.selectRectangle(id);
    },
  });
}
</script>

<template>
  <SplitTabSet :tab-set="pane" :basis="basis" :data-split-tabs-node="pane.id">
    <div ref="element" class="split-tabs-pane" tabindex="-1" :class="{ 'split-tabs-pane--focused': focused, 'split-tabs-pane--selected': selected }"
      :data-split-tabs-pane="pane.index" :data-pane-id="pane.id" :data-side="pane.side"
      :data-collapsed="pane.collapsed ? '' : undefined" @pointerdown.capture="pressBody">
      <div class="split-tabs-pane-content"><slot /></div>
      <div v-if="covered" class="split-tabs-pane-cover" aria-hidden="true" @pointerdown="pressCover" />
      <div v-if="pick && (numbered || lettered)" :ref="setOverlay" class="split-tabs-pane-number" aria-hidden="true"
        :data-mode="numbered ? pick.mode.value : 'letter'" :data-current="numbered && pick.source.value === pane.id ? '' : undefined"
        @click="numbered && (pick.mode.value === 'pick' || pick.mode.value === 'display') && pick.choose(pane.id)">
        <span class="split-tabs-pane-number-badge">{{ numbered ? pick.numberOf(pane.id) : pick.letterOf(pane.id) }}</span>
      </div>
    </div>
  </SplitTabSet>
</template>
