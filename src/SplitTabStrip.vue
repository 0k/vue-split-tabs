<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref } from "vue";
import type { Side } from "./model.js";
import { splitTabsKey, tabSetKey, type SplitTabStripProps, type SplitTabsTabScope } from "./context.js";
import SplitTabsGlyph from "./SplitTabsGlyph.vue";
import SplitTabsRename from "./SplitTabsRename.vue";
import { createChordTracker, modifiersOf } from "./keymap.js";

const props = withDefaults(defineProps<SplitTabStripProps>(), { renamable: true });
const emit = defineEmits<{ select: [id: string] }>();
defineSlots<{
  tab?: (scope: SplitTabsTabScope) => unknown;
  end?: () => unknown;
  start?: () => unknown;
}>();
const context = inject(splitTabsKey, undefined);
const editing = context?.rename?.key ?? ref<string | null>(null);
function canRename(key: string): boolean {
  const policy = props.renamable;
  return props.controller !== undefined && (context?.rename?.allowed(key) ?? true)
    && (typeof policy === "function" ? policy(key) : policy);
}
function rename(key: string): void { if (canRename(key)) editing.value = key; }
function finishRename(key: string, title?: string): void {
  editing.value = null;
  if (title !== undefined) {
    if (context?.rename) context.rename.commit(key, title); else props.controller?.rename(key, title);
  }
  void nextTick(() => {
    // Blur may already have handed the keyboard to a host or arrange control.
    if (document.activeElement !== document.body && !root.value?.contains(document.activeElement)) return;
    const item = [...(root.value?.querySelectorAll<HTMLElement>("[data-split-tabs-tab]") ?? [])]
      .find(el => el.dataset.splitTabsTab === key);
    item?.querySelector<HTMLElement>(".split-tab-strip-tab")?.focus({ preventScroll: true });
  });
}
const tracker = typeof window === "undefined" ? null : createChordTracker();
onBeforeUnmount(() => tracker?.dispose());
const root = ref<HTMLElement | null>(null);
const injected = inject(tabSetKey, "");
const id = computed(() => props.tabSet ?? injected);
const current = computed(() => props.controller?.tabSet(id.value));
const tabs = computed(() => props.controller === undefined ? props.tabs ?? [] : current.value?.tabs ?? []);
const active = computed(() => props.controller === undefined ? props.active ?? "" : current.value?.active ?? "");
const side = computed<Side>(() => current.value?.side ?? "top");
const vertical = computed(() => side.value === "left" || side.value === "right");
/** A tab bar is drawn only when it has something to choose between. */
const visible = computed(() => props.alwaysShow || tabs.value.length > 1);
const closeMode = computed(() => props.closeButton ?? context?.closeButton.value ?? "active");
function showsClose(key: string): boolean {
  if (props.labels?.close === undefined || props.controller?.isClosable(key) !== true) return false;
  return closeMode.value === "never" ? false : closeMode.value === "active" ? active.value === key : true;
}
const barFocused = computed(() => props.controller?.barFocus.value === id.value);
const width = computed(() => current.value?.barWidth ?? 0);
function entry(key: string) {
  const d = props.controller?.describe(key);
  return { kind: d?.kind ?? "view", views: d?.views ?? [key] } as const;
}
function sourceOf(key: string) {
  return entry(key).kind === "view" ? { view: key } : { node: key };
}
const marker = computed(() => {
  const target = context?.drag.target.value;
  return target?.kind === "bar" && target.target === id.value;
});
function dragging(key: string): boolean {
  const s = context?.drag.source.value;
  return s != null && ("view" in s ? s.view : "node" in s ? s.node : "") === key;
}
function press(event: PointerEvent, key: string): void {
  if (context === undefined || props.controller === undefined || !(event.currentTarget instanceof HTMLElement)) return;
  const anchor = event.currentTarget;
  context.drag.press(event, { source: () => sourceOf(key), ghost: anchor, hold: 350, clickKey: key,
    onHoldRelease: point => context.openMenu({ tab: key, tabSet: id.value, anchor, point }) });
}
function menu(event: MouseEvent | KeyboardEvent, tab: string): void {
  if (event instanceof KeyboardEvent && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  if (props.controller === undefined || !(event.currentTarget instanceof HTMLElement)) return;
  // Native touch contextmenu may fire while the finger is still held: release, not that event, owns opening.
  if (!(event instanceof KeyboardEvent) && (context?.drag.armed.value === tab || context?.drag.source.value != null)) {
    if (context?.canOpenMenu(tab, id.value)) { event.preventDefault(); event.stopPropagation(); }
    return;
  }
  const point = event instanceof KeyboardEvent ? null : { x: event.clientX, y: event.clientY };
  if (context?.openMenu({ tab, tabSet: id.value, anchor: event.currentTarget, point })) {
    event.preventDefault();
    event.stopPropagation();
  }
}
function select(key: string, event: MouseEvent): void {
  if (context?.drag.consumeClick(key, event)) { event.preventDefault(); event.stopPropagation(); return; }
  if (props.controller !== undefined) {
    props.controller.select(id.value, key);
    // T and R now act on this bar, until a pane is clicked.
    props.controller.focusBar(id.value);
  }
  emit("select", key);
}
async function reorder(event: KeyboardEvent, key: string): Promise<void> {
  const back = vertical.value ? "ArrowUp" : "ArrowLeft", forth = vertical.value ? "ArrowDown" : "ArrowRight";
  if (modifiersOf(event) !== "Alt+Shift" || event.getModifierState("AltGraph")
    || (event.key !== back && event.key !== forth)) return;
  const controller = props.controller ?? context?.controller;
  const index = tabs.value.indexOf(key);
  if (controller === undefined || index < 0) return;
  event.preventDefault();
  const direction = event.key === back ? -1 : 1;
  if (index + direction < 0 || index + direction >= tabs.value.length) return;
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  controller.reorder(id.value, key, direction);
  await nextTick();
  button?.focus();
}
// A left or right bar is resized from its inner edge; a double press restores the default width.
const DOUBLE_PRESS_MS = 350;
let lastResizePress = 0;
let stopResize: (() => void) | null = null;
function resize(event: PointerEvent): void {
  const c = props.controller;
  const area = current.value;
  if (c === undefined || area === undefined || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  event.stopPropagation();
  if (lastResizePress !== 0 && event.timeStamp - lastResizePress < DOUBLE_PRESS_MS) { lastResizePress = 0; c.setBarWidth(id.value, null); return; }
  lastResizePress = event.timeStamp;
  const startX = event.clientX, startWidth = width.value, right = side.value === "right";
  const max = Math.max(c.sideBarWidth, Math.min(area.width * 0.6, area.width - 60));
  const pointer = event.pointerId;
  const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  try { handle?.setPointerCapture(pointer); } catch { /* Best-effort. */ }
  // Iframes must not take the pointer while it crosses them (as for dividers).
  if (context !== undefined) context.modes.resizing.value = true;
  let last: number | null = null;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const delta = right ? startX - e.clientX : e.clientX - startX;
    last = Math.round(Math.min(max, Math.max(c.sideBarWidth, startWidth + delta)));
    // Through the controller, so the layout (iframe content included) follows live.
    c.setBarWidthLive(id.value, last);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (context !== undefined) context.modes.resizing.value = false;
    stopResize = null;
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    stop();
    if (last !== null) lastResizePress = 0;
    if (last !== null && last !== startWidth && e.type === "pointerup") c.setBarWidth(id.value, last);
    else c.setBarWidthLive(id.value, null);
  };
  stopResize = () => { stop(); c.setBarWidthLive(id.value, null); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
onBeforeUnmount(() => { context?.drag.cancelOwner(root.value); stopResize?.(); });
</script>

<template>
  <div v-show="visible" ref="root" class="split-tab-strip" :data-tab-set="controller ? id : undefined" :data-side="side"
    :class="{ 'split-tab-strip--draggable': !!context, 'split-tab-strip--vertical': vertical, 'split-tab-strip--bar-focus': barFocused,
      'split-tab-strip--drop-target': marker, 'split-tab-strip--close-always': closeMode === 'always' }"
    :style="vertical ? { width: `${width}px` } : undefined">
    <div v-if="$slots.start" class="split-tab-strip-start"><slot name="start" /></div>
    <div v-for="key in tabs" :key="key" class="split-tab-strip-item" :data-split-tabs-tab="key" :data-kind="entry(key).kind"
      :class="{
        'split-tab-strip-item--dragging': dragging(key),
        'split-tab-strip-item--drag-armed': context?.drag.armed.value === key,
        'split-tab-strip-item--active': active === key,
        'split-tab-strip-item--spring': context?.drag.spring.value === `${id}:${key}`,
      }">
      <span class="split-tab-strip-title" :class="{ 'split-tab-strip-title--active': active === key }">
        <SplitTabsRename v-if="editing === key && canRename(key)" :title="controller?.titleOf(key) ?? null"
          :label="labels?.renameInput ?? context?.rename?.label.value" @commit="finishRename(key, $event)" @cancel="finishRename(key)" />
        <button v-else type="button" class="split-tab-strip-tab" :class="[tabClass, { 'split-tab-strip-tab--active': active === key }]"
          :aria-pressed="active === key" @click="select(key, $event)" @pointerdown="press($event, key)" @contextmenu="menu($event, key)"
          @keydown="menu($event, key); reorder($event, key)" @dblclick.stop="rename(key)">
          <slot name="tab" :id="key" :active="active === key" :kind="entry(key).kind" :views="entry(key).views"
            :title="controller?.titleOf(key) ?? null">
            {{ controller?.titleOf(key) ?? (entry(key).kind === "view" ? key : entry(key).views.join("+")) }}
          </slot>
        </button>
        <button v-if="showsClose(key)" type="button" class="split-tab-strip-close" :class="iconClass"
          :aria-label="labels!.close" :title="labels!.close" @pointerdown.stop @click.stop="controller!.close(key)">
          <SplitTabsGlyph kind="close" />
        </button>
      </span>
    </div>
    <div v-if="vertical && controller" class="split-tab-strip-resize" role="separator"
      :aria-orientation="'vertical'" :aria-label="labels?.resize" @pointerdown="resize" />
    <div v-if="$slots.end" class="split-tab-strip-end"><slot name="end" /></div>
  </div>
</template>
