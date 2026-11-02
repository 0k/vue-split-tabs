import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitTabs } from "../src/index";
import { controller, labels, pointer, storage } from "./helpers";

afterEach(() => vi.useRealTimers());

function gestureFixture() {
  const s = storage();
  const c = controller({ storage: s });
  c.setContainerSize(600, 400);
  const wrapper = mount(SplitTabs, {
    attachTo: document.body,
    props: { controller: c, labels: { divider: "Resize" }, stripLabels: labels },
  });
  const strip = wrapper.get<HTMLElement>(".split-tab-strip");
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  vi.spyOn(strip.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 30));
  const items = strip.findAll(".split-tab-strip-item");
  items.forEach((item, i) => {
    vi.spyOn(item.element, "getBoundingClientRect").mockReturnValue(new DOMRect(i * 80, 0, 80, 30));
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => strip.element });
  return { c, s, wrapper, strip, items, button: strip.get(".split-tab-strip-tab") };
}

describe("shared storage and ratio intent", () => {
  it.each([undefined, "", ["b", "absent"]])("loads tolerant opened intent %j and retains absent ids on actions", (opened) => {
    const s = storage();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: {
      orientation: null, firstActive: "", order: [], second: [], secondActive: "", ratio: 0.5, opened,
    } }] }));
    const c = controller({ optional: ["b"], storage: s });
    expect(c.intent.value.opened).toEqual(Array.isArray(opened) ? opened : []);
    expect(c.opened.value).toEqual(Array.isArray(opened) ? ["b"] : []);
    c.select(0, "c");
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { opened: string[] } }[] };
    expect(table.entries[0]?.intent.opened).toEqual(Array.isArray(opened) ? opened : []);
  });

  it.each([null, 3, ["b", 7]])("rejects only the entry with malformed opened %j, preserving its valid neighbour", (opened) => {
    const s = storage();
    const intent = { orientation: null, firstActive: "a", order: [], second: [], secondActive: "", ratio: 0.5 };
    s.values.set("layouts", JSON.stringify({ entries: [
      { key: "page", stamp: 1, intent: { ...intent, opened } },
      { key: "other", stamp: 2, intent: { ...intent, opened: ["b"] } },
    ] }));
    const key = ref("page");
    const c = controller({ optional: ["b"], storage: s, entryKey: key });
    expect(c.intent.value.firstActive).toBe("");
    expect(c.opened.value).toEqual([]);
    key.value = "other";
    expect(c.opened.value).toEqual(["b"]);
    c.dispose();
  });

  it("shared controllers preserve each other's persisted entries on interleaved writes", () => {
    const s = storage();
    const a = controller({ storage: s, entryKey: "a" });
    const b = controller({ storage: s, entryKey: "b" });
    a.select(0, "b");
    b.select(0, "c");
    a.place("d", 0, "a");
    const table = JSON.parse(s.getItem("layouts") ?? "null") as {
      entries: { key: string; stamp: number; intent: { firstActive: string; order: string[] } }[];
    };
    expect(table.entries.map((entry) => [entry.key, entry.stamp, entry.intent.firstActive]))
      .toEqual([["b", 2, "c"], ["a", 3, "b"]]);
    expect(table.entries[1]?.intent.order).toEqual(["d", "a", "b", "c"]);
    expect(s.setItem).toHaveBeenCalledTimes(3);
    const loadedB = controller({ storage: s, entryKey: "b" });
    expect(loadedB.intent.value.firstActive).toBe("c");
    loadedB.dispose();
  });

  it("the stored stamp wins over stale local stamps and key changes reload other controllers' entries", () => {
    const s = storage();
    const key = ref("a");
    const a = controller({ storage: s, entryKey: key });
    a.select(0, "b");
    const saved = JSON.parse(s.getItem("layouts") ?? "null") as {
      entries: { key: string; stamp: number; intent: { firstActive: string } }[];
    };
    const entry = saved.entries[0];
    expect(entry).toBeDefined();
    s.values.set("layouts", JSON.stringify({ entries: [
      entry, { ...entry, key: "b", stamp: 50, intent: { ...entry?.intent, firstActive: "d" } },
    ] }));
    a.select(0, "c");
    const updated = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { key: string; stamp: number }[] };
    expect(updated.entries.map((item) => [item.key, item.stamp])).toEqual([["b", 50], ["a", 51]]);
    key.value = "b";
    expect(a.intent.value.firstActive).toBe("d");
    a.dispose();
  });

  it("pending failed writes survive a valid stored table and flush with a later successful write", () => {
    const s = storage();
    const seed = controller({ storage: s, entryKey: "seed" });
    seed.select(0, "a");
    seed.dispose();
    const key = ref("a");
    const c = controller({ storage: s, entryKey: key });
    s.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    c.select(0, "b");
    key.value = "b";
    c.select(0, "c");
    key.value = "a";
    expect(c.intent.value.firstActive).toBe("b");
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { key: string }[] };
    expect(table.entries.map((entry) => entry.key).sort()).toEqual(["a", "b", "seed"]);
    c.dispose();
  });

  it.each([[-1, 0], [0.7, 0.7], [2, 1]])("ratio intent %s persists normalized to %s while unmeasured or collapsed", (requested, expected) => {
    const s = storage();
    const c = controller({ storage: s });
    c.commitRatio(requested);
    expect(c.intent.value.ratio).toBe(expected);
    c.setContainerSize(600, 400);
    c.split("b", "cols");
    c.setContainerSize(100, 100);
    c.commitRatio(requested);
    expect(c.intent.value.ratio).toBe(expected);
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { ratio: number } }[] };
    expect(table.entries[0]?.intent.ratio).toBe(expected);
  });

  it("a collapsed resize discards the live override and restores the committed ratio without writing", async () => {
    const { c, s, wrapper } = gestureFixture();
    c.split("b", "cols");
    c.commitRatio(0.6);
    await nextTick();
    const writes = s.setItem.mock.calls.length;
    pointer(wrapper.get(".split-tabs-divider").element, "pointerdown", { pointerType: "mouse" });
    pointer(window, "pointermove", { pointerType: "mouse", clientX: 453 });
    expect(c.ratio.value).toBeCloseTo(450 / 594);
    c.setContainerSize(100, 100);
    pointer(window, "pointerup", { pointerType: "mouse" });
    await nextTick();
    c.setContainerSize(600, 400);
    expect(c.ratio.value).toBe(0.6);
    expect(c.intent.value.ratio).toBe(0.6);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });

});

