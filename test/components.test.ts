import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { SplitTabs, SplitTabStrip, SplitTabsAnchor, SplitTabsKeep, type Orientation, type SplitTabsController } from "../src/index";
import { controller, labels, pointer, rect, storage } from "./helpers";

function layout(c = controller()) {
  const wrapper = mount(SplitTabs, {
    attachTo: document.body,
    props: { controller: c, labels: { divider: "Resize panes" }, stripLabels: labels },
  });
  rect(wrapper.element);
  return { c, wrapper };
}
function startSplit(o: Orientation = "cols") {
  const c = controller();
  c.setContainerSize(606, 406);
  c.split("b", o);
  return layout(c);
}

// Acceptance ledger: label + first-icon close grouped in an active title span,
// no selection/drag side effects, conditional end slot outside items, no drop target.
describe("on-demand strip controls", () => {
  // splitButtons acceptance: default-on in both layouts; false removes only
  // split/move controls, keeping close/end and keyboard reorder/focus alive.
  it.each([false, true])("splitButtons only disables split/move icons, split layout=%s", async (split) => {
    const c = controller({ optional: ["b"] });
    c.open("b", 0);
    c.setContainerSize(606, 406);
    if (split) c.split("d", "cols");
    const wrapper = mount(SplitTabStrip, { attachTo: document.body, props: {
      controller: c, pane: 0, labels: { ...labels, close: "Close" },
    }, slots: { end: () => h("button", { type: "button" }, "Add") } });
    expect(wrapper.findAll(".split-tab-strip-send")).toHaveLength(split ? 3 : 8);
    await wrapper.setProps({ splitButtons: false });
    expect(wrapper.find(".split-tab-strip-send").exists()).toBe(false);
    expect(wrapper.get(".split-tab-strip-end").text()).toBe("Add");
    expect(wrapper.findAll(".split-tab-strip-close")).toHaveLength(1);
    const button = wrapper.get<HTMLButtonElement>('[data-split-tabs-tab="a"] .split-tab-strip-tab');
    button.element.focus();
    await button.trigger("keydown", { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(c.panes.value[0]?.tabs).toEqual(split ? ["c", "a", "b"] : ["c", "a", "d", "b"]);
    expect(document.activeElement).toBe(button.element);
    await wrapper.get(".split-tab-strip-close").trigger("click");
    expect(c.paneOf("b")).toBeNull();
    await wrapper.setProps({ splitButtons: true });
    expect(wrapper.findAll(".split-tab-strip-send")).toHaveLength(split ? 2 : 6);
  });

  it("renders close only for optional tabs with a close label and closes without selecting or dragging", async () => {
    const c = controller({ optional: ["b"] });
    c.open("b", 0);
    c.select(0, "a");
    const wrapper = mount(SplitTabs, { attachTo: document.body, props: {
      controller: c, labels: { divider: "Resize" }, stripLabels: { ...labels, close: "Close tab" },
    } });
    const close = wrapper.get<HTMLButtonElement>(".split-tab-strip-close");
    expect(wrapper.findAll(".split-tab-strip-close")).toHaveLength(1);
    expect(close.element.closest("[data-split-tabs-tab]")?.getAttribute("data-split-tabs-tab")).toBe("b");
    expect(close.element.parentElement?.classList.contains("split-tab-strip-title")).toBe(true);
    expect(close.attributes("aria-label")).toBe("Close tab");
    expect(close.attributes("title")).toBe("Close tab");
    expect(close.get("svg").attributes("stroke-width")).toBe("2");
    expect(close.element.tabIndex).toBe(0);
    expect(wrapper.find("button button").exists()).toBe(false);
    const select = vi.spyOn(c, "select");
    pointer(close.element, "pointerdown");
    pointer(window, "pointermove", { clientX: 100 });
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    pointer(window, "pointerup");
    await close.trigger("click");
    expect(select).not.toHaveBeenCalled();
    expect(c.panes.value[0]?.active).toBe("a");
    expect(c.paneOf("b")).toBeNull();
    expect(wrapper.find(".split-tab-strip-close").exists()).toBe(false);
  });

  it("puts close immediately after the label in the title span, before split/move icons, with the host hook", async () => {
    const c = controller({ optional: ["b"] });
    c.open("b", 0);
    c.setContainerSize(606, 406);
    const plain = mount(SplitTabStrip, { props: { controller: c, pane: 0, labels } });
    expect(plain.find(".split-tab-strip-close").exists()).toBe(false);
    const wrapper = mount(SplitTabStrip, { props: {
      controller: c, pane: 0, labels: { ...labels, close: "Close" }, iconClass: "host-icon",
    } });
    const item = wrapper.get('[data-split-tabs-tab="b"]');
    const title = item.get(".split-tab-strip-title");
    expect(title.element.tagName).toBe("SPAN");
    expect(item.element.firstElementChild).toBe(title.element);
    expect([...title.element.children].map((child) => child.className))
      .toEqual(["split-tab-strip-tab split-tab-strip-tab--active", "split-tab-strip-close host-icon"]);
    expect(item.get(".split-tab-strip-close").classes()).toContain("host-icon");
    expect([...item.element.children].slice(1).map((child) => child.className))
      .toEqual(["split-tab-strip-send host-icon", "split-tab-strip-send host-icon"]);
    expect(title.classes()).toContain("split-tab-strip-title--active");
    expect(title.get(".split-tab-strip-tab").attributes("aria-pressed")).toBe("true");
    c.select(0, "a");
    await nextTick();
    expect(title.classes()).not.toContain("split-tab-strip-title--active");
    expect(title.get(".split-tab-strip-tab").classes()).not.toContain("split-tab-strip-tab--active");
    c.split("d", "cols");
    await nextTick();
    expect([...item.element.children].slice(1).map((child) => child.className)).toEqual(["split-tab-strip-send host-icon"]);
  });

  it("renders end only when provided, after tabs and outside items, without changing visibility", () => {
    const props = { tabs: ["a"], active: "a" };
    const absent = mount(SplitTabStrip, { props });
    expect(absent.find(".split-tab-strip-end").exists()).toBe(false);
    const wrapper = mount(SplitTabStrip, { attachTo: document.body, props,
      slots: { end: () => h("button", { type: "button" }, "Add") },
    });
    expect(wrapper.isVisible()).toBe(false);
    const end = wrapper.get(".split-tab-strip-end");
    expect(end.text()).toBe("Add");
    expect(end.element).toBe(wrapper.element.lastElementChild);
    expect(end.element.previousElementSibling?.classList.contains("split-tab-strip-item")).toBe(true);
    expect(end.element.closest("[data-split-tabs-tab]")).toBeNull();
    expect(end.attributes("draggable")).not.toBe("true");
  });

  it("does not start a drag from end content or accept drops over it", async () => {
    const c = controller();
    const wrapper = mount(SplitTabs, { attachTo: document.body,
      props: { controller: c, labels: { divider: "Resize" } },
      slots: { pane: () => h(SplitTabStrip, { controller: c, pane: 0, labels }, {
        end: () => h("button", { type: "button" }, "Add"),
      }) },
    });
    const end = wrapper.get(".split-tab-strip-end button").element;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => end });
    const place = vi.spyOn(c, "place");
    pointer(end, "pointerdown");
    pointer(window, "pointermove", { clientX: 100 });
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    pointer(window, "pointerup");
    pointer(wrapper.get(".split-tab-strip-tab").element, "pointerdown");
    pointer(window, "pointermove", { clientX: 100 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-marker").exists()).toBe(false);
    pointer(window, "pointerup", { clientX: 100 });
    expect(place).not.toHaveBeenCalled();
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
  });
});

describe("SplitTabs", () => {
  it("renders a selectable default strip without offering unlabelled controls", async () => {
    const c = controller();
    const wrapper = mount(SplitTabs, { props: { controller: c, labels: { divider: "Resize" } } });
    expect(wrapper.findAll(".split-tab-strip-tab").map((t) => t.text())).toEqual(["a", "b", "c", "d"]);
    await wrapper.findAll(".split-tab-strip-tab")[1]?.trigger("click");
    expect(c.panes.value[0]?.active).toBe("b");
    expect(wrapper.find(".split-tab-strip-send").exists()).toBe(false);
    expect(wrapper.find(".split-tabs-anchor").exists()).toBe(true);
  });
  it("renders single/split layout and default slots, labels, sizing and anchors", async () => {
    const { c, wrapper } = layout();
    expect(wrapper.classes()).toContain("split-tabs--single");
    expect(wrapper.findAll(".split-tabs-pane")).toHaveLength(1);
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--rows");
    expect(wrapper.findAll(".split-tabs-pane")).toHaveLength(2);
    expect(wrapper.findAll(".split-tabs-anchor")).toHaveLength(2);
    expect(wrapper.get("[data-split-tabs-pane='0']").attributes("style")).toContain("flex-basis");
    const divider = wrapper.get("[role=separator]");
    expect(divider.attributes()).toEqual(expect.objectContaining({ "aria-label": "Resize panes", "aria-orientation": "horizontal", "aria-valuenow": "50", tabindex: "0" }));
    c.merge();
    c.split("b", "cols");
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--cols");
    expect(wrapper.get("[role=separator]").attributes("aria-orientation")).toBe("vertical");
  });

  it("exposes scoped pane slot and renders keep slot once", () => {
    const c = controller();
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    const keep = vi.fn(() => h("span", "kept"));
    const wrapper = mount(SplitTabs, {
      props: { controller: c, labels: { divider: "Divider" } },
      slots: { pane: ({ pane }: { pane: { index: number; tabs: readonly string[] } }) => h("p", `${pane.index}:${pane.tabs.join(",")}`), keep },
    });
    expect(wrapper.findAll("p").map((p) => p.text())).toEqual(["0:a,c,d", "1:b"]);
    expect(wrapper.get(".split-tabs-keep-holder").text()).toBe("kept");
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("observes root size and disconnects; works without ResizeObserver", async () => {
    let notify: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class Observer {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", Observer);
    const { c, wrapper } = layout();
    expect(observe).toHaveBeenCalledWith(wrapper.element);
    notify?.([{ contentRect: new DOMRect(0, 0, 206, 166) } as ResizeObserverEntry], new Observer(() => undefined));
    expect(c.fits.value).toEqual({ rows: true, cols: true });
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.stubGlobal("ResizeObserver", undefined);
    expect(() => layout()).not.toThrow();
    await nextTick();
  });

  it.each(["rows", "cols"] as const)("maps %s divider pointers relative to root, guards mouse and foreign pointers", async (o) => {
    const { c, wrapper } = startSplit(o);
    const divider = wrapper.get("[role=separator]").element;
    const commit = vi.spyOn(c, "commitRatio");
    pointer(divider, "pointerdown", { pointerType: "mouse", button: 2 });
    pointer(window, "pointermove", { clientX: 443, clientY: 313 });
    expect(c.ratio.value).toBe(0.5);
    vi.spyOn(divider, "setPointerCapture").mockImplementation(() => { throw new Error("no capture"); });
    pointer(divider, "pointerdown");
    pointer(window, "pointermove", { pointerId: 4, clientX: 999, clientY: 999 });
    expect(c.ratio.value).toBe(0.5);
    pointer(window, "pointermove", { clientX: 443, clientY: 313 });
    await nextTick();
    expect(wrapper.classes()).toContain("split-tabs--resizing");
    expect(c.ratio.value).toBeCloseTo(0.7, 2);
    pointer(window, "pointerup");
    pointer(window, "pointercancel");
    expect(commit).toHaveBeenCalledTimes(1);
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--resizing");
  });

  it("commits divider cancel once and removes window listeners on cancel/unmount", () => {
    const { c, wrapper } = startSplit();
    const commit = vi.spyOn(c, "commitRatio");
    const live = vi.spyOn(c, "setRatioLive");
    pointer(wrapper.get("[role=separator]").element, "pointerdown");
    pointer(window, "pointermove", { clientX: 443 });
    pointer(window, "pointercancel");
    pointer(window, "pointerup");
    pointer(window, "pointermove", { clientX: 400 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
    pointer(wrapper.get("[role=separator]").element, "pointerdown");
    wrapper.unmount();
    const count = commit.mock.calls.length;
    pointer(window, "pointermove", { clientX: 500 });
    pointer(window, "pointerup");
    expect(live).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(count);
  });

  it.each(["rows", "cols"] as const)("centres the divider on double-click in %s with exactly one persisted write", async (o) => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", o);
    c.commitRatio(0.7);
    const { wrapper } = layout(c);
    const divider = wrapper.get(".split-tabs-divider");
    const commit = vi.spyOn(c, "commitRatio");
    s.setItem.mockClear();
    for (let i = 0; i < 2; i++) {
      pointer(divider.element, "pointerdown", { pointerType: "mouse", clientX: 450, clientY: 320 });
      pointer(window, "pointerup", { pointerType: "mouse", clientX: 450, clientY: 320 });
      divider.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: i + 1 }));
    }
    expect(commit).not.toHaveBeenCalled();
    await divider.trigger("dblclick");
    expect(commit).toHaveBeenCalledExactlyOnceWith(0.5);
    expect(divider.attributes("aria-valuenow")).toBe("50");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { ratio: number } }[] };
    expect(table.entries[0]?.intent.ratio).toBe(0.5);
  });

  it.each(["rows", "cols"] as const)("divider press without movement or axis movement in %s does not update or commit", (o) => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", o);
    c.commitRatio(0.7);
    const { wrapper } = layout(c);
    const divider = wrapper.get(".split-tabs-divider").element;
    const commit = vi.spyOn(c, "commitRatio");
    const live = vi.spyOn(c, "setRatioLive");
    s.setItem.mockClear();
    pointer(divider, "pointerdown", { clientX: 450, clientY: 320 });
    pointer(window, "pointerup", { clientX: 450, clientY: 320 });
    pointer(divider, "pointerdown", { clientX: 450, clientY: 320 });
    pointer(window, "pointermove", { clientX: 450, clientY: 320 });
    pointer(window, "pointermove", { clientX: o === "rows" ? 470 : 450, clientY: o === "cols" ? 340 : 320 });
    pointer(window, "pointercancel");
    expect(live).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(s.setItem).not.toHaveBeenCalled();
    expect(c.ratio.value).toBe(0.7);
  });

  it.each(["rows", "cols"] as const)("centres the focused divider on Enter in %s", async (o) => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", o);
    c.commitRatio(0.7);
    const { wrapper } = layout(c);
    const divider = wrapper.get<HTMLElement>(".split-tabs-divider");
    const commit = vi.spyOn(c, "commitRatio");
    s.setItem.mockClear();
    divider.element.focus();
    expect(document.activeElement).toBe(divider.element);
    await divider.trigger("keydown", { key: "Enter" });
    expect(commit).toHaveBeenCalledExactlyOnceWith(0.5);
    expect(divider.attributes("aria-valuenow")).toBe("50");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { ratio: number } }[] };
    expect(table.entries[0]?.intent.ratio).toBe(0.5);
  });

  it.each(["rows", "cols"] as const)("commits axis-specific keyboard steps and bounds for %s", async (o) => {
    const { c, wrapper } = startSplit(o);
    const divider = wrapper.get("[role=separator]");
    const axis = o === "rows" ? 400 : 600;
    await divider.trigger("keydown", { key: o === "rows" ? "ArrowDown" : "ArrowRight" });
    expect(c.ratio.value).toBeCloseTo(0.5 + 8 / axis);
    await divider.trigger("keydown", { key: o === "rows" ? "ArrowUp" : "ArrowLeft", shiftKey: true });
    expect(c.ratio.value).toBeCloseTo(0.5 - 24 / axis);
    const before = c.ratio.value;
    await divider.trigger("keydown", { key: o === "rows" ? "ArrowLeft" : "ArrowUp" });
    expect(c.ratio.value).toBe(before);
    await divider.trigger("keydown", { key: "Home" });
    expect(c.ratio.value).toBeCloseTo(o === "rows" ? 0.2 : 1 / 6);
    await divider.trigger("keydown", { key: "End" });
    expect(c.ratio.value).toBeCloseTo(o === "rows" ? 0.8 : 5 / 6);
  });
});

