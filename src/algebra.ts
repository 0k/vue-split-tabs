// The layout algebra: focus, selection, grouping, splitting, tabs next to /
// inside, moving, closing, zoom and bar sides, on a mutable working copy of
// the intent tree.  Pure (no Vue, no DOM); the controller wraps it.
import {
  childNodes, contains, cut, findNode, isNode, isVertical, keyOf, nodesOf, parentOf, sideOf, SIDES, tabSet, viewsOf,
  type CutNode, type LayoutNode, type Orientation, type Side, type TabEntry, type TabSetNode,
} from "./model.js";

/** A tab set's visible entries, bar presentation and available outer size. */
export interface SplitTabsTabSet {
  id: string;
  /** Keys of visible tabs: view ids, or node ids of layout / inner-bar tabs. */
  tabs: readonly string[];
  /** Key of the shown tab (empty for an empty pane). */
  active: string;
  side: Side;
  /** Width of a left / right bar, in pixels. */
  barWidth: number;
  /** Multiple tabs, or a bar requested by the presentation policy. */
  showsBar: boolean;
  width: number;
  height: number;
}
/** Presentation policy, never persisted. */
export type SplitTabsBarVisibility = boolean | ((tabSet: SplitTabsTabSet) => boolean);

export const EPS = 1e-6;
export interface Rect { x: number; y: number; w: number; h: number }
interface Unit { x0: number; y0: number; x1: number; y1: number }
const UNIT: Unit = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

export interface Env {
  /** Whether a view is on screen at all (present and opened, or a placeholder). */
  visible(view: string): boolean;
  /** Whether a view may be closed (optional host tab or placeholder). */
  closable(view: string): boolean;
  /** A fresh node id. Peek never consumes it; exclude a prospective view id reserved before this node. */
  fresh(prefix: "cut" | "tabs", peek?: boolean, exclude?: string): string;
  /** A fresh placeholder view id: new views are filled in by the host. Peek never consumes it. */
  placeholder(peek?: boolean): string;
  stage: Rect;
  min: { w: number; h: number };
  /** Grouping aligns edges closer than this many pixels. */
  snap: number;
  /** Thickness of a top / bottom bar, default width of a left / right bar. */
  bar: { thickness: number; width: number };
  /** Presentation shared by commands and rendering, never saved. */
  alwaysShow?: SplitTabsBarVisibility;
  barWidths?: Readonly<Record<string, number>>;
  /** The pure algebra may use a zero-width divider; controllers supply their actual thickness. */
  divider?: number;
  /** The most recently shown of `keys` in tab set `id`: replaces a departing shown tab. */
  recent?(id: string, keys: readonly string[]): string | undefined;
}
/** Who has the focus and what is selected. Ids are tab-set ids of panes. */
export interface Workspace { root: LayoutNode; focus: string; selection: string[]; zoom: string | null; barFocus: string | null }

export type Reason =
  | "selection-too-small" | "not-groupable" | "no-room" | "into-itself" | "nothing-to-move" | "no-bar" | "no-split"
  | "edge" | "zoomed" | "not-zoomed" | "fills-area" | "not-closable" | "unknown" | "at-limit";
export type Result = (
  | { ok: true; kind?: "single" | "already" | "exact" | "snap"; node?: string; view?: string }
  | { ok: false; reason: Reason; nodes?: string[] }) & {
    /** A self-drop creates a placeholder opposite the source, even in a refused size preview. */
    selfSplit?: true;
  };
const fail = (reason: Reason, nodes?: string[]): Result => nodes === undefined ? { ok: false, reason } : { ok: false, reason, nodes };

// --- visibility -----------------------------------------------------------------

export function hasVisible(entry: TabEntry, env: Env): boolean {
  if (typeof entry === "string") return env.visible(entry);
  return entry.kind === "cut" ? hasVisible(entry.first, env) || hasVisible(entry.second, env) : entry.tabs.some(t => hasVisible(t, env));
}
export function visibleTabs(node: TabSetNode, env: Env): TabEntry[] { return node.tabs.filter(t => hasVisible(t, env)); }
/** The entry a tab set shows: its active one when visible, else the nearest visible neighbour. */
export function shownEntry(node: TabSetNode, env: Env): TabEntry | undefined {
  const at = node.tabs.findIndex(t => keyOf(t) === node.active);
  const ok = (t: TabEntry | undefined) => t !== undefined && hasVisible(t, env);
  if (at >= 0 && ok(node.tabs[at])) return node.tabs[at];
  for (let i = Math.max(at, 0); i < node.tabs.length; i++) if (ok(node.tabs[i])) return node.tabs[i];
  for (let i = at - 1; i >= 0; i--) if (ok(node.tabs[i])) return node.tabs[i];
  return undefined;
}
/** A tab set showing a view (or nothing): a pane. Otherwise it frames a layout. */
export function isPane(node: LayoutNode, env: Env): node is TabSetNode {
  return node.kind === "tabs" && typeof (shownEntry(node, env) ?? "") === "string";
}
export function showsLayout(node: LayoutNode, env: Env): node is TabSetNode {
  return node.kind === "tabs" && isNode(shownEntry(node, env) ?? "");
}
export function tabSetInfo(n: TabSetNode, tabs: readonly string[], active: string, w: number, h: number, env: Env): SplitTabsTabSet {
  const set: SplitTabsTabSet = { id: n.id, tabs, active, side: sideOf(n),
    barWidth: Math.max(env.bar.width, env.barWidths?.[n.id] ?? n.barWidth ?? 0), showsBar: tabs.length > 1, width: w, height: h };
  set.showsBar ||= typeof env.alwaysShow === "function" ? env.alwaysShow(set) : env.alwaysShow === true;
  return set;
}
function barInfo(node: TabSetNode, env: Env): SplitTabsTabSet {
  const shown = shownEntry(node, env);
  return tabSetInfo(node, visibleTabs(node, env).map(keyOf), shown === undefined ? "" : keyOf(shown), 0, 0, env);
}
export function showsBar(node: TabSetNode, env: Env): boolean { return barInfo(node, env).showsBar; }
export function barExtent(set: SplitTabsTabSet, axis: Orientation, thickness: number): number {
  return set.showsBar && ((axis === "cols") === isVertical(set.side)) ? (isVertical(set.side) ? set.barWidth : thickness) : 0;
}
export function hasLayoutTab(node: TabSetNode, env: Env): boolean { return visibleTabs(node, env).some(isNode); }
export function barSize(node: TabSetNode, env: Env): number {
  const set = barInfo(node, env);
  return set.showsBar ? (isVertical(set.side) ? set.barWidth : env.bar.thickness) : 0;
}
function shownView(node: TabSetNode, env: Env): string | undefined {
  const entry = shownEntry(node, env);
  return typeof entry === "string" ? entry : undefined;
}

