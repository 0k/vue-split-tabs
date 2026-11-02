import { expect, it, vi } from "vitest";
import { ref, type DeepReadonly } from "vue";
import { createSplitTabsController, type LayoutNode, type Orientation } from "../src/index.js";
import { createTabDrag } from "../src/drag.js";
import { labels, pointer, storage } from "./helpers.js";

function setup(ids = ["a", "b", "c", "d", "e"]) {
  const tabs = ref(ids);
  const optional = ref<string[]>([]);
  const host = ref(ids[0] ?? "");
  const saved = storage();
  const options = { tabs, optional, entryKey: "second-review", storageKey: "layouts", storage: saved,
    minPaneWidth: 100, minPaneHeight: 80, active: { get: () => host.value, set: (id: string) => { host.value = id; } } };
  const c = createSplitTabsController(options);
  c.setContainerSize(906, 606);
  return { c, tabs, optional, host, saved, options };
}
function leafTabs(node: DeepReadonly<LayoutNode>, pane: string): readonly string[] | undefined {
  return node.kind === "pane" ? node.id === pane ? node.tabs : undefined : leafTabs(node.first, pane) ?? leafTabs(node.second, pane);
}

it.each(["remove", "optional"] as const)("semantic projection: %s of the host-linked tab falls back without writing or inventing an empty request", change => {
  const f = setup(["a", "b", "c"]);
  f.c.split("b", "cols");
  f.host.value = "b";
  const before = JSON.stringify(f.c.intent.value);
  const setter = vi.spyOn(f.options.active, "set");
  f.saved.setItem.mockClear();
  if (change === "remove") f.tabs.value = ["a", "c"]; else f.optional.value = ["b"];
  expect(f.c.panes.value[0]!.active, "Expected a valid shown tab when the nonempty host request becomes unavailable").toBe("a");
  expect(f.host.value).toBe("b");
  expect(JSON.stringify(f.c.intent.value)).toBe(before);
  expect(f.saved.setItem).not.toHaveBeenCalled();
  expect(setter).not.toHaveBeenCalled();
  f.host.value = "";
  expect(f.c.panes.value[0]!.active).toBe("");
  f.c.dispose();
});

it.each(["cols", "rows"] as const)("second review 1: %s equalization uses effective collapsed minima while resize retains full intent minima", outer => {
  const f = setup(["a", "b", "c", "d"]);
  const cross: Orientation = outer === "cols" ? "rows" : "cols";
  f.c.split("b", outer);
  f.c.place("c", f.c.paneOf("b")!, null);
  f.c.place("d", f.c.paneOf("b")!, null);
  f.c.split("c", cross);
  f.c.moveTo("d", f.c.paneOf("c")!);
  f.c.split("d", outer);
  const before = f.c.intent.value.tree;
  if (before.kind !== "cut") throw new Error("Expected the mixed-axis root cut");
  const hidden = JSON.stringify(before.second);
  const w = outer === "cols" ? 406 : 120, h = outer === "cols" ? 120 : 326;
  f.c.setContainerSize(w, h);
  f.c.commitRatio(0.3);
  expect(f.c.panes.value.map(p => p.tabs)).toEqual([["a"], ["b", "c", "d"]]);
  f.saved.setItem.mockClear();
  f.c.equalize();
  const lengths = () => f.c.panes.value.map(p => outer === "cols" ? p.width : p.height);
  const equal = outer === "cols" ? [200, 200] : [160, 160];
  expect(lengths(), "Expected the collapsed segment to contribute one effective pane minimum, not hidden descendants").toEqual(equal);
  expect(f.c.intent.value.tree.kind === "cut" && f.c.intent.value.tree.ratio).toBe(0.5);
  expect(f.c.intent.value.tree.kind === "cut" && JSON.stringify(f.c.intent.value.tree.second)).toBe(hidden);
  expect(f.saved.setItem).toHaveBeenCalledTimes(1);
  const loaded = createSplitTabsController(f.options);
  loaded.setContainerSize(w, h);
  expect(loaded.panes.value.map(p => outer === "cols" ? p.width : p.height)).toEqual(equal);
  loaded.dispose();
  f.c.commitRatio(1);
  expect(lengths(), "Expected ordinary divider resizing to retain S8 full intent minima").toEqual(outer === "cols" ? [194, 206] : [154, 166]);
  f.c.equalize();
  expect(lengths()).toEqual(equal);
  f.c.dispose();
});