describe("pointer arming and button interaction", () => {
  it.each(["touch", "pen"])("a %s quick swipe never arms or starts dragging, even after the hold time", async (pointerType) => {
    vi.useFakeTimers();
    const { s, wrapper, button } = gestureFixture();
    pointer(button.element, "pointerdown", { pointerType, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(100);
    const swipe = new PointerEvent("pointermove", {
      cancelable: true, pointerType, pointerId: 3, clientX: 170, clientY: 10,
    });
    window.dispatchEvent(swipe);
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(swipe.defaultPrevented).toBe(false);
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
    pointer(window, "pointerup", { pointerType, clientX: 170, clientY: 10 });
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it.each(["touch", "pen"])("a %s long press arms at 350ms, then movement drags and prevents scrolling", async (pointerType) => {
    vi.useFakeTimers();
    const { c, s, wrapper, button } = gestureFixture();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    pointer(button.element, "pointerdown", { pointerType, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(349);
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
    expect(add.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(true);
    expect(add).toHaveBeenCalledWith("touchmove", expect.any(Function), { passive: false });
    const touch = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    const move = new PointerEvent("pointermove", {
      cancelable: true, pointerType, pointerId: 3, clientX: 170, clientY: 15,
    });
    window.dispatchEvent(move);
    await nextTick();
    expect(document.querySelector(".split-tabs-drag-ghost")).not.toBeNull();
    pointer(window, "pointerup", { pointerType, clientX: 170, clientY: 15 });
    await nextTick();
    expect(c.panes.value[0]?.tabs).toEqual(["b", "a", "c", "d"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
    const handler = add.mock.calls.find(([type]) => type === "touchmove")?.[1];
    expect(remove).toHaveBeenCalledWith("touchmove", handler);
    const after = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it.each(["pointerup", "pointercancel", "Escape", "unmount"])("removes armed touchmove cancellation on %s", (end) => {
    vi.useFakeTimers();
    const { wrapper, button } = gestureFixture();
    pointer(button.element, "pointerdown", { pointerType: "touch" });
    vi.advanceTimersByTime(350);
    const before = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    if (end === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (end === "unmount") wrapper.unmount();
    else pointer(window, end, { pointerType: "touch" });
    const after = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("a touch drag does not suppress a subsequent keyboard click", async () => {
    vi.useFakeTimers();
    const { c, strip } = gestureFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1];
    expect(button).toBeDefined();
    pointer(button?.element ?? strip.element, "pointerdown", { pointerType: "touch", clientX: 10 });
    vi.advanceTimersByTime(350);
    pointer(window, "pointermove", { pointerType: "touch", clientX: 250 });
    pointer(window, "pointerup", { pointerType: "touch", clientX: 250 });
    button?.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await nextTick();
    expect(c.panes.value[0]?.active).toBe("b");
  });

  it("mouse drag suppression ignores keyboard clicks and only consumes the immediate pointer click", () => {
    vi.useFakeTimers();
    const { c, strip } = gestureFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1];
    expect(button).toBeDefined();
    const select = vi.spyOn(c, "select");
    pointer(button?.element ?? strip.element, "pointerdown", { clientX: 10 });
    pointer(window, "pointermove", { clientX: 250 });
    pointer(window, "pointerup", { clientX: 250 });
    button?.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(select).toHaveBeenCalledExactlyOnceWith(c.panes.value[0]!.id, "b");
    button?.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(1);
    button?.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("an unconsumed mouse drag guard expires after the current task", () => {
    vi.useFakeTimers();
    const { c, strip } = gestureFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1];
    const select = vi.spyOn(c, "select");
    pointer(button?.element ?? strip.element, "pointerdown", { clientX: 10 });
    pointer(window, "pointermove", { clientX: 250 });
    pointer(window, "pointerup", { clientX: 250 });
    vi.advanceTimersByTime(0);
    button?.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(select).toHaveBeenCalledExactlyOnceWith(c.panes.value[0]!.id, "b");
  });

  it("unmount clears the pending post-mouse-drag suppression timer", () => {
    vi.useFakeTimers();
    const { wrapper, button } = gestureFixture();
    pointer(button.element, "pointerdown", { clientX: 10 });
    pointer(window, "pointermove", { clientX: 250 });
    pointer(window, "pointerup", { clientX: 250 });
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Alt+Shift+arrows reorder one slot without selection and retain button focus", async () => {
    const { c, s, strip } = gestureFixture();
    const button = strip.findAll(".split-tab-strip-tab")[1];
    (button?.element as HTMLElement).focus();
    await button?.trigger("keydown", { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(c.panes.value[0]?.tabs).toEqual(["a", "c", "b", "d"]);
    expect(c.panes.value[0]?.active).toBe("a");
    expect(document.activeElement).toBe(button?.element);
    await button?.trigger("keydown", { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c", "d"]);
    expect(document.activeElement).toBe(button?.element);
    expect(s.setItem).toHaveBeenCalledTimes(2);
    await strip.get(".split-tab-strip-tab").trigger("keydown", {
      key: "ArrowLeft", altKey: true, shiftKey: true,
    });
    expect(s.setItem).toHaveBeenCalledTimes(2);
  });

  it("a pending hold is cleaned on unmount and a quick tap remains a normal selection", async () => {
    vi.useFakeTimers();
    const { c, wrapper, strip } = gestureFixture();
    const tab = strip.findAll(".split-tab-strip-tab")[1];
    pointer(tab?.element ?? strip.element, "pointerdown", { pointerType: "touch" });
    pointer(window, "pointerup", { pointerType: "touch" });
    await tab?.trigger("click");
    expect(c.panes.value[0]?.active).toBe("b");
    pointer(tab?.element ?? strip.element, "pointerdown", { pointerType: "touch" });
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
  });

  it("a transformed and scrolled strip uses absolute content-relative marker coordinates", async () => {
    const { wrapper, strip, items, button } = gestureFixture();
    (wrapper.element as HTMLElement).style.transform = "translate(300px, 100px) scale(2)";
    vi.spyOn(strip.element, "getBoundingClientRect").mockReturnValue(new DOMRect(300, 100, 1200, 60));
    Object.defineProperties(strip.element, {
      offsetWidth: { configurable: true, value: 600 },
      offsetHeight: { configurable: true, value: 30 },
      clientHeight: { configurable: true, value: 30 },
      scrollLeft: { configurable: true, value: 40 },
    });
    items.forEach((item, i) => {
      vi.spyOn(item.element, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(300 + (i * 80 - 40) * 2, 100, 160, 60));
    });
    pointer(button.element, "pointerdown", { pointerType: "mouse", clientX: 300, clientY: 110 });
    pointer(window, "pointermove", { pointerType: "mouse", clientX: 600, clientY: 115 });
    await nextTick();
    const marker = strip.get<HTMLElement>(".split-tab-strip-marker");
    expect(marker.attributes("data-before")).toBe("c");
    expect(marker.element.style.left).toBe("160px");
    expect(marker.element.style.top).toBe("0px");
    expect(marker.element.style.height).toBe("30px");
    pointer(window, "pointercancel", { pointerType: "mouse" });
  });

  it("ordinary named buttons expose pressed state without tablist ownership or a slot-name override", async () => {
    const { c, wrapper, strip, button } = gestureFixture();
    expect(wrapper.find("[role=tablist]").exists()).toBe(false);
    expect(wrapper.find("[role=tab]").exists()).toBe(false);
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.text()).toBe("a");
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(button.classes()).toContain("split-tab-strip-tab--active");
    expect(button.classes()).not.toContain("active");
    expect(button.attributes("aria-selected")).toBeUndefined();
    expect(button.attributes("aria-label")).toBeUndefined();
    c.select(0, "b");
    await nextTick();
    expect(button.attributes("aria-pressed")).toBe("false");
    expect(strip.findAll(".split-tab-strip-tab")[1]?.attributes("aria-pressed")).toBe("true");
  });
});