export function visiblePanes(root: LayoutNode, env: Env): TabSetNode[] {
  const out: TabSetNode[] = [];
  (function rec(node: LayoutNode): void {
    if (isPane(node, env)) out.push(node);
    else if (node.kind === "cut") { rec(node.first); rec(node.second); }
    else rec(shownEntry(node, env) as LayoutNode);
  })(root);
  return out;
}
export function viewRoot(ws: Workspace): LayoutNode { return ws.zoom === null ? ws.root : findNode(ws.root, ws.zoom) ?? ws.root; }

// --- tree surgery -----------------------------------------------------------------

function node(ws: Workspace, id: string): LayoutNode {
  const found = findNode(ws.root, id);
  if (found === null) throw new Error(`split-tabs: node ${id} is not in the layout`);
  return found;
}
function put(ws: Workspace, oldKey: string, replacement: TabEntry): void {
  const at = parentOf(ws.root, oldKey);
  if (at === null) {
    if (!isNode(replacement)) throw new Error("split-tabs: the root must be a node");
    ws.root = replacement;
  } else if (at.parent.kind === "cut") {
    if (!isNode(replacement)) throw new Error("split-tabs: a cut side must be a node");
    at.parent[at.slot as "first" | "second"] = replacement;
  } else {
    at.parent.tabs[at.slot as number] = replacement;
    if (at.parent.active === oldKey) at.parent.active = keyOf(replacement);
  }
}
function newPane(env: Env, view: string = env.placeholder()): TabSetNode { return tabSet(env.fresh("tabs"), [view], view); }
function newCut(env: Env, orientation: Orientation, ratio: number, first: LayoutNode, second: LayoutNode) {
  return cut(env.fresh("cut"), orientation, ratio, first, second);
}

/**
 * Enforce the grammar and fold what is not on screen, recording old -> new ids:
 * - a branch or tab with no visible view goes; its views move (hidden) into the
 *   nearest surviving tab set, so they come back there;
 * - a tab set nested as a tab and left with one tab is replaced by that tab;
 * - a tab set whose only tab is a layout or a tab set dissolves into it;
 * - an empty tab set goes.  Bars of two tabs or more never merge.
 */
export function normalize(ws: Workspace, env: Env): void {
  const redirect = new Map<string, string>();
  const firstTabs = (n: LayoutNode): TabSetNode => n.kind === "tabs" ? n : firstTabs(n.first);
  for (let changed = true; changed;) {
    changed = false;
    const visit = (n: LayoutNode): void => {
      if (changed) return;
      if (n.kind === "cut") {
        for (const [side, other] of [["first", "second"], ["second", "first"]] as const) {
          if (!hasVisible(n[side], env) && hasVisible(n[other], env)) {
            const keep = n[other];
            firstTabs(keep).tabs.push(...viewsOf(n[side]));
            put(ws, n.id, keep);
            redirect.set(n.id, keep.id);
            for (const sub of nodesOf(n[side])) redirect.set(sub.id, keep.id);
            changed = true;
            return;
          }
        }
      } else {
        const gone = n.tabs.findIndex(t => isNode(t) && !hasVisible(t, env));
        if (gone >= 0 && hasVisible(n, env)) {
          const dead = n.tabs[gone] as LayoutNode;
          n.tabs.splice(gone, 1, ...viewsOf(dead));
          redirect.set(dead.id, n.id);
          changed = true;
          return;
        }
        const lone = n.tabs.findIndex(t => isNode(t) && t.kind === "tabs" && t.tabs.length === 1);
        if (lone >= 0) {
          const inner = n.tabs[lone] as TabSetNode;
          const wasActive = n.active === inner.id;
          n.tabs[lone] = inner.tabs[0]!;
          if (wasActive) n.active = keyOf(inner.tabs[0]!);
          redirect.set(inner.id, n.id);
          changed = true;
          return;
        }
        const empty = n.tabs.findIndex(t => isNode(t) && t.kind === "tabs" && t.tabs.length === 0);
        if (empty >= 0) {
          redirect.set(keyOf(n.tabs[empty]!), n.id);
          n.tabs.splice(empty, 1);
          changed = true;
          return;
        }
        if (n.tabs.length === 1 && isNode(n.tabs[0]!)) {
          const only = n.tabs[0] as LayoutNode;
          put(ws, n.id, only);
          redirect.set(n.id, only.id);
          changed = true;
          return;
        }
        if (n.tabs.length > 0 && !n.tabs.some(t => keyOf(t) === n.active)) n.active = keyOf(n.tabs[0]!);
      }
      childNodes(n).forEach(visit);
    };
    visit(ws.root);
  }
  const follow = (id: string): string => { while (redirect.has(id)) id = redirect.get(id)!; return id; };
  const alive = (id: string | null) => id !== null && findNode(ws.root, id) !== null;
  ws.focus = follow(ws.focus);
  ws.selection = ws.selection.map(follow);
  if (ws.zoom !== null) { ws.zoom = follow(ws.zoom); if (!alive(ws.zoom)) ws.zoom = null; }
  if (ws.barFocus !== null) {
    ws.barFocus = follow(ws.barFocus);
    if (!alive(ws.barFocus) || node(ws, ws.barFocus).kind !== "tabs") ws.barFocus = null;
  }
  const panes = visiblePanes(viewRoot(ws), env).map(p => p.id);
  if (!panes.includes(ws.focus)) {
    const at = findNode(ws.root, ws.focus);
    ws.focus = (at === null ? undefined : visiblePanes(at, env)[0]?.id) ?? panes[0]!;
    if (!panes.includes(ws.focus)) ws.focus = panes[0]!;
  }
  ws.selection = [...new Set(ws.selection)].filter(id => panes.includes(id));
}

// --- geometry ------------------------------------------------------------------------

function cutUnit(r: Unit, orientation: Orientation, ratio: number): [Unit, Unit] {
  if (orientation === "cols") { const c = r.x0 + (r.x1 - r.x0) * ratio; return [{ ...r, x1: c }, { ...r, x0: c }]; }
  const c = r.y0 + (r.y1 - r.y0) * ratio;
  return [{ ...r, y1: c }, { ...r, y0: c }];
}
const unitEq = (a: Unit, b: Unit) => Math.abs(a.x0 - b.x0) < EPS && Math.abs(a.x1 - b.x1) < EPS
  && Math.abs(a.y0 - b.y0) < EPS && Math.abs(a.y1 - b.y1) < EPS;
