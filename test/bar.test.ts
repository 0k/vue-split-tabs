import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SplitTabs, SplitTabStrip, SplitTabsAnchor, SplitTabsKeep, type Side, type SplitTabsController, type SplitTabsTabSet } from "../src/index.js";
import { controller, key, pointer, storage } from "./helpers.js";

const mounted: VueWrapper[] = [];
const controllers: SplitTabsController[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  for (const c of controllers.splice(0)) c.dispose();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementsFromPoint");
});
async function settle() { await nextTick(); await nextTick(); await nextTick(); }
async function fixture(side: Side = "top", tabs = ["a", "b", "c"]) {
  const c = controller({ tabs });
  controllers.push(c);
  c.setContainerSize(800, 600);
  c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: "right" });
  c.focusPane(c.paneOf("a")!);
  while (c.tabSet(c.focus.value)!.side !== side) c.cycleBarSide();
  const wrapper = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize" } }, slots: {
    pane: () => h(SplitTabsAnchor, { part: "body" }),
    frame: () => h("div", { class: "host-frame-content" }),
    tab: ({ id }: { id: string }) => `Host ${id}`,
    "bar-start": ({ tabSet }: { tabSet: { id: string } }) => h("button", { class: "host-start" }, tabSet.id),
    "bar-end": ({ tabSet }: { tabSet: { id: string } }) => h("button", { class: "host-add" }, tabSet.id),
    keep: () => tabs.map(tab => h(SplitTabsKeep, { tab, part: "body", overlay: true }, () => h("iframe", { title: tab }))),
  } });
  mounted.push(wrapper);
  await settle();
  return { c, wrapper, pane: () => wrapper.get<HTMLElement>(`[data-pane-id="${c.paneOf("a")}"]`) };
}

