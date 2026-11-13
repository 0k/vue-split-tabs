<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowReactive, shallowRef, useId, watch, watchEffect } from "vue";
import type { SplitTabsBarVisibility, SplitTabsTabSet } from "./projection.js";
import type { SplitTabsBarSlots } from "./context.js";
import type { SplitTabsRenamable } from "./context.js";
import type { PaneId, SplitTabsController, SplitTabsResult } from "./controller.js";
import { splitTabsKey, type SplitTabsCloseButton, type SplitTabsContext, type SplitTabsLabels, type SplitTabStripLabels } from "./context.js";
import SplitLayout from "./SplitLayout.vue";
import SplitTabsGlyph from "./SplitTabsGlyph.vue";
import { createTabDrag, previewStyle, type PreviewRect } from "./drag.js";
import { createPanePick } from "./pick.js";
import {
  compilePointerChords, defaultExitKeys, defaultKeymap, defaultPointerChords, runCommand,
  type SplitTabsCommand, type SplitTabsKeymap, type SplitTabsPointerChords,
} from "./keymap.js";
import { createShell, type SplitTabsCapture } from "./shell.js";
import SplitTabsMenu from "./SplitTabsMenu.vue";
import { defaultArrangeMenuItems, defaultMenuItems, menuEntries, type SplitTabsArrangeMenuItem, type SplitTabsArrangeMenuLabels,
  type SplitTabsMenuItem, type SplitTabsMenuLabels, type SplitTabsMenuRequest } from "./menu.js";

const props = withDefaults(defineProps<{
  controller: SplitTabsController;
  labels: SplitTabsLabels;
  stripLabels?: SplitTabStripLabels;
  alwaysShow?: SplitTabsBarVisibility;
  tabClass?: string;
  iconClass?: string;
  /** Every tab is renamable by default; hosts may disable all or individual keys. */
  renamable?: SplitTabsRenamable;
  menuLabels?: SplitTabsMenuLabels;
  menuItems?: readonly SplitTabsMenuItem[];
  /** Layout chords; `null` binds none. */
  keymap?: SplitTabsKeymap | null;
  /** Capture-phase exits for every modal mode; `null` or `[]` disables. */
  exitKeys?: readonly string[] | null;
  /** Additional exits, active only while arranging. Default: plain physical Q. */
  arrangeExitKeys?: readonly string[] | null;
  arrangeMenuLabels?: SplitTabsArrangeMenuLabels;
  arrangeMenuItems?: readonly SplitTabsArrangeMenuItem[];
  /** Duration of displayPanes badges in milliseconds. */
  displayPanesTimeout?: number;
  /** When tabs show their ✕ (default `active`: only the shown tab). */
  closeButton?: SplitTabsCloseButton;
  /** Modifier chords of pointer actions on panes. */
  pointerChords?: SplitTabsPointerChords;
  /** How long Undo stays offered after a close, in ms. */
  undoTimeout?: number;
  /** Origins allowed to report from pane iframes (frame helper). */
  frameOrigins?: readonly string[];
}>(), { keymap: () => defaultKeymap as SplitTabsKeymap, exitKeys: () => defaultExitKeys,
  pointerChords: () => ({ ...defaultPointerChords }), closeButton: "active", renamable: true, undoTimeout: 8000, displayPanesTimeout: 2000 });
