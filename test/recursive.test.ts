import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createSplitTabsController } from "../src/index.js";
import { storage } from "./helpers.js";

function fixture(optional: string[] = []) {
  const saved = storage();
  const tabs = ref(["a", "b", "c", "d", "e"]);
  const active = ref("a");
  const c = createSplitTabsController({ tabs, optional, storage: saved,
    entryKey: "recursive", storageKey: "layouts", minPaneWidth: 100, minPaneHeight: 80,
    active: { get: () => active.value, set: id => { active.value = id; } },
  });
  c.setContainerSize(906, 606);
  return { c, saved, tabs, active };
}

describe("recursive", () => {
  it("stable reading-order tree and unassigned tabs", () => {
    const { c, tabs } = fixture();
    const first = c.panes.value[0]!.id;
    c.split("b", "cols");
    const right = c.paneOf("b")!;
    c.place("c", right, null);
    c.split("c", "cols");
    expect(c.panes.value.map(p => p.tabs), "Expected three depth-first leaves").toEqual([["a", "d", "e"], ["b"], ["c"]]);
    expect(c.panes.value.map(p => p.index)).toEqual([0, 1, 2]);
    expect(c.panes.value.map(p => p.id).slice(0, 2)).toEqual([first, right]);
    tabs.value.push("new");
    expect(c.panes.value[0]!.tabs).toContain("new");
    expect(c.intent.value.tree.kind).toBe("cut");
    expect("moveToOther" in c).toBe(false);
    c.dispose();
  });

  it("splits explicit targets and rejects a locally unfit axis", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    const target = c.paneOf("b")!;
    c.splitAt("c", "rows", "end", target);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a", "d", "e"], ["b"], ["c"]]);
    c.setContainerSize(206, 606);
    const pane = c.panes.value.find(p => p.tabs.includes("b"))!;
    expect(pane.fits).toEqual({ rows: true, cols: false });
    const before = saved.setItem.mock.calls.length;
    c.splitAt("d", "cols", "end", pane.id);
    expect(saved.setItem).toHaveBeenCalledTimes(before);
    c.dispose();
  });

  it("inner cuts collapse first and exact intent restores without writes", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "cols");
    const intent = JSON.stringify(c.intent.value);
    const ids = c.panes.value.map(p => p.id);
    const writes = saved.setItem.mock.calls.length;
    c.setContainerSize(300, 606);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a", "d", "e"], ["b", "c"]]);
    c.setContainerSize(205, 606);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a", "b", "c", "d", "e"]]);
    c.setContainerSize(906, 606);
    expect(c.panes.value.map(p => p.id)).toEqual(ids);
    expect(JSON.stringify(c.intent.value)).toBe(intent);
    expect(saved.setItem).toHaveBeenCalledTimes(writes);
    c.dispose();
  });

  it("divider clamps protect subtree minimums and fall back under pressure", () => {
    const { c } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "cols");
    c.commitRatio(1);
    expect(c.panes.value).toHaveLength(3);
    expect(c.panes.value[1]!.width).toBeCloseTo(100);
    expect(c.panes.value[2]!.width).toBeCloseTo(100);
    c.setContainerSize(300, 606);
    c.commitRatio(1);
    expect(c.panes.value).toHaveLength(2);
    expect(c.panes.value[1]!.width).toBeCloseTo(100);
    c.dispose();
  });

  it("equalizes maximal same-axis runs including divider widths", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "cols");
    const tree = c.intent.value.tree;
    expect(tree.kind).toBe("cut");
    if (tree.kind !== "cut" || tree.second.kind !== "cut") throw new Error("Expected right nested cut");
    saved.setItem.mockClear();
    c.equalize(tree.second.id);
    expect(c.panes.value.map(p => p.width)).toEqual([298, 298, 298]);
    expect(saved.setItem).toHaveBeenCalledTimes(1);
    expect(c.intent.value.tree.kind).toBe("cut");
    c.dispose();
  });

  it("pruning promotes sibling subtree with ratios intact", () => {
    const { c } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "rows");
    const root = c.intent.value.tree;
    if (root.kind !== "cut") throw new Error("Expected root cut");
    const sibling = JSON.parse(JSON.stringify(root.second));
    for (const id of ["a", "d", "e"]) c.moveTo(id, c.paneOf("b")!);
    expect(c.intent.value.tree).toEqual(expect.objectContaining({ ...sibling, first: expect.any(Object) }));
    expect(c.panes.value.map(p => p.active)).toEqual(["b", "c"]);
    c.dispose();
  });

  it("deep links and per-pane history", () => {
    const { c, active, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.place("d", c.paneOf("b")!, null);
    const pane = c.paneOf("b")!;
    c.select(pane, "b");
    c.select(pane, "d");
    c.split("d", "rows");
    expect(c.panes.value.map(p => p.active)).toEqual(["a", "b", "d"]);
    active.value = "c";
    expect(c.panes.value[1]!.active).toBe("c");
    expect(saved.values.get("layouts")).not.toContain("visits");
    c.dispose();
  });

  it("move and merge preserve order and opened", () => {
    const { c } = fixture(["e"]);
    c.open("e", c.panes.value[0]!.id);
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "rows");
    c.moveTo("e", c.paneOf("b")!);
    expect(c.panes.value[1]!.active).toBe("b");
    c.place("e", c.paneOf("c")!, null);
    expect(c.panes.value[2]!.active).toBe("e");
    const order = [...c.intent.value.order];
    c.merge();
    expect(c.panes.value).toHaveLength(1);
    expect(c.intent.value.order).toEqual(order);
    expect(c.opened.value).toEqual(["e"]);
    c.dispose();
  });

  it("migrates legacy intent and rejects malformed trees", () => {
    const saved = storage();
    saved.values.set("layouts", JSON.stringify({ entries: [{ key: "recursive", stamp: 7, intent: {
      orientation: "cols", second: ["b", "absent"], secondActive: "b", ratio: 0.7, firstActive: "a",
    } }] }));
    const c = createSplitTabsController({ tabs: ["a", "b"], entryKey: "recursive", storageKey: "layouts", storage: saved,
      minPaneWidth: 100, minPaneHeight: 80 });
    c.setContainerSize(906, 606);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a"], ["b"]]);
    expect(c.ratio.value).toBe(0.7);
    expect(c.intent.value.tree.kind).toBe("cut");
    expect(c.restoredActive.value).toBe("a");
    c.dispose();
    const malformed = JSON.parse(saved.values.get("layouts")!);
    malformed.entries[0].intent.tree.first.id = malformed.entries[0].intent.tree.second.id;
    saved.values.set("layouts", JSON.stringify(malformed));
    const invalid = createSplitTabsController({ tabs: ["a", "b"], entryKey: "recursive", storageKey: "layouts", storage: saved,
      minPaneWidth: 100, minPaneHeight: 80 });
    expect(invalid.intent.value.tree.kind).toBe("pane");
    invalid.dispose();
  });

  it("splits a collapsed subtree as the one effective hovered pane", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "cols");
    c.setContainerSize(300, 606);
    const target = c.panes.value[1]!;
    expect(target.tabs).toEqual(["b", "c"]);
    saved.setItem.mockClear();
    c.splitAt("c", "rows", "end", target.id);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a", "d", "e"], ["b"], ["c"]]);
    const tree = c.intent.value.tree;
    if (tree.kind !== "cut") throw new Error("Expected surviving outer cut");
    expect(tree.second.kind).toBe("cut");
    if (tree.second.kind !== "cut") throw new Error("Expected replacement rows cut");
    expect(tree.second.orientation).toBe("rows");
    expect(tree.second.first.kind).toBe("pane");
    expect(tree.second.second.kind).toBe("pane");
    expect(saved.setItem).toHaveBeenCalledTimes(1);
    c.setContainerSize(906, 606);
    expect(c.panes.value.map(p => p.tabs)).toEqual([["a", "d", "e"], ["b"], ["c"]]);
    c.dispose();
  });

  it("supports deep trees without a fixed pane count or depth cap", () => {
    const tabs = Array.from({ length: 34 }, (_, i) => `tab-${i}`);
    const c = createSplitTabsController({ tabs, entryKey: "deep", storageKey: "deep", storage: storage(),
      minPaneWidth: 100, minPaneHeight: 80 });
    c.setContainerSize(1e12, 606);
    const rootPane = c.panes.value[0]!.id;
    for (let i = 1; i < tabs.length; i++) c.split(tabs[i]!, "cols", rootPane);
    expect(c.panes.value, "Expected one leaf per tab after 33 recursive splits").toHaveLength(34);
    expect(new Set(c.panes.value.map(p => p.id)).size).toBe(34);
    expect(c.panes.value.every(p => p.width >= 100)).toBe(true);
    c.dispose();
  });

  it("equalization stops at cross-axis boundaries and respects asymmetric subtree minima", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "rows");
    c.place("d", c.paneOf("c")!, null);
    c.split("d", "cols");
    const tree = c.intent.value.tree;
    if (tree.kind !== "cut" || tree.second.kind !== "cut" || tree.second.second.kind !== "cut") {
      throw new Error("Expected columns -> rows -> columns");
    }
    c.commitRatio(0.7);
    saved.setItem.mockClear();
    c.equalize(tree.second.second.id);
    expect(c.intent.value.tree.kind === "cut" && c.intent.value.tree.ratio).toBe(0.7);
    expect(c.panes.value[2]!.width).toBeCloseTo(c.panes.value[3]!.width);
    // Equalizing an already centred single cut is an idempotent no-op.
    expect(saved.setItem).not.toHaveBeenCalled();
    c.commitRatio(1);
    expect(c.panes.value).toHaveLength(4);
    expect(c.panes.value[2]!.width).toBeCloseTo(100);
    expect(c.panes.value[3]!.width).toBeCloseTo(100);
    c.dispose();
  });

  it("equalization under collapse pressure centres the rendered run and retains hidden ratios", () => {
    const { c, saved } = fixture();
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.split("c", "cols");
    c.setContainerSize(300, 606);
    saved.setItem.mockClear();
    c.equalize();
    const tree = c.intent.value.tree;
    if (tree.kind !== "cut") throw new Error("Expected outer cut retained");
    // Finding 5 replaces intent-only segment counting: the collapsed right subtree is ONE rendered segment.
    expect(tree.ratio, "Expected equal rendered segments with each side above its minimum").toBe(0.5);
    expect(tree.second.kind === "cut" && tree.second.ratio).toBe(0.5);
    expect(c.panes.value.map(p => p.width)).toEqual([147, 147]);
    expect(saved.setItem).not.toHaveBeenCalled();
    c.setContainerSize(906, 606);
    expect(c.panes.value).toHaveLength(3);
    saved.setItem.mockClear();
    c.equalize();
    expect(c.panes.value.map(p => p.width)).toEqual([298, 298, 298]);
    expect(saved.setItem).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("closing the last nested optional tab promotes its sibling subtree without losing ratios", () => {
    const { c, saved } = fixture(["c"]);
    c.open("c", c.panes.value[0]!.id);
    c.split("b", "cols");
    c.place("c", c.paneOf("b")!, null);
    c.place("d", c.paneOf("b")!, null);
    c.split("c", "rows");
    c.split("d", "cols");
    const root = c.intent.value.tree;
    if (root.kind !== "cut" || root.second.kind !== "cut" || root.second.first.kind !== "cut") {
      throw new Error("Expected outer columns, right rows, top-right columns");
    }
    c.commitRatio(0.65, root.second.first.id);
    const before = c.intent.value.tree;
    if (before.kind !== "cut" || before.second.kind !== "cut") throw new Error("Expected nested right subtree");
    const promoted = JSON.parse(JSON.stringify(before.second.first));
    const order = [...c.intent.value.order];
    saved.setItem.mockClear();
    c.close("c");
    const after = c.intent.value.tree;
    if (after.kind !== "cut") throw new Error("Expected surviving outer cut");
    expect(after.second).toEqual(promoted);
    expect(c.intent.value.order).toEqual(order);
    expect(c.opened.value).toEqual([]);
    expect(saved.setItem).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("newly present unassigned tabs follow the new first leaf after a start-side split", () => {
    const { c, tabs, saved } = fixture();
    const original = c.panes.value[0]!.id;
    c.splitAt("b", "cols", "start");
    const first = c.panes.value[0]!.id;
    expect(first).not.toBe(original);
    const writes = saved.setItem.mock.calls.length;
    tabs.value.push("new");
    expect(c.paneOf("new")).toBe(first);
    expect(c.panes.value[0]!.tabs).toEqual(["b", "new"]);
    expect(c.panes.value[1]!.id).toBe(original);
    expect(saved.setItem).toHaveBeenCalledTimes(writes);
    c.dispose();
  });
});
