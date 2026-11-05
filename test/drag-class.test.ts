// M8 acceptance: releasing modifiers rerenders the root without ending drag isolation; cancellation removes it.
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { expect, it } from "vitest";
import { SplitTabs } from "../src/index.js";
import { controller, key, pointer } from "./helpers.js";

// R12-3 ledger: divider/bar press -> modifier rerender retains isolation; up/cancel -> clears it.
it.each(["divider", "bar"])("resizing class survives modifier rerenders for %s and clears on release", async kind => {
  const c = controller(); c.setContainerSize(900, 700);
  if (kind === "divider") c.split("right"); else c.cycleBarSide();
  const w = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize" } } });
  try {
    pointer(w.get(kind === "divider" ? ".split-tabs-divider" : ".split-tab-strip-resize").element, "pointerdown");
    await nextTick();
    expect(w.classes()).toContain("split-tabs--resizing");
    key({ code: "AltLeft", altKey: true, shiftKey: true }); await nextTick();
    expect(w.classes()).toContain("split-tabs--resizing");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "AltLeft" })); await nextTick();
    expect(w.classes()).toContain("split-tabs--resizing");
    pointer(window, kind === "divider" ? "pointerup" : "pointercancel"); await nextTick();
    expect(w.classes()).not.toContain("split-tabs--resizing");
  } finally { w.unmount(); c.dispose(); }
});

it("M8 dragging class survives releasing modifiers and disappears on cancel", async () => {
  const c = controller(); c.setContainerSize(900, 700);
  const w = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize" } } });
  try {
    key({ code: "AltLeft", altKey: true, shiftKey: true }); await nextTick();
    pointer(w.get('[data-split-tabs-tab="a"] .split-tab-strip-tab').element, "pointerdown", { clientX: 40, clientY: 20 });
    pointer(window, "pointermove", { clientX: 60, clientY: 20, altKey: true, shiftKey: true }); await nextTick();
    expect(w.classes()).toContain("split-tabs--dragging");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "AltLeft" })); await nextTick();
    expect(w.classes()).toContain("split-tabs--dragging");
    pointer(window, "pointercancel"); await nextTick();
    expect(w.classes()).not.toContain("split-tabs--dragging");
  } finally { w.unmount(); c.dispose(); }
});
