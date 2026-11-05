<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { createSplitTabsController, defaultExitKeys, defaultKeymap, defaultPointerChords, SplitTabs,
  SplitTabsAnchor, SplitTabsKeep } from "@0k/vue-split-tabs";
import type { Side, SplitTabsCommand, SplitTabsMenuLabels, SplitTabsReason, SplitTabsResult, SplitTabsStorage } from "@0k/vue-split-tabs";
import { loadOptions, menuChoices, saveOptions } from "./options.js";

const saved = loadOptions();
const options = reactive(saved.options);
const optionsNotice = ref(saved.notice);
watch(options, () => { optionsNotice.value = saveOptions(options); }, { deep: true });
const hostTabs = ref<string[]>([]);
const ready = ref(false);
const surface = ref<InstanceType<typeof SplitTabs> | null>(null);
const status = ref("All numbered views are closable. Layout resets on reload.");
const refused = ref(false);
const keycast = ref("Alt + Shift  /  layout commands");
const closed = ref("");
const keymap = computed(() => options.layoutKeys ? {
  ...defaultKeymap, displayPanes: [...defaultKeymap.displayPanes!, "Shift+Meta+KeyQ"],
} : null);
const pointerChords = computed(() => options.pointerChord === "Alt+Shift" ? { ...defaultPointerChords }
  : { ...defaultPointerChords, toggle: "Ctrl+Alt+Shift", move: "Ctrl+Alt+Shift", rectangle: null });
const focusStyle = computed(() => ({
  "--split-tabs-focus-border": options.focus === "dim" ? "none" : "var(--wb-ring) solid var(--wb-accent)",
  "--split-tabs-unfocused-opacity": String(options.focus === "border" ? 1 : options.opacity),
}));
const stripLabels = { close: "Close tab", resize: "Resize side bar" };
const menuLabels = { menu: "Tab options", right: "Split right", left: "Split left", down: "Split down", up: "Split up",
  inside: "Tab inside", move: "Move to…", otherPane: "Move to the other pane", rename: "Rename tab", close: "Close tab",
  noRoom: "Not enough room", onlyTab: "Nothing to move here" } satisfies SplitTabsMenuLabels;
