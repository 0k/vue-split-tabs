// Effective layout: what is rendered for a given container size.  Derived
// from the (folded) intent tree without changing it: size collapse, frames
// around layout tabs, bars, pane numbering.
import { barExtent, hasVisible, isPane, shownEntry, tabSetInfo, visiblePanes, visibleTabs, type Env, type SplitTabsTabSet } from "./algebra.js";
import { isVertical, keyOf, viewsOf, type LayoutNode, type Orientation, type TabSetNode } from "./model.js";
export type { SplitTabsTabSet, SplitTabsBarVisibility } from "./algebra.js";

export type PaneId = string;
/** A rendered rectangle showing one view. */
export interface SplitTabsPane extends SplitTabsTabSet {
  index: number;
  /** Shown view id ("" when empty). */
  view: string;
  fits: { rows: boolean; cols: boolean };
  /** Stands for a whole subtree that does not fit: lists all its views. */
  collapsed: boolean;
}
/** A tab set showing a layout or an inner bar: its bar frames that content. */
export type SplitTabsFrame = SplitTabsTabSet;
export interface EffectiveCut {
  kind: "cut"; id: string; orientation: Orientation; ratio: number; width: number; height: number;
  first: EffectiveNode; second: EffectiveNode;
}
export type EffectiveNode =
  | { kind: "pane"; pane: SplitTabsPane }
  | EffectiveCut
  | { kind: "frame"; frame: SplitTabsFrame; content: EffectiveNode };

export interface Projection {
  layout: EffectiveNode;
  panes: SplitTabsPane[];
  frames: SplitTabsFrame[];
  cuts: Map<string, EffectiveCut>;
  tabSets: Map<string, SplitTabsTabSet>;
  /** Pane id -> the intent node it stands for (itself, or a collapsed subtree). */
  represented: Map<PaneId, LayoutNode>;
  /** Effective minimum size of every rendered node. */
  minima: Map<string, { rows: number; cols: number }>;
}
export interface Sizes {
  width: number; height: number; divider: number;
  minWidth: number; minHeight: number;
  live: Readonly<Record<string, number>>;
  /** Side-bar widths being dragged, by tab set id (not saved yet). */
  bars: Readonly<Record<string, number>>;
}

export function fit(w: number, h: number, s: Sizes): { rows: boolean; cols: boolean } {
  return { cols: w > 0 && w >= 2 * s.minWidth + s.divider, rows: h > 0 && h >= 2 * s.minHeight + s.divider };
}
/** Clamp a ratio so each side keeps the given minimums; unmeasured cuts keep the request. */
export function clampRatio(orientation: Orientation, value: number, w: number, h: number, s: Sizes, bounds: readonly [number, number]): number {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
  const available = (orientation === "cols" ? w : h) - s.divider;
  const min = orientation === "cols" ? s.minWidth : s.minHeight;
  if (w <= 0 || h <= 0 || available < 2 * min) return normalized;
  let [a, b] = bounds;
  if (a + b > available) a = b = min;
  return Math.max(a / available, Math.min(1 - b / available, normalized));
}

/**
 * Render `root` (already folded: every cut side holds a visible view) at the
 * container size.  `focusView` decides what a collapsed subtree shows.
 */