function bbox(rects: Unit[]): Unit {
  return { x0: Math.min(...rects.map(r => r.x0)), y0: Math.min(...rects.map(r => r.y0)),
    x1: Math.max(...rects.map(r => r.x1)), y1: Math.max(...rects.map(r => r.y1)) };
}
function overlaps(a: Unit, b: Unit, tolX = EPS, tolY = EPS): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > tolX && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > tolY;
}
export interface Tile { node: LayoutNode; rect: Unit }
/** The non-cut nodes reached through a scope's cuts, with their rectangle in the scope's unit square. */
export function tilesOf(scope: LayoutNode): Tile[] {
  const out: Tile[] = [];
  (function rec(n: LayoutNode, r: Unit): void {
    if (n.kind === "cut") { const [a, b] = cutUnit(r, n.orientation, n.ratio); rec(n.first, a); rec(n.second, b); }
    else out.push({ node: n, rect: r });
  })(scope, UNIT);
  return out;
}
interface UnitCut { axis: "x" | "y"; c: number; region: Unit }
function cutsOf(scope: LayoutNode): UnitCut[] {
  const out: UnitCut[] = [];
  (function rec(n: LayoutNode, r: Unit): void {
    if (n.kind !== "cut") return;
    const [a, b] = cutUnit(r, n.orientation, n.ratio);
    out.push({ axis: n.orientation === "cols" ? "x" : "y", c: n.orientation === "cols" ? a.x1 : a.y1, region: r });
    rec(n.first, a);
    rec(n.second, b);
  })(scope, UNIT);
  return out;
}

/** Pixel rectangles of every node and shown view on screen (no size collapse here). */
export function layout(root: LayoutNode, rect: Rect, env: Env): Map<string, Rect> {
  const m = new Map<string, Rect>();
  (function rec(entry: TabEntry, r: Rect): void {
    m.set(keyOf(entry), r);
    if (typeof entry === "string") return;
    if (entry.kind === "cut") {
      if (entry.orientation === "cols") {
        const w = (r.w - (env.divider ?? 0)) * entry.ratio;
        rec(entry.first, { ...r, w });
        rec(entry.second, { ...r, x: r.x + w + (env.divider ?? 0), w: r.w - w - (env.divider ?? 0) });
      } else {
        const h = (r.h - (env.divider ?? 0)) * entry.ratio;
        rec(entry.first, { ...r, h });
        rec(entry.second, { ...r, y: r.y + h + (env.divider ?? 0), h: r.h - h - (env.divider ?? 0) });
      }
      return;
    }
    const s = barSize(entry, env);
    const content = {
      top: { x: r.x, y: r.y + s, w: r.w, h: r.h - s }, bottom: { x: r.x, y: r.y, w: r.w, h: r.h - s },
      left: { x: r.x + s, y: r.y, w: r.w - s, h: r.h }, right: { x: r.x, y: r.y, w: r.w - s, h: r.h },
    }[sideOf(entry)];
    const shown = shownEntry(entry, env);
    if (shown !== undefined) rec(shown, content);
  })(root, rect);
  return m;
}
/** Smallest pixel extent a node can be given along an axis. */
export function minExtent(n: LayoutNode, axis: "x" | "y", env: Env): number {
  const min = axis === "x" ? env.min.w : env.min.h;
  if (n.kind === "cut") {
    const a = minExtent(n.first, axis, env), b = minExtent(n.second, axis, env);
    return (n.orientation === "cols") === (axis === "x") ? a + (env.divider ?? 0) + b : Math.max(a, b);
  }
  const shown = shownEntry(n, env);
  const inner = shown !== undefined && isNode(shown) ? minExtent(shown, axis, env) : min;
  return inner + barExtent(barInfo(n, env), axis === "x" ? "cols" : "rows", env.bar.thickness);
}

// --- scopes and grouping --------------------------------------------------------------

/** Chain of scopes from the root down to the scope where `target` is a tile. */
export function scopePath(root: LayoutNode, target: string, env: Env): LayoutNode[] {
  const rec = (n: LayoutNode, path: LayoutNode[]): LayoutNode[] | null => {
    if (n.id === target) return path;
    if (n.kind === "cut") return rec(n.first, path) ?? rec(n.second, path);
    if (showsLayout(n, env)) { const c = shownEntry(n, env) as LayoutNode; return rec(c, [...path, c]); }
    return null;
  };
  const path = rec(root, [root]);
  if (path === null) throw new Error(`split-tabs: pane ${target} is not on screen`);
  return path;
}
function commonScope(paths: LayoutNode[][]): LayoutNode {
  let i = 0;
  while (paths.every(p => i < p.length && p[i] === paths[0]![i])) i++;
  return paths[0]![i - 1]!;
}

