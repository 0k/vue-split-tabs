import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSplitTabsController, type Orientation, type PaneIndex } from "../src/index";
import { controller, storage } from "./helpers";

describe("controller", () => {
  it("defaults to the first tab and supports an empty list", () => {
    const c = controller();
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a", "b", "c", "d"], active: "a" }]);
    expect(controller({ tabs: [] }).panes.value).toEqual([{ index: 0, tabs: [], active: "" }]);
    expect(c.orientation.value).toBeNull();
    expect(c.paneOf("missing")).toBeNull();
  });

  it("passes empty host selection through without settling it", () => {
    const value = ref("");
    const set = vi.fn((id: string) => { value.value = id; });
    const c = controller({ active: { get: () => value.value, set } });
    c.setContainerSize(500, 500);
    c.split("b", "rows");
    expect(c.panes.value.map((p) => p.active)).toEqual(["", "b"]);
    expect(set).not.toHaveBeenCalled();
  });

  it("uses inclusive fit thresholds and neither orientation when unmeasured", () => {
    const c = controller();
    expect(c.fits.value).toEqual({ rows: false, cols: false });
    expect(c.canOfferSplit.value).toBe(false);
    c.setContainerSize(205, 165);
    expect(c.fits.value).toEqual({ rows: false, cols: false });
    c.setContainerSize(206, 166);
    expect(c.fits.value).toEqual({ rows: true, cols: true });
    expect(c.canOfferSplit.value).toBe(true);
    expect(controller({ tabs: ["a"] }).canOfferSplit.value).toBe(false);
  });

  it("derives layout without writes and retains absent ids and natural order", () => {
    const s = storage();
    const tabs = ref(["a", "b", "c", "d"]);
    const c = controller({ storage: s, tabs: () => tabs.value });
    c.setContainerSize(600, 400);
    c.split("c", "cols");
    c.moveTo("a", 1);
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["b", "d"], ["a", "c"]]);
    const writes = s.setItem.mock.calls.length;
    c.setContainerSize(205, 400);
    expect(c.panes.value[0]?.tabs).toEqual(tabs.value);
    expect(c.orientation.value).toBeNull();
    tabs.value = ["b", "d"];
    c.setContainerSize(600, 400);
    expect(c.isSplit.value).toBe(false);
    expect(c.intent.value.second).toEqual(["c", "a"]);
    tabs.value = ["d", "c", "b", "a"];
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["d", "b"], ["c", "a"]]);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    c.dispose();
  });

  it("guards split and chooses next then previous neighbors", () => {
    const c = controller();
    c.split("a", "cols");
    expect(c.intent.value.orientation).toBeNull();
    c.setContainerSize(600, 400);
    c.split("missing", "cols");
    c.split("a", "bad" as Orientation);
    expect(c.intent.value.orientation).toBeNull();
    c.split("a", "cols");
    expect(c.panes.value.map((p) => p.active)).toEqual(["b", "a"]);
    c.split("d", "rows");
    expect(c.orientation.value).toBe("cols");
    const last = controller({ tabs: ["a", "b"], active: { get: () => "b", set: vi.fn() } });
    const setter = vi.fn();
    const prev = controller({ tabs: ["a", "b"], active: { get: () => "b", set: setter } });
    prev.setContainerSize(600, 400);
    prev.split("b", "rows");
    expect(setter).toHaveBeenCalledWith("a");
    last.dispose();
  });

  it("shows deep links in pane 1 and falls back from an absent second active", () => {
    const a = ref("a");
    const c = controller({ active: { get: () => a.value, set: (id) => { a.value = id; } } });
    c.setContainerSize(600, 400);
    c.split("b", "rows");
    c.moveTo("d", 1);
    c.select(1, "d");
    a.value = "b";
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "b"]);
    a.value = "c";
    expect(c.panes.value.map((p) => p.active)).toEqual(["c", "d"]);
    c.moveTo("d", 0);
    expect(c.panes.value.map((p) => p.active)).toEqual(["c", "b"]);
  });

  it("moves both ways behind the shown tabs, chooses active neighbors, and selects same-pane moves", () => {
    const c = controller();
    c.setContainerSize(600, 400);
    c.split("b", "rows");
    c.moveToOther("a");
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["c", "d"], ["a", "b"]]);
    expect(c.panes.value.map((p) => p.active)).toEqual(["c", "b"]);
    c.moveTo("a", 0);
    expect(c.panes.value.map((p) => p.active)).toEqual(["c", "b"]);
    c.moveTo("d", 1);
    c.select(1, "d");
    c.moveTo("b", 1);
    expect(c.panes.value[1]?.active).toBe("b");
    c.moveTo("b", 0);
    expect(c.intent.value.secondActive).toBe("d");
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c"]);
    expect(c.panes.value[0]?.active).toBe("c");
  });

  it.each([0, 1] as const)("merges when moving the last present tab out of pane %i", (pane) => {
    const c = controller({ tabs: ["a", "b"] });
    c.setContainerSize(600, 400);
    c.split("b", "cols");
    const id = pane === 0 ? "a" : "b";
    c.moveToOther(id);
    expect(c.isSplit.value).toBe(false);
    expect(c.intent.value.second).toEqual([]);
    expect(c.intent.value.orientation).toBeNull();
    expect(c.panes.value[0]?.active).toBe(pane === 0 ? "b" : "a");
  });

  it("validates action pane/membership and persists only changed intent", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(600, 400);
    c.moveTo("a", 1);
    c.select(1, "a");
    expect(s.setItem).not.toHaveBeenCalled();
    c.split("b", "cols");
    const writes = s.setItem.mock.calls.length;
    c.moveTo("missing", 0);
    c.moveTo("a", 3 as PaneIndex);
    c.select(0, "b");
    c.select(1, "a");
    c.select(1, "b");
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    c.select(0, "c");
    expect(c.panes.value[0]?.active).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it("merge clears membership but keeps ratio", () => {
    const c = controller();
    c.setContainerSize(600, 400);
    c.split("b", "rows");
    c.commitRatio(0.6);
    c.merge();
    expect(c.intent.value).toEqual({ orientation: null, firstActive: "", order: [], second: [], secondActive: "", ratio: 0.6 });
    expect(c.ratio.value).toBe(0.6);
    c.split("c", "cols");
    expect(c.ratio.value).toBe(0.6);
  });

  it.each(["rows", "cols"] as const)("clamps %s ratios, keeps live edits in memory, and commits once", (o) => {
    const s = storage();
    const c = controller({ storage: s, defaultRatio: 0.4 });
    expect(c.ratio.value).toBe(0.4);
    c.setContainerSize(506, 406);
    c.split("b", o);
    const writes = s.setItem.mock.calls.length;
    c.setRatioLive(-1);
    expect(c.ratio.value).toBe(0.2);
    c.setRatioLive(2);
    expect(c.ratio.value).toBe(0.8);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    c.commitRatio(0.7);
    expect(c.intent.value.ratio).toBe(0.7);
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
    c.setContainerSize(0, 0);
    expect(c.ratio.value).toBe(0.4);
    expect(c.intent.value.ratio).toBe(0.7);
  });

  it("reacts to ref/getter keys, reloads entries, and stops its key watcher on dispose", () => {
    const key = ref("one");
    const c = controller({ entryKey: () => key.value });
    c.setContainerSize(600, 400);
    c.split("b", "rows");
    key.value = "two";
    expect(c.intent.value.orientation).toBeNull();
    c.split("d", "cols");
    key.value = "one";
    expect(c.intent.value.second).toEqual(["b"]);
    c.dispose();
    key.value = "two";
    expect(c.intent.value.second).toEqual(["b"]);
  });

  it("keeps a bounded monotonic LRU and bumps reads and changed actions", () => {
    const s = storage();
    const key = ref("one");
    const c = controller({ storage: s, entryKey: key, maxEntries: 2 });
    c.setContainerSize(600, 400);
    c.split("b", "rows");
    key.value = "two";
    c.split("c", "cols");
    const before = s.getItem("layouts");
    key.value = "one";
    expect(s.getItem("layouts")).not.toBe(before);
    key.value = "three";
    c.split("d", "rows");
    key.value = "two";
    expect(c.intent.value.orientation).toBeNull();
    key.value = "one";
    expect(c.intent.value.second).toEqual(["b"]);
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { key: string; stamp: number }[] };
    expect(table.entries.map((e) => e.key)).toEqual(["three", "one"]);
    expect(table.entries.map((e) => e.stamp)).toEqual([4, 5]);
    c.dispose();
  });

  it("reloads a stored entry in a new controller, bumps recency, and never persists size clamps", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    c.moveTo("d", 1);
    c.select(1, "b");
    c.commitRatio(0.7);
    c.dispose();
    const previous = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { stamp: number }[] };
    const restored = controller({ storage: s });
    expect(restored.intent.value).toEqual({ orientation: "rows", firstActive: "a", order: [], second: ["b", "d"], secondActive: "b", ratio: 0.7 });
    const bumped = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { stamp: number }[] };
    expect(bumped.entries[0]?.stamp).toBe((previous.entries[0]?.stamp ?? 0) + 1);
    const writes = s.setItem.mock.calls.length;
    restored.setContainerSize(606, 206);
    expect(restored.ratio.value).toBe(0.6);
    expect(restored.intent.value.ratio).toBe(0.7);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    restored.setContainerSize(606, 406);
    expect(restored.ratio.value).toBe(0.7);
    restored.dispose();
  });

  it("defaults to fifty entries and evicts the oldest after the fifty-first action", () => {
    const key = ref("0");
    const s = storage();
    const c = controller({ entryKey: key, storage: s });
    c.setContainerSize(606, 406);
    for (let i = 0; i < 51; i++) { key.value = String(i); c.split("b", "cols"); }
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { key: string; stamp: number }[] };
    expect(table.entries).toHaveLength(50);
    expect(table.entries[0]).toEqual(expect.objectContaining({ key: "1", stamp: 2 }));
    expect(table.entries[49]).toEqual(expect.objectContaining({ key: "50", stamp: 51 }));
    key.value = "0";
    expect(c.intent.value.orientation).toBeNull();
    c.dispose();
  });

  it("uses pane-1 fallback when its saved active tab disappears and keeps intent", () => {
    const tabs = ref(["a", "b", "c", "d"]);
    const c = controller({ tabs });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.moveTo("d", 1);
    c.select(1, "d");
    tabs.value = ["a", "b", "c"];
    expect(c.panes.value[1]?.active).toBe("b");
    expect(c.intent.value.secondActive).toBe("d");
    tabs.value = ["a", "b", "c", "d"];
    expect(c.panes.value[1]?.active).toBe("d");
  });

  it("respects custom divider and minima and rejects a one-tab split", () => {
    const c = controller({ tabs: ["a"], dividerSize: 10, minPaneWidth: 30, minPaneHeight: 40 });
    c.setContainerSize(70, 90);
    expect(c.fits.value).toEqual({ rows: true, cols: true });
    expect(c.canOfferSplit.value).toBe(false);
    c.split("a", "cols");
    expect(c.isSplit.value).toBe(false);
    expect(c.intent.value.orientation).toBeNull();
  });

  it("keeps intent deeply readonly and treats non-finite ratio/size input safely", () => {
    const c = controller({ defaultRatio: 0.4 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Reflect.set(c.intent.value, "orientation", "rows");
    expect(c.intent.value.orientation).toBeNull();
    expect(warn).toHaveBeenCalled();
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.setRatioLive(Number.NaN);
    expect(c.ratio.value).toBe(0.4);
    c.setContainerSize(Number.NaN, Number.POSITIVE_INFINITY);
    expect(c.fits.value).toEqual({ rows: false, cols: false });
  });

  it.each(["{", "null", "[]", '{"entries":[{"key":"page","stamp":1,"intent":{"orientation":"bad"}}]}'])("rejects corrupt storage boundary %s", (raw) => {
    const s = storage();
    s.values.set("layouts", raw);
    const c = controller({ storage: s });
    c.setContainerSize(600, 400);
    expect(() => c.split("b", "rows")).not.toThrow();
    expect(c.isSplit.value).toBe(true);
  });

  it("survives throwing reads/writes while retaining per-key memory", () => {
    const key = ref("one");
    const s = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } };
    const c = controller({ storage: s, entryKey: key });
    c.setContainerSize(600, 400);
    expect(() => c.split("b", "rows")).not.toThrow();
    key.value = "two";
    key.value = "one";
    expect(c.intent.value.second).toEqual(["b"]);
    c.dispose();
  });

  it("uses default localStorage and falls back when unavailable", () => {
    const options = { tabs: ["a", "b"], entryKey: "default", storageKey: "default-table", minPaneWidth: 10, minPaneHeight: 10 };
    const c = createSplitTabsController(options);
    c.setContainerSize(100, 100);
    c.split("b", "cols");
    expect(localStorage.getItem("default-table")).not.toBeNull();
    vi.stubGlobal("window", undefined);
    const memory = createSplitTabsController(options);
    memory.setContainerSize(100, 100);
    expect(() => memory.split("a", "rows")).not.toThrow();
    expect(memory.isSplit.value).toBe(true);
    c.dispose();
    memory.dispose();
  });
});

