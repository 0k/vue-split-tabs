import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, isReadonly, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { SplitTabs, SplitTabsGlyph, useSplitTabsPick, type SplitTabsPick } from "../src/index.js";
import { createPanePick } from "../src/pick.js";
import { controller, pointer } from "./helpers.js";

// Acceptance ledger (each named test below proves one boundary):
// glyphs: exact strip drawings; directional filled halves; move/close paths.
// eligibility: visible tab + >=2 effective panes, invalid requests preserve state.
// identity: index+1 numbering, folded panes excluded, readonly public state.
// placement: place/reveal/end in either mode; source/unknown choices stay open.
// input: capture digits/numpad, Escape propagation, outside pointer cancellation.
// lifecycle: no preview listeners, layout ids/order and visibility invalidation,
// root isolation/injection, exact listener removal and watcher disposal on unmount.
function splitController() {
  const c = controller();
  c.setContainerSize(1000, 800);
  c.split("d", "cols");
  return c;
}
function fixture() {
  const c = splitController();
  let pick: SplitTabsPick | undefined;
  const Probe = defineComponent({ setup() { pick = useSplitTabsPick(); return () => null; } });
  const wrapper = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize" } },
    slots: { keep: () => h(Probe) } });
  if (pick === undefined) throw new Error("root must provide its picker");
  return { c, pick, wrapper };
}

describe("shared glyphs", () => {
  it.each(["rows", "cols"] as const)("preserves the exact undirected %s strip drawing", orientation => {
    const wrapper = mount(SplitTabsGlyph, { props: { kind: "split", orientation } });
    expect(wrapper.attributes()).toMatchObject({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none",
      stroke: "currentColor", "stroke-width": "2", "data-direction": orientation });
    expect(wrapper.findAll("rect").map(rect => ["x", "y", "width", "height"].map(key => rect.attributes(key))))
      .toEqual(orientation === "rows" ? [["3", "3", "18", "7"], ["3", "14", "18", "7"]]
        : [["3", "3", "7", "18"], ["14", "3", "7", "18"]]);
    expect(wrapper.get("path").attributes("d")).toBe(orientation === "rows" ? "M3 12h18" : "M12 3v18");
    wrapper.unmount();
  });
  it.each([
    ["cols", "start", 0], ["cols", "end", 1], ["rows", "start", 0], ["rows", "end", 1],
  ] as const)("fills the destination half for %s/%s", (orientation, side, filled) => {
    const wrapper = mount(SplitTabsGlyph, { props: { kind: "split", orientation, side } });
    expect(wrapper.attributes("data-orientation")).toBe(orientation);
    expect(wrapper.attributes("data-side")).toBe(side);
    expect(wrapper.find("path").exists()).toBe(false);
    expect(wrapper.findAll("rect").map(rect => rect.attributes("fill") ?? "none"))
      .toEqual(filled === 0 ? ["currentColor", "none"] : ["none", "currentColor"]);
    wrapper.unmount();
  });
  it("renders the move square/arrow and the existing round-capped close", () => {
    const move = mount(SplitTabsGlyph, { props: { kind: "move" } });
    expect(move.get("rect").attributes()).toMatchObject({ x: "3", y: "3", width: "18", height: "18", rx: "2" });
    expect(move.get("path").attributes()).toMatchObject({ d: "M8 12h8m-3-3 3 3-3 3", "stroke-linecap": "round",
      "stroke-linejoin": "round" });
    const close = mount(SplitTabsGlyph, { props: { kind: "close" } });
    expect(close.get("path").attributes()).toMatchObject({ d: "m6 6 12 12M6 18 18 6", "stroke-linecap": "round" });
    move.unmount(); close.unmount();
  });
});

