import { mount } from "@vue/test-utils";
import { h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { SplitTabs, SplitTabStrip, type SplitTabsPane, type Orientation, type TabDropTarget } from "../src/index";
import { createTabDrag } from "../src/drag.js";
import { controller, labels, pointer, storage } from "./helpers";

function fixture(split = false, tabs: readonly string[] = ["a", "b", "c", "d"]) {
  const s = storage();
  const c = controller({ storage: s, tabs });
  c.setContainerSize(600, 400);
  if (split) c.split("b", "cols");
  const wrapper = mount(SplitTabs, { attachTo: document.body,
    props: { controller: c, labels: { divider: "Resize" }, stripLabels: labels },
    slots: { pane: ({ pane }: { pane: SplitTabsPane }) => [
      h(SplitTabStrip, { controller: c, pane: pane.id, labels, alwaysShow: true }, { tab: ({ id }: { id: string }) => h("em", `Label ${id}`) }),
      h("div", { class: "body" }, "Content"),
    ] },
  });
  const box = (el: Element, x: number, y: number, w: number, height: number) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, w, height));
  box(wrapper.element, 0, 0, 600, 400);
  for (const pane of wrapper.findAll(".split-tabs-pane")) {
    const x = pane.attributes("data-split-tabs-pane") === "1" ? 303 : 0;
    box(pane.element, x, 0, split ? 297 : 600, 400);
    box(pane.get(".body").element, x, 30, split ? 297 : 600, 370);
    box(pane.get(".split-tab-strip").element, x, 0, split ? 297 : 600, 30);
    pane.findAll(".split-tab-strip-item").forEach((item, i) => box(item.element, x + i * 80, 0, 80, 30));
  }
  const hit = vi.fn((): Element | null => wrapper.get(".split-tab-strip").element);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  s.setItem.mockClear();
  const start = (index = 0) => pointer(wrapper.findAll(".split-tab-strip-tab")[index]?.element ?? wrapper.element, "pointerdown", { clientX: 10, clientY: 10 });
  return { c, s, wrapper, hit, start };
}