describe("Keep", () => {
  it("preserves one mount and local state across moves, collapse/restore and body/footer parts", async () => {
    const c = controller();
    const mounts = vi.fn();
    const Child = defineComponent({ setup() {
      const count = ref(0);
      onMounted(mounts);
      return () => h("button", { class: "counter", onClick: () => { count.value++; } }, String(count.value));
    } });
    const wrapper = mount(SplitTabs, {
      attachTo: document.body,
      props: { controller: c, labels: { divider: "Resize" } },
      slots: {
        pane: () => [h(SplitTabsAnchor, { part: "body" }), h(SplitTabsAnchor, { part: "footer" })],
        keep: () => [h(SplitTabsKeep, { tab: "b", part: "body" }, () => h(Child)), h(SplitTabsKeep, { tab: "b", part: "footer" }, () => h("footer", "actions"))],
      },
    });
    await nextTick();
    const original = wrapper.get(".counter").element;
    c.select(0, "b");
    await nextTick();
    await wrapper.get(".counter").trigger("click");
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    await nextTick();
    expect(wrapper.get("[data-split-tabs-pane='1'] .counter").text()).toBe("1");
    expect(wrapper.get("[data-split-tabs-pane='1'] footer").text()).toBe("actions");
    c.moveTo("a", 1);
    c.moveTo("b", 0);
    await nextTick();
    expect(wrapper.get("[data-split-tabs-pane='0'] .counter").element).toBe(original);
    c.moveTo("b", 1);
    await nextTick();
    c.setContainerSize(100, 100);
    await nextTick();
    expect(wrapper.get("[data-split-tabs-pane='0'] .counter").element).toBe(original);
    c.setContainerSize(606, 406);
    await nextTick();
    expect(wrapper.get("[data-split-tabs-pane='1'] .counter").element).toBe(original);
    expect(mounts).toHaveBeenCalledTimes(1);
    c.select(1, "a");
    await nextTick();
    expect(wrapper.get(".counter").element.parentElement?.style.display).toBe("none");
  });

  it("unregisters anchors and disables absent-tab teleport without remounting", async () => {
    const tabs = ref(["a", "b"]);
    const anchored = ref(true);
    const mounts = vi.fn();
    const Child = defineComponent({ setup() { onMounted(mounts); return () => h("span", { class: "kept" }, "state"); } });
    const c = controller({ tabs });
    const Host = defineComponent({ setup: () => () => h(SplitTabs, {
      controller: c, labels: { divider: "Resize" },
    }, { pane: () => anchored.value ? h(SplitTabsAnchor, { part: "body" }) : h("span", "No anchor"), keep: () => h(SplitTabsKeep, { tab: "b", part: "body" }, () => h(Child)) }) });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    const original = wrapper.get(".kept").element;
    anchored.value = false;
    await nextTick();
    expect(wrapper.get(".split-tabs-keep-holder .kept").element).toBe(original);
    anchored.value = true;
    await nextTick();
    tabs.value = ["a"];
    await nextTick();
    expect(wrapper.get(".split-tabs-keep-holder .kept").element).toBe(original);
    tabs.value = ["a", "b"];
    await nextTick();
    expect(wrapper.get(".split-tabs-anchor .kept").element).toBe(original);
    expect(mounts).toHaveBeenCalledTimes(1);
  });
});