class NoCut extends Error {}
function uniqSorted(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || v - s[i - 1]! > EPS);
}
const K = { x: ["x0", "x1"], y: ["y0", "y1"] } as const;
function chooseCut(tiles: Tile[], region: Unit, R: Unit | null, cuts: UnitCut[]): { axis: "x" | "y"; c: number } | null {
  const cands: { axis: "x" | "y"; c: number }[] = [];
  for (const axis of ["x", "y"] as const) {
    const [k0, k1] = K[axis];
    const coords = uniqSorted(tiles.flatMap(t => [t.rect[k0], t.rect[k1]])).filter(c => c > region[k0] + EPS && c < region[k1] - EPS);
    for (const c of coords) {
      if (tiles.some(t => t.rect[k0] < c - EPS && t.rect[k1] > c + EPS)) continue;
      if (R !== null && R[k0] < c - EPS && R[k1] > c + EPS) continue;
      cands.push({ axis, c });
    }
  }
  if (cands.length === 0) return null;
  // Keep the existing tree wherever the selection does not force a change.
  const original = cands.find(k => cuts.some(o => o.axis === k.axis && Math.abs(o.c - k.c) < EPS && unitEq(o.region, region)));
  if (original !== undefined) return original;
  if (R !== null) {
    const onR = cands.find(k => { const [k0, k1] = K[k.axis]; return Math.abs(R[k0] - k.c) < EPS || Math.abs(R[k1] - k.c) < EPS; });
    if (onR !== undefined) return onR;
  }
  return cands[0]!;
}
// Rebuild a cut tree over `tiles` (exactly covering `region`) so that R, if
// given, becomes one node; that node is stored in out.group.
function build(tiles: Tile[], region: Unit, R: Unit | null, cuts: UnitCut[], out: { group?: LayoutNode }, env: Env): LayoutNode {
  if (R !== null && unitEq(region, R)) {
    const g = tiles.length === 1 ? tiles[0]!.node : build(tiles, region, null, cuts, out, env);
    out.group = g;
    return g;
  }
  if (tiles.length === 1) {
    if (!unitEq(tiles[0]!.rect, region)) throw new Error("split-tabs: internal: tile does not fill its region");
    return tiles[0]!.node;
  }
  const cutAt = chooseCut(tiles, region, R, cuts);
  if (cutAt === null) throw new NoCut();
  const [k0, k1] = K[cutAt.axis];
  const ta = tiles.filter(t => t.rect[k1] <= cutAt.c + EPS);
  const tb = tiles.filter(t => t.rect[k0] >= cutAt.c - EPS);
  if (ta.length + tb.length !== tiles.length) throw new Error("split-tabs: internal: cut crosses a tile");
  const a = build(ta, { ...region, [k1]: cutAt.c }, R !== null && R[k1] <= cutAt.c + EPS ? R : null, cuts, out, env);
  const b = build(tb, { ...region, [k0]: cutAt.c }, R !== null && R[k0] >= cutAt.c - EPS ? R : null, cuts, out, env);
  return newCut(env, cutAt.axis === "x" ? "cols" : "rows", (cutAt.c - region[k0]) / (region[k1] - region[k0]), a, b);
}
type Try = { ok: true; R: Unit; newRoot: LayoutNode; group: LayoutNode } | { ok: false; R: Unit; intruders: LayoutNode[] };
function tryGroup(tiles: Tile[], sel: boolean[], cuts: UnitCut[], env: Env): Try {
  const R = bbox(tiles.filter((_, i) => sel[i]).map(t => t.rect));
  const intruders = tiles.filter((t, i) => !sel[i] && overlaps(t.rect, R)).map(t => t.node);
  if (intruders.length > 0) return { ok: false, R, intruders };
  const out: { group?: LayoutNode } = {};
  try {
    const newRoot = build(tiles, UNIT, R, cuts, out, env);
    if (out.group === undefined) throw new Error("split-tabs: internal: group node not produced");
    return { ok: true, R, newRoot, group: out.group };
  } catch (error) {
    if (error instanceof NoCut) return { ok: false, R, intruders: [] };
    throw error;
  }
}
function clusterMap(values: number[], eps: number): (v: number) => number {
  const inner = uniqSorted(values).filter(v => v > EPS && v < 1 - EPS);
  const pairs: [number, number][] = [];
  let cluster: number[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const mean = cluster.reduce((s, v) => s + v, 0) / cluster.length;
    for (const v of cluster) pairs.push([v, mean]);
    cluster = [];
  };
  for (const v of inner) { if (cluster.length > 0 && v - cluster[0]! > eps) flush(); cluster.push(v); }
  flush();
  return v => pairs.find(([o]) => Math.abs(o - v) < EPS)?.[1] ?? v;
}
function snapTiles(tiles: Tile[], eps: { x: number; y: number }, min: { x: number; y: number }) {
  const mx = clusterMap(tiles.flatMap(t => [t.rect.x0, t.rect.x1]), eps.x);
  const my = clusterMap(tiles.flatMap(t => [t.rect.y0, t.rect.y1]), eps.y);
  const mapRect = (r: Unit): Unit => ({ x0: mx(r.x0), x1: mx(r.x1), y0: my(r.y0), y1: my(r.y1) });
  const snapped = tiles.map(t => ({ node: t.node, rect: mapRect(t.rect) }));
  if (snapped.some(t => t.rect.x1 - t.rect.x0 < min.x - EPS || t.rect.y1 - t.rect.y0 < min.y - EPS)) return null;
  return {
    tiles: snapped,
    mapCut: (o: UnitCut): UnitCut => ({ axis: o.axis, c: (o.axis === "x" ? mx : my)(o.c), region: mapRect(o.region) }),
    changed: snapped.some((t, i) => !unitEq(t.rect, tiles[i]!.rect)),
  };
}
function existingGroup(scope: LayoutNode, selected: LayoutNode[]): LayoutNode | null {
  let found: LayoutNode | null = null;
  (function rec(n: LayoutNode): LayoutNode[] {
    if (n.kind !== "cut") return [n];
    const ts = [...rec(n.first), ...rec(n.second)];
    if (found === null && ts.length === selected.length && ts.every(t => selected.includes(t))) found = n;
    return ts;
  })(scope);
  return found;
}

export interface PlanBase { scope: LayoutNode; tiles: Tile[]; selected: LayoutNode[]; R: Unit }
export type GroupPlan = PlanBase & (
  | { ok: true; kind: "single" | "already"; target: LayoutNode }
  | { ok: true; kind: "exact"; target: LayoutNode; newRoot: LayoutNode }
  | { ok: true; kind: "snap"; target: LayoutNode; newRoot: LayoutNode; moved: Tile[] }
  | { ok: false; kind: "error"; intruders: LayoutNode[] });

// Scopes are measured, and searched, in what is on screen: the zoomed node while zoomed.
function scopeSizes(ws: Workspace, env: Env): Map<string, Rect> { return layout(viewRoot(ws), env.stage, env); }

/** What grouping `panes` would do.  Never changes the tree. */
export function planGroup(ws: Workspace, panes: readonly string[], env: Env): GroupPlan {
  if (panes.length === 0) throw new Error("split-tabs: planGroup on an empty selection");
  const scope = commonScope(panes.map(p => scopePath(viewRoot(ws), p, env)));
  const tiles = tilesOf(scope);
  const sel = tiles.map(t => panes.some(p => contains(t.node, p)));
  const selTiles = tiles.filter((_, i) => sel[i]);
  if (selTiles.length === 0) throw new Error("split-tabs: internal: selection outside its scope");
  const base = { scope, tiles, selected: selTiles.map(t => t.node) };
  if (selTiles.length === 1) return { ...base, ok: true, kind: "single", target: selTiles[0]!.node, R: selTiles[0]!.rect };
  const existing = existingGroup(scope, base.selected);
  if (existing !== null) return { ...base, ok: true, kind: "already", target: existing, R: bbox(selTiles.map(t => t.rect)) };
  const cuts = cutsOf(scope);
  const exact = tryGroup(tiles, sel, cuts, env);
  if (exact.ok) return { ...base, ok: true, kind: "exact", target: exact.group, newRoot: exact.newRoot, R: exact.R };
  const size = scopeSizes(ws, env).get(scope.id)!;
  const snapped = snapTiles(tiles, { x: env.snap / size.w, y: env.snap / size.h }, { x: env.min.w / size.w, y: env.min.h / size.h });
  if (snapped?.changed) {
    const res = tryGroup(snapped.tiles, sel, cuts.map(snapped.mapCut), env);
    if (res.ok) {
      const moved = snapped.tiles.filter((t, i) => !unitEq(t.rect, tiles[i]!.rect));
      return { ...base, ok: true, kind: "snap", target: res.group, newRoot: res.newRoot, R: res.R, moved };
    }
  }
  return { ...base, ok: false, kind: "error", R: exact.R, intruders: exact.intruders };
}
export function applyGroup(ws: Workspace, plan: GroupPlan): LayoutNode {
  if (!plan.ok) throw new Error("split-tabs: applyGroup on a refused plan");
  if (plan.kind === "exact" || plan.kind === "snap") put(ws, plan.scope.id, plan.newRoot);
  return plan.target;
}
/** The panes standing for each refused-plan intruder (what is in the way). */
export function refusal(plan: GroupPlan, env: Env): Result {
  if (plan.ok) throw new Error("split-tabs: refusal of an accepted plan");
  return fail("not-groupable", plan.intruders.flatMap(n => visiblePanes(n, env).map(p => p.id)));
}