describe("controller restoration", () => {
  it("records primary selection in the same single write, including same-pane moves", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.select(0, "c");
    expect(c.intent.value.firstActive).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.setItem.mock.calls[0]?.[1] ?? "null")).toEqual({ entries: [{ key: "page", stamp: 1, intent: { orientation: null, firstActive: "c", order: [], second: [], secondActive: "", ratio: 0.5 } }] });
    expect(c.restoredActive.value).toBe("");
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    expect(c.intent.value.firstActive).toBe("c");
    const writes = s.setItem.mock.calls.length;
    c.moveTo("d", 0);
    expect(c.intent.value.firstActive).toBe("d");
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
    c.select(1, "b");
    expect(c.intent.value.firstActive).toBe("d");
  });

  it("records active-changing split and both move directions atomically", () => {
    const s = storage();
    const value = ref("a");
    const observed: string[] = [];
    const c = controller({ storage: s, active: { get: () => value.value, set: (id) => {
      const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { firstActive: string } }[] };
      observed.push(table.entries[0]?.intent.firstActive ?? "");
      value.value = id;
    } } });
    c.setContainerSize(606, 406);
    c.split("a", "rows");
    expect(c.intent.value.firstActive).toBe("b");
    expect(s.setItem).toHaveBeenCalledTimes(1);
    c.moveTo("b", 1);
    expect(c.intent.value.firstActive).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(2);
    c.moveTo("a", 0);
    expect(c.intent.value.firstActive).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(3);
    expect(observed).toEqual(["b", "c"]);
  });

  it.each(["a", "b"])("records last-tab move %s with merge in one write", (id) => {
    const s = storage();
    const c = controller({ storage: s, tabs: ["a", "b"] });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    const writes = s.setItem.mock.calls.length;
    c.moveToOther(id);
    expect(c.intent.value).toEqual({ orientation: null, firstActive: id === "a" ? "b" : "a", order: [], second: [], secondActive: "", ratio: 0.5 });
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
    expect(c.restoredActive.value).toBe("");
    c.merge();
    expect(c.intent.value.firstActive).toBe("");
  });

  it("restores a request after reload, even collapsed, without selecting for the host", () => {
    const s = storage();
    const c = controller({ storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.select(0, "d");
    c.dispose();
    const set = vi.fn();
    const loaded = controller({ storage: s, active: { get: () => "a", set } });
    expect(loaded.restoredActive.value).toBe("d");
    expect(loaded.panes.value[0]?.active).toBe("a");
    expect(set).not.toHaveBeenCalled();
    loaded.setContainerSize(100, 100);
    expect(loaded.isSplit.value).toBe(false);
    expect(loaded.restoredActive.value).toBe("d");
    loaded.setContainerSize(606, 406);
    expect(loaded.restoredActive.value).toBe("d");
    loaded.merge();
    expect(loaded.intent.value.firstActive).toBe("");
    expect(loaded.restoredActive.value).toBe("");
    loaded.dispose();
  });

  it.each([
    { orientation: "rows", firstActive: "", second: ["b"], expected: "" },
    { orientation: "rows", firstActive: "absent", second: ["b"], expected: "" },
    { orientation: "rows", firstActive: "b", second: ["b"], expected: "" },
    { orientation: null, firstActive: "c", second: [], expected: "" },
    { orientation: "rows", firstActive: "c", second: ["b"], expected: "c" },
  ])("gates restoration on saved split membership: %j", ({ expected, ...intent }) => {
    const s = storage();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: { ...intent, secondActive: "b", ratio: 0.5 } }] }));
    const c = controller({ storage: s });
    expect(c.restoredActive.value).toBe(expected);
  });

  it("never learns host navigation or writes on derived changes", () => {
    const s = storage();
    const tabs = ref(["a", "b", "c", "d"]);
    const active = ref("a");
    const c = controller({ storage: s, tabs, active: { get: () => active.value, set: (id) => { active.value = id; } } });
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    c.select(0, "c");
    const writes = s.setItem.mock.calls.length;
    active.value = "d";
    tabs.value = ["a", "b", "d"];
    c.setContainerSize(100, 100);
    expect(c.intent.value.firstActive).toBe("c");
    expect(c.restoredActive.value).toBe("");
    tabs.value = ["a", "b", "c", "d"];
    expect(c.restoredActive.value).toBe("c");
    active.value = "a";
    c.setContainerSize(606, 406);
    c.moveTo("c", 1);
    expect(c.intent.value.firstActive).toBe("a");
    expect(c.restoredActive.value).toBe("a");
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it("records the displayed tab when splitting off another tab, over a stale request", () => {
    // Host shape: no explicit selection shows restoredActive, else the first tab.
    const explicit = ref<string | undefined>(undefined);
    const c: ReturnType<typeof controller> = controller({ active: {
      get: () => explicit.value ?? (c.restoredActive.value || "a"),
      set: (id) => { explicit.value = id; },
    } });
    c.setContainerSize(606, 406);
    c.select(0, "d");
    expect(c.intent.value.firstActive).toBe("d");
    explicit.value = undefined;
    expect(c.panes.value[0]?.active).toBe("a");
    c.split("c", "rows");
    expect(c.intent.value.firstActive).toBe("a");
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "c"]);
  });

  it("loads an omitted firstActive as empty while retaining split intent", () => {
    const s = storage();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 4, intent: { orientation: "cols", second: ["b"], secondActive: "b", ratio: 0.7 } }] }));
    const c = controller({ storage: s });
    expect(c.intent.value).toEqual({ orientation: "cols", firstActive: "", order: [], second: ["b"], secondActive: "b", ratio: 0.7 });
    expect(c.restoredActive.value).toBe("");
    c.setContainerSize(606, 406);
    expect(c.isSplit.value).toBe(true);
  });

  it("salvages valid entries and keeps the newest valid duplicate by stamp", () => {
    const s = storage();
    const saved = (firstActive: string) => ({ orientation: "cols", firstActive, second: ["b"], secondActive: "b", ratio: 0.5 });
    s.values.set("layouts", JSON.stringify({ entries: [
      { key: "page", stamp: 9, intent: saved("d") },
      { key: "broken", stamp: 20, intent: { ...saved("a"), firstActive: 3 } },
      null,
      { key: "page", stamp: 2, intent: saved("a") },
      { key: "other", stamp: 5, intent: saved("c") },
      { key: "page", stamp: 30, intent: { ...saved("a"), ratio: "bad" } },
    ] }));
    const key = ref("page");
    const c = controller({ storage: s, entryKey: key });
    expect(c.restoredActive.value).toBe("d");
    const table = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { key: string; stamp: number }[] };
    expect(table.entries.map((entry) => [entry.key, entry.stamp])).toEqual([["other", 5], ["page", 10]]);
    key.value = "other";
    expect(c.restoredActive.value).toBe("c");
    c.dispose();
  });
});