const emit = defineEmits<{
  command: [command: SplitTabsCommand | "rename" | "fourFingerHold" | "pinchOut" | "pinchIn", result: SplitTabsResult];
  capture: [policy: SplitTabsCapture];
}>();
const slots = defineSlots<SplitTabsBarSlots & {
  pane?: (scope: { pane: import("./projection.js").SplitTabsPane }) => unknown;
  frame?: (scope: { frame: import("./projection.js").SplitTabsFrame }) => unknown;
  keep?: () => unknown;
  undo?: (scope: { undo: () => void; dismiss: () => void }) => unknown;
  arrange?: (scope: { run: (command: SplitTabsCommand) => void; done: () => void }) => unknown;
  bin?: () => unknown;
  "menu-extra"?: (scope: { tab: string; tabSet: string; close: () => void }) => unknown;
}>();
const c = props.controller;
// Host renders create fresh arrows. Only changed answers invalidate the controller.
let latestVisibility = props.alwaysShow ?? false;
const visibilityVersion = ref(0);
const visibilityAnswers = new Map<string, { set: SplitTabsTabSet; shown: boolean }>();
function requestedBar(set: SplitTabsTabSet): boolean {
  return typeof latestVisibility === "function" ? latestVisibility(set) : latestVisibility;
}
c.setAlwaysShow(set => {
  void visibilityVersion.value;
  const shown = requestedBar(set);
  visibilityAnswers.set(set.id, { set, shown });
  return shown;
});
watchEffect(() => {
  latestVisibility = props.alwaysShow ?? false;
  void c.tabSets.value;
  // Read every answer to subscribe to a replacement callback's reactive inputs,
  // even when its current answers are identical to the previous callback's.
  let changed = false;
  for (const { set, shown } of visibilityAnswers.values()) if (requestedBar(set) !== shown) changed = true;
  if (changed) visibilityVersion.value++;
});
const root = ref<HTMLElement | null>(null);
const layerId = `split-tabs-layer-${useId()}`;
const geometry = ref(0);
const drag = createTabDrag(c, root, focusKeyboard);
const pick = createPanePick(c, () => props.displayPanesTimeout);
const menu = shallowRef<SplitTabsMenuRequest | null>(null);
const menuPanel = ref<InstanceType<typeof SplitTabsMenu> | null>(null);
const arrangeAnchor = ref<HTMLElement | null>(null);
const arrangeMenuOpen = ref(false);
function closeArrangeMenu(): void { arrangeMenuOpen.value = false; }
function done(): void { modes.arranging.value = false; }
function arrangeAction(item: SplitTabsArrangeMenuItem): void { if (item === "done") done(); else run(item); }
const renameKey = ref<string | null>(null);
function canRename(key: string): boolean {
  return typeof props.renamable === "function" ? props.renamable(key) : props.renamable !== false;
}
/** Open the existing label editor; hosts use their own prompt when no editable bar is rendered. */
function startRename(key: string): boolean {
  if (root.value === null || !canRename(key)
    || ![...c.tabSets.value.values()].some(set => set.showsBar && set.tabs.includes(key))) return false;
  renameKey.value = key;
  return true;
}
function closeMenu(): void { menuPanel.value?.close(); menu.value = null; }
let menuSequence = 0;
const menuKey = ref(0);
function canOpenMenu(tab: string, tabSet: string): boolean {
  return menuEntries(c, tab, tabSet, props.menuLabels, props.menuItems, canRename(tab)).length > 0;
}
function openMenu(request: SplitTabsMenuRequest): boolean {
  if (!canOpenMenu(request.tab, request.tabSet)) return false;
  drag.cancel();
  pick.cancel();
  menuKey.value = ++menuSequence;
  menu.value = request;
  return true;
}
const modes = { arranging: ref(false), grab: ref(false), gesture: ref(false), resizing: ref(false) };
watch(modes.arranging, on => { if (!on) closeArrangeMenu(); }, { flush: "sync" });
watch(drag.source, source => { if (source) closeArrangeMenu(); });
const guide = ref<{ axis: "x" | "y"; at: number } | null>(null);
const FOCUSABLE = ["iframe", "input", "textarea", "select", "button", "a[href]", "[contenteditable='true']", "[tabindex]:not([tabindex='-1'])"]
  .join(", ");
function focusKeyboard(id: string): void {
  void nextTick(() => {
    const pane = paneEl(id);
    const view = c.panes.value.find(p => p.id === id)?.view ?? "";
    const keep = view === "" ? null : root.value?.querySelector<HTMLElement>(`[data-split-tabs-keep="${attr(view)}"]`) ?? null;
    const target = keep?.querySelector<HTMLElement>(FOCUSABLE) ?? pane;
    if (target === null || target.contains(document.activeElement)) return;
    target.focus({ preventScroll: true });
    if (target instanceof HTMLIFrameElement) {
      try { target.contentWindow?.focus(); } catch { /* A cross-origin iframe still received element focus. */ }
    }
  });
}
const anchors = shallowReactive(new Map<string, HTMLElement>());
const overlayParts = shallowReactive(new Map<string, number>());
const chords = computed(() => compilePointerChords(props.pointerChords));
const closeButton = computed(() => props.closeButton);
const context: SplitTabsContext = {
  controller: c, root, layer: `#${layerId}`, geometry, anchors, overlayParts, drag, pick, modes, guide, chords, closeButton, focusKeyboard,
  openMenu, canOpenMenu,
  rename: { key: renameKey, allowed: canRename, label: computed(() => props.labels.renameInput),
    commit: (key, title) => emit("command", "rename", c.rename(key, title)) },
  bar: { labels: computed(() => props.stripLabels), tabClass: computed(() => props.tabClass), iconClass: computed(() => props.iconClass), slots },
};
provide(splitTabsKey, context);
function report(command: SplitTabsCommand | "fourFingerHold" | "pinchOut" | "pinchIn", result: SplitTabsResult): void { emit("command", command, result); }
pick.onResult = result => {
  if (result.ok) focusKeyboard(c.focus.value);
  report("move", result);
};
pick.onFocus = focusKeyboard;
function run(command: SplitTabsCommand): void {
  const result = runCommand(context, command);
  if (result !== null) report(command, result);
}
defineExpose({ startExternalDrag: drag.startExternal, run, startRename });