describe("library-owned bars", () => {
  // Acceptance: controller-reading policies reject at mount, with either restored or cached state;
  // tab-set-only policies and host-render booleans stay live through split and unsplit.
  it("rejects an alwaysShow controller read when mounting a restored split", () => {
    const s = storage(), saved = controller({ tabs: ["a", "b"], storage: s });
    saved.setContainerSize(800, 600);
    saved.move({ view: "b" }, { kind: "split", target: saved.focus.value, side: "right" });
    saved.dispose();
    const c = controller({ tabs: ["a", "b"], storage: s });
    controllers.push(c);
    c.setContainerSize(800, 600);
    expect(() => mount(SplitTabs, { props: {
      controller: c, labels: { divider: "Resize" }, alwaysShow: () => c.isSplit.value,
    } })).toThrow(/^split-tabs:.*alwaysShow policy must not read the controller/);
  });

  it.each(["focus", "panes", "tabSet"] as const)("rejects an alwaysShow %s read after a pre-mount move", member => {
    const c = controller({ tabs: ["a", "b"] });
    controllers.push(c);
    c.setContainerSize(800, 600);
    c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
    expect(() => mount(SplitTabs, { props: {
      controller: c, labels: { divider: "Resize" }, alwaysShow: (set: SplitTabsTabSet) => member === "focus" ? set.id === c.focus.value
        : member === "panes" ? c.panes.value.length > 1 : c.tabSet(set.id) !== undefined,
    } })).toThrow(/^split-tabs:.*alwaysShow policy must not read the controller/);
  });

  it("rejects even cached projection-derived reads and allows ordinary reads after replacing a rejected policy", () => {
    const c = controller({ tabs: ["a"] });
    controllers.push(c);
    c.setContainerSize(800, 600);
    const focus = c.focus.value;
    expect(c.isSplit.value).toBe(false);
    c.setAlwaysShow(() => c.focus.value === focus);
    expect(() => c.layout.value).toThrow(/^split-tabs:.*alwaysShow policy must not read the controller/);
    c.setAlwaysShow(false);
    expect(c.panes.value).toHaveLength(1);
    expect(c.focus.value).toBe(focus);
    expect(c.split("right").ok).toBe(true);
    expect(c.isSplit.value).toBe(true);
  });

  it.each(["tab-set argument", "host-render boolean"])("a safe alwaysShow %s updates through split and unsplit", async form => {
    const c = controller({ tabs: ["a"] });
    controllers.push(c);
    c.setContainerSize(800, 200);
    const Host = defineComponent(() => () => h(SplitTabs, { controller: c, labels: { divider: "Resize" },
      alwaysShow: form === "host-render boolean" ? c.hasSplit.value : (set: SplitTabsTabSet) => set.tabs.includes("a"),
    }));
    const wrapper = mount(Host);
    mounted.push(wrapper);
    await settle();
    expect(c.panes.value[0]!.showsBar).toBe(form === "tab-set argument");
    const result = c.split("right");
    expect(result.ok).toBe(true);
    await settle();
    expect(c.panes.value).toHaveLength(2);
    expect(c.panes.value.map(p => p.showsBar)).toEqual(form === "host-render boolean" ? [true, true] : [true, false]);
    expect(c.close(c.panes.value[1]!.view).ok).toBe(true);
    await settle();
    expect(c.panes.value).toHaveLength(1);
    expect(c.panes.value[0]!.showsBar).toBe(form === "tab-set argument");
  });

  // Acceptance: structural split -> bounded host rendering at collapse boundary;
  // heights/policy/zoom -> stable hasSplit; split/close -> changed hasSplit.
  it("the documented hasSplit policy settles with visible bars at the collapse boundary", async () => {
    const c = controller({ tabs: ["a", "b"], dividerSize: 6, barThickness: 32 });
    controllers.push(c);
    c.setContainerSize(800, 600);
    expect(c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "bottom" }).ok).toBe(true);
    c.setContainerSize(800, 200);
    let renders = 0;
    const errors: unknown[] = [];
    const Host = defineComponent(() => () => {
      if (++renders > 12) throw new Error("Structural split visibility did not settle");
      return h(SplitTabs, { controller: c, labels: { divider: "Resize" }, alwaysShow: c.hasSplit.value });
    });
    const wrapper = mount(Host, { global: { config: { errorHandler: error => errors.push(error) } } });
    mounted.push(wrapper);
    await settle();
    expect(errors).toEqual([]);
    expect(renders).toBeLessThan(5);
    expect(c.hasSplit.value).toBe(true);
    expect(c.isSplit.value).toBe(false);
    expect(c.panes.value).toHaveLength(1);
    expect(c.panes.value[0]!.showsBar).toBe(true);
    expect(wrapper.findAll(".split-tabs-bar")).toHaveLength(1);
  });

  it("hasSplit follows the unzoomed working tree, not size or bar policy", () => {
    const c = controller({ tabs: ["a"], dividerSize: 6, barThickness: 32 });
    controllers.push(c);
    c.setContainerSize(800, 600);
    expect(c.hasSplit.value).toBe(false);
    const split = c.split("bottom");
    expect(split.ok).toBe(true);
    if (!split.ok || split.view === undefined) throw new Error("Expected a split with a placeholder view");
    const pane = c.focus.value;
    const heights = Array.from({ length: 436 }, (_, index) => 165 + index);
    for (const show of [false, true]) {
      c.setAlwaysShow(show);
      for (const height of [...heights, ...heights.slice().reverse()]) {
        c.setContainerSize(800, height);
        expect(c.hasSplit.value, `height=${height}, alwaysShow=${show}`).toBe(true);
      }
    }
    c.setContainerSize(800, 600);
    expect(c.zoom(pane).ok).toBe(true);
    expect(c.isSplit.value).toBe(false);
    expect(c.hasSplit.value).toBe(true);
    expect(c.restore().ok).toBe(true);
    expect(c.close(split.view).ok).toBe(true);
    expect(c.hasSplit.value).toBe(false);
  });

  it("inline visibility policies settle without changing identical projection outputs", async () => {
    const s = storage(), c = controller({ tabs: ["a", "b"], storage: s });
    controllers.push(c);
    c.setContainerSize(800, 600);
    c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
    c.setSelection(c.panes.value.map(p => p.id));
    const show = ref(true), tick = ref(0), errors: unknown[] = [];
    let renders = 0;
    const Host = defineComponent(() => () => {
      // Fail safely instead of letting the broken production path hang the test runner.
      if (++renders > 12) throw new Error("Inline visibility policy did not settle");
      const values = [c.panes.value, c.frames.value, c.cuts.value, c.tabSets.value, c.fits.value, c.focus.value,
        c.selection.value, c.plan.value, c.barFocus.value, c.zoomed.value, c.canUndo.value, c.undoSerial.value,
        c.restoredActive.value, c.opened.value, c.intent.value, c.notation.value, c.layout.value, c.isSplit.value, c.orientation.value];
      return h("div", [h("span", `${tick.value}:${JSON.stringify(values)}`),
        h(SplitTabs, { controller: c, labels: { divider: "Resize" }, alwaysShow: () => show.value })]);
    });
    const wrapper = mount(Host, { global: { config: { errorHandler: error => errors.push(error) } } });
    mounted.push(wrapper);
    await settle();
    expect(errors).toEqual([]);
    expect(renders).toBeLessThan(5);
    const before = [c.layout.value, c.panes.value, c.tabSets.value, c.fits.value];
    tick.value++;
    await settle();
    expect([c.layout.value, c.panes.value, c.tabSets.value, c.fits.value].every((v, i) => v === before[i])).toBe(true);
    show.value = false;
    await settle();
    expect(c.panes.value.every(p => !p.showsBar)).toBe(true);
    show.value = true;
    await settle();
    expect(c.panes.value.every(p => p.showsBar)).toBe(true);
    expect(errors).toEqual([]);
    expect(renders).toBeLessThan(12);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("equal public computed values keep their identities after a policy rebuild", () => {
    const c = controller({ tabs: ["a", "b"] });
    controllers.push(c);
    c.setContainerSize(800, 600);
    c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
    c.setSelection(c.panes.value.map(p => p.id));
    c.setAlwaysShow(() => true);
    const values = () => [c.layout.value, c.panes.value, c.frames.value, c.cuts.value, c.tabSets.value,
      c.fits.value, c.selection.value, c.plan.value, c.opened.value, c.intent.value];
    const before = values();
    c.setAlwaysShow(() => true);
    expect(values().map((value, i) => value === before[i])).toEqual(before.map(() => true));
  });

  it("an equal replacement policy tracks its new reactive inputs", async () => {
    const c = controller({ tabs: ["a"] });
    controllers.push(c);
    c.setContainerSize(800, 600);
    const first = ref(true), second = ref(true), source = shallowRef({ input: first });
    const Host = defineComponent(() => () => {
      const input = source.value.input;
      return h(SplitTabs, { controller: c, labels: { divider: "Resize" }, alwaysShow: () => input.value });
    });
    const wrapper = mount(Host);
    mounted.push(wrapper);
    await settle();
    const layout = c.layout.value;
    source.value = { input: second };
    await settle();
    expect(c.layout.value).toBe(layout);
    second.value = false;
    await settle();
    expect(c.panes.value[0]!.showsBar).toBe(false);
    first.value = false;
    second.value = true;
    await settle();
    expect(c.panes.value[0]!.showsBar).toBe(true);
  });

  it("shown one-tab bars own bar-side commands and bar focus", async () => {
    const c = controller({ tabs: ["a"] });
    controllers.push(c);
    c.setContainerSize(800, 600);
    expect(c.cycleBarSide()).toEqual({ ok: false, reason: "no-bar" });
    c.setAlwaysShow(true);
    expect(c.cycleBarSide().ok).toBe(true);
    expect(c.panes.value[0]!.side).toBe("left");
    const { c: nested, wrapper } = await fixture();
    await wrapper.setProps({ alwaysShow: true });
    nested.focusPane(nested.paneOf("c")!);
    expect(nested.cycleBarSide()).toMatchObject({ ok: true, node: nested.paneOf("c") });
    nested.setSelection(nested.panes.value.map(p => p.id));
    nested.tabNext();
    const frame = [...nested.tabSets.value.values()].find(set => set.tabs.some(id => nested.describe(id)?.kind === "layout"))!;
    nested.select(frame.id, frame.tabs.find(id => nested.describe(id)?.kind === "layout")!);
    nested.focusPane(nested.paneOf("c")!);
    expect(nested.cycleBarSide()).toMatchObject({ ok: true, node: nested.paneOf("c") });
    expect(nested.tabSet(frame.id)!.side).toBe("top");
    await settle();
    await wrapper.get(`[data-bar-id="${nested.paneOf("c")}"] .split-tab-strip-tab`).trigger("click");
    expect(nested.barFocus.value).toBe(nested.paneOf("c"));
    const side = nested.tabSet(nested.paneOf("c")!)!.side;
    key({ code: "KeyR", key: "R", altKey: true, shiftKey: true });
    expect(nested.tabSet(nested.paneOf("c")!)!.side).not.toBe(side);
    expect(nested.tabSet(frame.id)!.side).toBe("top");
    await wrapper.setProps({ alwaysShow: false });
    nested.focusPane(nested.paneOf("c")!);
    expect(nested.cycleBarSide()).toMatchObject({ ok: true, node: frame.id });
  });

  it("frame slot content is an out-of-flow layer", async () => {
    const { c, wrapper } = await fixture();
    c.setSelection(c.panes.value.map(p => p.id));
    c.tabNext();
    const frame = [...c.tabSets.value.values()].find(set => set.tabs.some(id => c.describe(id)?.kind === "layout"))!;
    c.select(frame.id, frame.tabs.find(id => c.describe(id)?.kind === "layout")!);
    await settle();
    expect(wrapper.get(".host-frame-content").element.parentElement!.className).toBe("split-tabs-frame-slot");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.split-tabs-frame-slot\s*\{[^}]*position: absolute;[^}]*inset: 0;/);
  });

  it("a standalone plain strip still supplies host navigation without a pane or controller", async () => {
    const wrapper = mount(SplitTabStrip, { props: { tabs: ["a", "b"], active: "a" },
      slots: { tab: ({ id }: { id: string }) => `Host ${id}` } });
    mounted.push(wrapper);
    expect(wrapper.findAll(".split-tab-strip-tab").map(el => el.text())).toEqual(["Host a", "Host b"]);
    await wrapper.findAll(".split-tab-strip-tab")[1]!.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["b"]]);
    expect(wrapper.attributes("data-tab-set")).toBeUndefined();
  });
  it.each(["top", "left", "bottom", "right"] as const)("%s: bar is a sibling outside content and owns host labels/controls", async side => {
    const { wrapper, pane } = await fixture(side);
    const outer = pane().element.parentElement!;
    expect(outer.classList.contains("split-tabs-tabset")).toBe(true);
    expect(outer.dataset.tabsetId).toBe(pane().attributes("data-pane-id"));
    expect(outer.dataset.side).toBe(side);
    expect(pane().find(".split-tab-strip").exists()).toBe(false);
    const bar = outer.querySelector<HTMLElement>(":scope > .split-tabs-bar")!;
    expect(bar).not.toBeNull();
    expect(bar.dataset.barId).toBe(outer.dataset.tabsetId);
    expect(bar.querySelector(".split-tab-strip-tab")!.textContent).toBe("Host a");
    expect(bar.querySelector(".host-start")!.textContent).toBe(outer.dataset.tabsetId);
    expect(bar.querySelector(".host-add")!.textContent).toBe(outer.dataset.tabsetId);
    expect(wrapper.findAll("[data-pane-id]")).toHaveLength(2);
  });

  it.each(["top", "left", "bottom", "right"] as const)("%s: pane-only marks use content geometry", async side => {
    const { c, wrapper, pane } = await fixture(side);
    const outer = pane().element.parentElement!;
    const content = side === "top" ? new DOMRect(20, 62, 350, 458) : side === "bottom" ? new DOMRect(20, 30, 350, 458)
      : side === "left" ? new DOMRect(116, 30, 254, 490) : new DOMRect(20, 30, 254, 490);
    vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 800, 600));
    vi.spyOn(outer, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 350, 490));
    vi.spyOn(pane().element, "getBoundingClientRect").mockReturnValue(content);
    c.setSelection([c.focus.value]);
    await settle();
    const expected = { left: `${content.left - 10}px`, top: `${content.top - 20}px`, width: `${content.width}px`, height: `${content.height}px` };
    for (const selector of [".split-tabs-focus", ".split-tabs-selected-mark", ".split-tabs-selection"]) {
      const style = wrapper.get<HTMLElement>(selector).element.style;
      expect({ left: style.left, top: style.top, width: style.width, height: style.height }).toEqual(expected);
    }
    expect(outer.classList.contains("split-tabs-tabset")).toBe(true);
  });

  it("opacity ownership is content-only, including overlay content but never bars", async () => {
    const { c, wrapper } = await fixture();
    c.focusPane(c.paneOf("c")!);
    await settle();
    const a = wrapper.get('[data-split-tabs-keep="a"]');
    expect(a.classes()).not.toContain("split-tabs-keep--focused");
    const pane = wrapper.get(`[data-pane-id="${c.paneOf("a")}"]`).element;
    const bar = wrapper.get(`[data-bar-id="${c.paneOf("a")}"]`).element;
    expect(pane.contains(bar)).toBe(false);
    expect(bar.closest(".split-tabs-pane")).toBeNull();
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.split-tabs--multi \.split-tabs-pane:not\(\.split-tabs-pane--focused\)/);
    expect(css).toMatch(/\.split-tabs--multi \.split-tabs-keep--overlay:not\(\.split-tabs-keep--focused\)/);
  });

  it("pane-only covers and picker badges leave bar controls outside their owner", async () => {
    const { c, wrapper } = await fixture();
    key({ key: "A", code: "KeyA", altKey: true, shiftKey: true });
    await settle();
    for (const el of wrapper.findAll(".split-tabs-pane-cover, .split-tabs-pane-number")) {
      expect(el.element.parentElement!.hasAttribute("data-pane-id")).toBe(true);
      expect(el.element.parentElement!.querySelector(".split-tabs-bar")).toBeNull();
    }
    await wrapper.get('[data-split-tabs-tab="b"] .split-tab-strip-tab').trigger("click");
    expect(c.panes.value.find(p => p.id === c.paneOf("b"))!.view).toBe("b");
  });

  it("a pointer over the bar resolves only its next-to marker, never the pane middle", async () => {
    const { wrapper, pane } = await fixture();
    const bar = wrapper.get<HTMLElement>(".split-tabs-bar");
    vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
    vi.spyOn(bar.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 394, 32));
    vi.spyOn(pane().element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 32, 394, 568));
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [bar.element] });
    wrapper.vm.$.exposed!.startExternalDrag(new PointerEvent("pointerdown", { pointerId: 3, clientX: 200, clientY: 16 }), "external", { label: "X" });
    pointer(window, "pointermove", { clientX: 200, clientY: 16 });
    await settle();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-zone")).toBe("bar");
    key({ key: "Escape" });
  });

  it("visibility policy can keep an add control available for just one one-tab set", async () => {
    const { c, wrapper } = await fixture();
    const single = c.paneOf("c")!;
    await wrapper.setProps({ alwaysShow: (set: { id: string }) => set.id === single });
    expect(c.tabSet(single)!.showsBar).toBe(true);
    expect(wrapper.get<HTMLElement>(`[data-bar-id="${single}"]`).element.style.display).not.toBe("none");
    expect(wrapper.get(`[data-bar-id="${single}"] .host-add`).text()).toBe(single);
    await wrapper.setProps({ alwaysShow: false });
    expect(c.tabSet(single)!.showsBar).toBe(false);
    expect(wrapper.get<HTMLElement>(`[data-bar-id="${single}"]`).element.style.display).toBe("none");
  });

  it("frame bars belong to the tab set, while the frame slot belongs to content", async () => {
    const { c, wrapper } = await fixture();
    c.setSelection(c.panes.value.map(p => p.id));
    c.tabNext();
    const entry = [...c.tabSets.value.values()].find(set => set.tabs.some(id => c.describe(id)?.kind === "layout"))!;
    c.select(entry.id, entry.tabs.find(id => c.describe(id)?.kind === "layout")!);
    await settle();
    const frame = wrapper.get(".split-tabs-frame");
    expect(frame.find(":scope > .split-tabs-bar").exists()).toBe(true);
    expect(frame.get(".host-frame-content").element.parentElement!.className).toBe("split-tabs-frame-slot");
    expect(frame.get(".split-tabs-frame-content").find(":scope > .split-tabs-bar").exists()).toBe(false);
  });

  it("closing and undo preserve root visibility; unmount releases the presentation policy", async () => {
    const { c, wrapper } = await fixture();
    const single = c.paneOf("c")!;
    await wrapper.setProps({ alwaysShow: true });
    const result = c.tabNext();
    if (!result.ok || !result.view) throw new Error("Expected a placeholder tab");
    c.close(result.view);
    await settle();
    expect(c.tabSet(single)!.showsBar).toBe(true);
    c.undo();
    await settle();
    expect(c.tabSet(single)!.showsBar).toBe(true);
    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    expect(c.tabSet(single)!.showsBar).toBe(false);
  });
});

