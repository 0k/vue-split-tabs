import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSplitTabsController, type Orientation, type PaneIndex } from "../src/index";
import { controller, storage } from "./helpers";

// Acceptance ledger: on-demand visibility/counting, atomic placement/focus/close,
// pane history and last-tab merges, per-entry persistence/legacy loading,
// absent-id retention, reactive inputs without writes, and readonly exposure.
describe("on-demand tabs", () => {
  it("keeps every present tab visible when optional is omitted", () => {
    const c = controller();
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c", "d"]);
    expect(c.opened.value).toEqual([]);
    expect(c.isOptional("b")).toBe(false);
    c.close("b");
    expect(c.panes.value[0]?.tabs).toEqual(["a", "b", "c", "d"]);
  });

  it("hides optional tabs from membership, split eligibility and restored selection", () => {
    const s = storage();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: {
      orientation: "cols", firstActive: "b", order: [], second: ["c"], secondActive: "c", ratio: 0.5,
    } }] }));
    const c = controller({ storage: s, optional: ["b", "c", "d"] });
    c.setContainerSize(606, 406);
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a"], active: "a" }]);
    expect(c.paneOf("b")).toBeNull();
    expect(c.canOfferSplit.value).toBe(false);
    expect(c.restoredActive.value).toBe("");
    const writes = s.setItem.mock.calls.length;
    c.split("b", "cols");
    expect(c.isSplit.value).toBe(false);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
  });

  it.each([0, 1] as const)("opens into unsplit pane %i at the end and shows it in one write", (pane) => {
    const s = storage();
    const value = ref("a");
    const set = vi.fn((id: string) => { value.value = id; });
    const c = controller({ optional: ["b"], storage: s, active: { get: () => value.value, set } });
    c.place("d", 0, "a");
    const writes = s.setItem.mock.calls.length;
    c.open("b", pane);
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["d", "a", "c", "b"], active: "b" }]);
    expect(c.intent.value.opened).toEqual(["b"]);
    expect(c.intent.value.firstActive).toBe("b");
    expect(c.opened.value).toEqual(["b"]);
    expect(set).toHaveBeenCalledExactlyOnceWith("b");
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
    c.close("b");
    expect(c.panes.value[0]?.active).toBe("a");
  });

  it("opens at the end of pane 1 and focuses an existing tab there without moving it", () => {
    const s = storage();
    const c = controller({ optional: ["c", "d"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("c", 1);
    c.open("d", 1);
    expect(c.panes.value).toEqual([
      { index: 0, tabs: ["a"], active: "a" }, { index: 1, tabs: ["b", "c", "d"], active: "d" },
    ]);
    const membership = [...c.intent.value.second];
    const writes = s.setItem.mock.calls.length;
    c.open("c", 0);
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "c"]);
    expect(c.intent.value.second).toEqual(membership);
    expect(c.paneOf("c")).toBe(1);
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
    c.open("a", 1);
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "c"]);
    expect(c.intent.value.second).toEqual(membership);
  });

  it("clears lingering pane-1 membership when opening into pane 0", () => {
    const c = controller({ optional: ["c"] });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("c", 1);
    c.close("c");
    c.open("c", 0);
    expect(c.panes.value).toEqual([
      { index: 0, tabs: ["a", "d", "c"], active: "c" }, { index: 1, tabs: ["b"], active: "b" },
    ]);
    expect(c.intent.value.second).not.toContain("c");
  });

  it("ignores non-present opens and non-optional, absent or already-closed closes", () => {
    const s = storage();
    const c = controller({ optional: ["b", "missing"], storage: s });
    const before = c.intent.value;
    c.open("missing", 0);
    c.close("missing");
    c.close("b");
    c.close("a");
    expect(c.intent.value).toEqual(before);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it.each([0, 1] as const)("closing the shown tab in pane %i uses its previously viewed tab", (pane) => {
    const s = storage();
    const c = controller({ optional: ["c", "d"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("c", pane);
    c.open("d", pane);
    c.select(pane, "c");
    const order = [...c.intent.value.order];
    const writes = s.setItem.mock.calls.length;
    c.close("c");
    expect(c.panes.value[pane]?.active).toBe("d");
    expect(c.intent.value.order).toEqual(order);
    expect(c.intent.value.opened).toEqual(["d"]);
    expect(c.paneOf("c")).toBeNull();
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it.each([0, 1] as const)("closing the last tab of pane %i merges and keeps the other shown tab", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b"], optional: ["b"], storage: s });
    c.open("b", 0);
    c.setContainerSize(606, 406);
    c.splitAt("b", "cols", pane === 0 ? "start" : "end");
    c.commitRatio(0.6);
    c.setRatioLive(0.7);
    const writes = s.setItem.mock.calls.length;
    c.close("b");
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a"], active: "a" }]);
    expect(c.intent.value.orientation).toBeNull();
    expect(c.intent.value.second).toEqual([]);
    expect(c.intent.value.secondActive).toBe("");
    expect(c.ratio.value).toBe(0.6);
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it("closing an inactive tab preserves both shown tabs", () => {
    const c = controller({ optional: ["c"] });
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    c.open("c", 0);
    c.select(0, "d");
    c.close("c");
    expect(c.panes.value.map((p) => p.active)).toEqual(["d", "b"]);
  });

  it("persists opened per entry, retains absent ids, and never writes for reactive tab/optional/size changes", () => {
    const s = storage();
    const tabs = ref(["a", "b", "c"]);
    const optional = ref(["b", "c"]);
    const key = ref("one");
    const c = controller({ tabs, optional: () => optional.value, storage: s, entryKey: key });
    c.open("b", 0);
    const writes = s.setItem.mock.calls.length;
    tabs.value = ["a", "c"];
    expect(c.opened.value).toEqual([]);
    expect(c.intent.value.opened).toEqual(["b"]);
    optional.value = ["b"];
    expect(c.panes.value[0]?.tabs).toEqual(["a", "c"]);
    tabs.value = ["a", "b", "c"];
    expect(c.opened.value).toEqual(["b"]);
    c.setContainerSize(606, 406);
    c.setContainerSize(100, 100);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    key.value = "two";
    expect(c.opened.value).toEqual([]);
    c.open("b", 0);
    c.close("b");
    key.value = "one";
    expect(c.opened.value).toEqual(["b"]);
    c.dispose();
    const loaded = controller({ tabs, optional, storage: s, entryKey: "one" });
    expect(loaded.opened.value).toEqual(["b"]);
    loaded.dispose();
  });

  it("exposes readonly opened optional ids in effective order", () => {
    const c = controller({ optional: ["b", "d"] });
    c.open("d", 0);
    c.open("b", 0);
    expect(c.opened.value).toEqual(["d", "b"]);
    c.place("b", 0, "d");
    expect(c.opened.value).toEqual(["b", "d"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Reflect.set(c.opened.value, 0, "a");
    expect(c.opened.value).toEqual(["b", "d"]);
    expect(warn).toHaveBeenCalled();
  });

  it("defaults internal selection to the first visible tab, not a hidden optional tab", () => {
    const c = controller({ tabs: ["b", "a"], optional: ref(["b"]) });
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a"], active: "a" }]);
    expect(controller({ tabs: ["b"], optional: ["b"] }).panes.value)
      .toEqual([{ index: 0, tabs: [], active: "" }]);
  });

  it("closing after reload uses the order neighbour without history and cannot restore the closed id", () => {
    const s = storage();
    const c = controller({ optional: ["b"], storage: s });
    c.open("b", 0);
    c.place("b", 0, "c");
    c.setContainerSize(606, 406);
    c.split("d", "cols");
    c.dispose();
    const loaded = controller({ optional: ["b"], storage: s, active: { get: () => "b", set: vi.fn() } });
    loaded.setContainerSize(606, 406);
    loaded.close("b");
    expect(loaded.intent.value.firstActive).toBe("c");
    expect(loaded.panes.value[0]?.active).not.toBe("b");
    loaded.dispose();
    const reloaded = controller({ optional: ["b"], storage: s });
    expect(reloaded.restoredActive.value).toBe("c");
    expect(reloaded.paneOf("b")).toBeNull();
    reloaded.dispose();
  });
});

// Replacement acceptance ledger: exact slot/membership/opened swap in both panes,
// inactive sources, focus-existing without moving (same/other pane), history fallback,
// empty-pane merges/live-ratio cleanup, invalid-input no-ops, persistence and one write.
describe("controller replace", () => {
  it.each([0, 1] as const)("replaces a shown placeholder in pane %i in its exact ordered slot in one write", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b", "c", "new", "chosen"], optional: ["new", "chosen"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("new", pane);
    if (pane === 0) c.place("new", 0, "c");
    const order = [...c.intent.value.order].filter((id) => id !== "chosen").map((id) => id === "new" ? "chosen" : id);
    s.setItem.mockClear();
    c.replace("new", "chosen");
    expect(c.intent.value.order).toEqual(order);
    expect(c.panes.value[pane]?.tabs).toEqual(pane === 0 ? ["a", "chosen", "c"] : ["b", "chosen"]);
    expect(c.paneOf("chosen")).toBe(pane);
    expect(c.paneOf("new")).toBeNull();
    expect(c.panes.value.map((p) => p.active)).toEqual(pane === 0 ? ["chosen", "b"] : ["a", "chosen"]);
    expect(c.intent.value.second).toEqual(pane === 0 ? ["b"] : ["b", "chosen"]);
    expect(c.intent.value.opened).toEqual(["chosen"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1] as const)("replaces an inactive placeholder in pane %i without changing shown tabs", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b", "c", "new", "chosen"], optional: ["new", "chosen"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "rows");
    c.open("new", pane);
    c.select(pane, pane === 0 ? "c" : "b");
    const shown = c.panes.value.map((p) => p.active);
    s.setItem.mockClear();
    c.replace("new", "chosen");
    expect(c.panes.value.map((p) => p.active)).toEqual(shown);
    expect(c.paneOf("chosen")).toBe(pane);
    expect(c.opened.value).toEqual(["chosen"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1] as const)("focuses an already-visible tab in the same pane %i without moving it", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b", "c", "new"], optional: ["new"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("new", pane);
    const newId = pane === 0 ? "a" : "b";
    const order = [...c.intent.value.order];
    s.setItem.mockClear();
    c.replace("new", newId);
    expect(c.panes.value.map((p) => p.tabs)).toEqual([["a", "c"], ["b"]]);
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "b"]);
    expect(c.intent.value.order).toEqual(order);
    expect(c.intent.value.second).toEqual(["b"]);
    expect(c.opened.value).toEqual([]);
    expect(c.paneOf(newId)).toBe(pane);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1] as const)("focuses the other pane while replacing pane %i's shown placeholder with its recent tab", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b", "c", "d", "new"], optional: ["new"], storage: s });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.moveTo("d", 1);
    c.select(pane, pane === 0 ? "c" : "d");
    c.open("new", pane);
    const newId = pane === 0 ? "d" : "c";
    const membership = [...c.intent.value.second].filter((id) => id !== "new");
    const order = [...c.intent.value.order];
    s.setItem.mockClear();
    c.replace("new", newId);
    expect(c.panes.value.map((p) => p.active)).toEqual(["c", "d"]);
    expect(c.paneOf(newId)).toBe(pane === 0 ? 1 : 0);
    expect(c.intent.value.second).toEqual(membership);
    expect(c.intent.value.order).toEqual(order);
    expect(c.paneOf("new")).toBeNull();
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1] as const)("merges when the placeholder is the only tab of pane %i, then focuses the existing target", (pane) => {
    const s = storage();
    const c = controller({ tabs: ["a", "b", "new"], optional: ["new"], storage: s });
    c.open("new", 0);
    c.setContainerSize(606, 406);
    c.splitAt("new", "cols", pane === 0 ? "start" : "end");
    c.commitRatio(0.6);
    c.setRatioLive(0.7);
    s.setItem.mockClear();
    c.replace("new", "b");
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a", "b"], active: "b" }]);
    expect(c.intent.value.second).toEqual([]);
    expect(c.intent.value.orientation).toBeNull();
    expect(c.intent.value.secondActive).toBe("");
    expect(c.intent.value.firstActive).toBe("b");
    expect(c.ratio.value).toBe(0.6);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("focuses an existing optional target without forgetting its open state", () => {
    const s = storage();
    const c = controller({ optional: ["b", "c"], storage: s });
    c.open("b", 0);
    c.open("c", 0);
    s.setItem.mockClear();
    c.replace("c", "b");
    expect(c.opened.value).toEqual(["b"]);
    expect(c.panes.value[0]?.active).toBe("b");
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("replaces a host-deep-linked pane-1 placeholder with an %s existing target", (existing) => {
    const s = storage();
    const active = ref("a");
    const set = vi.fn((id: string) => { active.value = id; });
    const c = controller({ tabs: ["a", "b", "new", "chosen"], optional: ["new", "chosen"], storage: s,
      active: { get: () => active.value, set },
    });
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    if (existing) c.open("chosen", 1);
    c.open("new", 1);
    active.value = "new";
    set.mockClear();
    s.setItem.mockClear();
    c.replace("new", "chosen");
    expect(c.panes.value.map((p) => p.active)).toEqual(["a", "chosen"]);
    expect(c.paneOf("chosen")).toBe(1);
    expect(c.paneOf("new")).toBeNull();
    expect(set).toHaveBeenCalledExactlyOnceWith("a");
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("updates intent before calling the host setter, so primary replacement records one coherent selection", () => {
    const s = storage();
    const active = ref("a");
    const observed: string[] = [];
    const c = controller({ optional: ["b", "c"], storage: s, active: {
      get: () => active.value,
      set: (id) => {
        const saved = JSON.parse(s.getItem("layouts") ?? "null") as { entries: { intent: { firstActive: string } }[] };
        observed.push(saved.entries[0]?.intent.firstActive ?? "");
        active.value = id;
      },
    } });
    c.open("b", 0);
    observed.length = 0;
    s.setItem.mockClear();
    c.replace("b", "c");
    expect(observed).toEqual(["c"]);
    expect(c.panes.value[0]?.active).toBe("c");
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("clears stale target membership, transfers the slot and persists replacement across re-creation", () => {
    const s = storage();
    const options = { tabs: ["a", "b", "new", "chosen"], optional: ["new", "chosen"], storage: s };
    const c = controller(options);
    c.setContainerSize(606, 406);
    c.split("b", "cols");
    c.open("chosen", 1);
    c.close("chosen");
    c.open("new", 0);
    c.place("new", 0, "a");
    s.setItem.mockClear();
    c.replace("new", "chosen");
    expect(c.intent.value.order).toEqual(["chosen", "a", "b"]);
    expect(c.intent.value.second).toEqual(["b"]);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    c.dispose();
    const restored = controller(options);
    restored.setContainerSize(606, 406);
    expect(restored.opened.value).toEqual(["chosen"]);
    expect(restored.intent.value.order).toEqual(["chosen", "a", "b"]);
    expect(restored.panes.value.map((p) => p.tabs)).toEqual([["chosen", "a"], ["b"]]);
    expect(restored.restoredActive.value).toBe("chosen");
    restored.dispose();
  });

  it.each([["missing", "b"], ["c", "b"], ["b", "missing"], ["b", "b"]])("ignores replacement %s -> %s", (oldId, newId) => {
    const s = storage();
    const c = controller({ optional: ["c"], storage: s });
    const value = c.intent.value;
    c.replace(oldId, newId);
    expect(c.intent.value).toEqual(value);
    expect(c.panes.value).toEqual([{ index: 0, tabs: ["a", "b", "d"], active: "a" }]);
    expect(s.setItem).not.toHaveBeenCalled();
  });
});

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
    expect(c.intent.value).toEqual({ orientation: null, firstActive: "", order: [], opened: [], second: [], secondActive: "", ratio: 0.6 });
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
    expect(restored.intent.value).toEqual({
      orientation: "rows", firstActive: "a", order: [], opened: [], second: ["b", "d"], secondActive: "b", ratio: 0.7,
    });
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
    expect(JSON.parse(s.setItem.mock.calls[0]?.[1] ?? "null")).toEqual({ entries: [{ key: "page", stamp: 1, intent: {
      orientation: null, firstActive: "c", order: [], opened: [], second: [], secondActive: "", ratio: 0.5,
    } }] });
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
    expect(c.intent.value).toEqual({
      orientation: null, firstActive: id === "a" ? "b" : "a", order: [], opened: [], second: [], secondActive: "", ratio: 0.5,
    });
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
    expect(c.intent.value).toEqual({ orientation: "cols", firstActive: "", order: [], opened: [], second: ["b"], secondActive: "b", ratio: 0.7 });
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