describe("pane picker", () => {
  it.each(["preview", "start"] as const)("%s rejects hidden/absent tabs and fewer than two panes without changing state", method => {
    const c = controller({ optional: ["b"] });
    const pick = createPanePick(c);
    expect(pick[method]("a")).toBe(false);
    c.setContainerSize(1000, 800); c.split("d", "cols");
    expect(pick[method]("b")).toBe(false);
    expect(pick[method]("absent")).toBe(false);
    expect(pick.mode.value).toBeNull();
    expect(pick[method]("a")).toBe(true);
    expect(pick[method]("b")).toBe(false);
    expect(pick.tab.value).toBe("a");
    expect(pick.source.value).toBe(c.paneOf("a"));
    for (const state of [pick.mode, pick.tab, pick.source]) expect(isReadonly(state)).toBe(true);
    pick.dispose(); c.dispose();
  });
  it("numbers effective panes by index+1 and excludes folded leaves", () => {
    const c = splitController();
    c.split("c", "rows", c.panes.value[0]!.id);
    const pick = createPanePick(c);
    expect(c.panes.value.map(pane => pick.numberOf(pane.id))).toEqual([1, 2, 3]);
    const folded = c.panes.value[1]!.id;
    c.setContainerSize(1000, 100);
    expect(c.panes.value.map(pane => pick.numberOf(pane.id))).toEqual([1, 2]);
    expect(pick.numberOf(folded)).toBeNull();
    pick.dispose(); c.dispose();
  });
  it.each(["preview", "start"] as const)("%s chooses by number, calls place/reveals and clears all state", method => {
    const c = splitController();
    const pick = createPanePick(c);
    const target = c.panes.value[1]!.id;
    const place = vi.spyOn(c, "place");
    pick[method]("b"); pick.chooseNumber(2);
    expect(place).toHaveBeenCalledExactlyOnceWith("b", target, null);
    expect(c.panes.value[1]!.active).toBe("b");
    expect(c.paneOf("b")).toBe(target);
    expect([pick.mode.value, pick.tab.value, pick.source.value]).toEqual([null, null, null]);
    pick.dispose(); c.dispose();
  });
  it("keeps source, unknown and invalid number choices open, and ignores choices when idle", () => {
    const c = splitController(); const pick = createPanePick(c); const place = vi.spyOn(c, "place");
    pick.choose(c.panes.value[1]!.id);
    pick.start("a"); pick.choose(c.paneOf("a")!); pick.choose("unknown");
    for (const n of [0, -1, 1.5, 3, NaN]) pick.chooseNumber(n);
    expect(pick.mode.value).toBe("pick"); expect(place).not.toHaveBeenCalled();
    pick.cancel(); expect(pick.mode.value).toBeNull();
    pick.dispose(); c.dispose();
  });
  it("renders only digits, marks source and lets destination overlays choose", async () => {
    const { c, pick, wrapper } = fixture(); pick.preview("b"); await nextTick();
    expect(wrapper.findAll(".split-tabs-pane-number-badge").map(el => el.text())).toEqual(["1", "2"]);
    expect(wrapper.findAll('[data-mode="preview"]')).toHaveLength(2);
    expect(wrapper.findAll(".split-tabs-pane-number[data-current]")).toHaveLength(1);
    await wrapper.get(".split-tabs-pane-number:not([data-current])").trigger("click");
    expect(pick.mode.value).toBe("preview");
    pick.start("b"); await nextTick();
    await wrapper.get(".split-tabs-pane-number[data-current]").trigger("click");
    expect(pick.mode.value).toBe("pick");
    await wrapper.get(".split-tabs-pane-number:not([data-current])").trigger("click");
    expect(c.panes.value[1]!.active).toBe("b");
    expect(wrapper.find(".split-tabs-pane-number").exists()).toBe(false);
    wrapper.unmount(); c.dispose();
  });
  it.each(["Digit2", "Numpad2"])("handles %s via event.key in capture and prevents default", code => {
    const { c, pick, wrapper } = fixture(); pick.start("b");
    const event = new KeyboardEvent("keydown", { key: "2", code, bubbles: true, cancelable: true });
    const stop = (e: Event) => e.stopPropagation(); document.body.addEventListener("keydown", stop);
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(c.panes.value[1]!.active).toBe("b"); expect(pick.mode.value).toBeNull();
    document.body.removeEventListener("keydown", stop); wrapper.unmount(); c.dispose();
  });
  it("Escape cancels and stops propagation; unrelated keys do nothing", () => {
    const { c, pick, wrapper } = fixture(); pick.start("b");
    const bubble = vi.fn(); document.body.addEventListener("keydown", bubble);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(pick.mode.value).toBe("pick"); bubble.mockClear();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pick.mode.value).toBeNull(); expect(bubble).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", bubble); wrapper.unmount(); c.dispose();
  });
  it("pointerdown inside its overlay stays open, outside including a foreign root cancels", async () => {
    const one = fixture(), two = fixture(); one.pick.start("b"); two.pick.start("b"); await nextTick();
    pointer(one.wrapper.get(".split-tabs-pane-number-badge").element, "pointerdown");
    expect(one.pick.mode.value).toBe("pick"); expect(two.pick.mode.value).toBeNull();
    pointer(document.body, "pointerdown"); expect(one.pick.mode.value).toBeNull();
    for (const f of [one, two]) { f.wrapper.unmount(); f.c.dispose(); }
  });
  it("preview registers no window listeners and switching back from pick removes them", () => {
    const { c, pick, wrapper } = fixture();
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    pick.preview("b"); expect(add).not.toHaveBeenCalled();
    pick.start("b");
    const calls = add.mock.calls.filter(([type]) => type === "keydown" || type === "pointerdown");
    expect(calls.map(([type]) => type).sort()).toEqual(["keydown", "pointerdown"]);
    pick.preview("b");
    for (const [type, listener, options] of calls) expect(remove).toHaveBeenCalledWith(type, listener, options);
    add.mockRestore(); remove.mockRestore(); wrapper.unmount(); c.dispose();
  });
  it.each(["preview", "start"] as const)("%s cancels on layout changes or the tab leaving visible tabs", async method => {
    const tabs = ref(["a", "b", "c", "d"]);
    const c = controller({ tabs }); c.setContainerSize(1000, 800); c.split("d", "cols");
    const pick = createPanePick(c); pick[method]("b");
    c.setContainerSize(50, 50); await nextTick(); expect(pick.mode.value).toBeNull();
    c.setContainerSize(1000, 800); pick[method]("b");
    tabs.value = ["a", "c", "d"]; await nextTick(); expect(pick.mode.value).toBeNull();
    pick.dispose(); c.dispose();
  });
  it("cancels on pane order changes but not active selection or geometry-only changes", async () => {
    const c = splitController(); const panes = ref([...c.panes.value]);
    const pick = createPanePick({ ...c, panes: computed(() => panes.value) }); pick.start("b");
    panes.value = panes.value.map(p => ({ ...p, id: p.id, active: "c", width: p.width + 1 })); await nextTick();
    expect(pick.mode.value).toBe("pick");
    panes.value = [...panes.value].reverse(); await nextTick(); expect(pick.mode.value).toBeNull();
    pick.dispose(); c.dispose();
  });
  it("returns undefined outside a root and removes exact listeners/watchers on root unmount", async () => {
    let outside: SplitTabsPick | undefined;
    const probe = mount(defineComponent({ setup() { outside = useSplitTabsPick(); return () => null; } }));
    expect(outside).toBeUndefined(); probe.unmount();
    const { c, pick, wrapper } = fixture();
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    pick.start("b"); const calls = [...add.mock.calls]; wrapper.unmount();
    for (const [type, listener, options] of calls) expect(remove).toHaveBeenCalledWith(type, listener, options);
    expect(pick.mode.value).toBeNull();
    expect(pick.start("b")).toBe(false);
    c.merge(); await nextTick(); expect(pick.mode.value).toBeNull();
    add.mockRestore(); remove.mockRestore(); c.dispose();
  });
});
