// Specification of layout splitting, tab placement and geometric grouping.
import { describe, expect, it } from "vitest";
import * as A from "../src/algebra";
import { cut, findNode, keyOf, notation, tabSet, type CutNode, type LayoutNode, type TabSetNode } from "../src/model";

const STAGE = { x: 0, y: 0, w: 1000, h: 1000 };
type TestEnv = A.Env;
function makeEnv(overrides: Partial<A.Env> = {}): TestEnv {
  let ids = 0;
  let views = 0;
  return {
    visible: () => true, closable: () => true,
    fresh: prefix => `${prefix}${++ids}`, placeholder: () => String(++views),
    stage: STAGE, min: { w: 60, h: 60 }, snap: 40, bar: { thickness: 24, width: 34 }, ...overrides,
  };
}
const pane = (env: TestEnv) => { const v = env.placeholder(); return tabSet(env.fresh("tabs"), [v], v); };
function workspace(root: LayoutNode, env: TestEnv): A.Workspace {
  return { root, focus: A.visiblePanes(root, env)[0]!.id, selection: [], zoom: null, barFocus: null };
}
function preset(name: "single" | "cols" | "rows" | "skewed", env: TestEnv): A.Workspace {
  if (name === "single") return workspace(pane(env), env);
  const [p1, p2, p3, p4] = [pane(env), pane(env), pane(env), pane(env)];
  const c = (o: "rows" | "cols", r: number, a: LayoutNode, b: LayoutNode) => cut(env.fresh("cut"), o, r, a, b);
  if (name === "cols") return workspace(c("cols", 0.5, c("rows", 0.5, p1, p3), c("rows", 0.5, p2, p4)), env);
  if (name === "rows") return workspace(c("rows", 0.5, c("cols", 0.5, p1, p2), c("cols", 0.5, p3, p4)), env);
  return workspace(c("cols", 0.5, c("rows", 0.48, p1, p3), c("rows", 0.515, p2, p4)), env);
}
function setup(name: "single" | "cols" | "rows" | "skewed", overrides: Partial<A.Env> = {}) {
  const env = makeEnv(overrides);
  return { env, ws: preset(name, env) };
}
const line = (entry: LayoutNode, env: TestEnv) => notation(entry, n => keyOf(A.shownEntry(n, env) ?? ""), t => A.hasVisible(t, env));
const root = (ws: A.Workspace, env: TestEnv) => line(ws.root, env);
function paneOf(ws: A.Workspace, env: TestEnv, view: string): string {
  const p = A.visiblePanes(ws.root, env).find(q => A.shownEntry(q, env) === view);
  if (p === undefined) throw new Error(`pane ${view} not on screen in ${root(ws, env)}`);
  return p.id;
}
const select = (ws: A.Workspace, env: TestEnv, ...views: string[]) => { ws.selection = views.map(v => paneOf(ws, env, v)); };
const at = (ws: A.Workspace, id: string) => findNode(ws.root, id)!;
const tabsAt = (ws: A.Workspace, id: string) => at(ws, id) as TabSetNode;
const focusView = (ws: A.Workspace, env: TestEnv) => A.shownEntry(tabsAt(ws, ws.focus), env);
const viewsOfPanes = (ws: A.Workspace, env: TestEnv, ids: readonly string[]) => ids.map(id => A.shownEntry(tabsAt(ws, id), env));
const asCut = (n: LayoutNode) => n as CutNode;
const activate = (ws: A.Workspace, env: TestEnv, id: string, index: number) =>
  A.activate(ws, id, keyOf(tabsAt(ws, id).tabs[index]!), env);
const bar = (id: string, index: number | null = null) => ({ kind: "bar" as const, target: id, index });

describe("grouping", () => {
  it("columns-first 2x2: grouping the top row re-cuts rows first", () => {
    const { env, ws } = setup("cols");
    expect(root(ws, env)).toBe("H[V[1 3] V[2 4]]");
    select(ws, env, "1", "2");
    const r = A.group(ws, env);
    expect(r).toMatchObject({ ok: true, kind: "exact" });
    expect(root(ws, env)).toBe("V[H[1 2] H[3 4]]");
    expect(line(at(ws, (r as { node: string }).node), env)).toBe("H[1 2]");
  });

  it("rows-first 2x2: the top row is already a group", () => {
    const { env, ws } = setup("rows");
    select(ws, env, "1", "2");
    expect(A.group(ws, env)).toMatchObject({ ok: true, kind: "already" });
    expect(root(ws, env)).toBe("V[H[1 2] H[3 4]]");
  });

  it("a diagonal selection is refused and names the panes in the way", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "4");
    const before = root(ws, env);
    const r = A.group(ws, env);
    expect(r).toMatchObject({ ok: false, reason: "not-groupable" });
    expect(viewsOfPanes(ws, env, (r as { nodes: string[] }).nodes)).toEqual(["3", "2"]);
    expect(root(ws, env)).toBe(before);
  });

  it("near-aligned edges are snapped together, then grouped", () => {
    const { env, ws } = setup("skewed");
    select(ws, env, "1", "2");
    const plan = A.planGroup(ws, ws.selection, env);
    expect(plan.kind).toBe("snap");
    expect(plan.kind === "snap" && plan.moved.map(t => A.shownEntry(t.node as TabSetNode, env)).sort()).toEqual(["1", "2", "3", "4"]);
    A.group(ws, env);
    expect(root(ws, env)).toBe("V[H[1 2] H[3 4]]");
    expect(Math.abs(asCut(ws.root).ratio - (0.48 + 0.515) / 2)).toBeLessThan(1e-9);
  });

  it("edges too far apart are not snapped", () => {
    const { env, ws } = setup("skewed", { snap: 10 });
    select(ws, env, "1", "2");
    const r = A.group(ws, env);
    expect(r).toMatchObject({ ok: false, reason: "not-groupable" });
    expect(viewsOfPanes(ws, env, (r as { nodes: string[] }).nodes)).toEqual(["3"]);
  });

  it("a pane inside a layout tab stands for the whole tab set in the outer scope", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    activate(ws, env, asCut(ws.root).first.id, 0);
    select(ws, env, "1", "3");
    const plan = A.planGroup(ws, ws.selection, env);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.intruders.map(n => line(n, env))).toEqual(["4"]);
    select(ws, env, "1", "3", "4");
    expect(A.planGroup(ws, ws.selection, env).kind).toBe("already");
  });

  it("rectangle selection closes over the panes in between", () => {
    const { env, ws } = setup("cols");
    const sorted = (ids: string[]) => viewsOfPanes(ws, env, ids).sort();
    expect(sorted(A.rectangleSelection(ws, paneOf(ws, env, "1"), paneOf(ws, env, "2"), env))).toEqual(["1", "2"]);
    expect(sorted(A.rectangleSelection(ws, paneOf(ws, env, "1"), paneOf(ws, env, "4"), env))).toEqual(["1", "2", "3", "4"]);
    const k = setup("skewed");
    expect(viewsOfPanes(k.ws, k.env, A.rectangleSelection(k.ws, paneOf(k.ws, k.env, "1"), paneOf(k.ws, k.env, "2"), k.env)).sort())
      .toEqual(["1", "2"]);
  });
});