// External acceptance ledger: immediate already-armed handoff, label/DOM clone,
// absent-id preview, same-root targets including one-tab edges, synchronous host
// registration before one controller insert, pointer identity, cancel/no-target/
// unmount/listener cleanup, no host mutation on cancellation and busy-drag guard.
describe("external drag handoff", () => {
  function handoff(wrapper: ReturnType<typeof fixture>["wrapper"], id: string, beforeDrop?: (target: TabDropTarget) => void) {
    const sidebar = document.createElement("button");
    sidebar.textContent = "Incoming";
    document.body.appendChild(sidebar);
    sidebar.addEventListener("pointermove", (event) => {
      const start: unknown = Reflect.get(wrapper.vm, "startExternalDrag");
      if (typeof start !== "function") {
        throw new Error("SplitTabs must expose startExternalDrag");
      }
      start(event, id, { label: "Incoming" }, labels, beforeDrop);
    }, { once: true });
    pointer(sidebar, "pointermove", { clientX: 170, clientY: 15 });
    return sidebar;
  }

  it("exposes a root method to hand over an absent id immediately and registers it only on a valid drop", async () => {
    const { c, s, wrapper } = fixture();
    const insert = vi.spyOn(c, "insert");
    const drop = vi.fn();
    handoff(wrapper, "incoming", drop);
    await nextTick();
    expect(document.querySelector(".split-tabs-drag-ghost")?.textContent).toBe("Incoming");
    expect(wrapper.get(".split-tab-strip-marker").attributes("data-before")).toBe("c");
    expect(drop).not.toHaveBeenCalled();
    pointer(window, "pointerup", { clientX: 170, clientY: 15 });
    expect(drop).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "place", pane: c.panes.value[0]!.id, beforeId: "c" }));
    expect(insert).toHaveBeenCalledExactlyOnceWith("incoming", c.panes.value[0]!.id, "c", expect.any(Function));
    expect(s.setItem).not.toHaveBeenCalled();
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
  });

  it("synchronously adds an optional absent id before insertion with one storage write", async () => {
    const tabs = ref(["a", "b"]);
    const s = storage();
    const c = controller({ tabs, optional: ["incoming"], storage: s });
    const wrapper = mount(SplitTabs, { attachTo: document.body,
      props: { controller: c, labels: { divider: "Resize" }, stripLabels: labels },
    });
    const strip = wrapper.get(".split-tab-strip").element;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => strip });
    const drop = vi.fn(() => { tabs.value.push("incoming"); });
    handoff(wrapper, "incoming", drop);
    await nextTick();
    expect(c.paneOf("incoming")).toBeNull();
    pointer(window, "pointerup", { clientX: 500, clientY: 15 });
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a", "b", "incoming"], active: "incoming" }]);
    expect(drop).toHaveBeenCalledTimes(1);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("previews a labelled half-pane for an absent external id even with only one visible tab", async () => {
    const { c, wrapper, hit } = fixture(false, ["a"]);
    hit.mockReturnValue(wrapper.get(".body").element);
    const insert = vi.spyOn(c, "insertSplit");
    handoff(wrapper, "incoming");
    pointer(window, "pointermove", { clientX: 590, clientY: 200 });
    await nextTick();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-side")).toBe("end");
    expect(wrapper.get(".split-tabs-drop-shade").text()).toBe(labels.cols);
    pointer(window, "pointerup", { clientX: 590, clientY: 200 });
    expect(insert).toHaveBeenCalledExactlyOnceWith("incoming", "cols", "end", c.panes.value[0]!.id);
  });

  it.each([0, 1] as const)("offers pane %i's body for an id that is not yet in any pane", async (pane) => {
    const { wrapper, hit } = fixture(true);
    hit.mockReturnValue(wrapper.get(`[data-split-tabs-pane='${pane}'] .body`).element);
    handoff(wrapper, "incoming");
    pointer(window, "pointermove", { clientX: pane === 0 ? 150 : 450, clientY: 200 });
    await nextTick();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-zone")).toBe("pane");
    expect(wrapper.get(`[data-split-tabs-pane='${pane}'] .split-tab-strip-marker`).attributes("data-before")).toBe("");
    pointer(window, "pointercancel");
  });

  it.each(["Escape", "pointercancel", "unmount", "outside", "foreign", "end-slot"])
    ('cancels external drag on %s without invoking the host', async (end) => {
    const { c, wrapper, hit } = fixture();
    const insert = vi.spyOn(c, "insert");
    const drop = vi.fn();
    handoff(wrapper, "incoming", drop);
    if (end === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (end === "pointercancel") pointer(window, "pointercancel");
    else if (end === "unmount") wrapper.unmount();
    else if (end === "outside") hit.mockReturnValue(null);
    else if (end === "end-slot") {
      const endSlot = document.createElement("div");
      endSlot.className = "split-tab-strip-end";
      wrapper.get(".split-tab-strip").element.appendChild(endSlot);
      hit.mockReturnValue(endSlot);
    } else {
      const foreign = fixture();
      hit.mockReturnValue(foreign.wrapper.get(".body").element);
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
    }
    pointer(window, "pointerup", { clientX: 170, clientY: 15 });
    await nextTick();
    pointer(window, "pointermove", { clientX: 200, clientY: 15 });
    expect(insert).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    expect(wrapper.find(".split-tab-strip-marker").exists()).toBe(false);
  });

  it("clones host markup, uses the same pointer id and listeners, and immediately arms touch without another hold", () => {
    const { c, wrapper } = fixture();
    const drag = createTabDrag(c, ref(wrapper.element as HTMLElement));
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const source = document.createElement("span");
    source.innerHTML = '<em>External label</em><button>Action</button>';
    document.body.appendChild(source);
    drag.startExternal(new PointerEvent("pointermove", { pointerId: 7, pointerType: "touch" }), "incoming", source, labels);
    expect(drag.armed.value).toBe("incoming");
    expect(drag.id.value).toBe("incoming");
    const ghost = document.querySelector(".split-tabs-drag-ghost");
    expect(ghost?.querySelector("em")?.textContent).toBe("External label");
    expect(ghost?.querySelector("button")?.tabIndex).toBe(-1);
    expect(source.querySelector("button")?.tabIndex).toBe(0);
    const touch = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    pointer(window, "pointerup", { pointerId: 8 });
    expect(drag.id.value).toBe("incoming");
    drag.startExternal(new PointerEvent("pointermove"), "other", { label: "Other" }, labels);
    expect(drag.id.value).toBe("incoming");
    pointer(window, "pointercancel", { pointerId: 7 });
    expect(drag.id.value).toBeNull();
    const listener = add.mock.calls.find(([name]) => name === "touchmove")?.[1];
    expect(remove).toHaveBeenCalledWith("touchmove", listener);
    for (const type of ["pointermove", "pointerup", "pointercancel", "keydown"]) {
      expect(remove).toHaveBeenCalledWith(type, add.mock.calls.find(([name]) => name === type)?.[1]);
    }
    const after = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    drag.dispose();
  });
});