/**
 * The smallest set of panes, in the common scope of `anchor` and `other`, whose
 * union is a rectangle containing both.  Tiles overlapping by less than the
 * snap tolerance are left out (grouping will align them).
 */
export function rectangleSelection(ws: Workspace, anchor: string, other: string, env: Env): string[] {
  const scope = commonScope([anchor, other].map(p => scopePath(viewRoot(ws), p, env)));
  const tiles = tilesOf(scope);
  const size = scopeSizes(ws, env).get(scope.id)!;
  const tol = { x: env.snap / size.w, y: env.snap / size.h };
  const sel = tiles.map(t => contains(t.node, anchor) || contains(t.node, other));
  for (let grew = true; grew;) {
    grew = false;
    const R = bbox(tiles.filter((_, i) => sel[i]).map(t => t.rect));
    tiles.forEach((t, i) => { if (!sel[i] && overlaps(t.rect, R, tol.x, tol.y)) { sel[i] = true; grew = true; } });
  }
  return tiles.filter((_, i) => sel[i]).flatMap(t => visiblePanes(t.node, env).map(p => p.id));
}

// --- commands ---------------------------------------------------------------------------

type Target = { ok: true; kind: "focus" | GroupPlan["kind"]; target: LayoutNode; plan?: GroupPlan } | { ok: false; plan: GroupPlan };
// The node a command acts on: the selection (grouped when applied), else the focused pane.
function plannedTarget(ws: Workspace, env: Env): Target {
  if (ws.selection.length === 0) return { ok: true, kind: "focus", target: node(ws, ws.focus) };
  const plan = planGroup(ws, ws.selection, env);
  return plan.ok ? { ok: true, kind: plan.kind, target: plan.target, plan } : { ok: false, plan };
}
function applyTarget(ws: Workspace, t: Target & { ok: true }): LayoutNode { return t.plan === undefined ? t.target : applyGroup(ws, t.plan); }
function targetSize(ws: Workspace, t: Target & { ok: true }, env: Env): Rect {
  const m = scopeSizes(ws, env);
  const plan = t.plan;
  if (plan === undefined || (plan.kind !== "exact" && plan.kind !== "snap")) return m.get(t.target.id)!;
  const s = m.get(plan.scope.id)!;
  return { x: 0, y: 0, w: (plan.R.x1 - plan.R.x0) * s.w, h: (plan.R.y1 - plan.R.y0) * s.h };
}

// A pane whose bar also holds layouts is a page of that bar: a split happens
// inside the shown tab, so the other tabs keep their own layouts.
function splitHere(ws: Workspace, target: LayoutNode, orientation: Orientation, first: boolean, item: LayoutNode, env: Env): void {
  if (target.kind === "tabs" && hasLayoutTab(target, env) && isPane(target, env)) {
    const view = shownView(target, env)!;
    const at = target.tabs.indexOf(view);
    const page = newPane(env, view);
    const c = first ? newCut(env, orientation, 0.5, item, page) : newCut(env, orientation, 0.5, page, item);
    target.tabs[at] = c;
    target.active = c.id;
    return;
  }
  const c = first ? newCut(env, orientation, 0.5, item, target) : newCut(env, orientation, 0.5, target, item);
  put(ws, target.id, c);
}

export function group(ws: Workspace, env: Env): Result {
  if (ws.selection.length < 2) return fail("selection-too-small");
  const plan = planGroup(ws, ws.selection, env);
  if (!plan.ok) return refusal(plan, env);
  const g = applyGroup(ws, plan);
  normalize(ws, env);
  return { ok: true, kind: plan.kind, node: g.id };
}

const SPLIT: Record<Side, [Orientation, boolean]> = { left: ["cols", true], right: ["cols", false], top: ["rows", true], bottom: ["rows", false] };

/** A new placeholder pane on `side` of the target (the selection grouped, else the focused pane). */
export function splitNew(ws: Workspace, side: Side, env: Env): Result {
  const t = plannedTarget(ws, env);
  if (!t.ok) return refusal(t.plan, env);
  const [orientation, first] = SPLIT[side];
  const size = targetSize(ws, t, env);
  if (orientation === "cols" ? size.w < 2 * env.min.w : size.h < 2 * env.min.h) return fail("no-room");
  const target = applyTarget(ws, t);
  const p = newPane(env);
  splitHere(ws, target, orientation, first, p, env);
  ws.focus = p.id;
  ws.selection = [];
  normalize(ws, env);
  return { ok: true, node: p.id, view: p.tabs[0] as string };
}

/** A new placeholder tab NEXT to the target, in the bar holding it (the clicked bar first), else in a new bar. */
export function tabNext(ws: Workspace, env: Env): Result {
  const t = plannedTarget(ws, env);
  if (!t.ok) return refusal(t.plan, env);
  const target = applyTarget(ws, t);
  ws.selection = [];
  let host: TabSetNode | null = null;
  if (t.kind === "focus" && ws.barFocus !== null) host = node(ws, ws.barFocus) as TabSetNode;
  else if (target.kind === "tabs") host = target;
  else {
    const at = parentOf(ws.root, target.id);
    if (at !== null && at.parent.kind === "tabs") host = at.parent;
  }
  const view = env.placeholder();
  if (host !== null) {
    host.tabs.push(view);
    host.active = view;
  } else {
    host = tabSet(env.fresh("tabs"), [target, view], view);
    put(ws, target.id, host);
  }
  ws.focus = host.id;
  normalize(ws, env);
  return { ok: true, node: ws.focus, view };
}

/**
 * New tabs INSIDE the target: a new bar in its place, with the target as tab 1
 * and a new placeholder as tab 2.  When the focused pane shows one of several
 * tabs, the shown view is the target, so the new bar lives inside that tab.
 */
export function tabInside(ws: Workspace, env: Env): Result {
  let target = node(ws, ws.focus);
  if (ws.selection.length > 0) {
    const plan = planGroup(ws, ws.selection, env);
    if (!plan.ok) return refusal(plan, env);
    target = applyGroup(ws, plan);
  }
  ws.selection = [];
  const view = env.placeholder();
  let bar: TabSetNode;
  if (isPane(target, env) && visibleTabs(target, env).length > 1) {
    const shown = shownView(target, env)!;
    bar = tabSet(env.fresh("tabs"), [shown, view], view);
    target.tabs[target.tabs.indexOf(shown)] = bar;
    target.active = bar.id;
  } else {
    bar = tabSet(env.fresh("tabs"), [target, view], view);
    put(ws, target.id, bar);
  }
  ws.focus = bar.id;
  ws.barFocus = null;
  normalize(ws, env);
  return { ok: true, node: ws.focus, view };
}