describe("tabs next to (T) and splits (E / O)", () => {
  it("T on a selection wraps the group; closing the new tab dissolves it", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    expect(A.tabNext(ws, env)).toMatchObject({ ok: true, view: "5" });
    expect(root(ws, env)).toBe("V[T{H[1 2] | *5} H[3 4]]");
    const sup = asCut(ws.root).first.id;
    expect(ws.focus).toBe(sup);
    expect(focusView(ws, env)).toBe("5");
    activate(ws, env, sup, 0);
    expect(root(ws, env)).toBe("V[T{*H[1 2] | 5} H[3 4]]");
    A.closeTab(ws, sup, "5", env);
    expect(root(ws, env)).toBe("V[H[1 2] H[3 4]]");
  });

  it("T on the whole content of a layout tab adds a sibling tab, no nesting", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    activate(ws, env, asCut(ws.root).first.id, 0);
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("V[T{H[1 2] | 5 | *6} H[3 4]]");
  });

  it("E with a selection puts the new pane beside the whole group", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "3", "4");
    expect(A.splitNew(ws, "right", env)).toMatchObject({ ok: true, view: "5" });
    expect(root(ws, env)).toBe("V[H[1 2] H[H[3 4] 5]]");
    expect(ws.selection).toEqual([]);
  });

  it("O without selection cuts the focused pane; E refuses without room", () => {
    const { env, ws } = setup("single");
    A.splitNew(ws, "bottom", env);
    expect(root(ws, env)).toBe("V[1 2]");
    const tiny = setup("single", { stage: { x: 0, y: 0, w: 100, h: 100 } });
    expect(A.splitNew(tiny.ws, "right", tiny.env)).toEqual({ ok: false, reason: "no-room" });
    expect(root(tiny.ws, tiny.env)).toBe("1");
  });

  it("T without selection adds a tab to the focused pane", () => {
    const { env, ws } = setup("rows");
    ws.focus = paneOf(ws, env, "2");
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("V[H[1 (2 *5)] H[3 4]]");
  });

  it("closing the last tab of a pane removes the pane", () => {
    const { env, ws } = setup("cols");
    A.closeTab(ws, paneOf(ws, env, "3"), "3", env);
    expect(root(ws, env)).toBe("H[1 V[2 4]]");
    expect(A.visiblePanes(ws.root, env).map(p => p.id)).toContain(ws.focus);
  });
});

