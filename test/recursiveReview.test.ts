import { describe, expect, it, vi } from "vitest";
import { ref, type DeepReadonly } from "vue";
import { createSplitTabsController, type LayoutNode, type PaneNode, type SplitTabsIntent } from "../src/index.js";
import { storage } from "./helpers.js";

function setup(ids = ["a", "b", "c", "d", "e"], optional: string[] = [], saved = storage()) {
  const tabs = ref(ids);
  const optionalIds = ref([...optional]);
  const host = ref(ids.find(id => !optional.includes(id)) ?? "");
  const key = ref("review");
  const observed: string[] = [];
  const set = vi.fn((id: string) => {
    const table = JSON.parse(saved.getItem("layouts") ?? "null") as { entries: { key: string; intent: SplitTabsIntent }[] };
    observed.push(table.entries.find(entry => entry.key === key.value)?.intent.firstActive ?? "");
    host.value = id;
  });
  const options = { tabs, optional: optionalIds, entryKey: key, storageKey: "layouts", storage: saved,
    minPaneWidth: 100, minPaneHeight: 80, active: { get: () => host.value, set } };
  const c = createSplitTabsController(options);
  c.setContainerSize(906, 606);
  return { c, saved, host, tabs, optional: optionalIds, key, set, observed, options };
}
function leafMembership(node: DeepReadonly<LayoutNode>): readonly string[][] {
  return node.kind === "pane" ? [[...node.tabs]] : [...leafMembership(node.first), ...leafMembership(node.second)];
}
function intentLeaves(node: DeepReadonly<LayoutNode>): DeepReadonly<PaneNode>[] {
  return node.kind === "pane" ? [node] : [...intentLeaves(node.first), ...intentLeaves(node.second)];
}
function three(optional: string[] = []) {
  const f = setup(["a", "b", "c"], optional);
  if (optional.includes("b")) f.c.open("b", f.c.panes.value[0]!.id);
  f.c.select(f.c.panes.value[0]!.id, "a");
  f.c.split("b", "cols");
  f.c.place("c", f.c.paneOf("b")!, null);
  f.c.split("c", "cols");
  expect(f.c.panes.value.map(p => p.tabs)).toEqual([["a"], ["b"], ["c"]]);
  return f;
}

