// Specification of the controller: host tabs, placeholders, persistence,
// host binding, size collapse, undo and zoom around the layout algebra.
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { createSplitTabsController, notation, type LayoutNode, type SplitTabsOptions, type SplitTabsStorage } from "../src/index";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  } satisfies SplitTabsStorage & { values: Map<string, string> };
}
type MemoryStorage = ReturnType<typeof memoryStorage>;
function make(overrides: Partial<Omit<SplitTabsOptions, "storage">> & { storage?: MemoryStorage } = {}, size: [number, number] = [1000, 800]) {
  const storage = overrides.storage ?? memoryStorage();
  const c = createSplitTabsController({
    tabs: ["a", "b", "c", "d"], entryKey: "page", storageKey: "layouts",
    minPaneWidth: 100, minPaneHeight: 80, placeholderPrefix: "new:", ...overrides, storage,
  });
  c.setContainerSize(...size);
  return { c, storage };
}
type Controller = ReturnType<typeof make>["c"];
const writes = (s: MemoryStorage) => s.setItem.mock.calls.length;
const stored = (s: MemoryStorage) => JSON.parse(s.values.get("layouts")!) as { entries: { key: string; stamp: number }[] };
const pane = (c: Controller, view: string) => c.paneOf(view)!;
const splitOff = (c: Controller, view: string, beside: string, side: "left" | "right" | "top" | "bottom") =>
  c.move({ view }, { kind: "split", target: pane(c, beside), side });

describe("selection drop targets", () => {
  // M3: repeated hover/refusal probes must not advance the real ID allocator.
  it("M3 one hundred cluster hovers produce the same drop ids as a direct drop", () => {
    const grid = () => {
      const { c } = make();
      splitOff(c, "b", "a", "right"); splitOff(c, "c", "a", "bottom"); splitOff(c, "d", "b", "bottom");
      c.setSelection([pane(c, "a"), pane(c, "b")]);
      return c;
    };
    const hovered = grid(), direct = grid();
    const zone = { kind: "bar" as const, target: "selection", index: null };
    expect(hovered.plan.value).toMatchObject({ ok: true, kind: "exact" });
    for (let i = 0; i < 100; i++) expect(hovered.canMove({ node: pane(hovered, "c") }, zone).ok).toBe(true);
    expect(hovered.move({ node: hovered.intent.value.tree.id }, zone).ok).toBe(false);
    expect(hovered.move({ node: pane(hovered, "c") }, zone).ok).toBe(true);
    expect(direct.move({ node: pane(direct, "c") }, zone).ok).toBe(true);
    expect(hovered.intent.value).toEqual(direct.intent.value);
    hovered.dispose(); direct.dispose();
  });
  function selected() {
    const tabs = ref(["a", "b", "c"]);
    const f = make({ tabs });
    splitOff(f.c, "c", "a", "bottom");
    splitOff(f.c, "b", "a", "right");
    f.c.setSelection([pane(f.c, "a"), pane(f.c, "b")]);
    f.storage.setItem.mockClear();
    return { ...f, tabs };
  }
  it("derives the direct visible holder on a copy, respecting alwaysShow", () => {
    const { c, storage } = selected();
    const before = JSON.stringify(c.intent.value);
    expect(c.plan.value).toMatchObject({ ok: true, holder: null });
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(writes(storage)).toBe(0);
    c.tabNext();
    const holder = c.focus.value;
    c.select(holder, c.tabSet(holder)!.tabs[0]!);
    c.setSelection([pane(c, "a"), pane(c, "b")]);
    expect(c.plan.value).toMatchObject({ holder });
  });
  it.each([0, null])("canMove previews without writes; move groups and writes once (index %s)", index => {
    const { c, storage } = selected();
    const before = JSON.stringify([c.intent.value, c.selection.value, c.focus.value]);
    const zone = { kind: "bar" as const, target: "selection", index };
    expect(c.canMove({ node: pane(c, "c") }, zone)).toEqual({ ok: true });
    expect(JSON.stringify([c.intent.value, c.selection.value, c.focus.value])).toBe(before);
    expect(writes(storage)).toBe(0);
    expect(c.move({ node: pane(c, "c") }, zone).ok).toBe(true);
    expect(c.notation.value).toBe(index === 0 ? "T{*c | H[a b]}" : "T{H[a b] | *c}");
    expect(c.selection.value).toEqual([]);
    expect(writes(storage)).toBe(1);
  });
  it("a holder with one visible tab is reported only when the alwaysShow policy requests it", () => {
    const storage = memoryStorage();
    storage.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: {
      version: 3, focus: "a", opened: [], tree: { kind: "cut", id: "outer", orientation: "rows", ratio: 0.6,
        first: { kind: "tabs", id: "holder", active: "group", tabs: [
          { kind: "cut", id: "group", orientation: "cols", ratio: 0.5,
            first: { kind: "tabs", id: "pa", tabs: ["a"], active: "a" },
            second: { kind: "tabs", id: "pb", tabs: ["b"], active: "b" } }, "absent" ] },
        second: { kind: "tabs", id: "pc", tabs: ["c"], active: "c" } },
    } }] }));
    const { c } = make({ tabs: ["a", "b", "c"], storage });
    c.setSelection([pane(c, "a"), pane(c, "b")]);
    storage.setItem.mockClear();
    const before = JSON.stringify(c.intent.value);
    expect(c.plan.value).toMatchObject({ holder: null });
    c.setAlwaysShow(set => set.id === "holder");
    expect(c.plan.value).toMatchObject({ holder: "holder" });
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(writes(storage)).toBe(0);
    c.dispose();
  });
  it("parks an external insertion in a member and detaches it after grouping", () => {
    const { c, storage, tabs } = selected();
    expect(c.canMove({ view: "x" }, { kind: "bar", target: "selection", index: 0 }).ok).toBe(true);
    expect(writes(storage)).toBe(0);
    expect(c.insert("x", { kind: "bar", target: "selection", index: 0 }, () => { tabs.value.push("x"); }).ok).toBe(true);
    expect(c.notation.value).toBe("V[T{*x | H[a b]} c]");
    expect(writes(storage)).toBe(1);
  });
});