describe("moving", () => {
  const mv = (ws: A.Workspace, env: TestEnv, source: A.MoveSource, zone: A.Zone) => A.move(ws, source, zone, env);

  it("a drop on a pane edge splits that pane; the old place closes up", () => {
    const { env, ws } = setup("cols");
    expect(mv(ws, env, { node: paneOf(ws, env, "4") }, { kind: "split", target: paneOf(ws, env, "1"), side: "left" }).ok).toBe(true);
    expect(root(ws, env)).toBe("H[V[H[4 1] 3] 2]");
    expect(focusView(ws, env)).toBe("4");
  });

  it("a pane dropped on a bar adds its tabs there", () => {
    const { env, ws } = setup("cols");
    mv(ws, env, { node: paneOf(ws, env, "2") }, bar(paneOf(ws, env, "1")));
    expect(root(ws, env)).toBe("H[V[(1 *2) 3] 4]");
  });

  it("a drop on a tab bar inserts at that position, also within the same bar", () => {
    const { env, ws } = setup("rows");
    ws.focus = paneOf(ws, env, "1");
    A.tabNext(ws, env);
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("V[H[(1 5 *6) 2] H[3 4]]");
    const p1 = paneOf(ws, env, "6");
    mv(ws, env, { view: "1" }, bar(p1, 3));
    expect(root(ws, env)).toBe("V[H[(5 6 *1) 2] H[3 4]]");
    mv(ws, env, { view: "6" }, bar(paneOf(ws, env, "2"), 0));
    expect(root(ws, env)).toBe("V[H[(5 *1) (*6 2)] H[3 4]]");
  });

  it("dragging the shown tab to its own pane's edge splits inside that tab", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    mv(ws, env, { view: "2" }, { kind: "split", target: ws.root.id, side: "right" });
    expect(root(ws, env)).toBe("T{1 | *H[3 2]}");
  });

  it("a drop on the outer edge splits the whole area", () => {
    const { env, ws } = setup("cols");
    mv(ws, env, { node: paneOf(ws, env, "1") }, { kind: "split", target: "root", side: "bottom" });
    expect(root(ws, env)).toBe("V[H[3 V[2 4]] 1]");
  });

  it("dragging a selection groups it first and moves the group", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    mv(ws, env, { selection: ws.selection }, { kind: "split", target: "root", side: "right" });
    expect(root(ws, env)).toBe("H[H[3 4] H[1 2]]");
    expect(ws.selection).toEqual([]);
  });

  it("moving a layout tab out of its tab set dissolves the set", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    const sup = tabsAt(ws, asCut(ws.root).first.id);
    activate(ws, env, sup.id, 0);
    mv(ws, env, { node: keyOf(sup.tabs[0]!) }, { kind: "split", target: paneOf(ws, env, "4"), side: "bottom" });
    expect(root(ws, env)).toBe("V[5 H[3 V[4 H[1 2]]]]");
  });

  it("dragging a selection that needs edge alignment", () => {
    const { env, ws } = setup("skewed");
    select(ws, env, "1", "2");
    expect(mv(ws, env, { selection: ws.selection }, { kind: "split", target: "root", side: "bottom" }).ok).toBe(true);
    expect(root(ws, env)).toBe("V[H[3 4] H[1 2]]");
  });

  it("a group dropped on a pane's bar makes both tabs of a new tab set", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "3");
    mv(ws, env, { selection: ws.selection }, bar(paneOf(ws, env, "2")));
    expect(root(ws, env)).toBe("V[T{2 | *V[1 3]} 4]");
  });

  it("refused moves change nothing", () => {
    const { env, ws } = setup("cols");
    const before = root(ws, env);
    const p = (v: string) => paneOf(ws, env, v);
    // The 2026-11-07 self-split decision overrides the mock-up's own-edge refusal; own middle still refuses.
    expect(mv(ws, env, { node: p("1") }, { kind: "inside", target: p("1") })).toEqual({ ok: false, reason: "into-itself" });
    expect(mv(ws, env, { view: "1" }, bar(p("1")))).toEqual({ ok: false, reason: "nothing-to-move" });
    select(ws, env, "1", "2");
    expect(mv(ws, env, { selection: ws.selection }, { kind: "split", target: p("2"), side: "top" }))
      .toEqual({ ok: false, reason: "into-itself" });
    select(ws, env, "1", "4");
    expect(mv(ws, env, { selection: ws.selection }, { kind: "split", target: "root", side: "top" })).toMatchObject({ reason: "not-groupable" });
    ws.selection = [];
    const small = { ...env, stage: { x: 0, y: 0, w: 200, h: 200 } };
    expect(A.move(ws, { node: p("4") }, { kind: "split", target: p("1"), side: "left" }, small)).toEqual({ ok: false, reason: "no-room" });
    expect(root(ws, env)).toBe(before);
    expect(mv(ws, env, { node: p("4") }, { kind: "split", target: p("1"), side: "left" }).ok).toBe(true);
  });

  it("a dry run validates without changing the tree", () => {
    const { env, ws } = setup("cols");
    expect(A.move(ws, { node: paneOf(ws, env, "4") }, { kind: "split", target: paneOf(ws, env, "1"), side: "left" }, env, true))
      .toEqual({ ok: true });
    expect(root(ws, env)).toBe("H[V[1 3] V[2 4]]");
  });

  it("'as a tab' aimed at a group: a new bar around it, or the bar holding it", () => {
    const { env, ws } = setup("cols");
    const colA = asCut(ws.root).first.id;
    mv(ws, env, { node: paneOf(ws, env, "4") }, bar(colA));
    expect(root(ws, env)).toBe("H[T{V[1 3] | *4} 2]");
    const sup = tabsAt(ws, asCut(ws.root).first.id);
    activate(ws, env, sup.id, 0);
    mv(ws, env, { node: paneOf(ws, env, "2") }, bar(keyOf(sup.tabs[0]!)));
    expect(root(ws, env)).toBe("T{V[1 3] | 4 | *2}");
  });
});