describe("independent review regressions", () => {
  it.each(["moveTo", "place"] as const)("finding 1: %s into a collapsed first pane preserves unique membership and reload", action => {
    const f = setup();
    f.c.split("b", "cols");
    f.c.split("d", "cols");
    f.c.setContainerSize(300, 606);
    expect(f.c.panes.value.map(p => p.tabs)).toEqual([["a", "c", "d", "e"], ["b"]]);
    const target = f.c.panes.value[0]!.id;
    if (action === "place") f.c.place("b", target, null); else f.c.moveTo("b", target);
    const members = leafMembership(f.c.intent.value.tree).flat();
    expect(members.length, `Expected unique persisted leaf membership, observed ${JSON.stringify(leafMembership(f.c.intent.value.tree))}`)
      .toBe(new Set(members).size);
    const reloaded = createSplitTabsController(f.options);
    expect(reloaded.intent.value, "Expected the stored tree to validate and reload without falling back to defaults").toEqual(f.c.intent.value);
    reloaded.dispose();
    f.c.dispose();
  });

  it.each(["close", "moveTo", "place", "replace"] as const)("finding 2: %s repairs a removed secondary host deep link in one write", action => {
    const f = three(["b"]);
    f.host.value = "b";
    f.set.mockClear();
    f.saved.setItem.mockClear();
    f.observed.length = 0;
    if (action === "close") f.c.close("b");
    else if (action === "replace") f.c.replace("b", "c");
    else if (action === "place") f.c.place("b", f.c.paneOf("c")!, null);
    else f.c.moveTo("b", f.c.paneOf("c")!);
    expect(f.host.value, "Expected the host deep link repaired to the surviving primary selection").toBe("a");
    expect(f.c.intent.value.firstActive).toBe("a");
    expect(f.c.panes.value[0]!.active).toBe("a");
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    expect(f.set).toHaveBeenCalledExactlyOnceWith("a");
    expect(f.observed, "Expected firstActive already persisted when the host setter runs").toEqual(["a"]);
    f.c.dispose();
  });

  it("finding 2: hidden replacement repairs an invalidated secondary deep link without consulting old pane selections", () => {
    const f = three(["b", "hidden"]);
    f.tabs.value.push("hidden");
    f.host.value = "b";
    f.saved.setItem.mockClear();
    f.c.replace("b", "hidden");
    expect(f.host.value, "Expected closed placeholder deep link repaired to a").toBe("a");
    expect(f.c.panes.value.map(p => p.active)).toEqual(["a", "hidden", "c"]);
    expect(f.c.intent.value.firstActive).toBe("a");
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    f.c.dispose();
  });

  it("finding 3: the first rendered pane preserves empty host state after structural first-leaf disappearance", () => {
    const f = setup(["a", "b"]);
    f.c.split("b", "cols");
    const savedIntent = JSON.stringify(f.c.intent.value);
    f.saved.setItem.mockClear();
    f.set.mockClear();
    f.tabs.value = ["b"];
    f.host.value = "";
    expect(f.c.panes.value.map(p => [p.tabs, p.active]), "Expected first rendered pane to pass through the empty host selection")
      .toEqual([[["b"], ""]]);
    expect(JSON.stringify(f.c.intent.value)).toBe(savedIntent);
    expect(f.saved.setItem).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
    f.c.select(f.c.panes.value[0]!.id, "b");
    expect(f.host.value).toBe("b");
    expect(f.c.intent.value.firstActive).toBe("b");
    expect(f.c.restoredActive.value).toBe("b");
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    f.c.dispose();
  });

  it("finding 4: firstActive is resolved against the promoted post-drop primary pane", () => {
    const f = three();
    f.host.value = "b";
    f.saved.setItem.mockClear();
    f.c.place("a", f.c.paneOf("c")!, null);
    expect(f.c.panes.value.map(p => [p.tabs, p.active])).toEqual([[["b"], "b"], [["c", "a"], "a"]]);
    expect(f.host.value).toBe("b");
    expect(f.c.intent.value.firstActive, "Expected the persisted primary request to belong to promoted pane [b], not destination [c,a]").toBe("b");
    expect(f.c.restoredActive.value).toBe("b");
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    f.c.dispose();
  });

  it.each(["start", "end"] as const)("finding 4: a %s split after first-pane removal resolves the final primary selection", side => {
    const f = three();
    f.host.value = "b";
    f.saved.setItem.mockClear();
    f.c.splitAt("a", "rows", side, f.c.paneOf("b")!);
    const primary = side === "start" ? "a" : "b";
    expect(f.c.panes.value.map(p => p.tabs)).toEqual(side === "start" ? [["a"], ["b"], ["c"]] : [["b"], ["a"], ["c"]]);
    expect(f.host.value, "Expected host selection resolved after BOTH source pruning and target splitting").toBe(primary);
    expect(f.c.intent.value.firstActive).toBe(primary);
    expect(f.c.restoredActive.value).toBe(primary);
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    f.c.dispose();
  });

  it.each([false, true])("finding 5: equalize ignores non-rendered segments and dividers, sizeCollapsed=%s", sizeCollapsed => {
    const f = three();
    if (sizeCollapsed) f.c.setContainerSize(300, 606);
    else { f.c.commitRatio(0.4); f.tabs.value = ["a", "c"]; }
    expect(f.c.panes.value).toHaveLength(2);
    f.saved.setItem.mockClear();
    f.c.equalize();
    const widths = f.c.panes.value.map(p => p.width);
    expect(Math.max(...widths) - Math.min(...widths), `Expected equal visible panes within 1px, observed ${widths}`).toBeLessThanOrEqual(1);
    expect(widths).toEqual(sizeCollapsed ? [147, 147] : [450, 450]);
    expect(f.saved.setItem).toHaveBeenCalledTimes(sizeCollapsed ? 0 : 1);
    f.c.dispose();
  });

  it("finding 5: default equalize addresses the rendered root when the saved outer cut is hidden", () => {
    const f = three();
    const root = f.c.intent.value.tree;
    if (root.kind !== "cut" || root.second.kind !== "cut") throw new Error("Expected a right nested cut");
    f.c.commitRatio(0.3, root.second.id);
    f.tabs.value = ["b", "c"];
    expect(f.c.layout.value.kind === "cut" && f.c.layout.value.id).toBe(root.second.id);
    f.c.equalize();
    expect(f.c.panes.value.map(p => p.width), "Expected default equalize to centre the one rendered separator").toEqual([450, 450]);
    f.c.dispose();
  });

  function migratedHistory() {
    const saved = storage();
    saved.values.set("layouts", JSON.stringify({ entries: [{ key: "review", stamp: 1, intent: {
      orientation: "cols", second: ["b", "c"], secondActive: "b", ratio: 0.5, firstActive: "a",
    } }] }));
    const f = setup(["a", "b", "c", "d"], [], saved);
    const removed = f.c.paneOf("b")!;
    f.c.select(removed, "c");
    f.c.select(removed, "b");
    f.c.moveTo("c", f.c.paneOf("a")!);
    f.c.moveTo("b", f.c.paneOf("a")!);
    f.c.split("b", "cols");
    return { ...f, removed };
  }
  it("finding 6: loaded and removed pane ids are reserved for the controller lifetime", () => {
    const f = migratedHistory();
    expect(f.c.paneOf("b"), `Expected a fresh identity, not removed loaded id ${f.removed}`).not.toBe(f.removed);
    const issued = f.c.paneOf("b")!;
    f.c.merge();
    f.key.value = "fresh-entry";
    expect(f.c.panes.value[0]!.id).not.toBe(issued);
    expect(f.c.panes.value[0]!.id).not.toBe("pane-0");
    f.c.dispose();
  });
  it("finding 6: a new pane cannot inherit the removed pane's selection history", () => {
    const f = migratedHistory();
    const pane = f.c.paneOf("b")!;
    f.c.moveTo("c", pane);
    f.c.moveTo("d", pane);
    f.c.place("c", pane, "b");
    expect(f.c.panes.value.find(p => p.id === pane)!.tabs).toEqual(["c", "b", "d"]);
    f.c.select(pane, "b");
    f.c.moveTo("b", f.c.paneOf("a")!);
    expect(f.c.panes.value.find(p => p.id === pane)!.active, "Expected order neighbor d, not c visited only in the removed pane").toBe("d");
    f.c.dispose();
  });

  // 2,880 replayed actions take about 5 s: budget well above vitest's 5 s default.
  it("every random action preserves storage, absent ownership, rendered host role and valid shown tabs across host-input changes", {
    timeout: 60_000,
  }, () => {
    const performed = new Set<string>();
    const changed = new Set<string>();
    const operations = ["split", "split", "split", "moveTo", "place", "close", "replace", "merge", "resize", "resize",
      "open", "select", "insert", "remove", "restore", "optional", "host"];
    let restoredOwners = 0, hiddenOwners = 0, collapsedStates = 0, changedWhileCollapsed = 0;
    let hostRemovals = 0, hostRestorations = 0, optionalToggles = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let randomState = seed;
      const random = (n: number) => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return n === 0 ? 0 : (randomState >>> 8) % n;
      };
      const universe = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const f = setup([...universe], ["e", "f", "g", "h"]);
      const pendingOwners = new Map<string, string>();
      let size: [number, number] = [300, 606];
      f.c.select(f.c.panes.value[0]!.id, "a");
      f.c.split("b", "cols");
      f.c.split("d", "cols");
      f.c.setContainerSize(...size);
      for (let step = 0; step < 240; step++) {
        const panes = f.c.panes.value;
        const pane = panes[random(panes.length)]!;
        const visible = panes.flatMap(p => [...p.tabs]);
        const id = step === 0 ? "b" : visible[random(visible.length)] ?? "a";
        const kind = step === 0 ? "moveTo" : operations[random(operations.length)]!;
        performed.add(kind);
        const before = JSON.stringify(f.c.intent.value);
        const writes = f.saved.setItem.mock.calls.length;
        const setters = f.set.mock.calls.length;
        const oldLeaves = intentLeaves(f.c.intent.value.tree);
        const oldOwners = new Map(oldLeaves.flatMap(leaf => leaf.tabs.map(tab => [tab, leaf.id] as const)));
        const liveOwners = new Set(visible.map(tab => oldOwners.get(tab) ?? oldLeaves[0]!.id));
        const collapsed = liveOwners.size > panes.length;
        if (collapsed) collapsedStates++;
        const deliberate = new Set<string>();
        if (kind === "split") { deliberate.add(id); f.c.splitAt(id, random(2) ? "rows" : "cols", random(2) ? "start" : "end", pane.id); }
        else if (kind === "moveTo") { deliberate.add(id); f.c.moveTo(id, step === 0 ? panes[0]!.id : pane.id); }
        else if (kind === "place") { deliberate.add(id); f.c.place(id, pane.id, random(2) ? pane.tabs[random(pane.tabs.length)] ?? null : null); }
        else if (kind === "close") {
          const closable = visible.filter(tab => f.c.isOptional(tab));
          const tab = closable[random(closable.length)] ?? id;
          deliberate.add(tab); f.c.close(tab);
        } else if (kind === "replace") {
          const old = visible.filter(tab => f.c.isOptional(tab));
          if (old.length > 0 && f.tabs.value.length > 0) {
            const source = old[random(old.length)]!, target = f.tabs.value[random(f.tabs.value.length)]!;
            deliberate.add(source); deliberate.add(target); f.c.replace(source, target);
          }
        } else if (kind === "merge") f.c.merge();
        else if (kind === "resize") {
          size = [[180, 300, 406, 906, 1800][random(5)]!, [120, 200, 606][random(3)]!];
          f.c.setContainerSize(...size);
        } else if (kind === "open" || kind === "insert") {
          const incoming = f.tabs.value[random(f.tabs.value.length)];
          if (incoming !== undefined) {
            deliberate.add(incoming);
            if (kind === "open") f.c.open(incoming, pane.id); else f.c.insert(incoming, pane.id, null);
          }
        } else if (kind === "select") { if (pane.tabs.length > 0) f.c.select(pane.id, pane.tabs[random(pane.tabs.length)]!); }
        else if (kind === "remove") {
          const removed = f.tabs.value[random(f.tabs.value.length)];
          if (removed !== undefined) { hostRemovals++; f.tabs.value = f.tabs.value.filter(tab => tab !== removed); }
        } else if (kind === "restore") {
          const absent = universe.filter(tab => !f.tabs.value.includes(tab));
          const restored = absent[random(absent.length)];
          if (restored !== undefined) {
            hostRestorations++; f.tabs.value = universe.filter(tab => tab === restored || f.tabs.value.includes(tab));
          }
        } else if (kind === "optional") {
          const tab = universe[random(universe.length)]!;
          optionalToggles++;
          f.optional.value = f.optional.value.includes(tab) ? f.optional.value.filter(id => id !== tab) : [...f.optional.value, tab];
        } else f.host.value = [...visible, "", "unavailable"][random(visible.length + 2)]!;
        const intentChanged = JSON.stringify(f.c.intent.value) !== before;
        if (intentChanged) { changed.add(kind); if (collapsed) changedWhileCollapsed++; }
        const label = `seed=${seed}, step=${step}, action=${kind}, present=${f.tabs.value}, optional=${f.optional.value}, host=${f.host.value}`;
        if (["resize", "remove", "restore", "optional", "host"].includes(kind)) {
          expect(JSON.stringify(f.c.intent.value), `Expected no intent mutation for derived input: ${label}`).toBe(before);
          expect(f.saved.setItem.mock.calls.length, `Expected no derived storage write: ${label}`).toBe(writes);
          expect(f.set.mock.calls.length, `Expected no derived host setter: ${label}`).toBe(setters);
        }
        const nextLeaves = intentLeaves(f.c.intent.value.tree);
        const nextOwners = new Map(nextLeaves.flatMap(leaf => leaf.tabs.map(tab => [tab, leaf.id] as const)));
        const surviving = new Set(nextLeaves.map(leaf => leaf.id));
        const shown = f.c.panes.value;
        const nextVisible = new Set(shown.flatMap(p => [...p.tabs]));
        if (intentChanged && kind === "merge") pendingOwners.clear();
        if (intentChanged) for (const tab of deliberate) pendingOwners.delete(tab);
        for (const tab of visible) if (!nextVisible.has(tab) && !deliberate.has(tab)) {
          const owner = oldOwners.get(tab);
          if (owner !== undefined && surviving.has(owner)) { pendingOwners.set(tab, owner); hiddenOwners++; }
        }
        for (const [tab, owner] of pendingOwners) {
          // Explicit merge or owner-leaf removal ends the old ownership contract; unrelated actions do not.
          if (!surviving.has(owner)) { pendingOwners.delete(tab); continue; }
          expect(nextOwners.get(tab), `Expected saved hidden/absent owner ${owner} retained for ${tab}: ${label}`).toBe(owner);
          if (nextVisible.has(tab)) { restoredOwners++; pendingOwners.delete(tab); }
        }
        for (const p of shown) {
          if (p.tabs.length === 0 || (p.index === 0 && f.host.value === "")) {
            expect(p.active, `Expected empty shown state only for an empty pane or explicit empty host request: ${label}`).toBe("");
          } else expect(p.tabs.includes(p.active), `Expected a valid shown tab in ${p.id}, observed ${p.active}: ${label}`).toBe(true);
        }
        if (f.host.value === "") expect(shown[0]!.active, `Expected first rendered pane to hold the empty host role: ${label}`).toBe("");
        const linked = shown.find(p => p.tabs.includes(f.host.value));
        if (linked !== undefined) expect(linked.active, `Expected host link shown in its actual rendered pane: ${label}`).toBe(f.host.value);
        const members = leafMembership(f.c.intent.value.tree).flat();
        expect(members.length, `Expected unique leaf membership after ${label}; observed ${JSON.stringify(leafMembership(f.c.intent.value.tree))}`)
          .toBe(new Set(members).size);
        const stored = JSON.parse(f.saved.getItem("layouts")! ) as { entries: { key: string; intent: SplitTabsIntent }[] };
        expect(stored.entries.find(entry => entry.key === "review")!.intent, `Expected action persisted identical intent after ${label}`)
          .toEqual(f.c.intent.value);
        const reloaded = createSplitTabsController(f.options);
        expect(reloaded.intent.value, `Expected storage validator to accept and reload the identical tree after ${label}`).toEqual(f.c.intent.value);
        reloaded.setContainerSize(...size);
        expect(reloaded.panes.value, `Expected identical rendered semantics after reload: ${label}`).toEqual(shown);
        reloaded.dispose();
      }
      f.c.dispose();
    }
    expect([...performed].sort()).toEqual(["close", "host", "insert", "merge", "moveTo", "open", "optional", "place", "remove", "replace", "resize", "restore", "select", "split"]);
    for (const kind of ["split", "moveTo", "place", "close", "replace", "merge", "open", "select", "insert"]) {
      expect(changed.has(kind), `Expected seeded sequences to exercise a changed intent for ${kind}, not only no-ops`).toBe(true);
    }
    expect(hiddenOwners, "Expected saved-owner hide/remove transitions, not just controller-only sequences").toBeGreaterThan(0);
    expect(restoredOwners, "Expected restoration to verify previously hidden/absent ownership").toBeGreaterThan(0);
    expect(collapsedStates, "Expected size-collapsed action states").toBeGreaterThan(0);
    expect(changedWhileCollapsed, "Expected intent-changing actions while size-collapsed").toBeGreaterThan(0);
    console.info("Semantic sequence coverage", { steps: 12 * 240, hostRemovals, hostRestorations, optionalToggles,
      hiddenOwners, restoredOwners, collapsedStates, changedWhileCollapsed });
  });
});