describe("controller tab history", () => {
  function hosted(overrides: Parameters<typeof controller>[0] = {}) {
    const explicit = ref<string | undefined>(undefined);
    const set = vi.fn((id: string) => { explicit.value = id; });
    const c: ReturnType<typeof controller> = controller({
      active: { get: () => explicit.value ?? (c.restoredActive.value || "a"), set }, ...overrides,
    });
    c.setContainerSize(606, 406);
    return { c, explicit, set };
  }

  it("keeps the previous tab on top when the selected tab is sent to the other pane", () => {
    const { c } = hosted();
    c.select(0, "c");
    c.split("c", "rows");
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "c"]);
    expect(c.intent.value.firstActive).toBe("a");
  });

  it("uses the most recent tab still in the top pane, skipping tabs sent to the other pane", () => {
    const { c } = hosted({ tabs: ["a", "b", "c", "d", "e"] });
    c.select(0, "e");
    c.select(0, "a");
    c.select(0, "c");
    c.split("c", "rows");
    expect(c.panes.value[0]?.active).toBe("a");
    c.select(0, "d");
    c.select(0, "b");
    c.moveToOther("d");
    c.moveToOther("b");
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "c"]);
  });

  it("falls back to the neighbor without history, and history is per page and memory-only", () => {
    const s = storage();
    const key = ref("page");
    const { c, explicit } = hosted({ storage: s, entryKey: key });
    c.select(0, "d");
    key.value = "other";
    explicit.value = "b";
    c.split("b", "cols");
    expect(c.panes.value[0]?.active).toBe("c");
    expect(s.values.get("layouts")).not.toContain("history");
  });

  it("picks the recent tab for the other pane when dragging the selected tab to the start", () => {
    const { c } = hosted();
    c.select(0, "d");
    c.select(0, "b");
    c.splitAt("b", "cols", "start");
    expect(c.panes.value.map((p) => p.active)).toEqual(["b", "d"]);
  });
});