describe("self-drop specification", () => {
  it("the only visible tab self-splits inside the shown entry, preserving an absent sibling", () => {
    const env = makeEnv({ visible: view => view !== "x" });
    const original = tabSet("original", ["a", "x"], "a");
    const ws = workspace(cut("outer", "cols", 0.5, original, tabSet("neighbor", ["b"], "b")), env);
    const zone = { kind: "split", target: original.id, side: "right" } as const;
    expect(A.move(ws, { view: "a" }, zone, env, true)).toEqual({ ok: true, selfSplit: true });
    expect(A.move(ws, { view: "a" }, zone, env)).toMatchObject({ ok: true, selfSplit: true });
    expect(findNode(ws.root, original.id)).toMatchObject({ tabs: [{ kind: "cut" }, "x"] });
    expect(root(ws, env)).toBe("H[T{H[1 a]} b]");
  });
  it("the only visible tab refuses its own middle and bar without changing hidden siblings", () => {
    const env = makeEnv({ visible: view => view !== "x" });
    const ws = workspace(tabSet("original", ["a", "x"], "a"), env), before = structuredClone(ws);
    for (const zone of [bar(ws.root.id, 2), { kind: "inside", target: ws.root.id } as const]) {
      expect(A.move(ws, { view: "a" }, zone, env)).toEqual({ ok: false, reason: "nothing-to-move" });
      expect(ws).toEqual(before);
    }
  });
  it.each(["left", "right", "top", "bottom"] as const)("keeps other tabs outside the shown tab's %s split and focuses the placeholder", side => {
    const { env, ws } = setup("single");
    const original = ws.root as TabSetNode;
    original.tabs.push("extra");
    original.active = "extra";
    const saved = structuredClone(original);
    const zone = { kind: "split", target: original.id, side } as const;
    expect(A.move(ws, { node: original.id }, zone, env, true).ok).toBe(true);
    expect(ws.root).toEqual(saved);
    const result = A.move(ws, { node: original.id }, zone, env);
    expect(result.ok).toBe(true);
    const host = ws.root as TabSetNode;
    expect(host.tabs[0]).toBe("1");
    const c = asCut(host.tabs[1] as LayoutNode), first = side === "left" || side === "top";
    expect(host.active).toBe(c.id);
    expect(c.orientation).toBe(side === "left" || side === "right" ? "cols" : "rows");
    expect(c.ratio).toBe(0.5);
    expect((first ? c.first : c.second) as TabSetNode).toMatchObject({ tabs: ["extra"], active: "extra" });
    const fresh = (first ? c.second : c.first) as TabSetNode;
    expect(fresh.tabs).toEqual(["2"]);
    expect(ws.focus).toBe(fresh.id);
    expect(result).toMatchObject({ node: fresh.id, view: "2" });
  });
  it("changes only a nested pane's area, not neighboring cuts or tabs", () => {
    const { env, ws } = setup("cols");
    const id = paneOf(ws, env, "1"), before = structuredClone(ws.root) as CutNode;
    expect(A.move(ws, { node: id }, { kind: "split", target: id, side: "right" }, env).ok).toBe(true);
    expect(root(ws, env)).toBe("H[V[H[5 1] 3] V[2 4]]");
    expect(asCut(ws.root).second).toEqual(before.second);
    expect(asCut(asCut(ws.root).first).second).toEqual(asCut(before.first).second);
    expect(asCut(ws.root).ratio).toBe(before.ratio);
  });
  it("a lone tab self-splits and a non-shown tab from a multi-tab pane still separates", () => {
    const { env, ws } = setup("single");
    expect(A.move(ws, { view: "1" }, { kind: "split", target: ws.root.id, side: "right" }, env).ok).toBe(true);
    expect(root(ws, env)).toBe("H[2 1]");
    const other = setup("single");
    (other.ws.root as TabSetNode).tabs.push("extra");
    (other.ws.root as TabSetNode).active = "extra";
    expect(A.move(other.ws, { view: "1" }, { kind: "split", target: other.ws.root.id, side: "right" }, other.env).ok).toBe(true);
    expect(root(other.ws, other.env)).toBe("H[extra 1]");
  });
  it("a frame's own band preserves its whole layout and all tabs", () => {
    const { env, ws } = setup("cols");
    ws.selection = A.visiblePanes(ws.root, env).map(p => p.id);
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    const frame = structuredClone(ws.root);
    expect(A.move(ws, { node: frame.id }, { kind: "split", target: frame.id, side: "right" }, env).ok).toBe(true);
    expect(asCut(ws.root).second).toEqual(frame);
    expect(focusView(ws, env)).toBe("6");
  });
  it("single-node selections self-split, but multi-node selections cannot drop on a member", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1");
    expect(A.move(ws, { selection: ws.selection }, { kind: "split", target: ws.selection[0]!, side: "left" }, env).ok).toBe(true);
    expect(root(ws, env)).toBe("H[V[H[1 5] 3] V[2 4]]");
    expect(ws.selection).toEqual([]);
  });
  it.each(["left", "right", "top", "bottom"] as const)("refuses %s when equal halves cannot fit minima plus the divider", side => {
    const { env, ws } = setup("single", { stage: { x: 0, y: 0, w: 120, h: 120 }, divider: 6 });
    const before = structuredClone(ws);
    expect(A.move(ws, { node: ws.root.id }, { kind: "split", target: ws.root.id, side }, env)).toMatchObject({ ok: false, reason: "no-room" });
    expect(ws).toEqual(before);
  });
});