const menuItems = computed(() => menuChoices.filter(item => options.menuItems.includes(item)));
function sendEventLogs(event?: Event): void {
  const frames = event ? [event.target as HTMLIFrameElement] : [...document.querySelectorAll("iframe")];
  for (const frame of frames) frame.contentWindow?.postMessage({ type: "workbench-event-logs", visible: options.eventLogs }, location.origin);
}
watch(() => options.eventLogs, () => sendEventLogs());
let sequence = 0;
const generation = ref(0);
const records = new Map<string, string>();
const storage: SplitTabsStorage = {
  getItem: key => records.get(key) ?? null,
  setItem: (key, value) => { records.set(key, value); },
  removeItem: key => { records.delete(key); },
};
function createController() {
  return createSplitTabsController({
    tabs: hostTabs, optional: hostTabs, entryKey: "workbench", storageKey: "layout", storage,
    minPaneWidth: 80, minPaneHeight: 70, barThickness: 32, sideBarWidth: 96, placeholderPrefix: "new:", dividerSize: options.dividerSize,
  });
}
const controller = shallowRef(createController());
watch(() => options.dividerSize, async () => {
  ready.value = false;
  controller.value.dispose();
  controller.value = createController();
  generation.value++;
  await nextTick();
  ready.value = true;
  status.value = "Divider changed; layout retained. Iframes and their local logs restarted.";
});
const titles: Record<SplitTabsCommand, string> = {
  focusLeft: "Focus left", focusRight: "Focus right", focusUp: "Focus up", focusDown: "Focus down",
  extendLeft: "Extend left", extendRight: "Extend right", extendUp: "Extend up", extendDown: "Extend down",
  splitRight: "Split right", splitLeft: "Split left", splitBelow: "Split below", splitAbove: "Split above",
  tabNext: "Tab next to", tabInside: "Tabs inside",
  group: "Group", barSide: "Bar side", pick: "Pick letters", move: "Keyboard move", arrange: "Arrange",
  zoom: "Zoom / restore", close: "Close", undo: "Undo", previousTab: "Previous tab", nextTab: "Next tab",
  equalize: "Equal sizes", shrink: "Nudge smaller", grow: "Nudge larger", clear: "Clear", displayPanes: "Display panes",
};
const reasons: Record<SplitTabsReason, string> = {
  "selection-too-small": "Select at least two panes.", "not-groupable": "Selection must form a rectangle; diagonal panes cannot group.",
  "no-room": "Not enough room for another pane.", "into-itself": "Cannot move a layout into itself.",
  "nothing-to-move": "Nothing to move.", "no-bar": "Create a second tab first.", "no-split": "No divider to resize.",
  edge: "No pane in that direction.", zoomed: "Restore the layout first.", "not-zoomed": "The layout is already restored.",
  "fills-area": "This pane already fills the area.", "not-closable": "This view cannot be closed.",
  unknown: "That target is no longer available.", "at-limit": "The divider has reached its limit.",
};
const toolbar: SplitTabsCommand[] = ["group", "tabNext", "tabInside", "splitRight", "splitBelow", "barSide", "zoom", "close", "clear"];
function pretty(chord: string): string {
  return chord.replace(/Key/g, "").replace(/Arrow/g, "").replace("BracketLeft", "[").replace("BracketRight", "]")
    .replace("Equal", "=").replace("Comma", ",").replace("Period", ".");
}
const keys = computed(() => [{ command: "exit", title: "Exit mode", chord: pretty(defaultExitKeys.join(" / ")) },
  ...Object.entries(keymap.value ?? {}).map(([command, chords]) => ({
  command, title: titles[command as SplitTabsCommand], chord: pretty(chords.join(" / ")),
}))]);
const pointerKeys = computed(() => [
  { action: "click", title: "Add / remove pane", chord: pointerChords.value.toggle },
  { action: "drag", title: "Move pane", chord: pointerChords.value.move },
  { action: "click", title: "Select rectangle", chord: pointerChords.value.rectangle },
].filter(binding => binding.chord !== null));
const snapshot = computed(() => JSON.stringify({
  ready: ready.value, options, dividerSize: controller.value.dividerSize, notation: controller.value.notation.value,
  panes: controller.value.panes.value, selection: controller.value.selection.value, focus: controller.value.focus.value,
  focusedView: controller.value.panes.value.find(p => p.id === controller.value.focus.value)?.view,
  zoomed: controller.value.zoomed.value, opened: controller.value.opened.value, intent: controller.value.intent.value,
}));
function fillPlaceholders(): void {
  if (!ready.value) return;
  const c = controller.value;
  const placeholders = [...c.tabSets.value.values()].flatMap(set => set.tabs).filter(id => c.isPlaceholder(id));
  for (const placeholder of new Set(placeholders)) {
    const id = String(++sequence);
    hostTabs.value = [...hostTabs.value, id];
    c.replace(placeholder, id);
  }
}
watch(() => controller.value.notation.value, fillPlaceholders, { flush: "post" });
function result(command: string, outcome: SplitTabsResult): void {
  refused.value = !outcome.ok;
  status.value = outcome.ok ? `${titles[command as SplitTabsCommand] ?? command}: done.` : reasons[outcome.reason];
  const binding = keymap.value?.[command as SplitTabsCommand]?.[0];
  keycast.value = binding ? pretty(binding) : command === "fourFingerHold" ? "Four-finger hold / arrange" : command;
}
function move(view: string, beside: string, side: Side): void {
  const target = controller.value.paneOf(beside);
  if (target === null) throw new Error(`Initial target ${beside} not found`);
  const outcome = controller.value.move({ view }, { kind: "split", target, side });
  if (!outcome.ok) throw new Error(`Initial move failed: ${outcome.reason}`);
}
async function initialize(): Promise<void> {
  ready.value = false;
  sequence = 4;
  hostTabs.value = Array.from({ length: sequence }, (_, i) => String(i + 1));
  for (const id of hostTabs.value) controller.value.open(id);
  move("2", "1", "right"); move("3", "1", "bottom"); move("4", "2", "bottom");
  controller.value.focusPane(controller.value.paneOf("1")!);
  controller.value.dropUndo();
  await nextTick();
  ready.value = true;
}
watch(() => controller.value.opened.value, (now, before) => {
  const removed = before.filter(id => !now.includes(id));
  if (removed.length) closed.value = removed.join(", ");
});
function key(event: KeyboardEvent): void {
  if (!options.layoutKeys) return;
  if (["Alt", "Shift", "Control", "Meta"].includes(event.key)) return;
  keycast.value = pretty([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.code].filter(Boolean).join("+"));
}
function cast(event: Event): void { keycast.value = String((event as CustomEvent).detail); }
function pointer(event: PointerEvent): void {
  if (event.pointerType === "touch") keycast.value = "Touch / hold, tap or drag";
  else if ([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"]
    .filter(Boolean).join("+") === pointerChords.value.toggle) keycast.value = `${options.pointerChord} + click / drag`;
  else if ((event.target as Element).closest(".split-tab-strip-tab")) keycast.value = "Drag label / select tab";
  else if ((event.target as Element).closest('[role="separator"]')) keycast.value = "Drag / double press divider";
}
onMounted(() => {
  window.addEventListener("keydown", key, true);
  window.addEventListener("pointerdown", pointer, true);
  window.addEventListener("workbench-keycast", cast);
  void initialize();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", key, true);
  window.removeEventListener("pointerdown", pointer, true);
  window.removeEventListener("workbench-keycast", cast);
  controller.value.dispose();
});
</script>

<template>
  <main class="workbench" :style="focusStyle">
    <section class="stage" aria-label="Layout workbench">
      <div class="layout-surface">
        <SplitTabs :key="generation" ref="surface" :controller="controller" :pointer-chords="pointerChords"
          :close-button="options.closeButton" :keymap="keymap" :menu-labels="menuLabels" :menu-items="menuItems"
          :always-show="options.oneTabBar === 'always'" :arrange-menu-labels="{ ...titles, restore: 'Restore', done: 'Done', reasons }"
          :labels="{ divider: 'Resize panes', closeSelection: 'Close selection', newPane: 'New pane',
            renameInput: 'Tab name', arrangeMenu: 'Arrange actions' }"
          :strip-labels="stripLabels" @command="result">
          <template #tab="{ id, kind, views, title }">{{ title ?? (kind === 'view' ? id : `Layout ${views.join('+')}`) }}</template>
          <template #pane>
            <SplitTabsAnchor part="body" />
          </template>
          <template #keep>
            <SplitTabsKeep v-for="id in hostTabs" :key="`${generation}:${id}`" :tab="id" part="body" overlay>
              <iframe :title="`View ${id}`" :data-frame="id" :src="`./pane.html?n=${id}`" @load="sendEventLogs" />
            </SplitTabsKeep>
          </template>
          <template #undo="{ undo, dismiss }">
            <div class="undo-toast"><span>Closed {{ closed }} —</span><button type="button" @click="undo">Undo</button>
              <button type="button" aria-label="Dismiss undo" @click="dismiss">Dismiss</button></div>
          </template>
          <template #arrange="{ run, done }">
            <nav class="arrange-toolbar" aria-label="Arrange layout">
              <button v-for="command in toolbar" :key="command" type="button" @click="run(command)">{{ titles[command] }}</button>
              <button type="button" @click="done">Done</button>
            </nav>
          </template>
          <template #bin><span class="bin-label">Drop to<br>close</span></template>
        </SplitTabs>
      </div>
    </section>
    <aside class="side-panel">
      <output class="keycast" aria-label="Last key or gesture">{{ keycast }}</output>
      <section class="library-options" aria-labelledby="options-title">
        <h2 id="options-title">Library options</h2>
        <label>✕ on tabs<select v-model="options.closeButton" aria-label="✕ on tabs">
          <option v-for="mode in ['never', 'active', 'hover', 'always']" :key="mode" :value="mode">{{ mode }}</option>
        </select></label>
        <label>Focus indication<select v-model="options.focus" aria-label="Focus indication">
          <option value="border">border</option><option value="dim">dim others</option><option value="both">both</option>
        </select></label>
        <label class="opacity-option">Unfocused opacity <output>{{ options.opacity.toFixed(2) }}</output>
          <input v-model.number="options.opacity" aria-label="Unfocused opacity" type="range" min="0.2" max="1" step="0.05">
        </label>
        <label>Divider thickness<select v-model.number="options.dividerSize" aria-label="Divider thickness">
          <option v-for="size in [1, 2, 6, 10]" :key="size" :value="size">{{ size }} px</option>
        </select></label>
        <label>Pane mouse chords<select v-model="options.pointerChord" aria-label="Pane mouse chords">
          <option value="Ctrl+Alt+Shift">Ctrl+Alt+Shift</option><option value="Alt+Shift">Alt+Shift</option>
        </select></label>
        <label>One-tab bar<select v-model="options.oneTabBar" aria-label="One-tab bar">
          <option value="hidden">hidden</option><option value="always">always shown</option>
        </select></label>
        <label>Layout keys<input v-model="options.layoutKeys" type="checkbox"></label>
        <label>Event logs<input v-model="options.eventLogs" type="checkbox"></label>
        <fieldset class="menu-options"><legend>Context menu</legend>
          <label v-for="item in menuChoices" :key="item">{{ menuLabels[item] }}
            <input v-model="options.menuItems" type="checkbox" :value="item">
          </label>
        </fieldset>
        <p class="hint">Options saved; layout resets on reload. Divider changes restart iframe logs.</p>
        <p v-if="optionsNotice" class="options-notice" role="status">{{ optionsNotice }}</p>
      </section>
      <h2>Live tree</h2><pre id="notation">{{ controller.notation.value }}</pre>
      <p class="hint">H side by side · V stacked<br>* shown tab · T layout tab</p>
      <p id="status" role="status" :class="{ refused }">{{ status }}</p>
      <h2>Keys <small>physical chords</small></h2>
      <ul id="keys"><li v-for="binding in keys" :key="binding.command"><kbd>{{ binding.chord }}</kbd><span>{{ binding.title }}</span></li></ul>
      <p v-if="!options.layoutKeys" class="hint">Layout keys are off.</p>
      <ul id="pointer-keys"><li v-for="binding in pointerKeys" :key="binding.title">
        <kbd>{{ binding.chord }}+{{ binding.action }}</kbd><span>{{ binding.title }}</span>
      </li></ul>
      <p class="hint">Drag a label to move it. On touch: four-finger hold to arrange, pinch out/in to zoom/restore.
        Arrange long press selects rectangles{{ options.layoutKeys ? '; Ctrl+Alt+Shift+arrows also extend selection.' : '.' }}</p>
      <details><summary>Controller snapshot</summary><pre id="layout-json">{{ snapshot }}</pre></details>
    </aside>
  </main>
</template>
