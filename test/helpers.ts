import { createSplitTabsController, type SplitTabsOptions, type SplitTabsStorage, type PaneId } from "../src/index";
import { computed, readonly } from "vue";
import { vi } from "vitest";

export type PaneIndex = number;

export const labels = { rows: "Top / bottom", cols: "Side by side", sendToOther: "Move tab" };
export function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  } satisfies SplitTabsStorage & { values: Map<string, string> };
}
export function controller(overrides: Partial<SplitTabsOptions> = {}) {
  const c = createSplitTabsController({
    tabs: ["a", "b", "c", "d"], entryKey: "page", storageKey: "layouts",
    storage: storage(), minPaneWidth: 100, minPaneHeight: 80, ...overrides,
  });
  // Preserve the pre-tree behavioral fixtures: numeric positions resolve to the
  // current stable ids at the action boundary. The recursive suite uses the public
  // controller directly and verifies the full new model without this projection.
  const paneId = (pane: PaneId | number): PaneId => typeof pane === "string" ? pane : c.panes.value[pane]?.id ?? "invalid-pane";
  const methods = {
    select: c.select, place: c.place, open: c.open, insert: c.insert, moveTo: c.moveTo,
  };
  const intent = c.intent;
  const panes = c.panes;
  const projected = computed(() => {
    const value = intent.value;
    const tree = value.tree;
    const all = (node: typeof tree): string[] => node.kind === "pane" ? [...node.tabs] : [...all(node.first), ...all(node.second)];
    const last = (node: typeof tree): string => node.kind === "pane" ? node.active : last(node.first);
    const old = { orientation: tree.kind === "cut" ? tree.orientation : null, firstActive: value.firstActive,
      order: value.order, opened: value.opened, ratio: value.ratio,
      second: tree.kind === "cut" ? all(tree.second) : [], secondActive: tree.kind === "cut" ? last(tree.second) : "" };
    return readonly(Object.defineProperty(old, "tree", { value: tree }) as typeof old & { tree: typeof tree });
  });
  return Object.assign(c, {
    intent: projected,
    panes: computed(() => panes.value.map(pane => {
      const value = { index: pane.index, tabs: pane.tabs, active: pane.active };
      return Object.defineProperties(value, Object.fromEntries(["id", "width", "height", "fits"].map(key =>
        [key, { value: pane[key as keyof typeof pane] }])) ) as typeof pane;
    })),
    select(pane: PaneId | number, id: string) { methods.select(paneId(pane), id); },
    open(id: string, pane: PaneId | number) { methods.open(id, typeof pane === "number" && !c.isSplit.value ? paneId(0) : paneId(pane)); },
    insert(id: string, pane: PaneId | number, before: string | null, register?: () => void) {
      methods.insert(id, paneId(pane), before, register);
    },
    place(id: string, pane: PaneId | number, before: string | null) { methods.place(id, paneId(pane), before); },
    moveTo(id: string, pane: PaneId | number) { methods.moveTo(id, paneId(pane)); },
    moveToOther(id: string) {
      const source = c.panes.value.find(p => p.id === c.paneOf(id));
      if (source !== undefined) methods.moveTo(id, paneId(source.index === 0 ? 1 : 0));
    },
  });
}
export function pointer(target: EventTarget, type: string, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: "mouse", ...init }));
}
export function rect(el: Element, width = 606, height = 406) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, width, height));
}
