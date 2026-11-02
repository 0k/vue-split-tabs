<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { createSplitTabsController, SplitTabs, SplitTabStrip, SplitTabsAnchor, SplitTabsKeep } from "@0k/vue-split-tabs";
import type { PaneId } from "@0k/vue-split-tabs";
import Content from "./Content.vue";

const catalog = [
  { id: "notes", label: "Notes" }, { id: "log", label: "Activity" }, { id: "chart", label: "Orbit" }, { id: "guide", label: "Try this" },
  { id: "checklist", label: "Checklist" }, { id: "reference", label: "Reference" },
  { id: "colors", label: "Color study" }, { id: "reading", label: "Reading list" },
];
const labels = { rows: "Top / bottom", cols: "Side by side", close: "Close tab" };
const query = new URLSearchParams(location.search);
const incoming = query.get("incoming");
const optional = ["checklist", "reference", "colors", "reading"].filter(id => id !== incoming);
const hostTabs = ref(catalog.filter(tab => tab.id !== incoming).map(tab => tab.id));
const registrations = ref(0);
const hostActive = ref(query.get("active") ?? "notes");
const controller = createSplitTabsController({
  tabs: hostTabs, optional, entryKey: "fieldwork", storageKey: "split-tabs.demo.fieldwork.v1",
  minPaneWidth: 225, minPaneHeight: 175,
  active: { get: () => hostActive.value, set: id => {
    hostActive.value = id;
    if (query.has("active")) {
      const url = new URL(location.href);
      url.searchParams.set("active", id);
      history.replaceState(null, "", url);
    }
  } },
});
if (!query.has("active") && controller.restoredActive.value) {
  const pane = controller.paneOf(controller.restoredActive.value);
  if (pane !== null) controller.select(pane, controller.restoredActive.value);
}
const splitView = ref<InstanceType<typeof SplitTabs> | null>(null);
const menu = ref<PaneId | null>(null);
const splitButtons = ref(true);
const snapshot = computed(() => JSON.stringify({
  intent: controller.intent.value, panes: controller.panes.value, orientation: controller.orientation.value, fits: controller.fits.value,
  hostActive: hostActive.value,
  registrations: registrations.value,
}, null, 2));
function name(id: string): string { return catalog.find(tab => tab.id === id)?.label ?? id; }
function register(id: string): void {
  if (!hostTabs.value.includes(id)) { registrations.value++; hostTabs.value.push(id); }
}
function open(id: string, pane: PaneId): void { register(id); controller.open(id, pane); menu.value = null; }
function reset(): void {
  menu.value = null;
  controller.merge();
  for (const id of optional) controller.close(id);
  const pane = controller.panes.value[0];
  if (!pane) return;
  for (const tab of catalog.filter(tab => !optional.includes(tab.id))) controller.place(tab.id, pane.id, null);
  controller.commitRatio(0.5);
  controller.select(pane.id, "notes");
  splitButtons.value = true;
}

