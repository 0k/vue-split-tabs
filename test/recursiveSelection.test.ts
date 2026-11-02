import { expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSplitTabsController } from "../src/index.js";
import { storage } from "./helpers.js";

it("secondary selections preserve empty host state and an exact existing deep link", () => {
  const active = ref("");
  const set = vi.fn((id: string) => { active.value = id; });
  const saved = storage();
  const c = createSplitTabsController({ tabs: ["a", "b", "c"], entryKey: "selection", storageKey: "selection", storage: saved,
    minPaneWidth: 100, minPaneHeight: 80, active: { get: () => active.value, set } });
  c.setContainerSize(606, 406);
  c.split("b", "cols");
  c.select(c.paneOf("b")!, "b");
  expect(active.value, "Expected host's empty navigation state untouched").toBe("");
  expect(set).not.toHaveBeenCalled();
  active.value = "b";
  saved.setItem.mockClear();
  c.select(c.paneOf("b")!, "b");
  expect(active.value, "Expected exact existing deep link retained").toBe("b");
  expect(set).not.toHaveBeenCalled();
  expect(saved.setItem).not.toHaveBeenCalled();
  c.dispose();
});

it("an invalid destination pane id cannot focus an already-visible tab through open", () => {
  const saved = storage();
  const c = createSplitTabsController({ tabs: ["a", "b"], entryKey: "selection", storageKey: "selection", storage: saved,
    minPaneWidth: 100, minPaneHeight: 80 });
  c.open("b", "not-a-pane");
  expect(c.panes.value[0]!.active, "Expected invalid pane boundary to reject the open before selecting b").toBe("a");
  expect(saved.setItem).not.toHaveBeenCalled();
  c.dispose();
});