describe("tab bars", () => {
  it("a bar with a single tab takes no room", () => {
    const { env, ws } = setup("cols");
    expect(A.layout(ws.root, STAGE, env).get("1")).toEqual({ x: 0, y: 0, w: 500, h: 500 });
    ws.focus = paneOf(ws, env, "1");
    A.tabNext(ws, env);
    expect(A.layout(ws.root, STAGE, env).get("5")).toEqual({ x: 0, y: 24, w: 500, h: 476 });
  });

  it("R cycles the bar around: top, left, bottom, right", () => {
    const { env, ws } = setup("single");
    expect(A.cycleBarSide(ws, env)).toEqual({ ok: false, reason: "no-bar" });
    A.tabNext(ws, env);
    const content = () => A.layout(ws.root, STAGE, env).get("2");
    const host = ws.root as TabSetNode;
    expect(content()).toEqual({ x: 0, y: 24, w: 1000, h: 976 });
    A.cycleBarSide(ws, env);
    expect(host.side).toBe("left");
    expect(content()).toEqual({ x: 34, y: 0, w: 966, h: 1000 });
    A.cycleBarSide(ws, env);
    expect(content()).toEqual({ x: 0, y: 0, w: 1000, h: 976 });
    A.cycleBarSide(ws, env);
    expect(content()).toEqual({ x: 0, y: 0, w: 966, h: 1000 });
    A.cycleBarSide(ws, env);
    expect(host.side).toBeUndefined();
  });

  it("R on a lone pane grows up to the visible bar around it", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2", "3", "4");
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    ws.focus = paneOf(ws, env, "3");
    expect(A.cycleBarSide(ws, env)).toEqual({ ok: true, node: ws.root.id });
    expect((ws.root as TabSetNode).side).toBe("left");
    expect(tabsAt(ws, paneOf(ws, env, "3")).side).toBeUndefined();
  });

  it("R on a selection: its bar, else the bar around it, else none", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    expect(A.cycleBarSide(ws, env)).toEqual({ ok: false, reason: "no-bar" });
    A.tabNext(ws, env);
    const sup = asCut(ws.root).first.id;
    activate(ws, env, sup, 0);
    select(ws, env, "1", "2");
    expect(A.cycleBarSide(ws, env).ok).toBe(true);
    expect(tabsAt(ws, sup).side).toBe("left");
    expect(A.minExtent(at(ws, sup), "x", env)).toBe(2 * 60 + 34);
  });

  it("2x2, select all, T, R: one bar, and R turns that bar", () => {
    const { env, ws } = setup("cols");
    ws.focus = paneOf(ws, env, "1");
    ws.selection = A.rectangleSelection(ws, paneOf(ws, env, "1"), paneOf(ws, env, "4"), env);
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("T{H[V[1 3] V[2 4]] | *5}");
    expect(ws.focus).toBe(ws.root.id);
    expect(A.visiblePanes(ws.root, env).map(p => p.id)).toEqual([ws.root.id]);
    expect(A.cycleBarSide(ws, env)).toEqual({ ok: true, node: ws.root.id });
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("T{H[V[1 3] V[2 4]] | 5 | *6}");
  });

  it("splitting a view that shares its bar with a layout splits inside that tab", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2", "3", "4");
    A.tabNext(ws, env);
    A.splitNew(ws, "right", env);
    expect(root(ws, env)).toBe("T{H[V[1 3] V[2 4]] | *H[5 6]}");
    expect(focusView(ws, env)).toBe("6");
    activate(ws, env, ws.root.id, 0);
    expect(A.visiblePanes(ws.root, env)).toHaveLength(4);
  });

  it("a layout tab that shrinks to one pane brings its view into the outer bar", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    activate(ws, env, asCut(ws.root).first.id, 0);
    A.closeTab(ws, paneOf(ws, env, "1"), "1", env);
    expect(root(ws, env)).toBe("V[(*2 5) H[3 4]]");
  });

  it("a pane dropped on a tab bar brings its tabs, never nests its bar", () => {
    const { env, ws } = setup("rows");
    ws.focus = paneOf(ws, env, "3");
    A.tabNext(ws, env);
    A.move(ws, { node: paneOf(ws, env, "5") }, bar(paneOf(ws, env, "1"), 1), env);
    expect(root(ws, env)).toBe("V[H[(1 3 *5) 2] 4]");
  });

  it("a left or right bar can be widened; never below its default", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    A.cycleBarSide(ws, env);
    const host = ws.root as TabSetNode;
    host.barWidth = 150;
    expect(A.layout(ws.root, STAGE, env).get("2")).toEqual({ x: 150, y: 0, w: 850, h: 1000 });
    A.cycleBarSide(ws, env);
    expect(A.barSize(host, env)).toBe(24);
    A.cycleBarSide(ws, env);
    expect(A.layout(ws.root, STAGE, env).get("2")).toEqual({ x: 0, y: 0, w: 850, h: 1000 });
    host.barWidth = 5;
    expect(A.barSize(host, env)).toBe(34);
  });
});

describe("tabs inside (I) and middle drops", () => {
  it("left bar of two tabs, tab 1 gets an inner bar, each bar turns on its own", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    A.cycleBarSide(ws, env);
    const outer = ws.root as TabSetNode;
    activate(ws, env, outer.id, 0);
    expect(A.tabInside(ws, env)).toMatchObject({ ok: true, view: "3" });
    expect(root(ws, env)).toBe("T{*(1 *3) | 2}");
    const inner = outer.tabs[0] as TabSetNode;
    expect(ws.focus).toBe(inner.id);
    expect(A.cycleBarSide(ws, env)).toEqual({ ok: true, node: inner.id });
    expect(inner.side).toBe("left");
    expect(outer.side).toBe("left");
    const m = A.layout(ws.root, STAGE, env);
    expect(m.get(inner.id)!.x).toBe(34);
    expect(m.get("3")!.x).toBe(68);
  });

  it("T next to, I inside; the last-clicked bar takes T and R", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    A.tabInside(ws, env);
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("T{*(1 3 *4) | 2}");
    ws.barFocus = ws.root.id;
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("T{(1 3 *4) | 2 | *5}");
    expect(A.cycleBarSide(ws, env).ok).toBe(true);
    expect((ws.root as TabSetNode).side).toBe("left");
  });

  it("I without a bar around is the same as T; I on a group nests a bar inside its tab", () => {
    const one = setup("single");
    A.tabInside(one.ws, one.env);
    expect(root(one.ws, one.env)).toBe("(1 *2)");
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2", "3", "4");
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    select(ws, env, "1", "2", "3", "4");
    A.tabInside(ws, env);
    expect(root(ws, env)).toBe("T{*T{H[V[1 3] V[2 4]] | *6} | 5}");
  });

  it("an inner bar is never merged; back to one tab, it disappears", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    A.tabInside(ws, env);
    const inner = keyOf((ws.root as TabSetNode).tabs[0]!);
    activate(ws, env, ws.root.id, 1);
    activate(ws, env, ws.root.id, 0);
    expect(root(ws, env)).toBe("T{*(1 *3) | 2}");
    A.closeTab(ws, inner, "3", env);
    expect(root(ws, env)).toBe("(*1 2)");
  });

  it("a middle drop on a pane with several tabs: inner bar inside the shown tab", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    A.tabNext(ws, env);
    expect(root(ws, env)).toBe("(1 2 *3)");
    activate(ws, env, ws.root.id, 1);
    expect(A.move(ws, { view: "3" }, { kind: "inside", target: ws.root.id }, env)).toMatchObject({ ok: true, view: "3" });
    expect(root(ws, env)).toBe("T{1 | *(2 *3)}");
  });

  it("a middle drop on a one-tab pane just gives it a bar; on its own shown tab it is refused", () => {
    const { env, ws } = setup("cols");
    A.move(ws, { node: paneOf(ws, env, "4") }, { kind: "inside", target: paneOf(ws, env, "1") }, env);
    expect(root(ws, env)).toBe("H[V[(1 *4) 3] 2]");
    const t = setup("single");
    A.tabNext(t.ws, t.env);
    expect(A.move(t.ws, { view: "2" }, { kind: "inside", target: t.ws.root.id }, t.env)).toEqual({ ok: false, reason: "into-itself" });
    expect(root(t.ws, t.env)).toBe("(1 *2)");
  });

  it("middle drop vs bar drop: inside the zone, or next to in the bar", () => {
    const mk = () => {
      const s = setup("rows");
      s.ws.focus = paneOf(s.ws, s.env, "1");
      A.tabNext(s.ws, s.env);
      return s;
    };
    const a = mk();
    A.move(a.ws, { node: paneOf(a.ws, a.env, "3") }, bar(paneOf(a.ws, a.env, "5")), a.env);
    expect(root(a.ws, a.env)).toBe("V[H[(1 5 *3) 2] 4]");
    const b = mk();
    A.move(b.ws, { node: paneOf(b.ws, b.env, "3") }, { kind: "inside", target: paneOf(b.ws, b.env, "5") }, b.env);
    expect(root(b.ws, b.env)).toBe("V[H[T{1 | *(5 *3)} 2] 4]");
  });

  it("a middle drop on a group wraps it with the item in a new bar", () => {
    const { env, ws } = setup("cols");
    A.move(ws, { node: paneOf(ws, env, "4") }, { kind: "inside", target: asCut(ws.root).first.id }, env);
    expect(root(ws, env)).toBe("H[T{V[1 3] | *4} 2]");
  });
});