/** Show the tab `key` of tab set `id`, and focus what it shows. */
export function activate(ws: Workspace, id: string, key: string, env: Env): Result {
  const host = findNode(ws.root, id);
  if (host === null || host.kind !== "tabs") return fail("unknown");
  const entry = host.tabs.find(t => keyOf(t) === key);
  if (entry === undefined || !hasVisible(entry, env)) return fail("unknown");
  host.active = key;
  ws.focus = isPane(host, env) ? host.id : visiblePanes(host, env)[0]!.id;
  normalize(ws, env);
  return { ok: true, node: host.id };
}

/** Reveal a view wherever it is: show every tab on its way and focus its pane. */
export function reveal(ws: Workspace, view: string, env: Env): Result {
  if (!contains(ws.root, view) || !env.visible(view)) return fail("unknown");
  let key = view;
  for (let at = parentOf(ws.root, key); at !== null; key = at.parent.id, at = parentOf(ws.root, key)) {
    if (at.parent.kind === "tabs") at.parent.active = key;
  }
  const pane = parentOf(ws.root, view)!.parent;
  ws.focus = pane.id;
  if (ws.zoom !== null && !contains(node(ws, ws.zoom), view)) ws.zoom = null;
  normalize(ws, env);
  return { ok: true, node: ws.focus, view };
}

// Take `key` out of the tree and close up the hole: a cut keeps only the
// other side, an emptied tab set goes too.  Returns false when nothing is left.
function detach(ws: Workspace, key: string, redirect: Map<string, string>, env: Env): boolean {
  const at = parentOf(ws.root, key);
  if (at === null) return false;
  if (at.parent.kind === "cut") {
    const other = at.slot === "first" ? at.parent.second : at.parent.first;
    put(ws, at.parent.id, other);
    redirect.set(at.parent.id, other.id);
    return true;
  }
  const host = at.parent;
  const slot = at.slot as number;
  const wasActive = host.active === key;
  host.tabs.splice(slot, 1);
  if (host.tabs.length === 0) return detach(ws, host.id, redirect, env);
  if (wasActive) {
    const keys = host.tabs.filter(t => hasVisible(t, env)).map(keyOf);
    host.active = env.recent?.(host.id, keys) ?? keyOf(host.tabs[Math.min(slot, host.tabs.length - 1)]!);
  }
  return true;
}
function followAll(ws: Workspace, redirect: Map<string, string>): void {
  const follow = (id: string): string => { while (redirect.has(id)) id = redirect.get(id)!; return id; };
  ws.focus = follow(ws.focus);
  ws.selection = ws.selection.map(follow);
  if (ws.zoom !== null) ws.zoom = follow(ws.zoom);
  if (ws.barFocus !== null) ws.barFocus = follow(ws.barFocus);
}
function emptyRoot(ws: Workspace, env: Env): void {
  ws.root = newPane(env);
  ws.focus = ws.root.id;
}

/** Views closed by closing these keys; the visible ones must all be closable. */
function closeCheck(ws: Workspace, keys: readonly string[], env: Env): Result {
  const views = keys.flatMap(k => viewsOf(findNode(ws.root, k) ?? k)).filter(v => env.visible(v));
  const locked = views.filter(v => !env.closable(v));
  return locked.length > 0 ? fail("not-closable", locked) : { ok: true };
}

/** Close one tab of a tab set (a view, a layout or an inner bar). */
export function closeTab(ws: Workspace, id: string, key: string, env: Env): Result {
  const host = findNode(ws.root, id);
  if (host === null || host.kind !== "tabs" || !host.tabs.some(t => keyOf(t) === key)) return fail("unknown");
  const check = closeCheck(ws, [key], env);
  if (!check.ok) return check;
  const redirect = new Map<string, string>();
  if (!detach(ws, key, redirect, env)) emptyRoot(ws, env);
  followAll(ws, redirect);
  normalize(ws, env);
  return { ok: true };
}

export type MoveSource = { view: string } | { node: string } | { selection: readonly string[] };
/**
 * Close the selection (grouped when it can be, else pane by pane), else the
 * focused pane, or an explicit source.  Closing cascades: a cut left with one
 * side collapses, an emptied tab set disappears.  Atomic: refused as a whole
 * when a visible view in it is not closable.
 */
