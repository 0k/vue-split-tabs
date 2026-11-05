<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SplitTabsController } from "./controller.js";
import { splitTabsKey } from "./context.js";
import type { SplitTabsRenamable } from "./context.js";
import { arrangeMenuEntries, menuEntries, menuSource, placeMenu, pointBox,
  type ArrangeMenuOptions, type SplitTabsArrangeMenuItem, type SplitTabsMenuItem, type SplitTabsMenuLabels } from "./menu.js";
import { useSplitTabsPick } from "./pick.js";
import SplitTabsGlyph from "./SplitTabsGlyph.vue";
import { createModalExit } from "./modal.js";
import { modifiersOf } from "./keymap.js";

const props = withDefaults(defineProps<{
  controller: SplitTabsController; tab: string; tabSet: string; anchor: HTMLElement;
  point?: { x: number; y: number } | null; labels?: SplitTabsMenuLabels; items?: readonly SplitTabsMenuItem[];
  renamable?: SplitTabsRenamable;
  arrange?: ArrangeMenuOptions;
}>(), { renamable: true });
const emit = defineEmits<{ close: []; rename: [key: string] }>();
defineSlots<{ extra?: (scope: { tab: string; tabSet: string; close: () => void }) => unknown }>();
const context = inject(splitTabsKey, undefined);
const pick = useSplitTabsPick();
const panel = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({ position: "fixed", left: "0px", top: "0px", visibility: "hidden" });
const entries = computed(() => props.arrange ? arrangeMenuEntries(props.controller, props.arrange)
  : menuEntries(props.controller, props.tab, props.tabSet, props.labels, props.items,
  typeof props.renamable === "function" ? props.renamable(props.tab) : props.renamable !== false));
const moveEntry = computed(() => entries.value.find(e => e.item === "move" && !e.disabled));
const closed = ref(false);
// Root-owned menus join the shell's mode priority; standalone menus use the same exit mechanism.
const modal = context === undefined ? createModalExit(() => undefined, () => closed.value ? null : close) : null;
defineExpose({ close });
function cancelPreview(): void { if (pick?.mode.value === "preview") pick.cancel(); }
function close(restoreFocus = true): void {
  if (closed.value) return;
  closed.value = true;
  cancelPreview();
  emit("close");
  if (!restoreFocus) return;
  void nextTick(() => {
    const anchor = props.anchor.isConnected ? props.anchor : [...(context?.root.value?.querySelectorAll<HTMLElement>("[data-split-tabs-tab]") ?? [])]
      .find(el => el.dataset.splitTabsTab === props.tab)?.querySelector<HTMLElement>(".split-tab-strip-tab");
    anchor?.focus({ preventScroll: true });
  });
}
function place(): void {
  if (panel.value === null) return;
  const box = props.point ? pointBox(props.point.x, props.point.y) : props.anchor.getBoundingClientRect();
  const at = placeMenu(box, { width: panel.value.offsetWidth, height: panel.value.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight }, props.point ? 0 : 6);
  style.value = { position: "fixed", left: `${at.left}px`, top: `${at.top}px`, maxHeight: `${at.maxHeight}px`,
    maxWidth: `${Math.max(0, window.innerWidth - 16)}px` };
}
function preview(): void { if (moveEntry.value && props.controller.panes.value.length >= 3) pick?.preview(props.tab); }
function activate(item: SplitTabsMenuItem | SplitTabsArrangeMenuItem): void {
  const entry = entries.value.find(e => e.item === item);
  if (!entry || entry.disabled) return;
  if (props.arrange) { props.arrange.run(item as SplitTabsArrangeMenuItem); close(); return; }
  if (item === "rename") { close(false); emit("rename", props.tab); return; }
  if (item === "close") props.controller.close(props.tab);
  else if (entry.zone !== null) props.controller.move(menuSource(props.controller, props.tab), entry.zone);
  else if (item === "move") { close(); pick?.start(props.tab); return; }
  close();
}
function keydown(event: KeyboardEvent): void {
  const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
  if (moveEntry.value && ["", "Shift"].includes(modifiersOf(event)) && !event.getModifierState("AltGraph")) {
    if (event.key.toLowerCase() === "m") { stop(); activate("move"); return; }
    if (/^[1-9]$/.test(event.key) && props.controller.panes.value.length >= 3) {
      stop();
      preview();
      pick?.chooseNumber(Number(event.key));
      close();
      return;
    }
  }
  if (props.arrange && (event.key === "Enter" || event.key === " ") && document.activeElement instanceof HTMLButtonElement
    && panel.value?.contains(document.activeElement)) { stop(); document.activeElement.click(); return; }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  stop();
  const items = [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
}
function outside(event: PointerEvent): void {
  if (event.target instanceof Node && !panel.value?.contains(event.target)) close();
}
function blur(): void { close(); }
watch(entries, () => { if (entries.value.length === 0) close(); else void nextTick(place); });
watch(() => props.controller.tabSet(props.tabSet)?.tabs.includes(props.tab), exists => { if (!props.arrange && !exists) close(); });
onMounted(async () => {
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", place);
  window.addEventListener("blur", blur);
  await nextTick();
  place();
  await nextTick();
  if (!closed.value) panel.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  modal?.dispose();
  window.removeEventListener("keydown", keydown, true);
  window.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("resize", place);
  window.removeEventListener("blur", blur);
  cancelPreview();
});
</script>

<template>
  <div ref="panel" class="split-tabs-menu" role="menu" :aria-label="labels?.menu" :style="style" @contextmenu.prevent @pointerdown.stop>
    <template v-for="(entry, index) in entries" :key="entry.item">
      <div v-if="index > 0 && (entry.item === 'move' || entry.item === 'close')" class="split-tabs-menu-separator" role="separator" />
      <button type="button" class="split-tabs-menu-item" role="menuitem" :data-menu-item="entry.item" :disabled="entry.disabled"
        @click="activate(entry.item)" @pointerenter="entry.item === 'move' && preview()" @pointerleave="cancelPreview"
        @focus="entry.item === 'move' && preview()" @blur="cancelPreview">
        <SplitTabsGlyph v-if="entry.item !== 'rename'" :kind="entry.item === 'close' ? 'close'
          : entry.zone?.kind === 'split' || entry.item.startsWith('split') ? 'split' : 'move'"
          :orientation="entry.item === 'down' || entry.item === 'up' || entry.item === 'splitBelow' || entry.item === 'splitAbove' ? 'rows' : 'cols'"
          :side="entry.item === 'left' || entry.item === 'up' || entry.item === 'splitLeft' || entry.item === 'splitAbove' ? 'start' : 'end'" />
        <span>{{ entry.label }}</span><span v-if="entry.reason" class="split-tabs-menu-reason">{{ entry.reason }}</span>
      </button>
    </template>
    <slot name="extra" :tab="tab" :tab-set="tabSet" :close="close" />
  </div>
</template>