describe("zoom", () => {
  it("zoom shows the selection over the whole area; restore gives back the saved layout", () => {
    const { env, ws } = setup("cols");
    const before = root(ws, env);
    select(ws, env, "1", "2");
    expect(A.zoom(ws, env).ok).toBe(true);
    expect(line(A.viewRoot(ws), env)).toBe("H[1 2]");
    expect(A.visiblePanes(A.viewRoot(ws), env).map(p => A.shownEntry(p, env))).toEqual(["1", "2"]);
    expect(A.layout(A.viewRoot(ws), STAGE, env).get("1")).toEqual({ x: 0, y: 0, w: 500, h: 1000 });
    expect(A.restore(ws, env)).toEqual({ ok: true });
    expect(root(ws, env)).toBe("V[H[1 2] H[3 4]]");
    expect(root(ws, env)).not.toBe(before);
    const four = A.tilesOf(ws.root).find(t => A.shownEntry(t.node as TabSetNode, env) === "4")!;
    expect(four.rect).toEqual({ x0: 0.5, x1: 1, y0: 0.5, y1: 1 });
  });

  it("zoom without selection takes the given pane, else the focused one; refusals", () => {
    const { env, ws } = setup("cols");
    expect(A.zoom(ws, env, paneOf(ws, env, "4")).ok).toBe(true);
    expect(line(A.viewRoot(ws), env)).toBe("4");
    expect(A.zoom(ws, env)).toEqual({ ok: false, reason: "zoomed" });
    A.restore(ws, env);
    expect(A.restore(ws, env)).toEqual({ ok: false, reason: "not-zoomed" });
    select(ws, env, "1", "4");
    expect(A.zoom(ws, env)).toMatchObject({ ok: false, reason: "not-groupable" });
    const one = setup("single");
    expect(A.zoom(one.ws, one.env)).toEqual({ ok: false, reason: "fills-area" });
  });

  it("while zoomed on a pane of a layout tab whose bar then shows another tab, selections and plans work in the zoomed area", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    const sup = asCut(ws.root).first.id;
    activate(ws, env, sup, 0);
    ws.focus = paneOf(ws, env, "1");
    A.zoom(ws, env, paneOf(ws, env, "2"));
    const two = ws.zoom!;
    // The zoom keeps showing pane 2, even if the bar around it now shows tab 5.
    tabsAt(ws, sup).active = "5";
    ws.focus = two;
    expect(() => A.rectangleSelection(ws, two, two, env)).not.toThrow();
    expect(() => A.planGroup(ws, [two], env)).not.toThrow();
  });

  it("closing the zoomed pane ends the zoom", () => {
    const { env, ws } = setup("cols");
    A.zoom(ws, env, paneOf(ws, env, "2"));
    A.closeTab(ws, paneOf(ws, env, "2"), "2", env);
    expect(ws.zoom).toBeNull();
    expect(root(ws, env)).toBe("H[V[1 3] 4]");
  });
});

