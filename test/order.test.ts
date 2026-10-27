import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { Orientation, PaneIndex } from "../src/index";
import { controller, storage } from "./helpers";

describe("free ordering", () => {
  it("place reorders a single pane in one write without selecting, and reloads per entry", () => {
    const s = storage();
    const key = ref("one");
    const set = vi.fn();
    const c = controller({ storage: s, entryKey: key, active: { get: () => "a", set } });
    c.place("d", 0, "b");
    expect(c.panes.value[0]?.tabs).toEqual(["a", "d", "b", "c"]);
    expect(c.intent.value.order).toEqual(["a", "d", "b", "c"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    key.value = "two";
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c", "d"]);
    key.value = "one";
    expect(c.panes.value[0]?.tabs).toEqual(["a", "d", "b", "c"]);
    c.dispose();
    const loaded = controller({ storage: s, entryKey: "one" });
    expect(loaded.panes.value[0]?.tabs).toEqual(["a", "d", "b", "c"]);
    loaded.dispose();
  });

  it("inserts new ids after their nearest placed natural predecessor, otherwise at start, without writing", () => {
    const s = storage();
    const tabs = ref(["a", "b", "c"]);
    const c = controller({ storage: s, tabs });
    c.place("c", 0, "a");
    const writes = s.setItem.mock.calls.length;
    tabs.value = ["new", "a", "a2", "a3", "b", "c", "c2"];
    expect(c.panes.value[0]?.tabs).toEqual(["new", "c", "c2", "a", "a2", "a3", "b"]);
    expect(c.intent.value.order).toEqual(["c", "a", "b"]);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });

  it("retains absent ids in order through place, collapse, restore and merge", () => {
    const tabs = ref(["a", "b", "c", "d"]);
    const c = controller({ tabs });
    c.place("d", 0, "b");
    tabs.value = ["a", "c", "d"];
    c.place("c", 0, "a");
    expect(c.intent.value.order).toContain("b");
    tabs.value = ["a", "b", "c", "d"];
    expect(c.panes.value[0]?.tabs).toEqual(["c", "a", "d", "b"]);
    c.setContainerSize(606, 406);
    c.split("a", "cols");
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["c", "d", "b"], ["a"]]);
    c.setContainerSize(100, 100);
    expect(c.panes.value[0]?.tabs).toEqual(["c", "a", "d", "b"]);
    c.setContainerSize(606, 406);
    c.merge();
    expect(c.panes.value[0]?.tabs).toEqual(["c", "a", "d", "b"]);
    expect(c.intent.value.order).toEqual(["c", "a", "d", "b"]);
  });

  it("places across panes atomically with destination activation and source neighbors", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    s.setItem.mockClear();
    c.place("a", 1, "b");
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["c", "d"], active: "c" }, { index: 1, tabs: ["a", "b"], active: "a" }]);
    expect(c.intent.value.firstActive).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    c.place("a", 0, "d");
    expect(c.panes.value.map((p) => [p.tabs, p.active])).toEqual([[["c", "a", "d"], "a"], [["b"], "b"]]);
    expect(s.setItem).toHaveBeenCalledTimes(2);
    c.place("d", 0, "c");
    expect(c.panes.value[0]?.tabs).toEqual(["d", "c", "a"]);
    expect(c.panes.value[0]?.active).toBe("a");
    c.place("d", 0, null);
    expect(c.panes.value[0]?.tabs).toEqual(["c", "a", "d"]);
  });

  it.each([0, 1] as const)("merges when place empties pane %i while keeping the resulting custom order", (source) => {
    const s = storage();
    const c = controller({ storage: s, tabs: ["a", "b"] });
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    s.setItem.mockClear();
    c.place(source === 0 ? "a" : "b", source === 0 ? 1 : 0, source === 0 ? null : "a");
    expect(c.intent.value.orientation).toBeNull();
    expect(c.intent.value.second).toEqual([]);
    expect(c.intent.value.order).toEqual(["b", "a"]);
    expect(c.panes.value[0]?.tabs).toEqual(["b", "a"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("guards invalid placement and current-slot drops without writes or selection", () => {
    const s = storage();
    const set = vi.fn();
    const c = controller({ storage: s, active: { get: () => "a", set } });
    c.place("a", 0, "a");
    c.place("a", 0, "b");
    c.place("d", 0, null);
    c.place("missing", 0, "a");
    c.place("a", 3 as PaneIndex, null);
    c.place("a", 1, null);
    c.place("a", 0, "missing");
    expect(s.setItem).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    const writes = s.setItem.mock.calls.length;
    c.place("a", 0, "b");
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });

  it.each([undefined, "", []])("omitted or empty order %j uses natural order and retains absent saved ids", (order) => {
    const s = storage();
    const intent = { orientation: "rows", second: ["b"], secondActive: "b", ratio: 0.5, ...(order === undefined ? {} : { order }) };
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent }] }));
    const c = controller({ storage: s });
    expect(c.intent.value.order).toEqual([]);
    expect(c.intent.value.firstActive).toBe("");
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c", "d"]);
  });

  it.each(["rows", "cols"] as const)("splitAt starts or ends a %s split with one write and correct selection", (o) => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.place("d", 0, "a");
    s.setItem.mockClear();
    c.splitAt("c", o, "start");
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["c"], active: "c" }, { index: 1, tabs: ["d", "a", "b"], active: "a" }]);
    expect(c.intent.value.firstActive).toBe("c");
    expect(c.intent.value.secondActive).toBe("a");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    c.merge();
    c.splitAt("c", o, "end");
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["d", "a", "b"], ["c"]]);
    expect(c.intent.value.order).toEqual(["d", "a", "b", "c"]);
  });

  it("splitAt start selects a neighbor when the dragged tab was active, and validates guards", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.splitAt("a", "rows", "start");
    expect(s.setItem).not.toHaveBeenCalled();
    c.setContainerSize(606, 406);
    c.splitAt("missing", "rows", "start");
    c.splitAt("a", "bad" as Orientation, "start");
    c.splitAt("a", "rows", "bad" as "start");
    expect(s.setItem).not.toHaveBeenCalled();
    c.splitAt("a", "rows", "start");
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "b"]);
    expect(c.restoredActive.value).toBe("a");
    c.splitAt("b", "rows", "end");
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });
});
