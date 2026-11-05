// Specification of the components in jsdom: bars, gestures on labels, the
// keymap, pane covers, pick modes and content that never remounts.  Real
// browser input (touch compositor, iframes) is covered by test/browser.mjs.
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  SplitTabs, SplitTabsAnchor, SplitTabsKeep, SplitTabStrip, defaultKeymap, defaultPointerChords, type SplitTabsKeymap, type SplitTabsPointerChords,
} from "../src/index";
import { controller, key, pointer, storage } from "./helpers";

afterEach(() => vi.useRealTimers());

// Vue drops an event dispatched in the same millisecond its listener was attached: let time pass after mounting.
async function settle(): Promise<void> {
  await nextTick();
  if (vi.isFakeTimers()) vi.advanceTimersByTime(2); else await new Promise(resolve => setTimeout(resolve, 2));
}
async function fixture(options: { tabs?: string[]; keymap?: SplitTabsKeymap | null; overlay?: boolean;
  pointerChords?: SplitTabsPointerChords; iframes?: boolean; optional?: string[]; closeButton?: "never" | "active" | "hover" | "always" } = {}) {
  const s = storage();
  const c = controller({ storage: s, ...(options.tabs ? { tabs: options.tabs } : {}), ...(options.optional ? { optional: options.optional } : {}) });
  c.setContainerSize(600, 400);
  const commands: [string, unknown][] = [];
  const wrapper = mount(SplitTabs, {
    attachTo: document.body,
    props: {
      controller: c, labels: { divider: "Resize", closeSelection: "Close selection" }, stripLabels: { close: "Close" },
      ...(options.keymap !== undefined ? { keymap: options.keymap } : {}),
      ...(options.pointerChords !== undefined ? { pointerChords: options.pointerChords } : {}),
      ...(options.closeButton !== undefined ? { closeButton: options.closeButton } : {}),
      onCommand: (name: string, result: unknown) => { commands.push([name, result]); },
    },
    slots: {
      keep: () => (options.tabs ?? ["a", "b", "c", "d"]).map(tab =>
        h(SplitTabsKeep, { key: tab, tab, part: "body", overlay: options.overlay ?? false },
          () => options.iframes ? h("iframe", { "data-tab": tab }) : h("div", { class: "content", "data-tab": tab }, tab))),
    },
  });
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  await settle();
  return { c, s, wrapper, commands };
}
async function stripFixture() {
  const f = await fixture();
  const strip = f.wrapper.get<HTMLElement>(".split-tab-strip");
  vi.spyOn(strip.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 30));
  const items = strip.findAll(".split-tab-strip-item");
  items.forEach((item, i) => vi.spyOn(item.element, "getBoundingClientRect").mockReturnValue(new DOMRect(i * 80, 0, 80, 30)));
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: (x: number) => {
      const item = items[Math.min(items.length - 1, Math.floor(x / 80))];
      return item ? [item.element, strip.element] : [strip.element];
    },
  });
  return { ...f, strip, items, button: strip.get(".split-tab-strip-tab") };
}
const shown = (el: { element: Element }) => (el.element as HTMLElement).style.display !== "none";

describe("native multi-touch ownership", () => {
  it.each([false, true])("shell reuses a lifted touch id after %s omission snapshots, even after pointercancel", async omit => {
    vi.useFakeTimers();
    const { wrapper, commands } = await fixture();
    const target = wrapper.get(".content").element;
    const points = [50, 100, 150, 200].map((x, identifier) => ({ identifier, target, clientX: x, clientY: 100 }));
    const send = (type: string, ids: number[], changed = ids) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: ids.map(i => points[i]!) as unknown as Touch[],
      changedTouches: changed.map(i => points[i]!) as unknown as Touch[],
    }));
    send("touchstart", [0, 1]);
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 99, clientX: 100, clientY: 100 });
    if (omit) send("touchend", [0], [1]);
    send("touchstart", [0, 1], [1]);
    pointer(window, "pointercancel", { pointerType: "touch", pointerId: 100 });
    send("touchstart", [0, 1, 2], [2]);
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    send("touchstart", [0, 1, 2, 3], [3]);
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
    send("touchend", []);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["pointerup", "pointercancel", "silence", "unmount"])("provisional-only fingers hold and clean up on %s", async end => {
    vi.useFakeTimers();
    const { wrapper, commands } = await fixture();
    const target = wrapper.get(".content").element;
    for (let n = 1; n <= 4; n++) pointer(target, "pointerdown", {
      pointerId: n, pointerType: "touch", isPrimary: n === 1, clientX: 100 + n * 20, clientY: 100,
    });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
    key({ code: "Escape", key: "Escape" });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape", key: "Escape" }));
    if (end === "unmount") wrapper.unmount();
    else if (end === "silence") vi.advanceTimersByTime(2500);
    else for (let n = 1; n <= 4; n++) pointer(window, end, { pointerId: n, pointerType: "touch" });
    await nextTick();
    expect(document.querySelector(".split-tabs-pane-cover")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("touch snapshots replace provisional fingers without double counting and survive pointercancel", async () => {
    vi.useFakeTimers();
    const { wrapper, commands } = await fixture();
    const target = wrapper.get(".content").element;
    for (let n = 0; n < 2; n++) pointer(target, "pointerdown", {
      pointerId: n + 1, pointerType: "touch", clientX: 150 + (n ? 30 : -30), clientY: 120,
    });
    touch(target, "touchstart", 2);
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    for (let n = 1; n <= 2; n++) pointer(window, "pointercancel", { pointerId: n, pointerType: "touch" });
    touch(target, "touchstart", 4);
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
    touch(target, "touchend", 0);
    key({ code: "Escape", key: "Escape" });
  });
  it("a fourth finger on a gesture cover never changes focus or storage", async () => {
    const { c, s, wrapper } = await fixture();
    c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
    await nextTick();
    const focus = c.focus.value;
    touch(wrapper.get(".content").element, "touchstart", 3);
    await settle();
    const writes = s.setItem.mock.calls.length;
    const other = wrapper.findAll("[data-pane-id]").find(p => p.attributes("data-pane-id") !== focus)!;
    pointer(other.get(".split-tabs-pane-cover").element, "pointerdown", { pointerId: 999, pointerType: "touch" });
    expect(c.focus.value).toBe(focus);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });
  function touch(target: EventTarget, type: string, count: number, spread = 30) {
    const touches = Array.from({ length: count }, (_, i) => ({ identifier: i + 304, target,
      clientX: 150 + (i % 2 ? spread : -spread), clientY: 150 + (i < 2 ? -spread : spread) }));
    const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches as unknown as Touch[] });
    target.dispatchEvent(event);
    return event;
  }
  async function cancelledSequence() {
    vi.useFakeTimers();
    const f = await fixture();
    f.c.move({ view: "b" }, { kind: "split", target: f.c.panes.value[0]!.id, side: "right" });
    await nextTick();
    const target = f.wrapper.get(".content").element;
    for (let n = 1; n <= 4; n++) {
      touch(target, "touchstart", n);
      pointer(target, "pointerdown", { pointerId: n + 303, pointerType: "touch", isPrimary: n === 1 });
      vi.advanceTimersByTime(2);
    }
    vi.advanceTimersByTime(42);
    for (let n = 1; n <= 4; n++) pointer(target, "pointercancel", { pointerId: n + 303, pointerType: "touch" });
    return { ...f, target };
  }
  it("touch ownership stays inside its root for hold, pinch and gesture covers", async () => {
    vi.useFakeTimers();
    const a = await fixture(), b = await fixture();
    for (const f of [a, b]) f.c.move({ view: "b" }, { kind: "split", target: f.c.focus.value, side: "right" });
    await nextTick();
    const target = a.wrapper.get(".content").element;
    for (let n = 1; n <= 4; n++) touch(target, "touchstart", n);
    await nextTick();
    expect(a.wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    expect(b.wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(a.commands).toEqual([["fourFingerHold", { ok: true }]]);
    expect(b.commands).toEqual([]);
    touch(target, "touchend", 0);
    touch(target, "touchstart", 4);
    touch(target, "touchmove", 4, 60);
    expect(a.c.zoomed.value).not.toBeNull();
    expect(b.c.zoomed.value).toBeNull();
    touch(target, "touchend", 0);
  });
  it("outside and mixed-root touches never combine into a layout gesture", async () => {
    vi.useFakeTimers();
    const a = await fixture(), b = await fixture();
    const outside = document.createElement("div");
    document.body.append(outside);
    for (let n = 1; n <= 4; n++) expect(touch(outside, "touchstart", n).defaultPrevented).toBe(false);
    expect(touch(outside, "touchmove", 4).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    await nextTick();
    for (const f of [a, b]) {
      expect(f.commands).toEqual([]);
      expect(f.wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    }
    touch(outside, "touchend", 0);
    const targets = [a.wrapper.get(".content").element, b.wrapper.get(".content").element, outside];
    const touches = targets.map((target, identifier) => ({ target, identifier, clientX: 150, clientY: 150 }));
    for (const type of ["touchstart", "touchmove"]) {
      const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches as unknown as Touch[] });
      targets[0]!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await nextTick();
    for (const f of [a, b]) expect(f.wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    touch(outside, "touchend", 0);
  });
  it("Android cancellation at +50ms preserves continuing touches through the 500ms hold", async () => {
    const { wrapper, target, commands } = await cancelledSequence();
    for (let i = 0; i < 46; i++) { touch(target, "touchmove", 4); vi.advanceTimersByTime(10); }
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--arranging");
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
  });
  it("pinch out and in still zoom and restore after pointer cancellation", async () => {
    const { c, target } = await cancelledSequence();
    touch(target, "touchmove", 4, 60);
    expect(c.zoomed.value).not.toBeNull();
    touch(target, "touchend", 0);
    touch(target, "touchstart", 4, 60);
    for (let n = 1; n <= 4; n++) pointer(target, "pointercancel", { pointerId: n + 303, pointerType: "touch" });
    touch(target, "touchmove", 4, 25);
    expect(c.zoomed.value).toBeNull();
  });
  it("claims starts/moves from three fingers, keeps covers until zero, and removes listeners on unmount", async () => {
    const { wrapper } = await fixture({ overlay: true, iframes: true });
    const target = wrapper.get(".split-tabs-pane").element;
    for (const n of [1, 2, 3, 4]) {
      for (const phase of ["touchstart", "touchmove"]) expect(touch(target, phase, n).defaultPrevented).toBe(n >= 3);
      await nextTick();
      expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(n >= 3);
    }
    for (const n of [3, 2, 1, 0]) {
      touch(target, "touchend", n);
      expect(touch(target, "touchmove", n).defaultPrevented).toBe(n >= 3);
      await nextTick();
      expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(n > 0);
    }
    wrapper.unmount();
    expect(touch(window, "touchmove", 4).defaultPrevented).toBe(false);
  });
});

describe("tab bars", () => {
  it("a bar with one tab is hidden; it shows from two tabs", async () => {
    const one = await fixture({ tabs: ["a"] });
    expect(shown(one.wrapper.get(".split-tab-strip"))).toBe(false);
    const two = await fixture({ tabs: ["a", "b"] });
    expect(shown(two.wrapper.get(".split-tab-strip"))).toBe(true);
  });

  it("a bar turned to the left is vertical, sized by its width, and resizable", async () => {
    const { c, wrapper } = await fixture();
    c.cycleBarSide();
    await nextTick();
    const strip = wrapper.get<HTMLElement>(".split-tab-strip");
    expect(strip.classes()).toContain("split-tab-strip--vertical");
    expect(strip.element.style.width).toBe("96px");
    expect(wrapper.get(".split-tabs-pane").attributes("data-side")).toBe("left");
    expect(strip.find(".split-tab-strip-resize").exists()).toBe(true);
  });

  it("a first press on a side bar's resize edge resizes even right after load; a double press restores the default", async () => {
    const { c, wrapper } = await fixture();
    c.cycleBarSide();
    await nextTick();
    const handle = wrapper.get(".split-tab-strip-resize").element;
    const at = (type: string, x: number, timeStamp: number) => {
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: "mouse", clientX: x });
      Object.defineProperty(e, "timeStamp", { value: timeStamp });
      (type === "pointerdown" ? handle : window).dispatchEvent(e);
    };
    at("pointerdown", 96, 10);
    at("pointermove", 148, 20);
    at("pointerup", 148, 30);
    expect(c.tabSet(c.panes.value[0]!.id)!.barWidth).toBe(148);
    at("pointerdown", 148, 1000);
    at("pointerup", 148, 1010);
    at("pointerdown", 148, 1100);
    expect(c.tabSet(c.panes.value[0]!.id)!.barWidth).toBe(96);
  });

  it("clicking a label shows that tab and makes its bar the one T and R act on", async () => {
    const { c, wrapper } = await fixture();
    await wrapper.findAll(".split-tab-strip-tab")[2]!.trigger("click");
    expect(c.panes.value[0]!.view).toBe("c");
    expect(c.barFocus.value).toBe(c.panes.value[0]!.id);
    expect(wrapper.get(".split-tab-strip").classes()).toContain("split-tab-strip--bar-focus");
  });

  it("labels are ordinary named buttons with pressed state; layout tabs list their views", async () => {
    const { c, wrapper } = await fixture();
    const button = wrapper.get(".split-tab-strip-tab");
    expect(wrapper.find("[role=tablist]").exists()).toBe(false);
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.text()).toBe("a");
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(button.attributes("aria-label")).toBeUndefined();
    c.move({ view: "b" }, { kind: "split", target: c.panes.value[0]!.id, side: "right" });
    c.focusPane(c.panes.value[0]!.id);
    c.selectRectangle(c.panes.value[1]!.id);
    c.tabNext();
    await nextTick();
    const layout = wrapper.findAll(".split-tab-strip-item").find(item => item.attributes("data-kind") === "layout")!;
    expect(layout.text()).toBe("a+c+d+b");
  });
});

