import { inject, readonly, ref, watch, type Ref } from "vue";
import type { PaneId, SplitTabsController } from "./controller.js";
import { splitTabsKey } from "./context.js";

export interface SplitTabsPick {
  readonly mode: Readonly<Ref<null | "preview" | "pick">>;
  readonly tab: Readonly<Ref<string | null>>;
  readonly source: Readonly<Ref<PaneId | null>>;
  preview(tabId: string): boolean;
  start(tabId: string): boolean;
  cancel(): void;
  choose(paneId: PaneId): void;
  chooseNumber(n: number): void;
  numberOf(paneId: PaneId): number | null;
}
export interface PanePick extends SplitTabsPick {
  overlays: Set<Element>;
  dispose(): void;
}

export function useSplitTabsPick(): SplitTabsPick | undefined {
  return inject(splitTabsKey, undefined)?.pick;
}

export function createPanePick(controller: SplitTabsController): PanePick {
  const mode = ref<null | "preview" | "pick">(null);
  const tab = ref<string | null>(null);
  const source = ref<PaneId | null>(null);
  const overlays = new Set<Element>();
  let listening = false;
  let disposed = false;
  function unlisten(): void {
    if (!listening) return;
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("pointerdown", pointerdown, true);
    listening = false;
  }
  function cancel(): void {
    unlisten();
    mode.value = null;
    tab.value = null;
    source.value = null;
  }
  function choose(paneId: PaneId): void {
    const id = tab.value;
    if (mode.value === null || id === null || paneId === source.value || !controller.panes.value.some(p => p.id === paneId)) return;
    cancel();
    controller.place(id, paneId, null);
  }
  function chooseNumber(n: number): void {
    const pane = controller.panes.value.find(p => p.index + 1 === n);
    if (pane !== undefined) choose(pane.id);
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      chooseNumber(Number(event.key));
    }
  }
  function pointerdown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && [...overlays].some(overlay => overlay.contains(target))) return;
    cancel();
  }
  function begin(id: string, next: "preview" | "pick"): boolean {
    if (disposed || controller.panes.value.length < 2) return false;
    const pane = controller.panes.value.find(p => p.tabs.includes(id));
    if (pane === undefined) return false;
    unlisten();
    tab.value = id;
    source.value = pane.id;
    mode.value = next;
    if (next === "pick" && typeof window !== "undefined") {
      window.addEventListener("keydown", keydown, true);
      window.addEventListener("pointerdown", pointerdown, true);
      listening = true;
    }
    return true;
  }
  const stop = watch(() => [
    JSON.stringify(controller.panes.value.map(p => p.id)),
    tab.value === null || controller.panes.value.some(p => p.tabs.includes(tab.value!)),
  ] as const, ([ids, visible], previous) => {
    if (mode.value !== null && (!visible || ids !== previous[0])) cancel();
  }, { flush: "sync" });
  return {
    mode: readonly(mode), tab: readonly(tab), source: readonly(source), overlays,
    preview: id => begin(id, "preview"), start: id => begin(id, "pick"), cancel, choose, chooseNumber,
    numberOf(paneId) {
      const pane = controller.panes.value.find(p => p.id === paneId);
      return pane === undefined ? null : pane.index + 1;
    },
    dispose() { cancel(); stop(); overlays.clear(); disposed = true; },
  };
}
