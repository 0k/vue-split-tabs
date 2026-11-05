// Picking panes from the keyboard.  Three modes share one overlay per pane:
// - `pick` / `preview`: numbers; choosing a pane moves one tab there (and shows it);
// - `select`: letters; each letter adds or removes that pane from the selection;
// - `move`: letters pick a destination for the selection (or the focused pane),
//   Alt+Up / Alt+Down widen or narrow it to the layouts around it, an arrow
//   splits on that side, Enter drops it inside (like a drop in the middle).
import { computed, inject, readonly, ref, watch, type Ref } from "vue";
import type { PaneId, SplitTabsController, SplitTabsResult, SplitTabsSource } from "./controller.js";
import type { Side } from "./model.js";
import { splitTabsKey } from "./context.js";
import { menuSource } from "./menu.js";
import { modifiersOf } from "./keymap.js";
import type { EffectiveNode, SplitTabsPane } from "./projection.js";

export type PickMode = "preview" | "pick" | "select" | "move" | "display";
export interface SplitTabsPick {
  readonly mode: Readonly<Ref<PickMode | null>>;
  /** The tab a `pick` moves. */
  readonly tab: Readonly<Ref<string | null>>;
  readonly source: Readonly<Ref<PaneId | null>>;
  /** Keyboard move: the destination, a pane or a layout around it. */
  readonly destination: Readonly<Ref<string | null>>;
  preview(tabId: string): boolean;
  start(tabId: string): boolean;
  /** Letters toggle panes in the selection; Enter or the root's exit keys end it. */
  select(): boolean;
  /** Move the selection (or the focused pane) by keyboard. */
  keyboardMove(): boolean;
  /** Show visible pane numbers temporarily; digits or a badge focus a pane. */
  displayPanes(): boolean;
  cancel(): void;
  choose(paneId: PaneId): void;
  chooseNumber(n: number): void;
  numberOf(paneId: PaneId): number | null;
  letterOf(paneId: PaneId): string | null;
}
export interface PanePick extends SplitTabsPick {
  overlays: Set<Element>;
  /** Called with each keyboard-move result, for the host's messages. */
  onResult: ((result: SplitTabsResult) => void) | null;
  onFocus: ((pane: PaneId) => void) | null;
  dispose(): void;
}
// Q is reserved for leaving arrange mode, including when hosts customize its exits.
const LETTERS = "abcdefghijklmnoprstuvwxyz";
const ARROW_SIDE: Record<string, Side> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };

export function useSplitTabsPick(): SplitTabsPick | undefined {
  return inject(splitTabsKey, undefined)?.pick;
}