describe("controller move-to-other keeps what the destination shows", () => {
  function hosted(tabs: string[] = ["a", "b", "c", "d"]) {
    const explicit = ref<string | undefined>(undefined);
    const c: ReturnType<typeof controller> = controller({
      tabs, active: { get: () => explicit.value ?? (c.restoredActive.value || "a"), set: (id) => { explicit.value = id; } },
    });
    c.setContainerSize(606, 406);
    return { c, explicit };
  }
  const shown = (c: ReturnType<typeof controller>) => c.panes.value.map((p) => p.active);

  it("puts a tab sent up behind the top pane's shown tab", () => {
    const { c } = hosted();
    c.split("b", "rows");
    c.moveTo("d", 1);
    c.select(1, "d");
    c.moveToOther("d");
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["a", "c", "d"], ["b"]]);
    expect(shown(c)).toEqual(["a", "b"]);
    expect(c.intent.value.firstActive).toBe("a");
  });

  it("puts a tab sent down behind the bottom pane's shown tab, the top showing the previous tab", () => {
    const { c } = hosted();
    c.split("b", "rows");
    c.select(0, "d");
    c.select(0, "c");
    c.moveToOther("c");
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["a", "d"], ["b", "c"]]);
    expect(shown(c)).toEqual(["d", "b"]);
  });

  it.each([
    { from: "bottom", id: "b", expected: "a" },
    { from: "top", id: "a", expected: "b" },
  ])("keeps the destination's shown tab when moving the last $from tab merges", ({ id, expected }) => {
    const { c } = hosted(["a", "b"]);
    c.split("b", "rows");
    c.moveToOther(id);
    expect(c.isSplit.value).toBe(false);
    expect(shown(c)).toEqual([expected]);
    expect(c.intent.value.firstActive).toBe(expected);
  });

  it("replaces the shown bottom tab with the last one viewed there", () => {
    const { c } = hosted(["a", "b", "c", "d", "e"]);
    c.split("b", "rows");
    c.moveTo("c", 1);
    c.moveTo("d", 1);
    c.select(1, "d");
    c.select(1, "b");
    c.moveToOther("b");
    expect(shown(c)).toEqual(["a", "d"]);
  });

  it("keeps the top pane's tab when the host deep-links the bottom tab being moved", () => {
    const { c, explicit } = hosted();
    c.split("b", "rows");
    explicit.value = "b";
    expect(shown(c)).toEqual(["a", "b"]);
    c.moveTo("c", 1);
    c.moveToOther("b");
    expect(shown(c)).toEqual(["a", "c"]);
  });

  it("still reveals a tab dropped into the other pane", () => {
    const { c } = hosted();
    c.split("b", "rows");
    c.place("b", 0, null);
    expect(shown(c)[0]).toBe("b");
  });
});
