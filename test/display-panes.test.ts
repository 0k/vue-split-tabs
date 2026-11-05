// Acceptance ledger:
// command/API/badges/numbering -> displays visible panes;
// digits/focus/keyboard and down/up isolation -> digit selection;
// exits/other key/timer/pointer -> cancellation paths;
// reentry/disposal/layout changes -> timer/listener lifetime;
// iframe digit policy and keyboard transfer -> frame.test.ts + browser display-panes case.
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { SplitTabs, SplitTabsKeep, useSplitTabsPick } from "../src/index.js";
import type { SplitTabsPick } from "../src/pick.js";
import { controller, key, pointer } from "./helpers.js";

afterEach(() => vi.useRealTimers());
async function fixture() {
  const c = controller();
  c.setContainerSize(800, 600);
  c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
  let pick!: SplitTabsPick;
  const Probe = defineComponent({ setup() { pick = useSplitTabsPick()!; return () => null; } });
  const wrapper = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize" } }, slots: {
    pane: () => h(Probe),
    keep: () => ["a", "b"].map(tab => h(SplitTabsKeep, { tab, part: "body" }, () => h("input", { "data-view": tab }))),
  } });
  await nextTick();
  const api = wrapper.vm as unknown as { run(command: string): void };
  return { c, wrapper, pick, show: () => api.run("displayPanes") };
}
function up(code: string, target: EventTarget = window) {
  const e = new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

it("displayPanes shows numbered badges using the shared picker API and default command binding", async () => {
  const { c, wrapper, pick } = await fixture();
  expect(key({ code: "KeyQ", key: "Q", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  up("KeyQ");
  await nextTick();
  expect(pick.mode.value).toBe("display");
  expect(wrapper.findAll('.split-tabs-pane-number[data-mode="display"] .split-tabs-pane-number-badge').map(b => b.text())).toEqual(["1", "2"]);
  expect(c.panes.value.map(p => pick.numberOf(p.id))).toEqual([1, 2]);
  pick.cancel();
  expect(pick.displayPanes()).toBe(true);
});

it("pane numbers read left to right, then top to bottom even when the layout tree is column-first", async () => {
  const { c, pick, show } = await fixture();
  c.move({ view: "c" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
  c.open("d");
  c.move({ view: "d" }, { kind: "split", target: c.paneOf("b")!, side: "bottom" });
  show();
  expect(["a", "b", "c", "d"].map(view => pick.numberOf(c.paneOf(view)!))).toEqual([1, 2, 3, 4]);
  key({ key: "2", code: "Digit2" });
  up("Digit2");
  expect(c.focus.value).toBe(c.paneOf("b"));
});

it("holding the opening display chord leaves the numbered mode active", async () => {
  const { pick } = await fixture();
  const chord = { code: "KeyQ", key: "Q", altKey: true, shiftKey: true };
  expect(key(chord).defaultPrevented).toBe(true);
  key({ ...chord, repeat: true });
  expect(pick.mode.value).toBe("display");
  up("KeyQ");
  pick.cancel();
});

it("pane rows survive a ten-pixel offset between column dividers", async () => {
  const { c, pick } = await fixture();
  c.move({ view: "c" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
  c.open("d");
  c.move({ view: "d" }, { kind: "split", target: c.paneOf("b")!, side: "bottom" });
  const right = [...c.cuts.value.values()].find(cut => cut.orientation === "rows"
    && cut.second.kind === "pane" && cut.second.pane.view === "d")!;
  c.setRatioLive(0.5 - 10 / (600 - c.dividerSize), right.id);
  pick.displayPanes();
  expect(["a", "b", "c", "d"].map(view => pick.numberOf(c.paneOf(view)!))).toEqual([1, 2, 3, 4]);
});

it("a top frame bar does not number the adjacent pane before the left row", async () => {
  const { c, pick } = await fixture();
  c.move({ view: "c" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
  c.setSelection([c.paneOf("a")!, c.paneOf("c")!]);
  c.tabNext();
  const frame = [...c.tabSets.value.values()].find(set => set.tabs.some(id => c.describe(id)?.kind === "layout"))!;
  c.select(frame.id, frame.tabs.find(id => c.describe(id)?.kind === "layout")!);
  pick.displayPanes();
  expect(["a", "b", "c"].map(view => pick.numberOf(c.paneOf(view)!))).toEqual([1, 2, 3]);
});

it.each(["input", "div"])("digit selection focuses its pane and keyboard without leaking down/up to a %s or window bubble", async tag => {
  const { c, wrapper, show, pick } = await fixture();
  c.focusPane(c.panes.value[0]!.id);
  const target = document.createElement(tag);
  target.contentEditable = "true";
  document.body.append(target);
  const seen = vi.fn();
  for (const type of ["keydown", "keyup"]) { target.addEventListener(type, seen); window.addEventListener(type, seen); }
  try {
    show();
    expect(key({ key: "2", code: "Digit2" }, target).defaultPrevented).toBe(true);
    await nextTick();
    expect(c.focus.value).toBe(c.panes.value[1]!.id);
    expect(up("Digit2", document.activeElement!).defaultPrevented).toBe(true);
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get('input[data-view="b"]').element);
    expect(seen).not.toHaveBeenCalled();
    expect(pick.mode.value).toBeNull();
    expect(key({ key: "2", code: "Digit2" }, target).defaultPrevented).toBe(false);
    expect(up("Digit2", target).defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(4);
  } finally { for (const type of ["keydown", "keyup"]) window.removeEventListener(type, seen); target.remove(); }
});

it.each([{ key: "Escape", code: "Escape" }, { key: "g", code: "KeyG", ctrlKey: true }, { key: "d", code: "KeyD", ctrlKey: true }])
  ("exit $code ends arrange and nested display without changing focus", async init => {
    const { c, wrapper, pick, show } = await fixture();
    const api = wrapper.vm as unknown as { run(command: string): void };
    api.run("arrange");
    const before = c.intent.value, focus = c.focus.value;
    show();
    expect(key(init).defaultPrevented).toBe(true);
    expect(up(init.code).defaultPrevented).toBe(true);
    expect(pick.mode.value).toBeNull();
    expect(c.intent.value).toEqual(before);
    expect(c.focus.value).toBe(focus);
    expect(c.selection.value).toEqual([]);
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--arranging");
  });

it("other keys end display and pass through; invalid digits are consumed without changing focus", async () => {
  const { c, pick, show } = await fixture();
  const focus = c.focus.value;
  show();
  expect(key({ key: "9", code: "Digit9" }).defaultPrevented).toBe(true);
  up("Digit9");
  expect(c.focus.value).toBe(focus);
  show();
  expect(key({ key: "h", code: "KeyH" }).defaultPrevented).toBe(false);
  expect(up("KeyH").defaultPrevented).toBe(false);
  expect(pick.mode.value).toBeNull();
});

it("display timeout defaults to 2000 ms, restarts on reentry, honors the prop, and disposes its timer", async () => {
  vi.useFakeTimers();
  const { wrapper, pick, show } = await fixture();
  show();
  vi.advanceTimersByTime(1999);
  expect(pick.mode.value).toBe("display");
  vi.advanceTimersByTime(1);
  expect(pick.mode.value).toBeNull();
  await wrapper.setProps({ displayPanesTimeout: 75 });
  show();
  vi.advanceTimersByTime(50);
  show();
  vi.advanceTimersByTime(74);
  expect(pick.mode.value).toBe("display");
  vi.advanceTimersByTime(1);
  expect(pick.mode.value).toBeNull();
  show();
  wrapper.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(key({ key: "2", code: "Digit2" }).defaultPrevented).toBe(false);
});

it("replacing display with another picker mode clears the display timer", async () => {
  vi.useFakeTimers();
  const { pick, show } = await fixture();
  show();
  pick.start("a");
  vi.advanceTimersByTime(2000);
  expect(pick.mode.value).toBe("pick");
  expect(vi.getTimerCount()).toBe(0);
});

it("a badge click focuses and hands over the keyboard; other presses and pane changes end display", async () => {
  const { c, wrapper, pick, show } = await fixture();
  show();
  await nextTick();
  await wrapper.findAll('.split-tabs-pane-number[data-mode="display"]')[0]!.trigger("click");
  await nextTick();
  expect(c.focus.value).toBe(c.panes.value[0]!.id);
  expect(document.activeElement).toBe(wrapper.get('input[data-view="a"]').element);
  expect(pick.mode.value).toBeNull();
  show();
  pointer(document.body, "pointerdown");
  expect(pick.mode.value).toBeNull();
  show();
  c.setContainerSize(50, 50);
  expect(pick.mode.value).toBeNull();
});