export function close(ws: Workspace, env: Env, source: MoveSource | null = null): Result {
  const selection = source === null ? (ws.selection.length > 0 ? ws.selection : null) : "selection" in source ? source.selection : null;
  let targets: string[];
  if (source !== null && "view" in source) targets = [source.view];
  else if (source !== null && "node" in source) targets = [source.node];
  else if (selection !== null) {
    const plan = planGroup(ws, selection, env);
    // Check against nodes already in the tree: a planned group does not exist yet.
    const check = closeCheck(ws, plan.ok ? plan.selected.map(n => n.id) : selection, env);
    if (!check.ok) return check;
    targets = plan.ok ? [applyGroup(ws, plan).id] : [...selection];
  } else targets = [ws.focus];
  const check = closeCheck(ws, targets, env);
  if (!check.ok) return check;
  const redirect = new Map<string, string>();
  for (const key of targets) {
    if (!contains(ws.root, key)) continue;
    if (!detach(ws, key, redirect, env)) { emptyRoot(ws, env); break; }
  }
  followAll(ws, redirect);
  ws.selection = [];
  if (ws.zoom !== null && findNode(ws.root, ws.zoom) === null) ws.zoom = null;
  normalize(ws, env);
  return { ok: true };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

// A dropped tab set brings its tabs, never its bar, and keeps showing what it showed.
function itemsOf(x: TabEntry, env: Env): [TabEntry[], string] {
  if (isNode(x) && x.kind === "tabs") return [x.tabs, keyOf(shownEntry(x, env) ?? x.tabs[0]!)];
  return [[x], keyOf(x)];
}
// Insert x as tab(s) of `host` at `index` (end when null).  A whole pane brings
// its tabs, never its bar: what was shown in it stays shown.
function insertTab(ws: Workspace, x: TabEntry, host: LayoutNode, index: number | null, env: Env): TabSetNode {
  if (host.kind === "cut") {
    const at = parentOf(ws.root, host.id);
    if (at !== null && at.parent.kind === "tabs") return insertTab(ws, x, at.parent, null, env);
    const bar = tabSet(env.fresh("tabs"), [host], host.id);
    put(ws, host.id, bar);
    return insertTab(ws, x, bar, null, env);
  }
  const [items, shown] = itemsOf(x, env);
  const at = index === null ? host.tabs.length : index;
  host.tabs.splice(at, 0, ...items);
  host.active = shown;
  return host;
}
// A drop in the MIDDLE of a target: the item becomes a tab INSIDE that zone.
// In a pane showing one of several tabs, the shown view and the item become an
// inner bar inside that tab; elsewhere the target and the item become a bar in
// the target's place.  A whole pane brings its tabs.
function insertInner(ws: Workspace, x: TabEntry, target: LayoutNode, env: Env): TabSetNode {
  const [items, shown] = itemsOf(x, env);
  if (isPane(target, env) && visibleTabs(target, env).length > 1) {
    const view = shownView(target, env)!;
    const bar = tabSet(env.fresh("tabs"), [view, ...items], shown);
    target.tabs[target.tabs.indexOf(view)] = bar;
    target.active = bar.id;
    return bar;
  }
  const bar = tabSet(env.fresh("tabs"), [target, ...items], shown);
  put(ws, target.id, bar);
  return bar;
}

export type Zone =
  | { kind: "bar"; target: string; index: number | null }
  | { kind: "inside"; target: string }
  | { kind: "split"; target: string | "root"; side: Side };

/** Move a view, a node, or the selection (grouped first).  Works on a copy and commits only on success. */
export function move(ws: Workspace, source: MoveSource, zone: Zone, env: Env, dryRun = false): Result {
  const work: Workspace = { ...ws, root: clone(ws.root), selection: [...ws.selection] };
  let x: TabEntry;
  let single = true;
  if ("selection" in source) {
    if (source.selection.length === 0) return fail("nothing-to-move");
    const plan = planGroup(work, source.selection, env);
    if (!plan.ok) return refusal(plan, env);
    single = plan.kind === "single";
    x = applyGroup(work, plan);
  } else if ("view" in source) {
    if (!contains(work.root, source.view) || findNode(work.root, source.view) !== null) return fail("unknown");
    x = source.view;
  } else {
    const found = findNode(work.root, source.node);
    if (found === null) return fail("unknown");
    x = found;
  }
  const targetKey = zone.target;
  if (targetKey !== "root" && findNode(work.root, targetKey) === null) return fail("unknown");
  const from = parentOf(work.root, keyOf(x));
  const destKey = targetKey === "root" ? work.root.id : targetKey;
  const loneTab = typeof x === "string" && from?.parent.id === destKey && from.parent.kind === "tabs" && visibleTabs(from.parent, env).length === 1;
  const ownShownTab = typeof x === "string" && from?.parent.id === destKey && from.parent.kind === "tabs"
    && shownView(from.parent, env) === x;
  const self = keyOf(x) === destKey ? (isNode(x) ? x : null) : ownShownTab ? from!.parent : null;
  if (zone.kind === "split" && self !== null && single) {
    const shown = isPane(self, env) && self.tabs.length > 1 ? shownView(self, env) : undefined;
    const size = layout(work.root, env.stage, env).get(shown ?? self.id);
    if (size === undefined) return fail("unknown");
    const [orientation, first] = SPLIT[zone.side], axis = orientation === "cols" ? "x" : "y";
    // A host policy sees the actual next pane, without consuming either id during hover or refusal.
    let showNewBar: boolean;
    if (typeof env.alwaysShow === "function") {
      const view = env.placeholder(true);
      showNewBar = showsBar(tabSet(env.fresh("tabs", true, view), [view]), env);
    } else showNewBar = env.alwaysShow ?? false;
    const placeholderMin = (axis === "x" ? env.min.w : env.min.h) + (axis === "y" && showNewBar ? env.bar.thickness : 0);
    const minimum = shown === undefined ? Math.max(minExtent(self, axis, env), placeholderMin) : placeholderMin;
    if ((axis === "x" ? size.w : size.h) < 2 * minimum + (env.divider ?? 0)) return { ...fail("no-room"), selfSplit: true };
    if (dryRun) return { ok: true, selfSplit: true };
    const p = newPane(env);
    // A pane splits its shown tab, not its bar; frames keep their whole layout.
    const content = shown === undefined ? self : newPane(env, shown);
    const c = first ? newCut(env, orientation, 0.5, content, p) : newCut(env, orientation, 0.5, p, content);
    put(work, shown ?? self.id, c);
    if (shown !== undefined && self.kind === "tabs") self.active = c.id;
    work.focus = p.id;
    work.selection = [];
    work.zoom = null;
    normalize(work, env);
    Object.assign(ws, work);
    return { ok: true, selfSplit: true, node: p.id, view: p.tabs[0] as string };
  }
  if (targetKey === "root" ? keyOf(x) === work.root.id : contains(x, targetKey)) return fail("into-itself");
  if (loneTab) return fail("nothing-to-move");
  if (zone.kind === "inside" && typeof x === "string" && from?.parent.id === zone.target
    && shownView(from.parent as TabSetNode, env) === x) return fail("into-itself");
  let index = zone.kind === "bar" ? zone.index : null;
  if (index !== null && from !== null && from.parent.id === targetKey && (from.slot as number) < index) index--;
  const redirect = new Map<string, string>();
  if (!detach(work, keyOf(x), redirect, env)) return fail("nothing-to-move");
  let target = targetKey;
  while (redirect.has(target)) target = redirect.get(target)!;
  const dest = target === "root" ? work.root : findNode(work.root, target);
  if (dest === null) throw new Error("split-tabs: move: drop target left the layout");
  if (zone.kind === "split") {
    const r = layout(work.root, env.stage, env).get(dest.id);
    // Taking the source out changed what a bar shows and hid the target: nothing to drop beside.
    if (r === undefined) return fail("unknown");
    const cols = zone.side === "left" || zone.side === "right";
    if (cols ? r.w < 2 * env.min.w : r.h < 2 * env.min.h) return fail("no-room");
  }
  if (dryRun) return { ok: true };
  let placed: LayoutNode;
  if (zone.kind === "bar") placed = insertTab(work, x, dest, index, env);
  else if (zone.kind === "inside") placed = insertInner(work, x, dest, env);
  else {
    const [orientation, first] = SPLIT[zone.side];
    placed = isNode(x) ? x : newPane(env, x);
    splitHere(work, dest, orientation, first, placed, env);
  }
  ws.root = work.root;
  const panes = visiblePanes(ws.root, env).map(p => p.id);
  const landed = visiblePanes(findNode(ws.root, placed.id) ?? placed, env).find(p => panes.includes(p.id));
  const view = typeof x === "string" ? x : undefined;
  const holder = view === undefined ? undefined : parentOf(ws.root, view)?.parent;
  ws.focus = holder !== undefined && panes.includes(holder.id) ? holder.id : landed?.id ?? ws.focus;
  ws.selection = [];
  ws.zoom = null;
  normalize(ws, env);
  return view === undefined ? { ok: true, node: ws.focus } : { ok: true, node: ws.focus, view };
}

/** The pane next to the focused one that way, among those on screen: nearest first, then the one sharing most. */
export function paneInDirection(ws: Workspace, dir: Side, env: Env): string | null {
  const m = layout(viewRoot(ws), env.stage, env);
  const f = m.get(ws.focus);
  if (f === undefined) return null;
  const horizontal = dir === "left" || dir === "right";
  const gap = (r: Rect) => ({ left: f.x - (r.x + r.w), right: r.x - (f.x + f.w), top: f.y - (r.y + r.h), bottom: r.y - (f.y + f.h) })[dir];
  const shared = (r: Rect) => horizontal
    ? Math.min(f.y + f.h, r.y + r.h) - Math.max(f.y, r.y)
    : Math.min(f.x + f.w, r.x + r.w) - Math.max(f.x, r.x);
  let best: { id: string; g: number; o: number } | null = null;
  for (const p of visiblePanes(viewRoot(ws), env)) {
    if (p.id === ws.focus) continue;
    const r = m.get(p.id)!;
    const g = gap(r), o = shared(r);
    if (g < -EPS || o <= EPS) continue;
    if (best === null || g < best.g - EPS || (Math.abs(g - best.g) <= EPS && o > best.o)) best = { id: p.id, g, o };
  }
  return best?.id ?? null;
}
/** Move the focus that way; `extend` adds the panes passed to the selection. */
export function focusMove(ws: Workspace, dir: Side, env: Env, extend = false): Result {
  const p = paneInDirection(ws, dir, env);
  if (p === null) return fail("edge");
  if (extend) {
    if (!ws.selection.includes(ws.focus)) ws.selection = [...ws.selection, ws.focus];
    if (!ws.selection.includes(p)) ws.selection = [...ws.selection, p];
  } else ws.selection = [];
  ws.focus = p;
  ws.barFocus = null;
  return { ok: true, node: p };
}

function visibleBarAround(ws: Workspace, start: string, env: Env): TabSetNode | null {
  let key: string | null = start;
  while (key !== null) {
    const n = findNode(ws.root, key);
    if (n !== null && n.kind === "tabs" && showsBar(n, env)) return n;
    key = parentOf(ws.root, key)?.parent.id ?? null;
  }
  return null;
}
/** Previous / next tab of the clicked bar, else of the nearest visible bar around the focused pane. */
export function switchTab(ws: Workspace, delta: number, env: Env): Result {
  const host = visibleBarAround(ws, ws.barFocus ?? ws.focus, env);
  if (host === null) return fail("no-bar");
  const tabs = visibleTabs(host, env);
  const at = tabs.findIndex(t => keyOf(t) === keyOf(shownEntry(host, env)!));
  const keep = ws.barFocus;
  const result = activate(ws, host.id, keyOf(tabs[(at + delta + tabs.length) % tabs.length]!), env);
  ws.barFocus = keep;
  return result;
}
/** Move a tab bar to the next side (top, left, bottom, right): the nearest VISIBLE bar holding the target. */
export function cycleBarSide(ws: Workspace, env: Env): Result {
  let start = ws.barFocus ?? ws.focus;
  if (ws.selection.length > 0) {
    const plan = planGroup(ws, ws.selection, env);
    if (!plan.ok) return refusal(plan, env);
    start = plan.kind === "single" || plan.kind === "already" ? plan.target.id : plan.scope.id;
  }
  const host = visibleBarAround(ws, start, env);
  if (host === null) return fail("no-bar");
  const next = SIDES[(SIDES.indexOf(sideOf(host)) + 1) % SIDES.length]!;
  if (next === "top") delete host.side; else host.side = next;
  return { ok: true, node: host.id };
}
/** The cut nearest above the focused pane, among those on screen. */
export function nearestCut(ws: Workspace): string | null {
  for (let key = ws.focus; ;) {
    const at = parentOf(ws.root, key);
    if (at === null) return null;
    if (at.parent.kind === "cut") return contains(viewRoot(ws), at.parent.id) ? at.parent.id : null;
    key = at.parent.id;
  }
}
/** Move the nearest cut's divider by `px`, within both sides' minimum extents. */
export function nudge(ws: Workspace, px: number, env: Env): Result {
  const id = nearestCut(ws);
  if (id === null) return fail("no-split");
  const c = node(ws, id) as CutNode;
  const r = layout(viewRoot(ws), env.stage, env).get(id);
  if (r === undefined) return fail("no-split");
  const axis = c.orientation === "cols" ? "x" : "y";
  const size = (axis === "x" ? r.w : r.h) - (env.divider ?? 0);
  const lo = minExtent(c.first, axis, env), hi = size - minExtent(c.second, axis, env);
  // Both sides already need more than the room: the divider cannot move.
  if (size <= 0 || lo > hi) return fail("at-limit");
  const current = Math.min(hi, Math.max(lo, c.ratio * size));
  const p = Math.min(hi, Math.max(lo, current + px));
  if (Math.abs(p - current) < 0.5) return fail("at-limit");
  c.ratio = p / size;
  return { ok: true, node: id };
}

/** Zoom: show one node over the whole area until restored.  Only grouping changes the tree, keeping the picture. */
export function zoom(ws: Workspace, env: Env, fallback: string | null = null): Result {
  if (ws.zoom !== null) return fail("zoomed");
  let target: LayoutNode;
  if (ws.selection.length > 0) {
    const plan = planGroup(ws, ws.selection, env);
    if (!plan.ok) return refusal(plan, env);
    target = applyGroup(ws, plan);
  } else target = node(ws, fallback ?? ws.focus);
  if (target.id === ws.root.id) return fail("fills-area");
  ws.zoom = target.id;
  ws.selection = [];
  normalize(ws, env);
  return { ok: true, node: target.id };
}
export function restore(ws: Workspace, env: Env): Result {
  if (ws.zoom === null) return fail("not-zoomed");
  ws.zoom = null;
  normalize(ws, env);
  return { ok: true };
}

/** Equal sizes along the maximal run of same-orientation cuts holding `id`. Returns the item count. */
export function equalizeRun(ws: Workspace, id: string): number {
  const start = node(ws, id);
  if (start.kind !== "cut") throw new Error("split-tabs: equalize: not a cut");
  let top = start;
  for (let at = parentOf(ws.root, top.id); at !== null && at.parent.kind === "cut" && at.parent.orientation === start.orientation;
    at = parentOf(ws.root, top.id)) top = at.parent;
  const items = (n: LayoutNode): number => n.kind === "cut" && n.orientation === start.orientation ? items(n.first) + items(n.second) : 1;
  (function fix(n: LayoutNode): void {
    if (n.kind !== "cut" || n.orientation !== start.orientation) return;
    const a = items(n.first);
    n.ratio = a / (a + items(n.second));
    fix(n.first);
    fix(n.second);
  })(top);
  return items(top);
}