describe("host tabs and implicit placement", () => {
  it("refused external insert never registers, changes the tree or writes storage", () => {
    const tabs = ref(["a", "b"]);
    const { c, storage } = make({ tabs }, [150, 400]);
    const before = JSON.stringify(c.intent.value);
    const register = vi.fn(() => { tabs.value.push("x"); });
    expect(c.insert("x", { kind: "split", target: c.panes.value[0]!.id, side: "right" }, register))
      .toEqual({ ok: false, reason: "no-room" });
    expect(register).not.toHaveBeenCalled();
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(c.notation.value).toBe("(*a b)");
    expect(writes(storage)).toBe(0);
    c.setContainerSize(600, 400);
    expect(c.insert("x", { kind: "split", target: c.panes.value[0]!.id, side: "right" }, register).ok).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(c.notation.value).toBe("H[(*a b) x]");
    expect(writes(storage)).toBe(1);
  });
  it("starts as one pane holding every visible host tab in natural order, without writing", () => {
    const { c, storage } = make({ optional: ["d"] });
    expect(c.notation.value).toBe("(*a b c)");
    expect(c.panes.value[0]).toMatchObject({ tabs: ["a", "b", "c"], active: "a", view: "a", showsBar: true, collapsed: false });
    expect(writes(storage)).toBe(0);
  });

  it("a newly present tab goes after its nearest placed natural predecessor in the first pane, otherwise first", () => {
    const tabs = ref(["b", "d"]);
    const { c, storage } = make({ tabs });
    c.split("right");
    tabs.value = ["a", "b", "c", "d"];
    expect(c.panes.value[0]!.tabs).toEqual(["a", "b", "c", "d"]);
    expect(writes(storage)).toBe(1);
  });

  it("an absent tab keeps its place; a pane whose views are all absent disappears and comes back, without writing", () => {
    const tabs = ref(["a", "b", "c", "d"]);
    const { c, storage } = make({ tabs });
    splitOff(c, "c", "a", "right");
    expect(c.notation.value).toBe("H[(*a b d) c]");
    const n = writes(storage);
    tabs.value = ["a", "b", "d"];
    expect(c.notation.value).toBe("(*a b d)");
    tabs.value = ["a", "b", "c", "d"];
    expect(c.notation.value).toBe("H[(*a b d) c]");
    expect(writes(storage)).toBe(n);
  });
});

describe("optional tabs and placeholders", () => {
  it("an optional tab is hidden until opened; open reveals it in the focused pane; close forgets it", () => {
    const { c, storage } = make({ optional: ["d"] });
    c.open("d");
    expect(c.notation.value).toBe("(a b c *d)");
    expect(c.opened.value).toEqual(["d"]);
    expect(writes(storage)).toBe(1);
    expect(c.close("d")).toEqual({ ok: true });
    expect(c.opened.value).toEqual([]);
    expect(c.notation.value).toBe("(*a b c)");
  });

  it("a host tab that is not optional cannot be closed: the whole close is refused", () => {
    const { c, storage } = make();
    expect(c.close("a")).toEqual({ ok: false, reason: "not-closable", nodes: ["a"] });
    expect(c.closeTarget()).toEqual({ ok: false, reason: "not-closable", nodes: ["a", "b", "c", "d"] });
    expect(writes(storage)).toBe(0);
  });

  it("new panes and tabs hold placeholders that the host fills with replace", () => {
    const { c } = make({ optional: ["d"] });
    expect(c.split("right")).toMatchObject({ ok: true, view: "new:1" });
    expect(c.isPlaceholder("new:1")).toBe(true);
    expect(c.notation.value).toBe("H[(*a b c) new:1]");
    expect(c.focus.value).toBe(pane(c, "new:1"));
    c.replace("new:1", "d");
    expect(c.notation.value).toBe("H[(*a b c) d]");
    expect(c.opened.value).toEqual(["d"]);
    expect(c.tabNext()).toMatchObject({ ok: true, view: "new:2" });
    expect(c.tabInside()).toMatchObject({ ok: true, view: "new:3" });
    expect(c.notation.value).toBe("H[(*a b c) T{d | *(new:2 *new:3)}]");
    expect(c.isClosable("new:2")).toBe(true);
    expect(c.isClosable("a")).toBe(false);
    expect(c.close("new:2")).toEqual({ ok: true });
    expect(c.notation.value).toBe("H[(*a b c) (d *new:3)]");
  });
});