export function createPanePick(controller: SplitTabsController, displayTimeout: () => number = () => 2000): PanePick {
  const mode = ref<PickMode | null>(null);
  const tab = ref<string | null>(null);
  const source = ref<PaneId | null>(null);
  const chain = ref<string[] | null>(null);
  const level = ref(0);
  let carried: SplitTabsSource | null = null;
  const overlays = new Set<Element>();
  let listening = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const self: PanePick = {} as PanePick;
  // Numeric badges read across rows, independent of the cut tree's traversal order.
  const numbered = computed(() => {
    const positioned: { pane: SplitTabsPane; x: number; y: number }[] = [];
    function visit(node: EffectiveNode, x: number, y: number): void {
      if (node.kind === "pane") positioned.push({ pane: node.pane, x, y });
      else if (node.kind === "frame") {
        const f = node.frame;
        visit(node.content, x + (f.showsBar && f.side === "left" ? f.barWidth : 0),
          y + (f.showsBar && f.side === "top" ? controller.barThickness : 0));
      } else {
        const cols = node.orientation === "cols", divider = controller.dividerSize;
        const offset = ((cols ? node.width : node.height) - divider) * node.ratio + divider;
        visit(node.first, x, y);
        visit(node.second, x + (cols ? offset : 0), y + (cols ? 0 : offset));
      }
    }
    visit(controller.layout.value, 0, 0);
    const rows: typeof positioned[] = [];
    let band = -Infinity;
    for (const pane of positioned.sort((a, b) => a.y - b.y || a.x - b.x)) {
      // Anchor each row at its first pane's midpoint, not at an exact top edge.
      if (pane.y >= band) { rows.push([]); band = pane.y + pane.pane.height / 2; }
      rows[rows.length - 1]!.push(pane);
    }
    return rows.flatMap(row => row.sort((a, b) => a.x - b.x || a.y - b.y).map(p => p.pane));
  });
  function unlisten(): void {
    if (!listening) return;
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("pointerdown", pointerdown, true);
    listening = false;
  }
  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unlisten();
    mode.value = null;
    tab.value = null;
    source.value = null;
    chain.value = null;
    level.value = 0;
    carried = null;
  }
  function paneAt(letter: string): PaneId | null {
    const at = LETTERS.indexOf(letter.toLowerCase());
    return at < 0 ? null : controller.panes.value[at]?.id ?? null;
  }
  function choose(paneId: PaneId): void {
    if (mode.value === "display") {
      if (!controller.panes.value.some(p => p.id === paneId)) return;
      cancel();
      controller.focusPane(paneId);
      self.onFocus?.(paneId);
      return;
    }
    if (mode.value === "select") {
      controller.toggleSelected(paneId);
      return;
    }
    if (mode.value === "move") {
      chain.value = controller.scopes(paneId);
      level.value = 0;
      return;
    }
    const id = tab.value;
    if (mode.value === null || id === null || paneId === source.value || !controller.panes.value.some(p => p.id === paneId)) return;
    const src = menuSource(controller, id);
    if (!controller.canMove(src, { kind: "bar", target: paneId, index: null }).ok) return;
    cancel();
    controller.move(src, { kind: "bar", target: paneId, index: null });
  }
  function chooseNumber(n: number): void {
    const pane = numbered.value[n - 1];
    if (pane !== undefined) choose(pane.id);
  }
  function keydown(event: KeyboardEvent): void {
    if (event.target instanceof Element && event.target.closest(".split-tab-strip-rename")) return;
    if (mode.value === "display") return; // Its digits and passthrough keys belong to the unified modal capture.
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    if (mode.value === "select" && event.key === "Enter") { stop(); cancel(); return; }
    const plain = ["", "Shift"].includes(modifiersOf(event)) && !event.getModifierState("AltGraph");
    if ((mode.value === "pick" || mode.value === "preview") && /^[1-9]$/.test(event.key)) { stop(); chooseNumber(Number(event.key)); return; }
    if (mode.value === "select" || (mode.value === "move" && chain.value === null)) {
      if (!plain || event.key.length !== 1) return;
      const pane = paneAt(event.key);
      if (pane !== null) { stop(); choose(pane); }
      return;
    }
    if (mode.value !== "move" || chain.value === null || carried === null) return;
    const grow = (event.altKey && event.key === "ArrowUp") || event.key === "PageUp";
    const shrink = (event.altKey && event.key === "ArrowDown") || event.key === "PageDown";
    if (grow || shrink) {
      stop();
      level.value = Math.max(0, Math.min(chain.value.length - 1, level.value + (grow ? 1 : -1)));
      return;
    }
    const dest = chain.value[level.value]!;
    const side = ARROW_SIDE[event.key];
    let result: SplitTabsResult | null = null;
    if (side !== undefined && !event.altKey) result = controller.move(carried, { kind: "split", target: dest, side });
    else if (event.key === "Enter") result = controller.move(carried, { kind: "inside", target: dest });
    if (result === null) return;
    stop();
    self.onResult?.(result);
    if (result.ok) cancel();
  }
  function pointerdown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && [...overlays].some(overlay => overlay.contains(target))) return;
    cancel();
  }
  function listen(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pointerdown", pointerdown, true);
    listening = true;
  }
  function begin(id: string, next: "preview" | "pick"): boolean {
    if (disposed || controller.panes.value.length < 2) return false;
    const pane = [...controller.tabSets.value.values()].find(p => p.tabs.includes(id));
    if (pane === undefined) return false;
    cancel();
    tab.value = id;
    source.value = pane.id;
    mode.value = next;
    if (next === "pick") listen();
    return true;
  }
  const stop = watch(() => [
    JSON.stringify(controller.panes.value.map(p => p.id)),
    tab.value === null || [...controller.tabSets.value.values()].some(p => p.tabs.includes(tab.value!)),
  ] as const, ([ids, visible], previous) => {
    if ((mode.value === "pick" || mode.value === "preview" || mode.value === "display") && (!visible || ids !== previous[0])) cancel();
  }, { flush: "sync" });
  Object.assign(self, {
    mode: readonly(mode), tab: readonly(tab), source: readonly(source), overlays, onResult: null, onFocus: null,
    destination: computed(() => chain.value === null ? null : chain.value[level.value] ?? null),
    preview: (id: string) => begin(id, "preview"), start: (id: string) => begin(id, "pick"),
    select() {
      if (disposed) return false;
      cancel();
      mode.value = "select";
      listen();
      return true;
    },
    keyboardMove() {
      if (disposed) return false;
      cancel();
      carried = controller.selection.value.length > 1 ? { selection: true } : { node: controller.focus.value };
      mode.value = "move";
      listen();
      return true;
    },
    displayPanes() {
      if (disposed) return false;
      const timeout = displayTimeout();
      if (!Number.isFinite(timeout) || timeout < 0) throw new Error("split-tabs: displayPanesTimeout must be a finite non-negative number");
      cancel();
      mode.value = "display";
      listen();
      timer = setTimeout(cancel, timeout);
      return true;
    },
    cancel, choose, chooseNumber,
    numberOf(paneId: PaneId) {
      const index = numbered.value.findIndex(p => p.id === paneId);
      return index < 0 ? null : index + 1;
    },
    letterOf(paneId: PaneId) {
      const pane = controller.panes.value.find(p => p.id === paneId);
      return pane === undefined || pane.index >= LETTERS.length ? null : LETTERS[pane.index]!;
    },
    dispose() { cancel(); stop(); overlays.clear(); disposed = true; },
  });
  return self;
}