it.each(["split", "moveTo", "place"] as const)("second review 2: unrelated %s preserves an absent tab's saved owner across a start split", action => {
  const f = setup();
  const owner = f.c.panes.value[0]!.id;
  f.c.split("b", "cols");
  expect(leafTabs(f.c.intent.value.tree, owner)).toContain("c");
  f.tabs.value = ["a", "b", "d", "e"];
  const right = f.c.paneOf("b")!;
  if (action === "split") f.c.splitAt("e", "rows", "end", right);
  else if (action === "moveTo") f.c.moveTo("e", right);
  else f.c.place("e", right, null);
  expect(leafTabs(f.c.intent.value.tree, owner), "Expected an unrelated action to retain the saved absent assignment c").toContain("c");
  f.c.splitAt("d", "cols", "start", f.c.paneOf("a")!);
  f.tabs.value = ["a", "b", "c", "d", "e"];
  expect(f.c.paneOf("c"), "Expected restored c beside a in its original owner, not beside newly first d").toBe(owner);
  const loaded = createSplitTabsController(f.options);
  loaded.setContainerSize(906, 606);
  expect(loaded.paneOf("c")).toBe(owner);
  loaded.dispose();
  f.c.dispose();
});

it.each(["place", "close"] as const)("second review 2: an automatic %s merge retains absent assignments in the surviving owner", action => {
  const f = setup(["a", "b", "c"]);
  if (action === "close") { f.optional.value = ["a"]; f.c.open("a", f.c.panes.value[0]!.id); }
  f.c.split("b", "cols");
  f.c.moveTo("c", f.c.paneOf("b")!);
  const owner = f.c.paneOf("b")!;
  f.tabs.value = ["a", "c"];
  f.host.value = "c";
  if (action === "place") f.c.place("a", owner, null); else f.c.close("a");
  expect(leafTabs(f.c.intent.value.tree, owner), "Expected automatic promotion to retain absent b in the surviving leaf").toContain("b");
  f.tabs.value.push("d");
  f.c.splitAt("d", "cols", "start", f.c.panes.value[0]!.id);
  f.tabs.value = ["a", "b", "c", "d"];
  expect(f.c.paneOf("b")).toBe(owner);
  f.c.dispose();
});

it.each(["edge", "centre"] as const)("second review 3: external %s registration applies the pre-registration preview without resurrecting an implicit source", zone => {
  const f = setup(["a", "b", "c"]);
  f.c.split("b", "cols");
  f.c.place("c", f.c.paneOf("b")!, null);
  const hiddenOwner = f.c.paneOf("a")!;
  f.tabs.value = ["b", "c"];
  f.host.value = "b";
  f.c.setContainerSize(300, 200);
  const target = f.c.panes.value[0]!;
  const root = document.createElement("div");
  root.className = "split-tabs";
  const pane = document.createElement("div");
  pane.className = "split-tabs-pane";
  pane.dataset.splitTabsPane = "0";
  pane.dataset.paneId = target.id;
  const body = document.createElement("div");
  pane.append(body);
  root.append(pane);
  document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 200));
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 200));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => body });
  const drag = createTabDrag(f.c, ref(root));
  const register = vi.fn(() => { f.tabs.value.push("x"); });
  const x = zone === "edge" ? 295 : 150;
  try {
    drag.startExternal(new PointerEvent("pointermove", { pointerId: 7, pointerType: "mouse", clientX: x, clientY: 100 }),
      "x", { label: "Incoming" }, labels, register);
    expect(drag.target.value).toMatchObject({ kind: zone === "edge" ? "split" : "place", pane: target.id });
    if (zone === "edge") expect(drag.target.value?.shade?.width).toBe(147);
    f.saved.setItem.mockClear();
    pointer(window, "pointerup", { pointerId: 7, clientX: x, clientY: 100 });
    expect(register).toHaveBeenCalledTimes(1);
    expect(f.c.panes.value.map(p => p.tabs), "Expected exact preview placement, not transient default placement in the hidden first leaf")
      .toEqual(zone === "edge" ? [["b", "c"], ["x"]] : [["b", "c", "x"]]);
    expect(f.c.panes.value[f.c.panes.value.length - 1]!.active).toBe("x");
    expect(leafTabs(f.c.intent.value.tree, hiddenOwner), "Expected registration not to prune the hidden owner of absent a").toContain("a");
    expect(f.saved.setItem).toHaveBeenCalledTimes(1);
    const loaded = createSplitTabsController(f.options);
    expect(loaded.intent.value).toEqual(f.c.intent.value);
    loaded.dispose();
  } finally { drag.dispose(); f.c.dispose(); root.remove(); }
});