export function project(root: LayoutNode, env: Env, s: Sizes, focusView: string): Projection {
  const panes: SplitTabsPane[] = [];
  const frames: SplitTabsFrame[] = [];
  const cuts = new Map<string, EffectiveCut>();
  const tabSets = new Map<string, SplitTabsTabSet>();
  const represented = new Map<PaneId, LayoutNode>();
  const minima = new Map<string, { rows: number; cols: number }>();
  function info(n: TabSetNode, tabs: readonly string[], active: string, w: number, h: number): SplitTabsTabSet {
    return tabSetInfo(n, tabs, active, w, h, env);
  }
  function paneMin(set: SplitTabsTabSet) {
    return { rows: s.minHeight + barExtent(set, "rows", env.bar.thickness), cols: s.minWidth + barExtent(set, "cols", env.bar.thickness) };
  }
  // A child cut may collapse to one pane; a frame still reserves its own bar.
  function floorMin(n: LayoutNode): { rows: number; cols: number } {
    if (n.kind === "cut") return paneMin(collapsedInfo(n, 0, 0));
    const shown = shownEntry(n, env), set = info(n, visibleTabs(n, env).map(keyOf), shown === undefined ? "" : keyOf(shown), 0, 0);
    if (shown === undefined || typeof shown === "string") return paneMin(set);
    const inner = floorMin(shown);
    return { rows: inner.rows + barExtent(set, "rows", env.bar.thickness), cols: inner.cols + barExtent(set, "cols", env.bar.thickness) };
  }
  function addPane(base: SplitTabsTabSet, view: string, node: LayoutNode, collapsed: boolean): EffectiveNode {
    const pane: SplitTabsPane = { ...base, index: panes.length, view,
      fits: fit(base.width - barExtent(base, "cols", env.bar.thickness), base.height - barExtent(base, "rows", env.bar.thickness), s), collapsed };
    panes.push(pane);
    tabSets.set(pane.id, pane);
    represented.set(pane.id, node);
    minima.set(pane.id, paneMin(base));
    return { kind: "pane", pane };
  }
  function collapsedInfo(n: LayoutNode, w: number, h: number): SplitTabsTabSet {
    const views = viewsOf(n).filter(v => env.visible(v));
    const shown = views.includes(focusView) ? focusView : (() => {
      const first = visiblePanes(n, env)[0];
      const entry = first === undefined ? undefined : shownEntry(first, env);
      return typeof entry === "string" ? entry : views[0] ?? "";
    })();
    return info({ kind: "tabs", id: n.id, tabs: views, active: shown }, views, shown, w, h);
  }
  function collapse(n: LayoutNode, w: number, h: number): EffectiveNode {
    const base = collapsedInfo(n, w, h);
    return addPane(base, base.active, n, true);
  }
  function render(n: LayoutNode, w: number, h: number): EffectiveNode {
    if (n.kind === "cut") {
      if (!hasVisible(n.first, env)) return render(n.second, w, h);
      if (!hasVisible(n.second, env)) return render(n.first, w, h);
      const aMin = floorMin(n.first)[n.orientation], bMin = floorMin(n.second)[n.orientation];
      const length = n.orientation === "cols" ? w : h;
      if (length <= 0 || length < aMin + s.divider + bMin) return collapse(n, w, h);
      const ratio = clampRatio(n.orientation, s.live[n.id] ?? n.ratio, w, h, s, [aMin, bMin]);
      const available = (n.orientation === "cols" ? w : h) - s.divider;
      const a = available * ratio, b = available - a;
      const first = render(n.first, n.orientation === "cols" ? a : w, n.orientation === "rows" ? a : h);
      const second = render(n.second, n.orientation === "cols" ? b : w, n.orientation === "rows" ? b : h);
      const effective: EffectiveCut = { kind: "cut", id: n.id, orientation: n.orientation, ratio, width: w, height: h, first, second };
      cuts.set(n.id, effective);
      const fa = minima.get(idOf(first))!, sa = minima.get(idOf(second))!;
      minima.set(n.id, {
        rows: n.orientation === "rows" ? fa.rows + s.divider + sa.rows : Math.max(fa.rows, sa.rows),
        cols: n.orientation === "cols" ? fa.cols + s.divider + sa.cols : Math.max(fa.cols, sa.cols),
      });
      return effective;
    }
    const tabs = visibleTabs(n, env).map(keyOf);
    const shown = shownEntry(n, env);
    if (shown === undefined || isPane(n, env)) {
      const view = typeof shown === "string" ? shown : "";
      return addPane(info(n, tabs, view, w, h), view, n, false);
    }
    if (tabs.length < 2) return render(shown as LayoutNode, w, h);
    const frame = info(n, tabs, keyOf(shown), w, h);
    const vertical = isVertical(frame.side);
    const thickness = vertical ? frame.barWidth : env.bar.thickness;
    frames.push(frame);
    tabSets.set(frame.id, frame);
    const content = render(shown as LayoutNode, vertical ? Math.max(0, w - thickness) : w, vertical ? h : Math.max(0, h - thickness));
    const inner = minima.get(idOf(content))!;
    minima.set(frame.id, vertical ? { rows: inner.rows, cols: inner.cols + thickness } : { rows: inner.rows + thickness, cols: inner.cols });
    return { kind: "frame", frame, content };
  }
  const layout = render(root, s.width, s.height);
  return { layout, panes, frames, cuts, tabSets, represented, minima };
}

export function idOf(node: EffectiveNode): string {
  return node.kind === "pane" ? node.pane.id : node.kind === "frame" ? node.frame.id : node.id;
}