describe("strip", () => {
  it("plain mode renders only host tab labels/classes, selects, hides, and supports alwaysShow", async () => {
    const wrapper = mount(SplitTabStrip, {
      attachTo: document.body,
      props: { tabs: ["a", "b"], active: "b", tabClass: "host-tab" },
      slots: { tab: ({ id, active }: { id: string; active: boolean }) => h("span", `${id}:${active}`) },
    });
    expect(wrapper.attributes("role")).toBeUndefined();
    expect(wrapper.findAll(".split-tab-strip-tab").map((t) => t.text())).toEqual(["a:false", "b:true"]);
    expect(wrapper.get("[aria-pressed=true]").classes())
      .toEqual(expect.arrayContaining(["host-tab", "split-tab-strip-tab--active"]));
    expect(wrapper.find(".split-tab-strip-send").exists()).toBe(false);
    expect(wrapper.classes()).not.toContain("split-tab-strip--draggable");
    await wrapper.get(".split-tab-strip-tab").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["a"]]);
    await wrapper.setProps({ tabs: ["a"] });
    expect(wrapper.isVisible()).toBe(false);
    await wrapper.setProps({ alwaysShow: true });
    expect(wrapper.isVisible()).toBe(true);
  });

  it("controller mode always shows split strips and selects through controller plus event", async () => {
    const { c, wrapper } = startSplit();
    const strip = wrapper.findAllComponents(SplitTabStrip)[1];
    expect(strip?.isVisible()).toBe(true);
    const first = wrapper.findAllComponents(SplitTabStrip)[0];
    await first?.findAll(".split-tab-strip-tab")[1]?.trigger("click");
    expect(c.panes.value[0]?.active).toBe("c");
    expect(first?.emitted("select")).toEqual([["c"]]);
  });

  it("markup uses separate icon buttons without changing tab text or nesting buttons", () => {
    const { wrapper } = startSplit();
    expect(wrapper.findAll(".split-tab-strip-tab").map((t) => t.text())).toEqual(["a", "c", "d", "b"]);
    expect(wrapper.find("button button").exists()).toBe(false);
    expect(wrapper.findAll(".split-tab-strip-send")).toHaveLength(4);
  });

  it.each(["rows", "cols"] as const)("direct orientation icons offer %s in one click with host labels/hooks", async (orientation) => {
    const c = controller();
    c.setContainerSize(orientation === "cols" ? 606 : 100, orientation === "rows" ? 406 : 100);
    const wrapper = mount(SplitTabStrip, { attachTo: document.body, props: { controller: c, pane: 0, labels, iconClass: "host-icon" } });
    const icons = wrapper.findAll(".split-tab-strip-send");
    expect(icons).toHaveLength(4);
    expect(icons.map((icon) => icon.attributes("data-orientation"))).toEqual(Array(4).fill(orientation));
    const icon = wrapper.get(`.split-tab-strip-send[data-orientation=${orientation}]`);
    expect(icon.attributes("aria-label")).toBe(labels[orientation]);
    expect(icon.attributes("title")).toBe(labels[orientation]);
    expect(icon.classes()).toContain("host-icon");
    expect(icon.get("svg").attributes("data-direction")).toBe(orientation);
    expect(icon.get("svg").attributes("stroke-width")).toBe("2");
    expect(icon.findAll("rect").map((r) => [r.attributes("width"), r.attributes("height")])).toEqual(orientation === "rows" ? [["18", "7"], ["18", "7"]] : [["7", "18"], ["7", "18"]]);
    expect(icon.get("path").attributes("d")).toBe(orientation === "rows" ? "M3 12h18" : "M12 3v18");
    await icon.trigger("click");
    expect(c.orientation.value).toBe(orientation);
    expect(c.paneOf("a")).toBe(1);
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
  });

  it("renders both direct orientations on every tab and no icons when unfit or fewer than two tabs", async () => {
    const { c, wrapper } = layout();
    c.setContainerSize(606, 406);
    await nextTick();
    expect(wrapper.findAll(".split-tab-strip-item").map((item) => item.findAll(".split-tab-strip-send").map((icon) => icon.attributes("data-orientation")))).toEqual(Array.from({ length: 4 }, () => ["rows", "cols"]));
    expect(wrapper.findAll(".split-tab-strip-tab").map((tab) => tab.text())).toEqual(["a", "b", "c", "d"]);
    expect(wrapper.find("button button").exists()).toBe(false);
    c.setContainerSize(0, 0);
    await nextTick();
    expect(wrapper.find(".split-tab-strip-send").exists()).toBe(false);
    const single = controller({ tabs: ["a"] });
    single.setContainerSize(606, 406);
    const strip = mount(SplitTabStrip, { props: { controller: single, pane: 0, labels, alwaysShow: true } });
    expect(strip.find(".split-tab-strip-send").exists()).toBe(false);
  });

  it("marks only the active item and retains inactive icon buttons in keyboard order", async () => {
    const { c, wrapper } = layout();
    c.setContainerSize(606, 406);
    await nextTick();
    expect(wrapper.findAll(".split-tab-strip-item--active .split-tab-strip-tab").map((tab) => tab.text())).toEqual(["a"]);
    const inactive = wrapper.findAll(".split-tab-strip-item")[2];
    const button = inactive?.get<HTMLButtonElement>(".split-tab-strip-send").element;
    expect(button?.disabled).toBe(false);
    expect(button?.tabIndex).toBe(0);
    button?.focus();
    expect(document.activeElement).toBe(button);
    c.select(0, "c");
    await nextTick();
    expect(wrapper.findAll(".split-tab-strip-item--active .split-tab-strip-tab").map((tab) => tab.text())).toEqual(["c"]);
  });

  it.each(["rows", "cols"] as const)("renders %s directional SVGs and sends a tab on icon click", async (o) => {
    const { c, wrapper } = startSplit(o);
    const icons = wrapper.findAll(".split-tab-strip-send");
    expect(icons[0]?.get("svg").attributes("data-direction")).toBe(o === "rows" ? "down" : "right");
    expect(icons[3]?.get("svg").attributes("data-direction")).toBe(o === "rows" ? "up" : "left");
    expect(icons[0]?.attributes("title")).toBe(labels.sendToOther);
    expect(icons[0]?.attributes("data-orientation")).toBeUndefined();
    expect(icons[0]?.get("svg").attributes("stroke-width")).toBe("2");
    expect(icons[0]?.findAll("svg rect")).toHaveLength(2);
    await icons[0]?.trigger("click");
    expect(c.paneOf("a")).toBe(1);
  });

  it("drag targeting requires >6px and the other pane in the same root", async () => {
    const { c, wrapper } = startSplit();
    const other = startSplit();
    const target = wrapper.get("[data-split-tabs-pane='1']").element;
    const hit = vi.fn((): Element => other.wrapper.get("[data-split-tabs-pane='1']").element);
    vi.stubGlobal("document", document);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
    const button = wrapper.get(".split-tab-strip-tab").element;
    pointer(button, "pointerdown", { clientX: 30, clientY: 30 });
    pointer(window, "pointermove", { clientX: 36, clientY: 30 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(false);
    pointer(window, "pointermove", { clientX: 40, clientY: 30 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(true);
    expect(other.wrapper.find(".split-tabs-pane--drop-target").exists()).toBe(false);
    hit.mockReturnValue(target);
    pointer(window, "pointermove", { clientX: 50, clientY: 30 });
    expect(target.classList.contains("split-tabs-pane--drop-target")).toBe(true);
    pointer(window, "pointerup", { clientX: 50, clientY: 30 });
    await nextTick();
    expect(c.paneOf("a")).toBe(1);
    expect(target.classList.contains("split-tabs-pane--drop-target")).toBe(false);
    await wrapper.get("[data-split-tabs-pane='0'] .split-tab-strip-tab").trigger("click");
  });

  it.each(["Escape", "pointercancel", "unmount"])("drag lifecycle cancels with %s and cleans listeners/highlights", async (end) => {
    const { c, wrapper } = startSplit();
    const target = wrapper.get("[data-split-tabs-pane='1']").element;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    const move = vi.spyOn(c, "place");
    pointer(wrapper.get(".split-tab-strip-tab").element, "pointerdown", { clientX: 0, clientY: 0 });
    pointer(window, "pointermove", { clientX: 10, clientY: 0 });
    if (end === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (end === "unmount") wrapper.unmount();
    else pointer(window, end);
    pointer(window, "pointerup", { clientX: 20, clientY: 0 });
    await nextTick();
    expect(move).not.toHaveBeenCalled();
    expect(target.classList.contains("split-tabs-pane--drop-target")).toBe(false);
  });

  it("suppresses the immediate pointer click after dragging even when dropped in the source pane", async () => {
    const { c, wrapper } = startSplit();
    const source = wrapper.get("[data-split-tabs-pane='0']").element;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => source });
    const select = vi.spyOn(c, "select");
    const button = wrapper.get(".split-tab-strip-tab");
    pointer(button.element, "pointerdown", { clientX: 0 });
    pointer(window, "pointermove", { clientX: 10 });
    pointer(window, "pointerup", { clientX: 10 });
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).not.toHaveBeenCalled();
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not start drag on secondary mouse or for unrelated pointers in either layout", async () => {
    const { c, wrapper } = layout();
    const button = wrapper.get(".split-tab-strip-tab").element;
    pointer(button, "pointerdown", { pointerType: "mouse", button: 2, clientX: 0 });
    pointer(window, "pointermove", { clientX: 10 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(false);
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    await nextTick();
    pointer(button, "pointerdown", { pointerType: "mouse", button: 2 });
    pointer(window, "pointermove", { clientX: 10 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(false);
    pointer(button, "pointerdown", { clientX: 0 });
    pointer(window, "pointermove", { pointerId: 9, clientX: 10 });
    pointer(window, "pointercancel", { pointerId: 9 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(false);
    pointer(window, "pointermove", { clientX: 10 });
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--dragging").exists()).toBe(true);
    pointer(window, "pointercancel");
  });
});