describe("tab context menu", () => {
  const labels = { menu: "Tab options", right: "Split right", left: "Split left", down: "Split down", up: "Split up",
    inside: "Tab inside", move: "Move to", otherPane: "Other pane", close: "Close", noRoom: "No room", onlyTab: "Only tab" };
  async function menuFixture() {
    const f = await fixture();
    await f.wrapper.setProps({ menuLabels: labels });
    return { ...f, button: f.wrapper.get<HTMLElement>('[data-split-tabs-tab="b"] .split-tab-strip-tab') };
  }
  it("right-click opens at the pointer, missing labels hide items, and no labels leaves browser contextmenu alone", async () => {
    const { wrapper, button } = await menuFixture();
    await button.trigger("contextmenu", { clientX: 40, clientY: 50 });
    expect(wrapper.get('[role="menu"]').attributes("aria-label")).toBe("Tab options");
    expect((wrapper.get('[role="menu"]').element as HTMLElement).style.left).toBe("40px");
    expect(wrapper.findAll('[role="menuitem"]').map(i => i.text())).toEqual([
      "Split right", "Split left", "Split down", "Split up", "Tab inside",
    ]);
    await wrapper.setProps({ menuLabels: { right: "Right" } });
    expect(wrapper.findAll('[role="menuitem"]').map(i => i.text())).toEqual(["Right"]);
    await wrapper.setProps({ menuLabels: {} });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    button.element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
  it.each(["ContextMenu", "F10"])("%s opens under the label; arrows cycle enabled items and Escape restores focus", async keyName => {
    const { wrapper, button } = await menuFixture();
    vi.spyOn(button.element, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 80, 25));
    button.element.focus();
    await button.trigger("keydown", { key: keyName, shiftKey: keyName === "F10" });
    await settle();
    expect((wrapper.get('[role="menu"]').element as HTMLElement).style.top).toBe("61px");
    const items = wrapper.findAll('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0]!.element);
    key({ key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]!.element);
    key({ key: "Escape" });
    await nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
  });
  it.each([["right", "right"], ["left", "left"], ["down", "bottom"], ["up", "top"], ["inside", null]] as const)
    ("%s uses the tab source and exact controller zone", async (item, side) => {
      const { c, wrapper, button } = await menuFixture();
      const target = c.panes.value[0]!.id;
      const move = vi.spyOn(c, "move");
      await button.trigger("contextmenu");
      await wrapper.get(`[data-menu-item="${item}"]`).trigger("click");
      expect(move).toHaveBeenCalledWith({ view: "b" }, side === null ? { kind: "inside", target } : { kind: "split", target, side });
    });
  it("canMove refusals disable items with host reasons; close appears only for closable views", async () => {
    const { c, wrapper, button } = await menuFixture();
    c.setContainerSize(150, 100);
    await button.trigger("contextmenu");
    expect(wrapper.get('[data-menu-item="right"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-menu-item="right"] .split-tabs-menu-reason').text()).toBe("No room");
    expect(wrapper.find('[data-menu-item="close"]').exists()).toBe(false);
    await wrapper.setProps({ menuLabels: labels });
    c.setContainerSize(600, 400);
    c.split("right");
    await nextTick();
    const placeholder = c.panes.value[1]!.view;
    const host = wrapper.findAllComponents(SplitTabStrip)[1]!;
    await host.get('.split-tab-strip-tab').trigger("contextmenu");
    expect(wrapper.get('[data-menu-item="right"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-menu-item="inside"] .split-tabs-menu-reason').text()).toBe("Only tab");
    await wrapper.get('[data-menu-item="close"]').trigger("click");
    expect(c.paneOf(placeholder)).toBeNull();
  });
  it("menuItems preserves host order/subset and menu-extra receives tab, tabSet and close", async () => {
    const c = controller();
    c.setContainerSize(600, 400);
    const wrapper = mount(SplitTabs, { attachTo: document.body, props: {
      controller: c, labels: { divider: "Resize" }, menuLabels: labels, menuItems: ["inside", "left"],
    }, slots: { "menu-extra": ({ tab, tabSet, close }: { tab: string; tabSet: string; close: () => void }) =>
      h("button", { role: "menuitem", class: "split-tabs-menu-item", onClick: close }, `${tab}:${tabSet}`) } });
    await settle();
    await wrapper.get('[data-split-tabs-tab="b"] .split-tab-strip-tab').trigger("contextmenu");
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map(i => i.text())).toEqual(["Tab inside", "Split left", `b:${c.panes.value[0]!.id}`]);
    await items[2]!.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
  it("a held touch opens only on release without dragging and outside press closes and restores focus", async () => {
    vi.useFakeTimers();
    const { wrapper, button } = await menuFixture();
    pointer(button.element, "pointerdown", { pointerType: "touch", clientX: 60, clientY: 20 });
    vi.advanceTimersByTime(350);
    await button.trigger("contextmenu", { clientX: 60, clientY: 20 });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    pointer(window, "pointerup", { pointerType: "touch", clientX: 60, clientY: 20 });
    await nextTick(); await nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    pointer(document.body, "pointerdown", {});
    await nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
  });
  it("opening another label replaces the one menu; disabled entries are skipped; empty subsets leave browser alone", async () => {
    const { wrapper, button, c } = await menuFixture();
    c.setContainerSize(150, 100);
    await wrapper.setProps({ menuItems: ["right", "inside"] });
    await button.trigger("contextmenu");
    await settle();
    expect(document.activeElement?.getAttribute("data-menu-item")).toBe("inside");
    key({ key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-menu-item")).toBe("inside");
    await wrapper.get('[data-split-tabs-tab="c"] .split-tab-strip-tab').trigger("contextmenu");
    expect(wrapper.findAll('[role="menu"]')).toHaveLength(1);
    await wrapper.setProps({ menuItems: [] });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    button.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("layout tabs move as nodes rather than views", async () => {
    const { c, wrapper } = await menuFixture();
    c.split("right");
    c.setSelection(c.panes.value.map(p => p.id));
    c.tabNext();
    await settle();
    const layout = wrapper.get('[data-kind="layout"]');
    const tab = layout.attributes("data-split-tabs-tab");
    const target = layout.element.closest("[data-tab-set]")!.getAttribute("data-tab-set")!;
    const move = vi.spyOn(c, "move");
    await layout.get('.split-tab-strip-tab').trigger("contextmenu");
    await wrapper.get('[data-menu-item="right"]').trigger("click");
    expect(move).toHaveBeenCalledWith({ node: tab }, { kind: "split", target, side: "right" });
  });
  it("two panes move directly to the other bar; three panes preview and accept digits or M", async () => {
    const { c, wrapper, button } = await menuFixture();
    c.split("right");
    await settle();
    await button.trigger("contextmenu");
    expect(wrapper.get('[data-menu-item="move"]').text()).toBe("Other pane");
    const target = c.panes.value[1]!.id;
    const move = vi.spyOn(c, "move");
    await wrapper.get('[data-menu-item="move"]').trigger("click");
    expect(move).toHaveBeenLastCalledWith({ view: "b" }, { kind: "bar", target, index: null });
    c.split("bottom");
    await settle();
    const label = wrapper.get('[data-split-tabs-tab="b"] .split-tab-strip-tab');
    await label.trigger("contextmenu");
    await wrapper.get('[data-menu-item="move"]').trigger("pointerenter");
    expect(wrapper.find('.split-tabs-pane-number[data-mode="preview"]').exists()).toBe(true);
    key({ key: "1" });
    await nextTick();
    expect(c.paneOf("b")).toBe(c.panes.value[0]!.id);
    await wrapper.get('[data-split-tabs-tab="b"] .split-tab-strip-tab').trigger("contextmenu");
    key({ key: "m" });
    await nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(wrapper.find('.split-tabs-pane-number[data-mode="pick"]').exists()).toBe(true);
    key({ key: "Escape" });
  });
});

describe("focus and selection marks", () => {
  it("the focused pane is marked above overlay content, only when there are several panes, and the mark follows the focus", async () => {
    const { c, wrapper } = await fixture({ overlay: true });
    await nextTick();
    expect(wrapper.find(".split-tabs-focus").exists()).toBe(false);
    expect(wrapper.classes()).not.toContain("split-tabs--multi");
    c.move({ view: "b" }, { kind: "split", target: c.panes.value[0]!.id, side: "right" });
    await settle(); await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--multi");
    expect(wrapper.get(".split-tabs-focus").attributes("data-pane-of")).toBe(c.focus.value);
    c.focusPane(c.paneOf("a")!);
    await settle(); await nextTick();
    expect(wrapper.get(".split-tabs-focus").attributes("data-pane-of")).toBe(c.paneOf("a"));
    const keep = (tab: string) => wrapper.element.querySelector(`[data-split-tabs-keep="${tab}"]`)!;
    expect(keep("a").classList.contains("split-tabs-keep--focused")).toBe(true);
    expect(keep("b").classList.contains("split-tabs-keep--focused")).toBe(false);
    expect(keep("b").getAttribute("data-pane-of")).toBe(c.paneOf("b"));
  });
  it("each selected pane gets its own mark above overlay content", async () => {
    const { c, wrapper } = await fixture({ overlay: true });
    c.move({ view: "b" }, { kind: "split", target: c.panes.value[0]!.id, side: "right" });
    c.focusPane(c.paneOf("a")!);
    c.toggleSelected(c.paneOf("b")!);
    await settle(); await nextTick();
    expect(wrapper.findAll(".split-tabs-selected-mark").map(m => m.attributes("data-pane-of")).sort())
      .toEqual([c.paneOf("a"), c.paneOf("b")].sort());
    const keep = wrapper.element.querySelector('[data-split-tabs-keep="b"]')!;
    expect(keep.classList.contains("split-tabs-keep--selected")).toBe(true);
  });
  it("the stylesheet draws marks above the keep layer and offers border, background and opacity variables", () => {
    const css = readFileSync("src/style.css", "utf8");
    for (const v of ["--split-tabs-focus-border", "--split-tabs-focus-radius", "--split-tabs-focus-background", "--split-tabs-unfocused-opacity",
      "--split-tabs-focused-opacity", "--split-tabs-selected-border", "--split-tabs-selected-opacity", "--split-tabs-mark-z-index"]) expect(css).toContain(v);
    expect(css).toMatch(/\.split-tabs--multi \.split-tabs-keep--overlay:not\(\.split-tabs-keep--focused\)/);
  });
});

describe("close buttons", () => {
  async function closable(closeButton?: "never" | "active" | "hover" | "always") {
    const f = await fixture({ optional: ["c", "d"], ...(closeButton ? { closeButton } : {}) });
    f.c.open("c");
    f.c.open("d");
    f.c.select(f.c.panes.value[0]!.id, "a");
    await nextTick();
    const closes = () => f.wrapper.findAll(".split-tab-strip-item").filter(i => i.find(".split-tab-strip-close").exists())
      .map(i => i.attributes("data-split-tabs-tab"));
    return { ...f, closes };
  }
  it("by default only the shown tab has a ✕: a click on another tab selects it, then its ✕ appears", async () => {
    const { c, wrapper, closes } = await closable();
    expect(closes()).toEqual([]);
    await wrapper.find('[data-split-tabs-tab="c"] .split-tab-strip-tab').trigger("click");
    expect(c.panes.value[0]!.view).toBe("c");
    expect(c.opened.value).toEqual(["c", "d"]);
    expect(closes()).toEqual(["c"]);
  });
  it.each([["never", []], ["hover", ["c", "d"]], ["always", ["c", "d"]]] as const)("closeButton %s renders ✕ on %j", async (mode, expected) => {
    const { closes, wrapper } = await closable(mode);
    expect(closes()).toEqual(expected);
    if (mode === "always") expect(wrapper.get(".split-tab-strip").classes()).toContain("split-tab-strip--close-always");
  });
  it("a standalone controlled strip accepts its own closeButton policy", async () => {
    const c = controller({ optional: ["c"] });
    c.setContainerSize(600, 400);
    c.open("c");
    const wrapper = mount(SplitTabStrip, { props: { controller: c, tabSet: c.panes.value[0]!.id, labels: { close: "Close" }, closeButton: "always" } });
    await nextTick();
    expect(wrapper.findAll(".split-tab-strip-close")).toHaveLength(1);
  });
});

describe("self-drop preview and keyboard", () => {
  it("a bar drop changing the shown view gives that content the keyboard even when the pane id stays the same", async () => {
    const { c, wrapper, items } = await stripFixture();
    const source = c.focus.value;
    const contents = wrapper.findAll<HTMLElement>(".content");
    for (const content of contents) content.element.tabIndex = 0;
    wrapper.get<HTMLElement>('.content[data-tab="a"]').element.focus();
    pointer(items[1]!.get(".split-tab-strip-tab").element, "pointerdown", { clientX: 100, clientY: 15 });
    pointer(window, "pointermove", { clientX: 20, clientY: 15 });
    pointer(window, "pointerup", { clientX: 20, clientY: 15 });
    await settle();
    expect(c.focus.value).toBe(source);
    expect(c.panes.value[0]!.view).toBe("b");
    expect(document.activeElement).toBe(wrapper.get('.content[data-tab="b"]').element);
    wrapper.unmount(); c.dispose();
  });
  it.each(["absent", "unopened"])("a label with an %s sibling previews both self-split halves", async hidden => {
    const tabs = hidden === "absent" ? ["a"] : ["a", "x"];
    // Keep the hidden view in saved intent while the host hides it.
    const saved = JSON.stringify({ entries: [{ key: "page", stamp: 1,
      intent: { version: 3, tree: { kind: "tabs", id: "original", tabs: ["a", "x"], active: "a" }, focus: "a", opened: [] } }] });
    const store = storage(); store.values.set("layouts", saved);
    const visible = controller({ tabs, optional: hidden === "unopened" ? ["x"] : [], storage: store });
    visible.setContainerSize(600, 400);
    const root = mount(SplitTabs, { attachTo: document.body, props: { controller: visible, alwaysShow: true,
      labels: { divider: "Resize", newPane: "New pane" } } });
    vi.spyOn(root.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
    await settle();
    const pane = root.get("[data-pane-id]");
    vi.spyOn(pane.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 32, 600, 368));
    pointer(root.get(".split-tab-strip-tab").element, "pointerdown", { clientX: 50, clientY: 15 });
    pointer(window, "pointermove", { clientX: 510, clientY: 200 });
    await nextTick();
    expect(root.findAll(".split-tabs-drop-shade")).toHaveLength(2);
    expect(root.get(".split-tabs-drop-preview--new").text()).toBe("New pane");
    pointer(window, "pointerup", { clientX: 510, clientY: 200 });
    root.unmount(); visible.dispose();
  });
  it.each(["self", "other"])("a pointer drop to %s moves the keyboard to the newly focused pane", async destination => {
    const { c, wrapper } = await fixture({ tabs: destination === "self" ? ["a"] : ["a", "b"] });
    if (destination === "other") c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
    await settle();
    const source = c.paneOf("a")!;
    c.focusPane(source);
    const panes = wrapper.findAll<HTMLElement>("[data-pane-id]");
    for (const p of panes) vi.spyOn(p.element, "getBoundingClientRect").mockReturnValue(new DOMRect(
      p.attributes("data-pane-id") === source ? 0 : 300, 0, destination === "self" ? 600 : 300, 400));
    wrapper.get<HTMLElement>(`[data-pane-id="${source}"]`).element.focus();
    key({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true });
    await settle();
    pointer(wrapper.get(`[data-pane-id="${source}"] .split-tabs-pane-cover`).element, "pointerdown",
      { clientX: 100, clientY: 200, altKey: true, shiftKey: true });
    const x = destination === "self" ? 510 : 450;
    pointer(window, "pointermove", { clientX: x, clientY: 200, altKey: true, shiftKey: true });
    pointer(window, "pointerup", { clientX: x, clientY: 200 });
    await settle();
    expect(c.focus.value).not.toBe(source);
    expect(document.activeElement).toBe(wrapper.get(`[data-pane-id="${c.focus.value}"]`).element);
    wrapper.unmount(); c.dispose();
  });
  it.each([false, true])("own right quarter shows content right and a distinct new pane left (refused=%s)", async refused => {
    const { c, s, wrapper } = await fixture({ tabs: ["a", "b"] });
    c.select(c.focus.value, "b");
    s.setItem.mockClear();
    await wrapper.setProps({ labels: { divider: "Resize", newPane: "New pane" } });
    const width = refused ? 205 : 600;
    c.setContainerSize(width, 400);
    vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 400));
    const pane = wrapper.get("[data-pane-id]");
    vi.spyOn(pane.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 400));
    key({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true });
    await settle();
    pointer(wrapper.get(".split-tabs-pane-cover").element, "pointerdown", { clientX: width / 2, clientY: 200, altKey: true, shiftKey: true });
    pointer(window, "pointermove", { clientX: width * 0.85, clientY: 200, altKey: true, shiftKey: true });
    await nextTick();
    const content = wrapper.get<HTMLElement>(".split-tabs-drop-shade:not(.split-tabs-drop-preview--new)");
    const fresh = wrapper.get<HTMLElement>(".split-tabs-drop-preview--new");
    expect(content.element.style.left).toBe(`${width / 2}px`);
    expect(fresh.element.style.left).toBe("0px");
    expect(fresh.element.style.width).toBe(`${width / 2}px`);
    expect(fresh.text()).toBe("New pane");
    expect(content.attributes("data-refused")).toBe(refused ? "" : undefined);
    expect(fresh.attributes("data-refused")).toBe(refused ? "" : undefined);
    await wrapper.setProps({ labels: { divider: "Resize" } });
    expect(wrapper.get(".split-tabs-drop-preview--new").text()).toBe("");
    expect(s.setItem).not.toHaveBeenCalled();
    pointer(window, "pointermove", { clientX: width / 2, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-preview--new").exists()).toBe(false);
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-refused")).toBe("");
    pointer(window, "pointerup", { clientX: width / 2, clientY: 200 });
    expect(s.setItem).not.toHaveBeenCalled();
    wrapper.unmount(); c.dispose();
  });
  it("keyboard move splits inside the shown tab with its own letter and an arrow", async () => {
    const { c, s, wrapper } = await fixture({ tabs: ["a", "b"] });
    c.select(c.focus.value, "b");
    s.setItem.mockClear();
    key({ code: "KeyV", key: "V", altKey: true, shiftKey: true });
    key({ code: "KeyA", key: "a" });
    const arrow = key({ code: "ArrowRight", key: "ArrowRight" });
    await settle();
    expect(arrow.defaultPrevented).toBe(true);
    expect(c.notation.value).toBe("T{a | *H[new:1 b]}");
    expect(c.focus.value).toBe(c.paneOf("new:1"));
    expect(document.activeElement).toBe(wrapper.get(`[data-pane-id="${c.focus.value}"]`).element);
    expect(wrapper.classes()).not.toContain("split-tabs--picking");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    wrapper.unmount(); c.dispose();
  });
});

describe("label gestures", () => {
  it("an absent external id previews a no-room split as refused and never calls beforeDrop", async () => {
    const { c, s, wrapper } = await fixture({ tabs: ["a", "b"] });
    c.setContainerSize(150, 400);
    vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 150, 400));
    const beforeDrop = vi.fn();
    const event = new PointerEvent("pointerdown", { pointerId: 3, pointerType: "mouse", clientX: 148, clientY: 200 });
    const start = wrapper.vm.$.exposed!.startExternalDrag as (
      event: PointerEvent, id: string, ghost: { label: string }, beforeDrop: () => void
    ) => void;
    start(event, "x", { label: "X" }, beforeDrop);
    await nextTick();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-refused")).toBe("");
    pointer(window, "pointerup", { clientX: 148, clientY: 200 });
    expect(beforeDrop).not.toHaveBeenCalled();
    expect(c.notation.value).toBe("(*a b)");
    expect(s.setItem).not.toHaveBeenCalled();
  });
  it.each(["touch", "pen"])("a %s quick swipe never arms or starts dragging, even after the hold time", async (pointerType) => {
    vi.useFakeTimers();
    const { s, wrapper, button } = await stripFixture();
    pointer(button.element, "pointerdown", { pointerType, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(100);
    const swipe = new PointerEvent("pointermove", { cancelable: true, pointerType, pointerId: 3, clientX: 170, clientY: 10 });
    window.dispatchEvent(swipe);
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(swipe.defaultPrevented).toBe(false);
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    pointer(window, "pointerup", { pointerType, clientX: 170, clientY: 10 });
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it.each(["touch", "pen"])("a %s long press arms at 350ms, then a drag onto the bar reorders in one write", async (pointerType) => {
    vi.useFakeTimers();
    const { c, s, wrapper, button } = await stripFixture();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    pointer(button.element, "pointerdown", { pointerType, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(349);
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(true);
    const touch = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    window.dispatchEvent(new PointerEvent("pointermove", { cancelable: true, pointerType, pointerId: 3, clientX: 170, clientY: 15 }));
    await nextTick();
    expect(document.querySelector(".split-tabs-drag-ghost")).not.toBeNull();
    pointer(window, "pointerup", { pointerType, clientX: 170, clientY: 15 });
    await nextTick();
    expect(c.panes.value[0]!.tabs).toEqual(["b", "a", "c", "d"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    const handler = add.mock.calls.find(([type]) => type === "touchmove")?.[1];
    expect(remove).toHaveBeenCalledWith("touchmove", handler);
    const after = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it.each(["pointerup", "pointercancel", "Escape", "unmount"])("removes the armed touchmove cancellation on %s", async (end) => {
    vi.useFakeTimers();
    const { wrapper, button } = await stripFixture();
    pointer(button.element, "pointerdown", { pointerType: "touch" });
    vi.advanceTimersByTime(350);
    const before = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    if (end === "Escape") key({ key: "Escape" });
    else if (end === "unmount") wrapper.unmount();
    else pointer(window, end, { pointerType: "touch" });
    const after = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("mouse drag suppression only consumes the immediate pointer click, never keyboard activation", async () => {
    vi.useFakeTimers();
    const { c, strip } = await stripFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1]!;
    const select = vi.spyOn(c, "select");
    pointer(button.element, "pointerdown", { clientX: 90 });
    pointer(window, "pointermove", { clientX: 250 });
    pointer(window, "pointerup", { clientX: 250 });
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(select).toHaveBeenCalledTimes(1);
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(1);
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Escape during a mouse drag suppresses its later release click, but not keyboard or the next press", async () => {
    vi.useFakeTimers();
    const { c, strip } = await stripFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1]!;
    const select = vi.spyOn(c, "select");
    pointer(button.element, "pointerdown", { clientX: 90 });
    pointer(window, "pointermove", { clientX: 250 });
    vi.advanceTimersByTime(500);
    expect(c.panes.value[0]!.view).toBe("d");
    key({ key: "Escape" });
    vi.advanceTimersByTime(10);
    pointer(window, "pointerup", { clientX: 250 });
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(c.panes.value[0]!.view).toBe("d");
    expect(select).toHaveBeenCalledTimes(1);
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(select).toHaveBeenCalledTimes(2);
    pointer(button.element, "pointerdown", { clientX: 90 });
    pointer(window, "pointerup", { clientX: 90 });
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Alt+Shift+arrows on a focused label reorder one slot, keep focus, and are not taken by the keymap", async () => {
    const { c, s, strip } = await stripFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1]!;
    (button.element as HTMLElement).focus();
    await button.trigger("keydown", { key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true });
    expect(c.panes.value[0]!.tabs).toEqual(["a", "c", "b", "d"]);
    expect(c.panes.value[0]!.active).toBe("a");
    expect(document.activeElement).toBe(button.element);
    await button.trigger("keydown", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, shiftKey: true });
    expect(c.panes.value[0]!.tabs).toEqual(["a", "b", "c", "d"]);
    expect(s.setItem).toHaveBeenCalledTimes(2);
  });

  it("label reorder rejects extra Meta modifiers and AltGraph typing", async () => {
    const { c, strip } = await stripFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1]!.element;
    const event = key({ code: "ArrowRight", key: "ArrowRight", altKey: true, shiftKey: true, metaKey: true }, button);
    expect(event.defaultPrevented).toBe(false);
    const graph = new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight",
      altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(graph, "getModifierState", { value: (name: string) => name === "AltGraph" });
    button.dispatchEvent(graph);
    expect(graph.defaultPrevented).toBe(false);
    expect(c.panes.value[0]!.tabs).toEqual(["a", "b", "c", "d"]);
  });

  it("resting on a hidden tab's label during a drag opens it (spring-loaded tab)", async () => {
    vi.useFakeTimers();
    const { c, strip, button } = await stripFixture();
    pointer(button.element, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(window, "pointermove", { clientX: 250, clientY: 10 });
    await nextTick();
    expect(strip.find(".split-tab-strip-item--spring").exists()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(c.panes.value[0]!.view).toBe("d");
    key({ key: "Escape" });
  });
});

describe("keymap", () => {
  it("host inputs keep unbound, refused, null and non-repeatable repeat keys; successful commands win", async () => {
    const { c, wrapper } = await fixture({ tabs: ["a"], keymap: {
      focusRight: ["Alt+Shift+KeyL"], clear: ["Escape"], splitRight: ["Alt+Shift+KeyE"],
    } });
    const input = document.createElement("input");
    document.body.append(input);
    try {
      const mods = { altKey: true, shiftKey: true };
      expect(key({ code: "KeyQ", ...mods }, input).defaultPrevented).toBe(false);
      expect(key({ code: "KeyL", key: "|", ...mods }, input).defaultPrevented).toBe(false);
      expect(key({ code: "Escape" }, input).defaultPrevented).toBe(false);
      c.setContainerSize(150, 400);
      expect(key({ code: "KeyE", ...mods }, input).defaultPrevented).toBe(false);
      expect(key({ code: "KeyE", repeat: true, ...mods }, input).defaultPrevented).toBe(false);
      c.setContainerSize(600, 400);
      expect(key({ code: "KeyE", ...mods }, input).defaultPrevented).toBe(true);
      expect(c.panes.value).toHaveLength(2);
      expect(key({ code: "KeyE", repeat: true, ...mods }, input).defaultPrevented).toBe(true);
      expect(c.panes.value).toHaveLength(2);
    } finally { input.remove(); wrapper.unmount(); }
  });

  it.each([true, false])("a non-repeatable hold follows its first press (success=%s) without a second command", async success => {
    const { c, commands } = await fixture({ tabs: ["a"], keymap: { splitRight: ["Alt+Shift+KeyE"] } });
    c.setContainerSize(success ? 600 : 150, 400);
    const mods = { altKey: true, shiftKey: true };
    expect(key({ code: "KeyE", ...mods }).defaultPrevented).toBe(success);
    expect(commands).toHaveLength(1);
    // A different code must not overwrite the first code's decision.
    expect(key({ code: "KeyQ", ...mods }).defaultPrevented).toBe(false);
    for (let i = 0; i < 3; i++) expect(key({ code: "KeyE", repeat: true, ...mods }).defaultPrevented).toBe(success);
    expect(commands).toHaveLength(1);
    expect(c.panes.value).toHaveLength(success ? 2 : 1);
  });

  it.each(["keyup", "blur"])("%s clears a successful hold before an orphan repeat or a refused fresh press", async end => {
    const { c, commands } = await fixture({ tabs: ["a"], keymap: { splitRight: ["Alt+Shift+KeyE"] } });
    const mods = { altKey: true, shiftKey: true };
    expect(key({ code: "KeyE", ...mods }).defaultPrevented).toBe(true);
    expect(key({ code: "KeyE", repeat: true, ...mods }).defaultPrevented).toBe(true);
    window.dispatchEvent(end === "keyup" ? new KeyboardEvent("keyup", { code: "KeyE" }) : new Event("blur"));
    expect(key({ code: "KeyE", repeat: true, ...mods }).defaultPrevented).toBe(false);
    c.setContainerSize(150, 400);
    expect(key({ code: "KeyE", ...mods }).defaultPrevented).toBe(false);
    expect(key({ code: "KeyE", repeat: true, ...mods }).defaultPrevented).toBe(false);
    expect(commands).toHaveLength(2);
  });

  it("null and unbound first presses stay typing if the binding becomes actionable during the hold", async () => {
    const { c, wrapper, commands } = await fixture({ keymap: { clear: ["KeyQ"] } });
    expect(key({ code: "KeyQ" }).defaultPrevented).toBe(false);
    expect(key({ code: "KeyE" }).defaultPrevented).toBe(false);
    c.split("right");
    c.toggleSelected(c.panes.value[0]!.id);
    expect(key({ code: "KeyQ", repeat: true }).defaultPrevented).toBe(false);
    expect(c.selection.value.length).toBeGreaterThan(0);
    await wrapper.setProps({ keymap: { splitRight: ["KeyE"] } });
    expect(key({ code: "KeyE", repeat: true }).defaultPrevented).toBe(false);
    expect(commands).toEqual([]);
    expect(c.panes.value).toHaveLength(2);
  });

  it("key chords match exact modifiers and AltGraph never runs commands or raises covers", async () => {
    const { c, wrapper } = await fixture({ keymap: { splitRight: ["Alt+Shift+KeyE", "Ctrl+Alt+Shift+KeyL"] } });
    expect(key({ code: "KeyE", ctrlKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    const event = new KeyboardEvent("keydown", { code: "KeyL", ctrlKey: true, altKey: true, shiftKey: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" });
    window.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(false);
    expect(c.panes.value).toHaveLength(1);
    expect(wrapper.classes()).not.toContain("split-tabs--grab");
  });
  it("default chords run commands and report them; new views are placeholders", async () => {
    const { c, commands } = await fixture();
    key({ code: "KeyE", key: "E", altKey: true, shiftKey: true });
    expect(c.notation.value).toBe("H[(*a b c d) new:1]");
    key({ code: "KeyT", key: "T", altKey: true, shiftKey: true });
    expect(c.notation.value).toBe("H[(*a b c d) (new:1 *new:2)]");
    key({ code: "KeyH", key: "H", altKey: true, shiftKey: true });
    expect(c.focus.value).toBe(c.panes.value[0]!.id);
    expect(commands.map(([name]) => name)).toEqual(["splitRight", "tabNext", "focusLeft"]);
  });

  it("a host keymap replaces the default; null binds nothing; an unbound key is left to the page", async () => {
    const custom = await fixture({ keymap: { ...defaultKeymap, splitRight: ["Ctrl+Alt+KeyS"] } });
    expect(key({ code: "KeyE", altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(key({ code: "KeyS", ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(custom.c.panes.value).toHaveLength(2);
    custom.wrapper.unmount();
    const none = await fixture({ keymap: null });
    expect(key({ code: "KeyE", altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(none.c.panes.value).toHaveLength(1);
    expect(key({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(false);
  });

  it("Escape clears selection outside modes and exits arrange independently", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    c.toggleSelected(c.panes.value[0]!.id);
    expect(key({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(true);
    expect(c.selection.value).toEqual([]);
    key({ code: "KeyA", altKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--arranging");
    key({ key: "Escape", code: "Escape" });
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--arranging");
  });
});

describe("panes, covers and pick modes", () => {
  it("holding Alt+Shift covers panes; an Alt+Shift click adds a pane to the selection, with the focused one", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    c.focusPane(c.panes.value[0]!.id);
    key({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true });
    await nextTick();
    const covers = wrapper.findAll(".split-tabs-pane-cover");
    expect(covers).toHaveLength(2);
    pointer(covers[1]!.element, "pointerdown", { altKey: true, shiftKey: true });
    pointer(window, "pointerup", {});
    await nextTick();
    expect(c.selection.value).toEqual([c.panes.value[0]!.id, c.panes.value[1]!.id]);
    expect(wrapper.find(".split-tabs-selection").attributes("data-kind")).toBe("ok");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    await nextTick();
    expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
  });

  it("the host chooses the pane chords: Ctrl+Alt+Shift click toggles and drags; Alt+Shift alone does nothing; null disables", async () => {
    const { c, wrapper } = await fixture({ pointerChords: { ...defaultPointerChords, toggle: "Ctrl+Alt+Shift", move: "Ctrl+Alt+Shift", rectangle: null } });
    c.split("right");
    c.focusPane(c.panes.value[0]!.id);
    key({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
    pointer(wrapper.findAll(".split-tabs-pane")[1]!.element, "pointerdown", { altKey: true, shiftKey: true });
    expect(c.focus.value).toBe(c.panes.value[1]!.id);
    expect(c.selection.value).toEqual([]);
    c.focusPane(c.panes.value[0]!.id);
    key({ key: "Control", code: "ControlLeft", ctrlKey: true, altKey: true, shiftKey: true });
    await nextTick();
    const covers = wrapper.findAll(".split-tabs-pane-cover");
    expect(covers).toHaveLength(2);
    pointer(covers[1]!.element, "pointerdown", { ctrlKey: true, altKey: true, shiftKey: true });
    pointer(window, "pointerup", {});
    expect(c.selection.value).toEqual([c.panes.value[0]!.id, c.panes.value[1]!.id]);
    expect(c.focus.value).toBe(c.panes.value[0]!.id);
  });

  it("with default chords, Ctrl+Alt+Shift click selects the rectangle from the focused pane", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    c.focusPane(c.panes.value[0]!.id);
    key({ key: "Control", code: "ControlLeft", ctrlKey: true, altKey: true, shiftKey: true });
    await nextTick();
    pointer(wrapper.findAll(".split-tabs-pane-cover")[1]!.element, "pointerdown", { ctrlKey: true, altKey: true, shiftKey: true });
    pointer(window, "pointerup", {});
    expect([...c.selection.value].sort()).toEqual([c.panes.value[0]!.id, c.panes.value[1]!.id].sort());
  });

  it("a plain press in a pane focuses it", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    c.focusPane(c.panes.value[0]!.id);
    await nextTick();
    pointer(wrapper.findAll(".split-tabs-pane")[1]!.element, "pointerdown", {});
    expect(c.focus.value).toBe(c.panes.value[1]!.id);
  });

  it("arrange mode: a tap toggles a pane in the selection", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    key({ code: "KeyA", altKey: true, shiftKey: true });
    await nextTick();
    const cover = wrapper.findAll(".split-tabs-pane-cover")[0]!;
    pointer(cover.element, "pointerdown", { pointerType: "touch" });
    pointer(window, "pointerup", { pointerType: "touch" });
    expect(c.selection.value).toContain(c.panes.value[0]!.id);
  });

  it("Alt+Shift+M shows letters; a letter toggles that pane; Enter ends", async () => {
    const { c, wrapper } = await fixture();
    c.split("right");
    key({ code: "KeyM", altKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.findAll(".split-tabs-pane-number-badge").map(b => b.text())).toEqual(["a", "b"]);
    key({ key: "b", code: "KeyB" });
    key({ key: "a", code: "KeyA" });
    expect([...c.selection.value].sort()).toEqual([c.panes.value[0]!.id, c.panes.value[1]!.id].sort());
    key({ key: "Enter", code: "Enter" });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-number").exists()).toBe(false);
  });

  it("Alt+Shift+V moves by keyboard: a letter picks the destination, an arrow splits on that side", async () => {
    const { c } = await fixture();
    c.split("right");
    c.focusPane(c.panes.value[1]!.id);
    key({ code: "KeyV", altKey: true, shiftKey: true });
    key({ key: "a", code: "KeyA" });
    key({ key: "ArrowUp", code: "ArrowUp" });
    expect(c.notation.value).toBe("V[new:1 (*a b c d)]");
  });
});

describe("pane iframes report through the frame protocol", () => {
  // WebKit gives the receiving window as `event.source`: the shell must recognise
  // a pane's iframe by the token it handed to that iframe, not by `source`.
  async function framed() {
    const posts = new Map<string, unknown[]>();
    const f = await fixture({ overlay: true, iframes: true });
    f.c.move({ view: "b" }, { kind: "split", target: f.c.panes.value[0]!.id, side: "right" });
    await nextTick(); await nextTick();
    for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[data-tab]")) {
      const list: unknown[] = [];
      posts.set(frame.dataset.tab!, list);
      vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: unknown) => { list.push(message); });
    }
    // An iframe saying hello makes the shell identify every pane iframe.
    window.dispatchEvent(new MessageEvent("message", { data: { "split-tabs": 1, type: "hello" }, origin: location.origin, source: window }));
    const token = (tab: string) => (posts.get(tab)!.find(m => (m as { type?: string }).type === "identify") as { token: string }).token;
    const report = (data: Record<string, unknown>, origin = location.origin) =>
      window.dispatchEvent(new MessageEvent("message", { data: { "split-tabs": 1, ...data }, origin, source: window }));
    return { ...f, token, report, posts };
  }
  const down = { type: "down", button: 0, pointerType: "mouse", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

  it.each(["page", "iframe", "iframe-picker"])("a refused bound chord reports once with no fallback from %s", async path => {
    const { c, commands, token, report } = await framed();
    c.setContainerSize(150, 400);
    if (path === "iframe-picker") key({ code: "KeyM", altKey: true, shiftKey: true });
    commands.length = 0;
    const input = document.createElement("input");
    input.value = "host text";
    document.body.append(input);
    input.focus();
    const before = JSON.stringify(c.intent.value);
    const events: KeyboardEvent[] = [];
    const listen = (event: KeyboardEvent) => { events.push(event); };
    window.addEventListener("keydown", listen);
    try {
      const mods = { ctrlKey: false, metaKey: false, altKey: true, shiftKey: true };
      if (path === "page") key({ code: "KeyE", key: "E", ...mods }, input);
      else report({ type: "key", phase: "keydown", code: "KeyE", key: "E", repeat: false, ...mods, token: token("a") });
      expect(commands).toEqual([["splitRight", { ok: false, reason: "no-room" }]]);
      expect(JSON.stringify(c.intent.value)).toBe(before);
      expect(input.value).toBe("host text");
      expect(document.activeElement).toBe(input);
      expect(events).toHaveLength(path === "iframe" ? 0 : 1);
      if (path === "iframe-picker") {
        expect(events[0]!.isTrusted).toBe(false);
        expect((events[0]!.target as Window).document === document).toBe(true);
      }
    } finally { window.removeEventListener("keydown", listen); input.remove(); }
  });

  it("a forwarded iframe keyup clears the shared hold decision", async () => {
    const { wrapper, token, report } = await framed();
    const mods = { ctrlKey: false, metaKey: false, altKey: true, shiftKey: true };
    await wrapper.setProps({ keymap: { arrange: ["Alt+Shift+KeyA"] } });
    expect(key({ code: "KeyA", ...mods }).defaultPrevented).toBe(true);
    expect(key({ code: "KeyA", repeat: true, ...mods }).defaultPrevented).toBe(true);
    report({ type: "key", phase: "keyup", code: "KeyA", key: "A", repeat: false, ...mods, token: token("a") });
    expect(key({ code: "KeyA", repeat: true, ...mods }).defaultPrevented).toBe(true); // Arrange isolates even orphan repeats.
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA", ...mods }));
    (wrapper.vm as unknown as { run(command: string): void }).run("arrange");
    expect(key({ code: "KeyA", repeat: true, ...mods }).defaultPrevented).toBe(false);
  });

  it("identifies every iframe with current bindings and resends after a keymap change", async () => {
    const { wrapper, posts } = await framed();
    for (const messages of posts.values()) expect(messages[messages.length - 1]).toMatchObject({
      type: "identify", chords: expect.arrayContaining(["Alt+Shift+KeyE"]),
    });
    await wrapper.setProps({ keymap: { splitRight: ["Ctrl+KeyS"] } });
    for (const messages of posts.values()) expect(messages[messages.length - 1]).toMatchObject({ type: "identify", chords: ["Ctrl+KeyS"] });
    await wrapper.setProps({ keymap: null });
    for (const messages of posts.values()) expect(messages[messages.length - 1]).toMatchObject({ type: "identify", chords: [] });
  });

  it("a removed iframe loses its token even if that same element is reinserted", async () => {
    const { c, wrapper, token, report, posts } = await framed();
    const frame = (wrapper.element as Element).querySelector<HTMLIFrameElement>('iframe[data-tab="b"]')!;
    const parent = frame.parentElement!;
    const old = token("b");
    frame.remove();
    await nextTick();
    parent.append(frame);
    await nextTick();
    // jsdom replaces contentWindow on reinsertion, just as navigation replaces a frame document.
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: unknown) => { posts.get("b")!.push(message); });
    c.focusPane(c.paneOf("a")!);
    report({ ...down, token: old });
    expect(c.focus.value).toBe(c.paneOf("a"));
    report({ type: "hello" });
    const latest = posts.get("b")!.filter(m => (m as { type: string }).type === "identify").pop() as { token: string };
    expect(latest.token).not.toBe(old);
    report({ ...down, token: latest.token });
    expect(c.focus.value).toBe(c.paneOf("b"));
  });

  it("a press reported with an iframe's token focuses that iframe's pane, whatever event.source says", async () => {
    const { c, token, report } = await framed();
    c.focusPane(c.paneOf("a")!);
    expect(token("a")).not.toBe(token("b"));
    report({ ...down, token: token("b") });
    expect(c.focus.value).toBe(c.paneOf("b"));
  });

  it("an unknown token, a missing token or a foreign origin is ignored", async () => {
    const { c, token, report } = await framed();
    c.focusPane(c.paneOf("a")!);
    report({ ...down, token: "forged" });
    report({ ...down });
    report({ ...down, token: token("b") }, "https://elsewhere.example");
    expect(c.focus.value).toBe(c.paneOf("a"));
  });

  it("a key reported with a token runs the layout chord", async () => {
    const { c, token, report } = await framed();
    report({ type: "key", phase: "keydown", key: "E", code: "KeyE", repeat: false, ctrlKey: false, shiftKey: true, altKey: true, metaKey: false,
      token: token("a") });
    expect(c.panes.value).toHaveLength(3);
  });

  it("a modifier report that arrives after newer key events seen by the page does not turn the covers back on", async () => {
    const { wrapper, token, report } = await framed();
    const held = { ctrlKey: false, shiftKey: true, altKey: true, metaKey: false };
    report({ type: "key", phase: "keydown", key: "E", code: "KeyE", repeat: false, ...held, token: token("a"), at: performance.timeOrigin + 1 });
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--grab");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--grab");
    // The iframe's E release, stamped before the page's own Alt release, arrives last.
    report({ type: "key", phase: "keyup", key: "E", code: "KeyE", repeat: false, ...held, token: token("a"), at: performance.timeOrigin + 2 });
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--grab");
  });

  it("a late iframe Meta release restores page commands, exits and pointer chords after a newer pointermove", async () => {
    const { c, wrapper, token, report } = await framed();
    for (const frame of wrapper.element.querySelectorAll("iframe")) vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
    const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
    const at = performance.timeOrigin;
    report({ type: "key", phase: "keydown", key: "Super", code: "OSLeft", repeat: false, ...mods, token: token("a"), at: at + 1 });
    pointer(window, "pointermove");
    report({ type: "key", phase: "keyup", key: "Super", code: "OSLeft", repeat: false,
      ...mods, metaKey: false, token: token("a"), at: at + 2 });
    c.focusPane(c.paneOf("a")!);
    expect(key({ code: "KeyL", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.focus.value).toBe(c.paneOf("b"));
    (wrapper.vm as unknown as { run(command: string): void }).run("arrange");
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--arranging");
    expect(key({ code: "Escape", key: "Escape" }).defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape", key: "Escape" }));
    pointer(window, "pointermove", { altKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--arranging");
    expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
    pointer(wrapper.findAll(".split-tabs-pane-cover")[0]!.element, "pointerdown", { altKey: true, shiftKey: true });
    pointer(window, "pointerup", { altKey: true, shiftKey: true });
    expect(c.selection.value).toHaveLength(2);
  });

  it.each(["other-frame-keyup", "removed-frame"])("iframe Meta is released by %s", async release => {
    const { c, wrapper, token, report } = await framed();
    for (const frame of wrapper.element.querySelectorAll("iframe")) vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
    const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
    report({ type: "key", phase: "keydown", key: "Super", code: "OSLeft", repeat: false, ...mods, token: token("a") });
    if (release === "removed-frame") {
      wrapper.element.querySelector('iframe[data-tab="a"]')!.remove();
      await nextTick();
    } else report({ type: "key", phase: "keyup", key: "Super", code: "OSLeft", repeat: false,
      ...mods, metaKey: false, token: token("b") });
    pointer(window, "pointermove", { altKey: true, shiftKey: true });
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--grab");
    c.focusPane(c.paneOf("a")!);
    expect(key({ code: "KeyL", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.focus.value).toBe(c.paneOf("b"));
  });

  it("foreign-document touches reconcile moved hints, exclude outside-root points and keep truth after pointercancel", async () => {
    vi.useFakeTimers();
    const { wrapper, token, report, commands } = await framed();
    const frame = (wrapper.element as Element).querySelector<HTMLIFrameElement>('iframe[data-tab="a"]')!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 200, 300));
    const points = [
      { identifier: 10, x: 50, y: 50, x0: 50, y0: 50 },
      { identifier: 11, x: 280, y: 100, x0: 280, y0: 100, otherDocument: true },
      { identifier: 12, x: 350, y: 100, x0: 350, y0: 100, otherDocument: true },
      { identifier: 13, x: 700, y: 100, x0: 700, y0: 100, otherDocument: true },
    ];
    report({ type: "touches", points: points.slice(0, 1), token: token("a") });
    const target = wrapper.get(".split-tabs-pane").element;
    pointer(target, "pointerdown", { pointerType: "touch", pointerId: 2, clientX: 300, clientY: 130 });
    // The first snapshot sees a foreign touch only after it moved 10px.
    report({ type: "touches", points: [points[0], { ...points[1], x: 290, x0: 290 }], token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    pointer(window, "pointercancel", { pointerType: "touch", pointerId: 2 });
    report({ type: "touches", points, token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([]); // Only three owned fingers: the fourth is outside this root.
    // Chromium stops sending touchend here after the iframe's own finger lifts.
    report({ type: "touches", points: points.slice(1), token: token("a") });
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 2, clientX: 300, clientY: 130 });
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 3, clientX: 370, clientY: 130 });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("every frame point is root-filtered, otherDocument=%s", async otherDocument => {
    const { wrapper, token, report } = await framed();
    report({ type: "touches", token: token("a"), points: [50, 100, 700].map(x => ({
      identifier: x, x, y: 100, x0: x, y0: 100, otherDocument,
    })) });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
  });

  it.each(["page", "iframe"])("%s pointerup retires a stale foreign snapshot, including late reports", async source => {
    vi.useFakeTimers();
    const { wrapper, token, report, posts } = await framed();
    const points = [50, 150, 250].map(x => ({ identifier: x, x, y: 100, x0: x, y0: 100, otherDocument: true }));
    report({ type: "touches", points, token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    for (const p of points) {
      if (source === "page") pointer(window, "pointerup", { pointerType: "touch", pointerId: p.identifier, clientX: p.x, clientY: p.y });
      else report({ type: "touch-pointer", pointerId: p.identifier, phase: "up", x: p.x, y: p.y, token: token("b") });
    }
    vi.advanceTimersByTime(300); // Matched identifiers outlive the short position-matching window.
    // A queued snapshot must not resurrect fingers whose pointerup arrived first.
    report({ type: "touches", points, token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    expect(posts.get("a")!.filter(m => (m as { type: string }).type === "own-touch").at(-1)).toMatchObject({ count: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an iframe omission snapshot releases a retired id for reuse in the same sequence", async () => {
    vi.useFakeTimers();
    const { wrapper, token, report, commands } = await framed();
    const points = [50, 100, 150, 200].map((x, identifier) => ({ identifier, x, y: 100, x0: x, y0: 100 }));
    const snapshot = (ids: number[]) => report({ type: "touches", token: token("a"), points: ids.map(i => points[i]) });
    snapshot([0, 1]);
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 99, clientX: 100, clientY: 100 });
    snapshot([0]);
    snapshot([0, 1]);
    pointer(window, "pointercancel", { pointerType: "touch", pointerId: 100 });
    snapshot([0, 1, 2]);
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    snapshot([0, 1, 2, 3]);
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
    snapshot([]);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pointerup matches only the nearest finger per snapshot and ignores distant or expired releases", async () => {
    vi.useFakeTimers();
    const { wrapper, token, report, posts } = await framed();
    const points = [50, 60, 70].map(x => ({ identifier: x, x, y: 100, x0: x, y0: 100, otherDocument: true }));
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 90, clientX: 500, clientY: 300 });
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 91, clientX: 50, clientY: 100 });
    vi.advanceTimersByTime(300);
    report({ type: "touches", points, token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(true);
    pointer(window, "pointerup", { pointerType: "touch", pointerId: 92, clientX: 60, clientY: 100 });
    // Two nearby survivors must still prime the blocker, not be consumed by the same lift.
    report({ type: "touches", points, token: token("a") });
    expect(posts.get("a")!.filter(m => (m as { type: string }).type === "own-touch").at(-1)).toMatchObject({ count: 2 });
  });

  it("pointer-only iframe reports can complete a still hold and unmatched releases end the sequence", async () => {
    vi.useFakeTimers();
    const { wrapper, token, report, commands } = await framed();
    for (let i = 0; i < 4; i++) report({ type: "down", pointerType: "touch", button: 0, pointerId: i,
      isPrimary: i === 0, x: 50 + i * 20, y: 50, token: token("a"),
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
    key({ code: "Escape", key: "Escape" });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape", key: "Escape" }));
    for (let i = 0; i < 4; i++) report({ type: "touch-pointer", pointerId: i, phase: i % 2 ? "up" : "cancel", token: token("a") });
    await nextTick();
    expect(wrapper.find(".split-tabs-pane-cover").exists()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["shell", "iframe"])("a fresh primary touch in the %s discards a removed target's stranded fingers", async where => {
    vi.useFakeTimers();
    const { wrapper, token, report, commands } = await framed();
    const stale = document.createElement("button");
    wrapper.element.append(stale);
    stale.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [
      { identifier: 1, target: stale, clientX: 50, clientY: 50 },
    ] as unknown as Touch[] }));
    stale.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [
      { identifier: 1, target: stale, clientX: 150, clientY: 150 },
    ] as unknown as Touch[] }));
    stale.remove(); // Its native release cannot reach the shell anymore.
    const points = Array.from({ length: 4 }, (_, i) => ({ identifier: i + 1, x: 200 + i * 20, y: 200, x0: 200 + i * 20, y0: 200 }));
    if (where === "iframe") {
      report({ type: "down", pointerType: "touch", isPrimary: true, pointerId: 40, x: 200, y: 200, button: 0,
        token: token("a"), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
      for (let n = 1; n <= 4; n++) report({ type: "touches", points: points.slice(0, n), token: token("a") });
    } else {
      const target = wrapper.get(".split-tabs-pane").element;
      pointer(target, "pointerdown", { pointerType: "touch", isPrimary: true, pointerId: 40, clientX: 200, clientY: 200 });
      for (let n = 1; n <= 4; n++) {
        const touches = points.slice(0, n).map(p => ({ identifier: p.identifier, target, clientX: p.x, clientY: p.y })) as unknown as Touch[];
        target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches, changedTouches: touches.slice(-1) }));
      }
    }
    vi.advanceTimersByTime(500);
    expect(commands).toEqual([["fourFingerHold", { ok: true }]]);
  });

  it("a press on the already focused pane clears the selection", async () => {
    const { c, token, report } = await framed();
    c.focusPane(c.paneOf("a")!);
    c.toggleSelected(c.paneOf("b")!);
    expect(c.selection.value).toHaveLength(2);
    report({ ...down, token: token("a") });
    expect(c.selection.value).toEqual([]);
  });
});

describe("content never remounts", () => {
  it.each([false, true])("moving a tab keeps the same content element (overlay %s)", async (overlay) => {
    const { c, wrapper } = await fixture({ overlay });
    await nextTick();
    await nextTick();
    const before = document.querySelector('[data-tab="b"]');
    expect(before).not.toBeNull();
    const parent = before!.parentElement;
    c.move({ view: "b" }, { kind: "split", target: c.panes.value[0]!.id, side: "right" });
    await nextTick();
    await nextTick();
    expect(document.querySelector('[data-tab="b"]')).toBe(before);
    if (overlay) expect(before!.parentElement).toBe(parent);
    else expect(before!.closest(".split-tabs-pane")?.getAttribute("data-pane-id")).toBe(c.paneOf("b"));
    wrapper.unmount();
  });

  it("a host pane anchor receives kept content", async () => {
    const c = controller();
    c.setContainerSize(600, 400);
    const Host = defineComponent(() => () => h(SplitTabs, { controller: c, labels: { divider: "Resize" } }, {
      pane: () => h(SplitTabsAnchor, { part: "body" }),
      keep: () => h(SplitTabsKeep, { tab: "a", part: "body" }, () => h("p", { class: "mine" }, "A")),
    }));
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    await nextTick();
    expect(wrapper.find(".split-tabs-pane .mine").exists()).toBe(true);
    wrapper.unmount();
    c.dispose();
  });
});

describe("undo offer", () => {
  it("every close is offered for a full undoTimeout, even when an earlier offer was still running", async () => {
    vi.useFakeTimers();
    const { c } = await fixture();
    c.tabNext();
    c.tabNext();
    const [first, second] = c.panes.value.flatMap(p => c.tabSet(p.id)?.tabs ?? []).filter(t => c.isPlaceholder(t));
    expect(c.close(first!)).toEqual({ ok: true });
    await nextTick();
    vi.advanceTimersByTime(6000);
    expect(c.close(second!)).toEqual({ ok: true });
    await nextTick();
    vi.advanceTimersByTime(6000);
    expect(c.canUndo.value).toBe(true);
    vi.advanceTimersByTime(2001);
    expect(c.canUndo.value).toBe(false);
  });
});