// Geometry of overlays, in root coordinates, measured after each render.
function bump(): void { geometry.value++; drag.refresh(); }
function rectOf(el: Element): PreviewRect {
  const r = el.getBoundingClientRect(), host = root.value!.getBoundingClientRect();
  return { left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height };
}
function attr(value: string): string { return value.replace(/["\\]/g, "\\$&"); }
function paneEl(id: PaneId): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-pane-id="${attr(id)}"]`) ?? null;
}
function union(rects: PreviewRect[]): PreviewRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  return { left, top, width: Math.max(...rects.map(r => r.left + r.width)) - left, height: Math.max(...rects.map(r => r.top + r.height)) - top };
}
// Focus and selection marks live above overlay content (iframes), which covers the panes themselves.
const multi = computed(() => c.panes.value.length > 1);
const focusBox = computed(() => {
  void geometry.value;
  if (!multi.value || root.value === null) return null;
  const el = paneEl(c.focus.value);
  return el === null ? null : { id: c.focus.value, rect: rectOf(el) };
});
const selectedBoxes = computed(() => {
  void geometry.value;
  if (root.value === null) return [];
  return c.selection.value.flatMap(id => { const el = paneEl(id); return el === null ? [] : [{ id, rect: rectOf(el) }]; });
});
const selectionBox = computed(() => {
  void geometry.value;
  const plan = c.plan.value;
  if (plan === null || root.value === null) return null;
  const panes = plan.panes.map(paneEl).filter((el): el is HTMLElement => el !== null).map(rectOf);
  const rect = union(panes);
  if (rect === null) return null;
  // The union may span a neighboring bar (mixed sides). Clip its border and
  // controls to the actual pane rectangles; doubled bridges have zero area.
  const points = ["0px 0px", ...panes.flatMap(p => {
    const x = p.left - rect.left, y = p.top - rect.top, right = x + p.width, bottom = y + p.height;
    return [`${x}px ${y}px`, `${right}px ${y}px`, `${right}px ${bottom}px`, `${x}px ${bottom}px`, `${x}px ${y}px`, "0px 0px"];
  })];
  const corner = panes.reduce((a, b) => b.top < a.top || (b.top === a.top && b.left + b.width > a.left + a.width) ? b : a);
  const close = { top: `${corner.top - rect.top}px`, right: `${rect.left + rect.width - corner.left - corner.width}px` };
  const moved = plan.moved.map(paneEl).filter((el): el is HTMLElement => el !== null).map(rectOf);
  const intruders = plan.intruders.map(paneEl).filter((el): el is HTMLElement => el !== null).map(rectOf);
  return { rect, clipPath: `polygon(${points.join(", ")})`, close, kind: plan.ok ? (plan.kind === "snap" ? "snap" : "ok") : "refused", moved, intruders };
});
const destinationBox = computed(() => {
  void geometry.value;
  const id = pick.destination.value;
  if (id === null || root.value === null) return null;
  const el = paneEl(id) ?? root.value.querySelector(`[data-split-tabs-node="${attr(id)}"]`);
  return el === null ? null : rectOf(el);
});
const nesting = computed(() => {
  void geometry.value;
  if (!modes.arranging.value || root.value === null) return [];
  return [...root.value.querySelectorAll<HTMLElement>(".split-tabs-cut, .split-tabs-frame")]
    .map(el => ({ id: el.dataset.splitTabsNode ?? "", depth: Number(el.dataset.depth ?? 0), rect: rectOf(el) }));
});
// Undo stays offered for undoTimeout after each close, a later close starting the wait again.
let undoTimer: ReturnType<typeof setTimeout> | null = null;
watch([() => c.canUndo.value, () => c.undoSerial.value], ([offered]) => {
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoTimer = offered ? setTimeout(() => { undoTimer = null; c.dropUndo(); }, props.undoTimeout) : null;
});
watch([() => c.layout.value, () => c.selection.value, () => c.focus.value, () => modes.arranging.value], () => { void nextTick(bump); },
  { flush: "post" });

let observer: ResizeObserver | undefined;
let stopShell: (() => void) | null = null;
onMounted(() => {
  if (root.value === null) return;
  if (root.value.clientWidth > 0 && root.value.clientHeight > 0) c.setContainerSize(root.value.clientWidth, root.value.clientHeight);
  stopShell = createShell(context, { keymap: () => props.keymap, exitKeys: () => props.exitKeys,
    arrangeExitKeys: () => props.arrangeExitKeys,
    menu: () => arrangeMenuOpen.value ? closeArrangeMenu : menu.value === null ? null : closeMenu,
    frameOrigins: () => props.frameOrigins, report, capture: policy => emit("capture", policy) });
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry !== undefined) c.setContainerSize(entry.contentRect.width, entry.contentRect.height);
    bump();
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => {
  done();
  observer?.disconnect();
  stopShell?.();
  drag.dispose();
  pick.dispose();
  if (undoTimer !== null) clearTimeout(undoTimer);
  c.setAlwaysShow(false);
});
const zone = computed(() => drag.target.value);
const preview = ref<HTMLElement | null>(null);
/** Root edges the previewed bar touches, for hosts that draw controls over the root's corners. */
const previewEdges = computed(() => {
  const r = zone.value?.reveal?.rect;
  if (r === undefined || root.value === null) return undefined;
  const host = root.value.getBoundingClientRect(), near = (a: number, b: number) => Math.abs(a - b) < 1;
  const edges = [near(r.top, 0) && "top", near(r.left, 0) && "left", near(r.left + r.width, host.width) && "right",
    near(r.top + r.height, host.height) && "bottom"].filter(Boolean);
  return edges.length > 0 ? edges.join(" ") : undefined;
});
let previewObserver: ResizeObserver | undefined;
// WebView 91 predates inert: host slot controls must also leave the tab order there.
watch([preview, () => zone.value?.reveal?.tab], ([el]) => {
  if (el === null) return;
  for (const child of el.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    child.tabIndex = -1;
    if (child.isContentEditable) child.contentEditable = "false";
  }
}, { flush: "post" });
watch(preview, el => {
  previewObserver?.disconnect();
  if (el !== null && typeof ResizeObserver !== "undefined") {
    previewObserver = new ResizeObserver(() => drag.refresh());
    previewObserver.observe(el);
    const item = el.firstElementChild;
    if (item !== null) previewObserver.observe(item);
  }
}, { flush: "post" });
onBeforeUnmount(() => previewObserver?.disconnect());
</script>

<template>
  <div ref="root" class="split-tabs" :class="{
      [`split-tabs--${c.orientation.value ?? 'single'}`]: true,
      'split-tabs--arranging': modes.arranging.value,
      'split-tabs--multi': multi,
      'split-tabs--grab': modes.grab.value,
      'split-tabs--dragging': drag.source.value !== null,
      'split-tabs--resizing': modes.resizing.value,
      'split-tabs--zoomed': c.zoomed.value !== null,
      'split-tabs--picking': pick.mode.value !== null,
    }"
    :style="{ '--split-tabs-divider-size': `${c.dividerSize}px`, '--split-tabs-side-bar-width': `${c.sideBarWidth}px`,
      '--split-tabs-bar-thickness': `${c.barThickness}px` }">
    <SplitLayout :node="c.layout.value" :controller="c" :labels="labels" :depth="0">
      <template v-if="$slots.pane" #pane="scope"><slot name="pane" v-bind="scope" /></template>
      <template v-if="$slots.frame" #frame="scope"><slot name="frame" v-bind="scope" /></template>
    </SplitLayout>
    <div :id="layerId" class="split-tabs-keep-layer" />
    <div class="split-tabs-keep-holder"><slot name="keep" /></div>
    <SplitTabsMenu v-if="menu" ref="menuPanel" :key="menuKey" :controller="c" v-bind="menu"
      :labels="menuLabels ?? {}" :items="menuItems ?? defaultMenuItems"
      :renamable="renamable ?? true" @rename="startRename" @close="menu = null">
      <template v-if="$slots['menu-extra']" #extra="scope"><slot name="menu-extra" v-bind="scope" /></template>
    </SplitTabsMenu>
    <button v-if="modes.arranging.value && !drag.source.value && labels.arrangeMenu" ref="arrangeAnchor" type="button"
      class="split-tabs-bin split-tabs-arrange-menu-button" :aria-label="labels.arrangeMenu" :title="labels.arrangeMenu"
      :aria-expanded="arrangeMenuOpen" @click="arrangeMenuOpen = !arrangeMenuOpen">
      <SplitTabsGlyph kind="move" />
    </button>
    <SplitTabsMenu v-if="arrangeMenuOpen && arrangeAnchor" :controller="c" :tab="c.panes.value.find(p => p.id === c.focus.value)?.view ?? ''"
      :tab-set="c.focus.value" :anchor="arrangeAnchor" :labels="labels.arrangeMenu ? { menu: labels.arrangeMenu } : {}"
      :arrange="{ labels: arrangeMenuLabels ?? {}, items: arrangeMenuItems ?? defaultArrangeMenuItems, run: arrangeAction }" @close="closeArrangeMenu" />
    <div v-for="box in selectedBoxes" :key="`s-${box.id}`" class="split-tabs-selected-mark" aria-hidden="true" :data-pane-of="box.id"
      :style="previewStyle(box.rect)" />
    <div v-if="focusBox" class="split-tabs-focus" aria-hidden="true" :data-pane-of="focusBox.id" :style="previewStyle(focusBox.rect)" />
    <div v-for="box in nesting" :key="box.id" class="split-tabs-nest" aria-hidden="true" :data-depth="box.depth"
      :style="previewStyle(box.rect)" />
    <div v-if="selectionBox" class="split-tabs-selection" :data-kind="selectionBox.kind"
      :style="{ ...previewStyle(selectionBox.rect), clipPath: selectionBox.clipPath }">
      <button v-if="labels.closeSelection" type="button" class="split-tabs-selection-close" :aria-label="labels.closeSelection"
        :title="labels.closeSelection" :style="selectionBox.close" @pointerdown.stop @click.stop="report('close', c.closeTarget())">
        <SplitTabsGlyph kind="close" />
      </button>
    </div>
    <template v-if="selectionBox">
      <div v-for="(r, i) in selectionBox.moved" :key="`m${i}`" class="split-tabs-selection-moved" aria-hidden="true" :style="previewStyle(r)" />
      <div v-for="(r, i) in selectionBox.intruders" :key="`i${i}`" class="split-tabs-selection-intruder" aria-hidden="true"
        :style="previewStyle(r)" />
    </template>
    <div v-if="destinationBox" class="split-tabs-destination" aria-hidden="true" :style="previewStyle(destinationBox)" />
    <div v-if="guide" class="split-tabs-guide" aria-hidden="true" :data-axis="guide.axis"
      :style="guide.axis === 'x' ? { left: `${guide.at - 1}px` } : { top: `${guide.at - 1}px` }" />
    <div v-if="zone?.reveal" ref="preview" class="split-tab-strip split-tabs-bar split-tabs-bar-preview" aria-hidden="true" inert
      :class="{ 'split-tab-strip--vertical': zone.reveal.side === 'left' || zone.reveal.side === 'right',
        'split-tab-strip--drop-target': zone.kind === 'bar' }" :data-side="zone.reveal.side" :data-root-edges="previewEdges"
      :style="previewStyle(zone.reveal.rect)">
      <div class="split-tab-strip-item split-tab-strip-item--active" :data-kind="zone.reveal.tab.kind">
        <span class="split-tab-strip-title split-tab-strip-title--active">
          <span class="split-tab-strip-tab split-tab-strip-tab--active" :class="tabClass">
            <slot name="tab" v-bind="zone.reveal.tab">{{ zone.reveal.tab.title
              ?? (zone.reveal.tab.kind === 'view' ? zone.reveal.tab.id : zone.reveal.tab.views.join('+')) }}</slot>
          </span>
        </span>
      </div>
    </div>
    <div v-if="zone" class="split-tabs-drop-shade" aria-hidden="true" :data-zone="zone.kind"
      :data-side="zone.kind === 'split' ? zone.side : undefined" :data-refused="zone.result.ok ? undefined : ''"
      :data-marker="zone.marker ? '' : undefined" :style="previewStyle(zone.shade)" />
    <div v-if="zone?.newPane" class="split-tabs-drop-shade split-tabs-drop-preview--new" aria-hidden="true"
      :data-refused="zone.result.ok ? undefined : ''" :style="previewStyle(zone.newPane)">{{ labels.newPane }}</div>
    <div v-if="drag.source.value" class="split-tabs-bin" data-split-tabs-bin :data-hot="zone?.kind === 'bin' ? '' : undefined">
      <slot name="bin"><SplitTabsGlyph kind="close" /></slot>
    </div>
    <div v-if="c.canUndo.value && $slots.undo" class="split-tabs-undo">
      <slot name="undo" :undo="() => report('undo', c.undo())" :dismiss="() => c.dropUndo()" />
    </div>
    <div v-if="modes.arranging.value && $slots.arrange" class="split-tabs-arrange">
      <slot name="arrange" :run="run" :done="done" />
    </div>
  </div>
</template>