describe("bar minima", () => {
  it("keyboard nudges count nested cuts, frame bars and view bars in both subtrees", () => {
    const s = storage(), c = controller({ tabs: ["a", "b", "c", "d"], storage: s });
    controllers.push(c);
    c.setContainerSize(800, 1000);
    c.move({ view: "c" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
    c.move({ view: "b" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
    c.setSelection([c.paneOf("a")!, c.paneOf("b")!]);
    c.tabNext();
    const frame = [...c.tabSets.value.values()].find(set => set.tabs.some(id => c.describe(id)?.kind === "layout"))!;
    c.select(frame.id, frame.tabs.find(id => c.describe(id)?.kind === "layout")!);
    c.setAlwaysShow(true);
    c.focusPane(c.paneOf("c")!);
    const root = c.layout.value;
    if (root.kind !== "cut") throw new Error("Expected the outer cut");
    c.setRatioLive(0, root.id);
    const lower = c.cuts.value.get(root.id)!.ratio;
    expect(lower).toBeCloseTo((32 + 112 + c.dividerSize + 112) / (1000 - c.dividerSize));
    c.setRatioLive(0.5, root.id);
    expect(c.nudge(-10000).ok).toBe(true);
    expect(c.intent.value.tree).toMatchObject({ ratio: lower });
    const writes = s.setItem.mock.calls.length;
    expect(c.nudge(-24)).toEqual({ ok: false, reason: "at-limit" });
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });

  it.each(["rows", "cols"] as const)("%s: keyboard nudges use the same subtree minima as divider drags", axis => {
    const s = storage(), c = controller({ tabs: ["a", "b", "c", "d"], storage: s });
    controllers.push(c);
    c.setContainerSize(600, 400);
    c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: axis === "rows" ? "bottom" : "right" });
    c.focusPane(c.paneOf("a")!);
    c.setAlwaysShow(true);
    if (axis === "cols") {
      c.cycleBarSide();
      c.setBarWidth(c.focus.value, 120);
    }
    const id = [...c.cuts.value.keys()][0]!;
    const ratio = () => c.cuts.value.get(id)!.ratio;
    c.setRatioLive(0, id);
    const lower = ratio();
    c.setRatioLive(1, id);
    const upper = ratio();
    c.setRatioLive(0.5, id);
    expect(c.nudge(-10000).ok).toBe(true);
    expect(c.intent.value.tree).toMatchObject({ ratio: lower });
    const writes = s.setItem.mock.calls.length;
    expect(c.nudge(-24)).toEqual({ ok: false, reason: "at-limit" });
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    expect(c.nudge(10000).ok).toBe(true);
    expect(ratio()).toBeCloseTo(upper);
    const last = s.setItem.mock.calls.length;
    expect(c.nudge(24)).toEqual({ ok: false, reason: "at-limit" });
    expect(s.setItem).toHaveBeenCalledTimes(last);
  });

  it.each(["top", "bottom", "left", "right"] as const)("%s bars count in divider clamps and size collapse", side => {
    const c = controller({ tabs: ["a", "b", "c"] });
    c.setContainerSize(1000, 800);
    c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: side === "top" || side === "bottom" ? "bottom" : "right" });
    c.focusPane(c.paneOf("a")!);
    while (c.tabSet(c.focus.value)!.side !== side) c.cycleBarSide();
    c.setRatioLive(0);
    const first = c.panes.value[0]!;
    if (side === "left" || side === "right") {
      expect(first.width).toBeCloseTo(196);
      c.setContainerSize(290, 800);
    } else {
      expect(first.height).toBeCloseTo(112);
      c.setContainerSize(1000, 190);
    }
    expect(c.panes.value).toHaveLength(1);
    expect(c.panes.value[0]!.collapsed).toBe(true);
    c.setContainerSize(1000, 800);
    expect(c.panes.value).toHaveLength(2);
    c.dispose();
  });

  it("always-shown one-tab bars count in collapse/clamps without saving presentation", () => {
    const s = storage();
    const c = controller({ tabs: ["a", "b"], storage: s });
    c.setContainerSize(600, 400);
    c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "bottom" });
    const intent = JSON.stringify(c.intent.value);
    const writes = s.setItem.mock.calls.length;
    c.setAlwaysShow(true);
    c.setRatioLive(0);
    expect(c.panes.value[0]!.height).toBeCloseTo(112);
    c.setContainerSize(600, 210);
    expect(c.panes.value).toHaveLength(1);
    c.setAlwaysShow(false);
    expect(c.panes.value).toHaveLength(2);
    expect(JSON.stringify(c.intent.value)).toBe(intent);
    expect(s.setItem.mock.calls.length).toBe(writes);
    c.dispose();
  });

  it("live side-bar width counts in clamps and equalization", () => {
    const c = controller({ tabs: ["a", "b", "c"] });
    c.setContainerSize(600, 400);
    c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: "right" });
    c.focusPane(c.paneOf("a")!);
    c.cycleBarSide();
    c.setBarWidthLive(c.focus.value, 250);
    c.setRatioLive(0);
    expect(c.panes.value[0]!.width).toBeCloseTo(350);
    c.equalize();
    expect(c.panes.value.map(p => Math.round(p.width))).toEqual([350, 244]);
    c.dispose();
  });
});