describe("equal sizes, focus moves, close, tab switching, nudge", () => {
  it("equalize: A | 1 | 2 becomes three equal thirds, from any of its dividers", () => {
    const env = makeEnv();
    const [a, p1, p2] = [pane(env), pane(env), pane(env)];
    const inner = cut("c-in", "cols", 0.8, p1, p2);
    const ws = workspace(cut("c-out", "cols", 0.2, a, inner), env);
    expect(A.equalizeRun(ws, "c-in")).toBe(3);
    expect(A.tilesOf(ws.root).map(t => [t.rect.x0, t.rect.x1].map(v => Math.round(v * 1000) / 1000)))
      .toEqual([[0, 0.333], [0.333, 0.667], [0.667, 1]]);
  });

  it("equalize stops at the other orientation", () => {
    const { ws } = setup("cols");
    const top = asCut(ws.root), left = asCut(top.first), right = asCut(top.second);
    top.ratio = 0.3; left.ratio = 0.9; right.ratio = 0.1;
    expect(A.equalizeRun(ws, left.id)).toBe(2);
    expect([left.ratio, right.ratio, top.ratio]).toEqual([0.5, 0.1, 0.3]);
    expect(A.equalizeRun(ws, top.id)).toBe(2);
    expect(top.ratio).toBe(0.5);
  });

  it("focus moves to the neighbouring pane; nothing at the edge; Ctrl extends the selection", () => {
    const { env, ws } = setup("cols");
    ws.focus = paneOf(ws, env, "1");
    expect(A.focusMove(ws, "right", env).ok).toBe(true);
    expect(focusView(ws, env)).toBe("2");
    A.focusMove(ws, "bottom", env);
    expect(focusView(ws, env)).toBe("4");
    A.focusMove(ws, "left", env);
    expect(focusView(ws, env)).toBe("3");
    expect(A.focusMove(ws, "left", env)).toEqual({ ok: false, reason: "edge" });
    A.focusMove(ws, "top", env, true);
    A.focusMove(ws, "right", env, true);
    expect(viewsOfPanes(ws, env, ws.selection).sort()).toEqual(["1", "2", "3"]);
  });

  it("among several neighbours the one sharing most wins; only panes on screen count", () => {
    const { env, ws } = setup("single");
    A.splitNew(ws, "right", env);
    ws.focus = paneOf(ws, env, "2");
    A.splitNew(ws, "bottom", env);
    asCut(asCut(ws.root).second).ratio = 0.3;
    ws.focus = paneOf(ws, env, "1");
    A.focusMove(ws, "right", env);
    expect(focusView(ws, env)).toBe("3");
    A.zoom(ws, env, paneOf(ws, env, "1"));
    expect(A.focusMove(ws, "right", env).ok).toBe(false);
  });

  it("close the focused pane, a grouped selection, a non-groupable selection, a tab", () => {
    const s = setup("cols");
    s.ws.focus = paneOf(s.ws, s.env, "3");
    expect(A.close(s.ws, s.env)).toEqual({ ok: true });
    expect(root(s.ws, s.env)).toBe("H[1 V[2 4]]");
    const t = setup("cols");
    select(t.ws, t.env, "1", "2");
    A.close(t.ws, t.env);
    expect(root(t.ws, t.env)).toBe("H[3 4]");
    const u = setup("cols");
    select(u.ws, u.env, "1", "4");
    A.close(u.ws, u.env);
    expect(root(u.ws, u.env)).toBe("H[3 2]");
    const v = setup("single");
    A.tabNext(v.ws, v.env);
    A.close(v.ws, v.env, { view: "2" });
    expect(root(v.ws, v.env)).toBe("1");
  });

  it("closing is refused as a whole when a visible view in it may not be closed", () => {
    const { env, ws } = setup("cols", { closable: v => v !== "2" });
    select(ws, env, "1", "2");
    expect(A.close(ws, env)).toEqual({ ok: false, reason: "not-closable", nodes: ["2"] });
    expect(root(ws, env)).toBe("H[V[1 3] V[2 4]]");
  });

  it("closing everything inside a tab removes the tab; closing all leaves one new placeholder pane", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2", "3", "4");
    A.tabNext(ws, env);
    activate(ws, env, ws.root.id, 0);
    select(ws, env, "1", "2", "3", "4");
    A.close(ws, env);
    expect(root(ws, env)).toBe("5");
    A.close(ws, env);
    expect(A.visiblePanes(ws.root, env)).toHaveLength(1);
    expect(root(ws, env)).toBe("6");
  });

  it("switch tab: previous / next with wrap; nothing without a bar", () => {
    const { env, ws } = setup("single");
    A.tabNext(ws, env);
    A.tabNext(ws, env);
    A.switchTab(ws, 1, env);
    expect(root(ws, env)).toBe("(*1 2 3)");
    A.switchTab(ws, -1, env);
    expect(root(ws, env)).toBe("(1 2 *3)");
    const one = setup("cols");
    expect(A.switchTab(one.ws, 1, one.env)).toEqual({ ok: false, reason: "no-bar" });
  });

  it("nearest cut: the first one above the focused pane, only on screen; nudge stays within minima", () => {
    const { env, ws } = setup("cols");
    ws.focus = paneOf(ws, env, "3");
    expect(line(at(ws, A.nearestCut(ws)!), env)).toBe("V[1 3]");
    expect(A.nudge(ws, 24, env).ok).toBe(true);
    expect(asCut(asCut(ws.root).first).ratio).toBeCloseTo(0.524, 6);
    expect(A.nudge(ws, 10_000, env).ok).toBe(true);
    expect(A.nudge(ws, 24, env)).toEqual({ ok: false, reason: "at-limit" });
    A.zoom(ws, env, paneOf(ws, env, "3"));
    expect(A.nearestCut(ws)).toBeNull();
  });

  it("reveal shows every tab on the way to a view and focuses its pane", () => {
    const { env, ws } = setup("cols");
    select(ws, env, "1", "2");
    A.tabNext(ws, env);
    expect(A.reveal(ws, "2", env)).toMatchObject({ ok: true, view: "2" });
    expect(root(ws, env)).toBe("V[T{*H[1 2] | 5} H[3 4]]");
    expect(focusView(ws, env)).toBe("2");
  });
});