describe("self-drop persistence", () => {
  it.each(["absent", "unopened"])("a lone visible tab with an %s sibling self-splits and refuses its own bar without writes", hidden => {
    const tabs = ref(["a", "x", "b"]), optional = ref<string[]>([]);
    const { c, storage } = make({ tabs, optional });
    splitOff(c, "b", "a", "right");
    if (hidden === "absent") tabs.value = ["a", "b"]; else optional.value = ["x"];
    const original = JSON.parse(JSON.stringify(c.intent.value.tree)) as LayoutNode, count = writes(storage), target = c.paneOf("a")!;
    for (const kind of ["inside", "bar"] as const) {
      const zone = kind === "bar" ? { kind, target, index: 2 } as const : { kind, target } as const;
      expect(c.canMove({ view: "a" }, zone)).toEqual({ ok: false, reason: "nothing-to-move" });
      expect(c.move({ view: "a" }, zone)).toEqual({ ok: false, reason: "nothing-to-move" });
      expect(c.intent.value.tree).toEqual(original);
      expect(writes(storage)).toBe(count);
    }
    const zone = { kind: "split", target, side: "right" } as const;
    expect(c.canMove({ view: "a" }, zone)).toEqual({ ok: true, selfSplit: true });
    expect(c.move({ view: "a" }, zone)).toMatchObject({ ok: true, selfSplit: true, view: "new:1" });
    expect(c.notation.value).toBe("H[T{H[new:1 a]} b]");
    expect(c.intent.value.tree.kind === "cut" && c.intent.value.tree.first).toMatchObject({
      kind: "tabs", tabs: [{ kind: "cut" }, "x"],
    });
    expect(writes(storage)).toBe(count + 1);
    c.dispose();
  });
  it.each(["placeholder", "identity"].flatMap(by => [true, false].map(shown => ({ by, shown }))))(
    "self-split sizes the actual next pane under a $by bar policy (shown=$shown)", ({ by, shown }) => {
    const { c, storage } = make({ tabs: ["a"] }, [600, 180]);
    const source = c.focus.value, zone = { kind: "split", target: source, side: "bottom" } as const;
    const seen: { id: string; tabs: readonly string[] }[] = [];
    c.setAlwaysShow(set => {
      seen.push({ id: set.id, tabs: [...set.tabs] });
      return (by === "identity" ? set.id === "tabs-3" : set.tabs.some(tab => tab.startsWith("new:"))) ? shown : !shown;
    });
    if (!shown) c.cycleBarSide(); // Source bar stays on the other axis; only the new bar can prevent a rows split.
    const count = writes(storage);
    const before = JSON.stringify(c.intent.value);
    for (let n = 0; n < 3; n++) expect(c.canMove({ node: source }, zone))
      .toMatchObject(shown ? { ok: false, reason: "no-room", selfSplit: true } : { ok: true, selfSplit: true });
    if (shown) {
      expect(c.move({ node: source }, zone)).toMatchObject({ ok: false, reason: "no-room" });
      expect(JSON.stringify(c.intent.value)).toBe(before);
      expect(writes(storage)).toBe(count);
      c.setAlwaysShow(false);
    }
    const result = c.move({ node: source }, zone);
    expect(result).toMatchObject({ ok: true, selfSplit: true, view: "new:1", node: "tabs-3" });
    expect(seen).toContainEqual({ id: "tabs-3", tabs: ["new:1"] });
    expect(writes(storage)).toBe(count + 1);
    c.dispose();
  });
  it("a prospective pane avoids a colliding placeholder id without consuming either id", () => {
    const { c, storage } = make({ tabs: ["a"], placeholderPrefix: "tabs-" }, [600, 180]);
    const zone = { kind: "split", target: c.focus.value, side: "bottom" } as const;
    c.setAlwaysShow(set => set.id === "tabs-4" && set.tabs[0] === "tabs-3");
    for (let n = 0; n < 3; n++) expect(c.canMove({ node: zone.target }, zone)).toMatchObject({ ok: false, reason: "no-room" });
    expect(c.move({ node: zone.target }, zone)).toMatchObject({ ok: false, reason: "no-room" });
    expect(writes(storage)).toBe(0);
    c.setAlwaysShow(false);
    expect(c.move({ node: zone.target }, zone)).toMatchObject({ ok: true, node: "tabs-4", view: "tabs-3" });
    expect(writes(storage)).toBe(1);
    c.dispose();
  });
  describe.each(["pane", "shown label"] as const)("%s source", sourceKind => {
    it.each(["left", "right", "top", "bottom"] as const)("splits inside shown B on %s, retaining A and writing once", side => {
      const { c, storage } = make({ tabs: ["A", "B"], placeholderPrefix: "split-tabs:new-" });
      const host = c.focus.value;
      c.select(host, "B");
      storage.setItem.mockClear();
      expect(c.notation.value).toBe("(A *B)");
      const source = sourceKind === "pane" ? { node: host } : { view: "B" };
      const zone = { kind: "split", target: host, side } as const;
      expect(c.canMove(source, zone)).toMatchObject({ ok: true, selfSplit: true });
      expect(writes(storage)).toBe(0);
      expect(c.move(source, zone)).toMatchObject({ ok: true, selfSplit: true, view: "split-tabs:new-1" });
      const first = side === "left" || side === "top", axis = side === "left" || side === "right" ? "H" : "V";
      const layout = `${axis}[${first ? "B split-tabs:new-1" : "split-tabs:new-1 B"}]`;
      expect(c.notation.value).toBe(`T{A | *${layout}}`);
      const tree = c.intent.value.tree;
      expect(tree).toMatchObject({ kind: "tabs", id: host, tabs: ["A", { kind: "cut", ratio: 0.5 }] });
      if (tree.kind !== "tabs" || typeof tree.tabs[1] === "string") throw new Error("expected layout tab");
      expect(tree.active).toBe(tree.tabs[1]!.id);
      expect(c.focus.value).toBe(c.paneOf("split-tabs:new-1"));
      expect(c.canUndo.value).toBe(false);
      expect(writes(storage)).toBe(1);
      const reloaded = make({ tabs: ["A", "B"], placeholderPrefix: "split-tabs:new-", storage }).c;
      expect(reloaded.intent.value).toEqual(c.intent.value);
      c.select(host, "A");
      expect(c.panes.value.map(p => p.view)).toEqual(["A"]);
      expect(c.notation.value).toBe(`T{*A | ${layout}}`);
      c.select(host, tree.active);
      expect(c.panes.value.map(p => p.view)).toEqual(first ? ["B", "split-tabs:new-1"] : ["split-tabs:new-1", "B"]);
      expect(c.notation.value).toBe(`T{A | *${layout}}`);
      c.dispose(); reloaded.dispose();
    });
  });
  it.each(["left", "right", "top", "bottom"] as const)("single-tab self-drop %s remains normalized and reloads unchanged", side => {
    const { c, storage } = make({ tabs: ["a"] });
    const source = c.focus.value, zone = { kind: "split", target: source, side } as const;
    expect(c.canMove({ node: source }, zone).ok).toBe(true);
    expect(writes(storage)).toBe(0);
    expect(c.move({ node: source }, zone)).toMatchObject({ ok: true, view: "new:1" });
    const content = "a", first = side === "left" || side === "top";
    expect(c.notation.value).toBe(`${side === "left" || side === "right" ? "H" : "V"}[${first ? `${content} new:1` : `new:1 ${content}`}]`);
    expect(c.focus.value).toBe(c.paneOf("new:1"));
    expect(c.canUndo.value).toBe(false);
    expect(writes(storage)).toBe(1);
    const reloaded = make({ tabs: ["a"], storage }).c;
    expect(reloaded.intent.value).toEqual(c.intent.value);
    expect(reloaded.focus.value).toBe(reloaded.paneOf("new:1"));
    const beforeSecondMove = writes(storage);
    expect(c.move({ view: "new:1" }, { kind: "split", target: c.focus.value, side }).ok).toBe(true);
    expect(c.isPlaceholder("new:2")).toBe(true);
    expect(c.paneOf("new:2")).not.toBeNull();
    expect(writes(storage)).toBe(beforeSecondMove + 1);
    c.dispose(); reloaded.dispose();
  });
  it("a non-shown label still drags out of its own pane without a placeholder", () => {
    const { c, storage } = make({ tabs: ["A", "B"] });
    c.select(c.focus.value, "B");
    storage.setItem.mockClear();
    expect(c.move({ view: "A" }, { kind: "split", target: c.focus.value, side: "right" }).ok).toBe(true);
    expect(c.notation.value).toBe("H[B A]");
    expect(c.paneOf("new:1")).toBeNull();
    expect(writes(storage)).toBe(1);
    expect(c.canUndo.value).toBe(false);
    c.dispose();
  });
  it.each(["pane", "shown label"] as const)("multi-tab %s self middle and no-room preserve intent without writes", sourceKind => {
    const { c, storage } = make({ tabs: ["A", "B"] }, [205, 185]);
    const host = c.focus.value;
    c.select(host, "B");
    storage.setItem.mockClear();
    const before = JSON.stringify(c.intent.value), source = sourceKind === "pane" ? { node: host } : { view: "B" };
    expect(c.move(source, { kind: "inside", target: host })).toEqual({ ok: false, reason: "into-itself" });
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const zone = { kind: "split", target: host, side } as const;
      expect(c.canMove(source, zone)).toMatchObject({ ok: false, reason: "no-room", selfSplit: true });
      expect(c.move(source, zone)).toMatchObject({ ok: false, reason: "no-room", selfSplit: true });
    }
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(writes(storage)).toBe(0);
    c.dispose();
  });
  it("self middle and no-room refusal do not write or change intent", () => {
    const { c, storage } = make({ tabs: ["a"] }, [205, 165]);
    const before = JSON.stringify(c.intent.value), source = { node: c.focus.value };
    expect(c.move(source, { kind: "inside", target: c.focus.value })).toEqual({ ok: false, reason: "into-itself" });
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const zone = { kind: "split", target: c.focus.value, side } as const;
      expect(c.canMove(source, zone)).toMatchObject({ ok: false, reason: "no-room" });
      expect(c.move(source, zone)).toMatchObject({ ok: false, reason: "no-room" });
    }
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(writes(storage)).toBe(0);
    c.dispose();
  });
  it("self-drop counts a requested new one-tab bar even when the source bar is on another axis", () => {
    const { c, storage } = make({ tabs: ["a"] }, [500, 200]);
    c.setAlwaysShow(set => set.tabs.length === 1);
    c.cycleBarSide();
    expect(c.tabSet(c.focus.value)?.side).toBe("left");
    const before = JSON.stringify(c.intent.value), count = writes(storage);
    const zone = { kind: "split", target: c.focus.value, side: "bottom" } as const;
    expect(c.canMove({ node: c.focus.value }, zone)).toMatchObject({ ok: false, reason: "no-room" });
    expect(c.move({ node: c.focus.value }, zone)).toMatchObject({ ok: false, reason: "no-room" });
    expect(JSON.stringify(c.intent.value)).toBe(before);
    expect(writes(storage)).toBe(count);
    c.dispose();
  });
});

