import { createSplitTabsController, type SplitTabsOptions, type SplitTabsStorage } from "../src/index";
import { vi } from "vitest";

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
  return createSplitTabsController({
    tabs: ["a", "b", "c", "d"], entryKey: "page", storageKey: "layouts",
    storage: storage(), minPaneWidth: 100, minPaneHeight: 80, ...overrides,
  });
}
export function pointer(target: EventTarget, type: string, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: "mouse", ...init }));
}
export function rect(el: Element, width = 606, height = 406) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, width, height));
}