let cancelPending = () => {};
let suppressClick = false;
let suppressTimer: ReturnType<typeof setTimeout> | undefined;
function external(down: PointerEvent, id: string): void {
  if (down.button !== 0) return;
  cancelPending();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = down.pointerType !== "mouse";
  function stop(): void {
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", escape);
  }
  function handoff(event: PointerEvent): void {
    stop();
    suppressClick = true;
    // Normal sources are pre-registered; ?incoming=colors demonstrates absent nonoptional registration.
    splitView.value?.startExternalDrag(event, id, { label: name(id) }, labels, () => register(id));
  }
  function move(event: PointerEvent): void {
    if (event.pointerId !== down.pointerId || Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) <= 6) return;
    if (touch) stop(); else handoff(event);
  }
  function escape(event: KeyboardEvent): void { if (event.key === "Escape") stop(); }
  if (touch) timer = setTimeout(() => handoff(down), 350);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("keydown", escape);
  cancelPending = stop;
}
function sourceClick(event: MouseEvent, id: string): void {
  if (suppressClick && event.detail > 0) { event.preventDefault(); suppressClick = false; return; }
  const pane = controller.panes.value[0];
  if (pane) open(id, pane.id);
}
function release(): void {
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => { suppressClick = false; }, 0);
}
window.addEventListener("pointerup", release);
function dismissMenu(event: KeyboardEvent): void { if (event.key === "Escape") menu.value = null; }
window.addEventListener("keydown", dismissMenu);
onBeforeUnmount(() => {
  cancelPending();
  clearTimeout(suppressTimer);
  window.removeEventListener("pointerup", release);
  window.removeEventListener("keydown", dismissMenu);
  controller.dispose();
});
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div class="brand"><span class="brand-mark">f.</span><div><h1>Fieldwork</h1><p>A little space for your ideas.</p></div></div>
      <span class="package-name">@0k/vue-split-tabs <span>PLAYGROUND</span></span>
      <button class="button" type="button" @click="reset">Reset layout</button>
    </header>
    <section class="workspace" aria-label="Split tabs playground">
      <aside class="collection">
        <p class="eyebrow">YOUR COLLECTION</p><h2>Bring an idea in.</h2>
        <p class="muted">Drag an item onto a tab strip or a workspace edge.</p>
        <button v-for="id in ['colors', 'reading']" :key="id" class="source-card" type="button" :aria-label="`Drag ${name(id)}`"
          @pointerdown="external($event, id)" @click="sourceClick($event, id)">
          <span class="source-symbol">{{ id === 'colors' ? '◒' : '≋' }}</span><strong>{{ name(id) }}</strong><small>Drag to explore ↗</small>
        </button>
        <p class="collection-tip"><span class="status-dot"/> Layout saved locally<br><span>No account. No network.</span></p>
      </aside>
      <section class="studio" :class="{ 'studio--rows': controller.orientation.value === 'rows' }" aria-label="Workspace">
        <header class="workspace-toolbar"><span>THE WORKSPACE <small>{{ controller.panes.value.length }} pane(s)</small></span>
          <button v-if="controller.isSplit.value" class="button quiet" type="button" @click="controller.merge()">Merge panes</button>
          <label><input v-model="splitButtons" type="checkbox"> Show split buttons</label>
        </header>
        <div class="layout-surface">
          <SplitTabs ref="splitView" :controller="controller" :labels="{ divider: 'Resize panes' }">
            <template #pane="{ pane }">
              <SplitTabStrip :controller="controller" :pane="pane.id" :labels="labels" :split-buttons="splitButtons" always-show>
                <template #tab="{ id }">{{ name(id) }}</template>
                <template #end><button class="add-button" type="button" aria-label="Open tab menu" :aria-expanded="menu === pane.id"
                  @click="menu = menu === pane.id ? null : pane.id">+</button></template>
              </SplitTabStrip>
              <SplitTabsAnchor part="body" />
            </template>
            <template #keep>
              <SplitTabsKeep v-for="tab in catalog" :key="tab.id" :tab="tab.id" part="body">
                <Content :id="tab.id" @replace="controller.replace('checklist', 'reference')" />
              </SplitTabsKeep>
            </template>
          </SplitTabs>
          <nav v-if="menu !== null" class="add-menu" aria-label="Additional tabs" role="menu" @keydown.esc="menu = null">
            <p class="eyebrow">OPEN A LITTLE MORE</p>
            <button v-for="id in optional" :key="id" role="menuitem" type="button" @click="open(id, menu)">{{ name(id) }} <span>↗</span></button>
          </nav>
        </div>
      </section>
    </section>
    <footer class="app-footer"><span>Drag to arrange. Hold to drag on touch. Make room to think.</span><span>Built with Vue 3 · Made to move</span></footer>
    <details class="inspector"><summary>Layout inspector</summary><pre id="layout-json">{{ snapshot }}</pre></details>
  </main>
</template>