describe("persistence", () => {
  it("directional focus stays in memory until the next write while focusPane saves immediately", () => {
    const { c, storage } = make();
    splitOff(c, "b", "a", "right");
    const before = writes(storage);
    const savedFocus = () => JSON.parse(storage.values.get("layouts")!).entries[0].intent.focus;
    expect(savedFocus()).toBe("b");
    expect(c.focusDirection("left").ok).toBe(true);
    expect(c.focus.value).toBe(pane(c, "a"));
    expect(writes(storage)).toBe(before);
    expect(savedFocus()).toBe("b");
    c.cycleBarSide();
    expect(writes(storage)).toBe(before + 1);
    expect(savedFocus()).toBe("a");
    c.focusPane(pane(c, "b"));
    expect(writes(storage)).toBe(before + 2);
    expect(savedFocus()).toBe("b");
  });
  it("each changed action writes once; reload restores the tree, the focus and the bars", () => {
    const { c, storage } = make();
    splitOff(c, "b", "a", "bottom");
    expect(writes(storage)).toBe(1);
    c.tabNext();
    c.cycleBarSide();
    c.setBarWidth(pane(c, "b"), 150);
    expect(writes(storage)).toBe(4);
    const reloaded = make({ storage }).c;
    expect(reloaded.notation.value).toBe(c.notation.value);
    expect(reloaded.restoredActive.value).toBe("new:1");
    expect(reloaded.tabSet(reloaded.paneOf("b")!)).toMatchObject({ side: "left", barWidth: 150 });
  });

  it("focus and selection changes are memory, except that the focused view is remembered", () => {
    const { c, storage } = make();
    c.split("right");
    const n = writes(storage);
    c.focusPane(pane(c, "a"));
    expect(writes(storage)).toBe(n + 1);
    c.toggleSelected(pane(c, "new:1"));
    expect(c.selection.value).toEqual([pane(c, "a"), pane(c, "new:1")]);
    c.clearSelection();
    c.focusPane(pane(c, "a"));
    expect(writes(storage)).toBe(n + 1);
  });

  it("the table is a bounded LRU shared between controllers, stamped above every stored stamp", () => {
    const storage = memoryStorage();
    const key = ref("p1");
    const { c } = make({ storage, entryKey: key, maxEntries: 2 });
    const other = make({ storage, entryKey: "x" }).c;
    c.split("right");
    other.split("bottom");
    key.value = "p2";
    c.split("right");
    const table = stored(storage);
    expect(table.entries.map(e => e.key)).toEqual(["x", "p2"]);
    expect(table.entries[1]!.stamp).toBeGreaterThan(table.entries[0]!.stamp);
  });

  it("corrupt or throwing storage never breaks in-memory use; an invalid entry drops alone", () => {
    const storage = memoryStorage();
    storage.values.set("layouts", JSON.stringify({ entries: [
      { key: "page", stamp: 1, intent: { version: 3, tree: { kind: "tabs", id: "t", tabs: ["a", "a"], active: "a" }, focus: "", opened: [] } },
      { key: "other", stamp: 2, intent: { version: 3, tree: { kind: "tabs", id: "t", tabs: ["a"], active: "a" }, focus: "a", opened: [] } },
    ] }));
    const { c } = make({ storage });
    expect(c.notation.value).toBe("(*a b c d)");
    c.split("right");
    expect(stored(storage).entries.map(e => e.key)).toEqual(["other", "page"]);
    storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    expect(c.split("bottom").ok).toBe(true);
    storage.values.set("layouts", "{not json");
    expect(make({ storage }).c.notation.value).toBe("(*a b c d)");
  });

  it("0.2 trees and 0.1 two-pane entries migrate to equivalent tab sets", () => {
    const storage = memoryStorage();
    storage.values.set("layouts", JSON.stringify({ entries: [
      { key: "old", stamp: 3, intent: { orientation: "rows", second: ["b"], secondActive: "b", ratio: 0.6 } },
      { key: "page", stamp: 4, intent: { tree: { kind: "cut", id: "cut-0", orientation: "cols", ratio: 0.3,
        first: { kind: "pane", id: "pane-0", tabs: [], active: "" }, second: { kind: "pane", id: "pane-1", tabs: ["c", "a"], active: "a" } },
      firstActive: "d", order: ["d", "c", "b", "a"], opened: [], ratio: 0.3 } },
    ] }));
    const { c } = make({ storage });
    expect(c.notation.value).toBe("H[(*d b) (c *a)]");
    expect(c.cuts.value.get("cut-0")?.ratio).toBeCloseTo(0.3, 6);
    expect(make({ storage, entryKey: "old" }).c.notation.value).toBe("V[(*a c d) b]");
  });
});