describe("visual drops", () => {
  it("unsplit insertion shows a marker and cloned ghost, persists one reorder and reloads it", async () => {
    const { c, s, wrapper, start } = fixture();
    start();
    pointer(window, "pointermove", { clientX: 170, clientY: 15 });
    await nextTick();
    const marker = wrapper.get(".split-tab-strip-marker");
    expect(marker.attributes("data-before")).toBe("c");
    expect(marker.attributes("style")).toContain("left: 160px");
    const ghost = document.querySelector<HTMLElement>(".split-tabs-drag-ghost");
    expect(ghost?.querySelector("em")?.textContent).toBe("Label a");
    expect(ghost?.style.left).toBe("170px");
    expect(wrapper.get(".split-tab-strip-item--dragging .split-tab-strip-tab").text()).toBe("Label a");
    pointer(window, "pointerup", { clientX: 170, clientY: 15 });
    await nextTick();
    expect(c.panes.value[0]?.tabs).toEqual(["b", "a", "c", "d"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    const loaded = controller({ storage: s });
    expect(loaded.panes.value[0]?.tabs).toEqual(["b", "a", "c", "d"]);
    expect(wrapper.find(".split-tab-strip-marker").exists()).toBe(false);
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    loaded.dispose();
  });

  it.each([
    ["cols", "start", 10, 200, "297px", "400px"],
    ["cols", "end", 590, 200, "297px", "400px"],
    ["rows", "start", 300, 35, "600px", "197px"],
    ["rows", "end", 300, 390, "600px", "197px"],
  ] as const)("body edge offers %s %s with a half-root shade and splits there", async (orientation, side, x, y, width, height) => {
    const { c, s, wrapper, hit, start } = fixture();
    hit.mockReturnValue(wrapper.get(".body").element);
    start(2);
    pointer(window, "pointermove", { clientX: x, clientY: y });
    await nextTick();
    const shade = wrapper.get<HTMLElement>(".split-tabs-drop-shade");
    expect(shade.attributes("data-orientation")).toBe(orientation);
    expect(shade.attributes("data-side")).toBe(side);
    expect(shade.text()).toBe(labels[orientation]);
    expect(shade.element.style.width).toBe(width);
    expect(shade.element.style.height).toBe(height);
    expect(shade.element.style.left).toBe(orientation === "cols" && side === "end" ? "303px" : "0px");
    expect(shade.element.style.top).toBe(orientation === "rows" && side === "end" ? "203px" : "0px");
    pointer(window, "pointerup", { clientX: x, clientY: y });
    await nextTick();
    expect(c.orientation.value).toBe(orientation);
    expect(c.panes.value[side === "start" ? 0 : 1]?.tabs).toEqual(["c"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
  });

  it("fitting zones choose the nearest normalized edge and reject centre, unfit axes and fewer than two tabs", async () => {
    const { c, wrapper, hit, start } = fixture();
    hit.mockReturnValue(wrapper.get(".body").element);
    start();
    pointer(window, "pointermove", { clientX: 60, clientY: 35 });
    await nextTick();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-orientation")).toBe("rows");
    pointer(window, "pointermove", { clientX: 300, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    c.setContainerSize(100, 400);
    pointer(window, "pointermove", { clientX: 10, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    pointer(window, "pointermove", { clientX: 10, clientY: 390 });
    await nextTick();
    expect(wrapper.get(".split-tabs-drop-shade").attributes("data-orientation")).toBe("rows");
    c.setContainerSize(100, 100);
    pointer(window, "pointermove", { clientX: 10, clientY: 390 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    pointer(window, "pointercancel");
    const one = fixture(false, ["a"]);
    one.hit.mockReturnValue(one.wrapper.get(".body").element);
    one.start();
    pointer(window, "pointermove", { clientX: 590, clientY: 200 });
    await nextTick();
    expect(one.wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    pointer(window, "pointerup", { clientX: 590, clientY: 200 });
    expect(one.s.setItem).not.toHaveBeenCalled();
  });

  it("cross-pane strip shows shared insertion marker and inserts before its target", async () => {
    const { c, s, wrapper, hit, start } = fixture(true);
    const other = wrapper.get("[data-split-tabs-pane='1'] .split-tab-strip");
    hit.mockReturnValue(other.element);
    start();
    pointer(window, "pointermove", { clientX: 310, clientY: 15 });
    await nextTick();
    expect(other.get(".split-tab-strip-marker").attributes("data-before")).toBe("b");
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    pointer(window, "pointerup", { clientX: 310, clientY: 15 });
    await nextTick();
    expect(c.panes.value[1]?.tabs).toEqual(["a", "b"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("dropping in the current strip slot is a no-op and reaching the end appends", async () => {
    const { c, s, wrapper, start } = fixture();
    start();
    pointer(window, "pointermove", { clientX: 20, clientY: 15 });
    await nextTick();
    expect(wrapper.get(".split-tab-strip-marker").attributes("data-before")).toBe("a");
    pointer(window, "pointerup", { clientX: 20, clientY: 15 });
    expect(s.setItem).not.toHaveBeenCalled();
    start();
    pointer(window, "pointermove", { clientX: 500, clientY: 15 });
    await nextTick();
    expect(wrapper.get(".split-tab-strip-marker").attributes("data-before")).toBe("");
    pointer(window, "pointerup", { clientX: 500, clientY: 15 });
    expect(c.panes.value[0]?.tabs).toEqual(["b", "c", "d", "a"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("the body-edge half preview matches a centred split even after a saved non-middle ratio", async () => {
    const { c, s, wrapper, hit, start } = fixture();
    c.commitRatio(0.7);
    s.setItem.mockClear();
    hit.mockReturnValue(wrapper.get(".body").element);
    start();
    pointer(window, "pointermove", { clientX: 590, clientY: 200 });
    await nextTick();
    expect(wrapper.get<HTMLElement>(".split-tabs-drop-shade").element.style.width).toBe("297px");
    pointer(window, "pointerup", { clientX: 590, clientY: 200 });
    expect(c.ratio.value).toBe(0.5);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("the body-mounted ghost retains the root's CSS variable overrides", async () => {
    const { wrapper, start } = fixture();
    (wrapper.element as HTMLElement).style.setProperty("--split-tabs-ghost-background", "rgb(1, 2, 3)");
    start();
    pointer(window, "pointermove", { clientX: 170, clientY: 15 });
    await nextTick();
    const ghost = document.querySelector<HTMLElement>(".split-tabs-drag-ghost");
    expect(ghost?.style.getPropertyValue("--split-tabs-ghost-background")).toBe("rgb(1, 2, 3)");
    pointer(window, "pointercancel");
  });

  it("cross-pane body shades that pane and marks the strip end, while own body has no target", async () => {
    const { c, s, wrapper, hit, start } = fixture(true);
    hit.mockReturnValue(wrapper.get("[data-split-tabs-pane='0'] .body").element);
    start();
    pointer(window, "pointermove", { clientX: 150, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    hit.mockReturnValue(wrapper.get("[data-split-tabs-pane='1'] .body").element);
    pointer(window, "pointermove", { clientX: 450, clientY: 200 });
    await nextTick();
    const shade = wrapper.get<HTMLElement>(".split-tabs-drop-shade[data-zone=pane]");
    expect(shade.element.style.left).toBe("303px");
    expect(shade.element.style.width).toBe("297px");
    expect(shade.element.style.height).toBe("400px");
    expect(wrapper.get("[data-split-tabs-pane='1'] .split-tab-strip-marker").attributes("data-before")).toBe("");
    pointer(window, "pointerup", { clientX: 450, clientY: 200 });
    await nextTick();
    expect(c.panes.value[1]?.tabs).toEqual(["b", "a"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("threshold and root containment leave an ordinary tap selectable and an invalid drop cancelled", async () => {
    const { c, s, wrapper, start, hit } = fixture();
    const tab = wrapper.findAll(".split-tab-strip-tab")[1];
    pointer(tab?.element ?? wrapper.element, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(window, "pointermove", { clientX: 16, clientY: 10 });
    pointer(window, "pointerup", { clientX: 16, clientY: 10 });
    await tab?.trigger("click");
    expect(c.panes.value[0]?.active).toBe("b");
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    const writes = s.setItem.mock.calls.length;
    const foreign = fixture();
    hit.mockReturnValue(foreign.wrapper.get(".body").element);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
    start();
    pointer(window, "pointermove", { clientX: 40, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    expect(foreign.wrapper.find(".split-tabs-drop-shade").exists()).toBe(false);
    pointer(window, "pointerup", { clientX: 40, clientY: 200 });
    await nextTick();
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    expect(c.isSplit.value).toBe(false);
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
  });

  it.each(["Escape", "pointercancel", "unmount"])("cancellation via %s clears ghost, marker, shade and listeners without writes", async (end) => {
    const { s, wrapper, start, hit } = fixture();
    start();
    pointer(window, "pointermove", { clientX: 170, clientY: 15 });
    await nextTick();
    expect(document.querySelector(".split-tabs-drag-ghost")).not.toBeNull();
    expect(wrapper.find(".split-tab-strip-marker").exists()).toBe(true);
    hit.mockReturnValue(wrapper.get(".body").element);
    pointer(window, "pointermove", { clientX: 590, clientY: 200 });
    await nextTick();
    expect(wrapper.find(".split-tabs-drop-shade").exists()).toBe(true);
    if (end === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (end === "unmount") wrapper.unmount();
    else pointer(window, "pointercancel");
    pointer(window, "pointermove", { clientX: 250, clientY: 15 });
    pointer(window, "pointerup", { clientX: 250, clientY: 15 });
    await nextTick();
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    expect(document.querySelector(".split-tab-strip-marker")).toBeNull();
    expect(document.querySelector(".split-tabs-drop-shade")).toBeNull();
    expect(s.setItem).not.toHaveBeenCalled();
  });
});