describe("visibility and grammar", () => {
  it("hidden views take no part: a branch without visible views folds into the nearest surviving tab set", () => {
    const hidden = new Set(["3"]);
    const { env, ws } = setup("cols", { visible: v => !hidden.has(v) });
    A.normalize(ws, env);
    expect(line(ws.root, env)).toBe("H[1 V[2 4]]");
    hidden.clear();
    expect(notation(ws.root)).toBe("H[(*1 3) V[2 4]]");
  });

  it("random command sequences keep the grammar: no one-tab bar in a bar, no single-layout bar, focus on screen", () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const check = (n: LayoutNode, env: TestEnv): void => {
      if (n.kind === "tabs") {
        expect(n.tabs.length).toBeGreaterThan(0);
        expect(n.tabs.length === 1 && typeof n.tabs[0] !== "string").toBe(false);
        for (const t of n.tabs) if (typeof t !== "string" && t.kind === "tabs") expect(t.tabs.length).toBeGreaterThan(1);
        n.tabs.forEach(t => { if (typeof t !== "string") check(t, env); });
      } else { check(n.first, env); check(n.second, env); }
    };
    for (let run = 0; run < 200; run++) {
      const { env, ws } = setup(pick(["single", "cols", "rows", "skewed"] as const));
      for (let step = 0; step < 25; step++) {
        const panes = A.visiblePanes(A.viewRoot(ws), env).map(p => p.id);
        ws.focus = pick(panes);
        ws.selection = ws.zoom === null && rand() < 0.4 ? A.rectangleSelection(ws, ws.focus, pick(panes), env) : [];
        const op = pick(["tab", "inner", "split", "group", "move", "close", "bar", "show", "zoom"] as const);
        if (op === "tab") A.tabNext(ws, env);
        else if (op === "inner") A.tabInside(ws, env);
        else if (op === "split") A.splitNew(ws, pick(["right", "bottom", "left", "top"] as const), env);
        else if (op === "group") A.group(ws, env);
        else if (op === "bar") A.cycleBarSide(ws, env);
        else if (op === "zoom") { if (ws.zoom === null) A.zoom(ws, env); else A.restore(ws, env); }
        else if (op === "close") A.closeTab(ws, ws.focus, keyOf(A.shownEntry(tabsAt(ws, ws.focus), env)!), env);
        else if (op === "show") {
          const bars: TabSetNode[] = [];
          (function rec(n: LayoutNode): void { if (n.kind === "tabs") bars.push(n); (n.kind === "cut" ? [n.first, n.second] : n.tabs)
            .forEach(t => { if (typeof t !== "string") rec(t); }); })(ws.root);
          const b = pick(bars);
          activate(ws, env, b.id, Math.floor(rand() * b.tabs.length));
        } else {
          const focused = tabsAt(ws, ws.focus);
          const source: A.MoveSource = rand() < 0.5 ? { node: focused.id } : { view: keyOf(A.shownEntry(focused, env)!) };
          const target = pick(A.visiblePanes(ws.root, env).map(p => p.id));
          const zone: A.Zone = rand() < 0.2 ? { kind: "inside", target }
            : rand() < 0.5 ? bar(target, rand() < 0.5 ? null : 0)
              : { kind: "split", target: rand() < 0.2 ? "root" : target, side: pick(["left", "right", "top", "bottom"] as const) };
          A.move(ws, source, zone, env);
        }
        check(ws.root, env);
        expect(A.visiblePanes(A.viewRoot(ws), env).map(p => p.id)).toContain(ws.focus);
      }
    }
  });

  it("random layouts: a selection is groupable iff its bounding box holds no other pane, and grouping never moves a pane", () => {
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const key = (r: { x0: number; y0: number; x1: number; y1: number }) => [r.x0, r.y0, r.x1, r.y1].map(v => v.toFixed(9)).join(",");
    let grouped = 0, refused = 0;
    for (let i = 0; i < 3000; i++) {
      const env = makeEnv({ snap: 0 });
      const random = (depth: number): LayoutNode => depth === 0 || rand() < 0.25 ? pane(env)
        : cut(env.fresh("cut"), rand() < 0.5 ? "cols" : "rows", 0.2 + rand() * 0.6, random(depth - 1), random(depth - 1));
      const ws = workspace(random(5), env);
      const tiles = A.tilesOf(ws.root);
      if (tiles.length < 3) continue;
      let sel: A.Tile[];
      if (rand() < 0.5) {
        const one = () => tiles[Math.floor(rand() * tiles.length)]!.node.id;
        const rect = A.rectangleSelection(ws, one(), one(), env);
        sel = tiles.filter(t => rect.includes(t.node.id));
      } else sel = tiles.filter(() => rand() < 0.4);
      if (sel.length < 2) continue;
      ws.selection = sel.map(t => t.node.id);
      const plan = A.planGroup(ws, ws.selection, env);
      const R = { x0: Math.min(...sel.map(t => t.rect.x0)), y0: Math.min(...sel.map(t => t.rect.y0)),
        x1: Math.max(...sel.map(t => t.rect.x1)), y1: Math.max(...sel.map(t => t.rect.y1)) };
      const blocked = tiles.some(t => !sel.includes(t) && Math.min(t.rect.x1, R.x1) - Math.max(t.rect.x0, R.x0) > A.EPS
        && Math.min(t.rect.y1, R.y1) - Math.max(t.rect.y0, R.y0) > A.EPS);
      expect(plan.ok).toBe(!blocked);
      if (!plan.ok) { refused++; continue; }
      const before = new Map(tiles.map(t => [t.node.id, key(t.rect)]));
      const g = A.applyGroup(ws, plan);
      const after = A.tilesOf(ws.root);
      expect(after).toHaveLength(tiles.length);
      for (const t of after) expect(key(t.rect)).toBe(before.get(t.node.id));
      expect(new Set(A.tilesOf(g).map(t => t.node.id))).toEqual(new Set(ws.selection));
      grouped++;
    }
    expect(grouped).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(200);
  });
});