describe("host active binding", () => {
  it("a dropped navigation followed by a duplicate route does not hide later host navigation", async () => {
    vi.useFakeTimers();
    const route = ref("a"), pending: string[] = [];
    const { c, storage } = make({ tabs: ["a", "b", "c"], active: { get: () => route.value, set: id => pending.push(id) } });
    splitOff(c, "c", "a", "right");
    route.value = pending.pop()!;
    c.focusDirection("left");
    c.focusDirection("right");
    pending.length = 0; // Router cancels the first request and drops the duplicate of its current route.
    await nextTick();
    vi.advanceTimersByTime(250);
    const n = writes(storage);
    route.value = "a";
    expect(c.focus.value).toBe(pane(c, "a"));
    expect(c.panes.value.find(p => p.id === c.focus.value)!.view).toBe("a");
    expect(writes(storage)).toBe(n);
    c.dispose();
    vi.useRealTimers();
  });

  it("disposing clears the duplicate navigation fallback timer", () => {
    vi.useFakeTimers();
    try {
      const route = ref("a");
      const { c } = make({ active: { get: () => route.value, set: () => undefined } });
      splitOff(c, "c", "a", "right");
      c.focusDirection("left");
      expect(vi.getTimerCount()).toBe(1);
      c.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("binds the focused pane's view: actions set it, host navigation reveals without writing", () => {
    const value = ref("a");
    const set = vi.fn((id: string) => { value.value = id; });
    const { c, storage } = make({ active: { get: () => value.value, set } });
    splitOff(c, "c", "a", "right");
    expect(set).toHaveBeenLastCalledWith("c");
    const n = writes(storage);
    value.value = "b";
    expect(c.focus.value).toBe(pane(c, "b"));
    expect(c.notation.value).toBe("H[(a *b d) c]");
    expect(writes(storage)).toBe(n);
    c.focusPane(pane(c, "c"));
    expect(value.value).toBe("c");
  });

  it("a getter lagging behind set() across a tick never pulls the focus back", async () => {
    const value = ref("a");
    const set = vi.fn();
    const { c } = make({ active: { get: () => value.value, set } });
    splitOff(c, "c", "a", "right");
    expect(set).toHaveBeenLastCalledWith("c");
    expect(c.focus.value).toBe(pane(c, "c"));
    c.focusPane(pane(c, "c"));
    expect(c.intent.value.focus).toBe("c");
    c.focusDirection("left");
    expect(set).toHaveBeenLastCalledWith("a");
    expect(c.focus.value).toBe(pane(c, "a"));
    await nextTick();
    value.value = "c"; // the router lands on the first navigation, then on the second
    expect(c.focus.value).toBe(pane(c, "a"));
    value.value = "a";
    expect(c.focus.value).toBe(pane(c, "a"));
    value.value = "c"; // a host navigation once the router caught up
    expect(c.focus.value).toBe(pane(c, "c"));
  });

  it("a host request for a hidden or unknown tab changes nothing", () => {
    const value = ref("zzz");
    const { c } = make({ optional: ["d"], active: { get: () => value.value, set: id => { value.value = id; } } });
    expect(c.focus.value).toBe(pane(c, "a"));
    value.value = "d";
    expect(c.notation.value).toBe("(*a b c)");
  });
});

describe("size collapse", () => {
  it("a cut that does not fit shows its subtree as one pane listing all its views; the tree comes back with room", () => {
    const { c, storage } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "b", "bottom");
    expect(c.notation.value).toBe("H[(*a d) V[b c]]");
    const saved = JSON.stringify(c.intent.value);
    const n = writes(storage);
    c.setContainerSize(150, 800);
    expect(c.panes.value.map(p => [p.collapsed, p.tabs, p.view])).toEqual([[true, ["a", "d", "b", "c"], "c"]]);
    c.setContainerSize(1000, 120);
    expect(c.panes.value.map(p => [p.collapsed, p.tabs, p.view])).toEqual([[false, ["a", "d"], "a"], [true, ["b", "c"], "c"]]);
    c.setContainerSize(1000, 800);
    expect(c.panes.value).toHaveLength(3);
    expect(JSON.stringify(c.intent.value)).toBe(saved);
    expect(writes(storage)).toBe(n);
  });

  it("selecting a tab in a collapsed pane reveals it in the real tree", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    c.setContainerSize(150, 800);
    c.select(c.panes.value[0]!.id, "c");
    expect(c.panes.value[0]!.view).toBe("c");
    c.setContainerSize(1000, 800);
    expect(c.focus.value).toBe(pane(c, "c"));
    expect(c.notation.value).toBe("H[(a *c d) b]");
  });
});

describe("commands, undo and zoom", () => {
  it("grouping, then a layout tab next to the group", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "a", "bottom");
    splitOff(c, "d", "b", "bottom");
    expect(c.notation.value).toBe("H[V[a c] V[b d]]");
    c.focusPane(pane(c, "a"));
    c.toggleSelected(pane(c, "b"));
    expect(c.plan.value).toMatchObject({ ok: true, kind: "exact", panes: [pane(c, "a"), pane(c, "b")] });
    expect(c.group()).toMatchObject({ ok: true, kind: "exact" });
    expect(c.notation.value).toBe("V[H[a b] H[c d]]");
    c.focusPane(pane(c, "a"));
    c.selectRectangle(pane(c, "b"));
    c.tabNext();
    expect(c.notation.value).toBe("V[T{H[a b] | *new:1} H[c d]]");
    expect(c.frames.value).toHaveLength(0);
    c.select(c.focus.value, c.tabSet(c.focus.value)!.tabs[0]!);
    expect(c.frames.value).toHaveLength(1);
  });

  it("a refused selection preview names the panes in the way", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "a", "bottom");
    splitOff(c, "d", "b", "bottom");
    c.focusPane(pane(c, "a"));
    c.toggleSelected(pane(c, "d"));
    expect(c.plan.value).toMatchObject({ ok: false, kind: "error", intruders: [pane(c, "c"), pane(c, "b")] });
    expect(c.group()).toEqual({ ok: false, reason: "not-groupable", nodes: [pane(c, "c"), pane(c, "b")] });
  });

  it("closing a selection can be undone exactly once, with one write each", () => {
    const { c, storage } = make({ optional: ["c", "d"] });
    c.open("c");
    c.open("d");
    c.select(pane(c, "a"), "a");
    splitOff(c, "d", "a", "right");
    splitOff(c, "c", "d", "bottom");
    expect(c.notation.value).toBe("H[(*a b) V[d c]]");
    const before = c.notation.value;
    c.focusPane(pane(c, "d"));
    c.toggleSelected(pane(c, "c"));
    const n = writes(storage);
    expect(c.closeTarget()).toEqual({ ok: true });
    expect(c.notation.value).toBe("(*a b)");
    expect(c.opened.value).toEqual([]);
    expect(c.canUndo.value).toBe(true);
    expect(c.undo()).toEqual({ ok: true });
    expect(c.notation.value).toBe(before);
    expect([...c.opened.value].sort()).toEqual(["c", "d"]);
    expect(writes(storage)).toBe(n + 2);
    expect(c.undo()).toEqual({ ok: false, reason: "unknown" });
  });

  it("zooming a selection that must first be regrouped shows exactly that rectangle, and restore shows everything", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "a", "bottom");
    splitOff(c, "d", "b", "bottom");
    expect(c.notation.value).toBe("H[V[a c] V[b d]]");
    c.focusPane(pane(c, "a"));
    c.toggleSelected(pane(c, "b"));
    expect(c.toggleZoom().ok).toBe(true);
    expect(c.panes.value.map(p => p.view)).toEqual(["a", "b"]);
    expect(c.toggleZoom().ok).toBe(true);
    expect(c.panes.value.map(p => p.view)).toEqual(["a", "b", "c", "d"]);
    expect(c.notation.value).toBe("V[H[a b] H[c d]]");
  });

  it("zoom and restore are memory only; a layout command restores first", () => {
    const { c, storage } = make();
    splitOff(c, "b", "a", "right");
    const n = writes(storage);
    expect(c.zoom(pane(c, "b")).ok).toBe(true);
    expect(c.panes.value.map(p => p.view)).toEqual(["b"]);
    expect(c.zoomed.value).not.toBeNull();
    expect(c.toggleZoom().ok).toBe(true);
    expect(c.zoomed.value).toBeNull();
    c.zoom(pane(c, "b"));
    expect(writes(storage)).toBe(n);
    c.split("bottom");
    expect(c.zoomed.value).toBeNull();
    expect(c.panes.value).toHaveLength(3);
  });

  it("dividers: live resizing writes nothing, a commit clamps and writes once, equalize makes thirds", () => {
    const { c, storage } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "b", "right");
    const outer = c.layout.value.kind === "cut" ? c.layout.value.id : "";
    const n = writes(storage);
    c.setRatioLive(0.9, outer);
    expect(writes(storage)).toBe(n);
    c.commitRatio(0.99, outer);
    expect(writes(storage)).toBe(n + 1);
    expect(c.cuts.value.get(outer)!.ratio).toBeCloseTo(1 - 206 / 994, 6);
    c.equalize(outer);
    for (const p of c.panes.value) expect(p.width).toBeCloseTo(988 / 3, 6);
  });

  it.each([0, 0.5, -3, Number.NaN, Number.POSITIVE_INFINITY])("dividerSize %s is refused at creation: a divider is at least 1px", (size) => {
    expect(() => make({ dividerSize: size })).toThrow(/dividerSize/);
  });

  it("a 1px divider is accepted and used for the geometry", () => {
    const { c } = make({ dividerSize: 1 });
    splitOff(c, "b", "a", "right");
    expect(c.dividerSize).toBe(1);
    expect(c.panes.value.map(p => p.width)).toEqual([499.5, 499.5]);
  });

  it("a reactive dividerSize re-lays the panes at once, in both directions, without writing", () => {
    const size = ref(4);
    const { c, storage } = make({ dividerSize: size });
    splitOff(c, "b", "a", "right");
    const n = writes(storage);
    expect(c.panes.value.map(p => p.width)).toEqual([498, 498]);
    size.value = 12;
    expect(c.dividerSize).toBe(12);
    expect(c.panes.value.map(p => p.width)).toEqual([494, 494]);
    size.value = 2;
    expect(c.panes.value.map(p => p.width)).toEqual([499, 499]);
    expect(writes(storage)).toBe(n);
  });

  it("a reactive dividerSize is refused at creation and when it later drops below 1px", () => {
    expect(() => make({ dividerSize: ref(0) })).toThrow(/dividerSize/);
    const size = ref(3);
    const { c } = make({ dividerSize: () => size.value });
    size.value = 0.5;
    expect(() => c.dividerSize).toThrow(/dividerSize/);
  });

  it("a side bar's live width shows at once without writing; the commit writes once and drops the live value", () => {
    const { c, storage } = make();
    c.tabNext();
    c.cycleBarSide();
    const id = c.panes.value[0]!.id;
    const n = writes(storage);
    c.setBarWidthLive(id, 200);
    expect(c.tabSet(id)!.barWidth).toBe(200);
    c.setBarWidthLive(id, 50);
    expect(c.tabSet(id)!.barWidth).toBe(96);
    expect(writes(storage)).toBe(n);
    c.setBarWidth(id, 230);
    expect(writes(storage)).toBe(n + 1);
    c.setBarWidthLive(id, null);
    expect(c.tabSet(id)!.barWidth).toBe(230);
  });

  it("nudge moves the divider nearest to the focused pane", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    const outer = c.layout.value.kind === "cut" ? c.layout.value.id : "";
    expect(c.nudge(100).ok).toBe(true);
    expect(c.cuts.value.get(outer)!.ratio).toBeCloseTo(0.5 + 100 / (1000 - c.dividerSize), 6);
  });

  it("canMove is a dry run; unknown ids change nothing", () => {
    const { c, storage } = make();
    expect(c.canMove({ view: "b" }, { kind: "split", target: pane(c, "a"), side: "left" })).toEqual({ ok: true });
    expect(c.move({ view: "zzz" }, { kind: "split", target: pane(c, "a"), side: "left" })).toEqual({ ok: false, reason: "unknown" });
    expect(writes(storage)).toBe(0);
    expect(c.panes.value).toHaveLength(1);
  });

  it("insert moves an already-visible view without calling the registration callback", () => {
    const { c, storage } = make();
    const register = vi.fn();
    expect(c.insert("b", { kind: "split", target: pane(c, "a"), side: "right" }, register).ok).toBe(true);
    expect(register).not.toHaveBeenCalled();
    expect(c.notation.value).toBe("H[(*a c d) b]");
    expect(writes(storage)).toBe(1);
  });

  it("insert registers an external tab after the target is resolved, and places it in one write", () => {
    const tabs = ref(["a", "b"]);
    const { c, storage } = make({ tabs });
    const calls: string[] = [];
    const r = c.insert("x", { kind: "split", target: pane(c, "a"), side: "right" }, () => { calls.push("register"); tabs.value = ["a", "b", "x"]; });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["register"]);
    expect(c.notation.value).toBe("H[(*a b) x]");
    expect(writes(storage)).toBe(1);
  });

  it("merge brings every view into one tab set", () => {
    const { c } = make();
    splitOff(c, "b", "a", "right");
    splitOff(c, "c", "b", "bottom");
    c.merge();
    expect(c.notation.value).toBe("(a d b *c)");
  });

  it("an entry key change reloads its own layout and resets selection, zoom and undo", async () => {
    const key = ref("one");
    const { c } = make({ entryKey: key });
    c.split("right");
    c.toggleSelected(c.panes.value[0]!.id);
    key.value = "two";
    await nextTick();
    expect(c.panes.value).toHaveLength(1);
    expect(c.selection.value).toEqual([]);
    expect(c.canUndo.value).toBe(false);
    key.value = "one";
    expect(c.panes.value).toHaveLength(2);
  });

  it("the exported notation reads a saved tree", () => {
    const { c } = make();
    c.split("right");
    expect(notation(c.intent.value.tree as LayoutNode)).toBe("H[(*a b c d) new:1]");
  });
});
