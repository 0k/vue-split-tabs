import type { LayoutNode, PaneId, PaneNode } from "./controller.js";

export interface SubtreeMetrics {
  tabs: string[];
  first: PaneNode;
  min: { rows: number; cols: number };
}
export interface TreeIndex {
  nodes: Map<string, LayoutNode>;
  leaves: PaneNode[];
  membership: Map<PaneId, string[]>;
  owner: Map<string, PaneId>;
  metrics: Map<string, SubtreeMetrics>;
}

/** Size-independent facts shared by every geometry pass until intent or visibility changes. */
export function indexTree(tree: LayoutNode, ordered: readonly string[], minWidth: number, minHeight: number, divider: number): TreeIndex {
  const nodes = new Map<string, LayoutNode>();
  const leaves: PaneNode[] = [];
  function visit(node: LayoutNode): void {
    nodes.set(node.id, node);
    if (node.kind === "pane") leaves.push(node);
    else { visit(node.first); visit(node.second); }
  }
  visit(tree);
  const assigned = new Map<string, PaneId>();
  for (const pane of leaves.slice(1)) for (const id of pane.tabs) assigned.set(id, pane.id);
  const membership = new Map(leaves.map(pane => [pane.id, [] as string[]]));
  const owner = new Map<string, PaneId>();
  const rank = new Map<string, number>();
  ordered.forEach((id, position) => {
    const pane = assigned.get(id) ?? leaves[0]!.id;
    membership.get(pane)!.push(id);
    owner.set(id, pane);
    rank.set(id, position);
  });
  const metrics = new Map<string, SubtreeMetrics>();
  function merge(a: readonly string[], b: readonly string[]): string[] {
    const result: string[] = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (j === b.length || (i < a.length && rank.get(a[i]!)! < rank.get(b[j]!)!)) result.push(a[i++]!);
      else result.push(b[j++]!);
    }
    return result;
  }
  function measure(node: LayoutNode): SubtreeMetrics {
    let value: SubtreeMetrics;
    if (node.kind === "pane") {
      const tabs = membership.get(node.id)!;
      value = { tabs, first: node, min: { rows: tabs.length ? minHeight : 0, cols: tabs.length ? minWidth : 0 } };
    } else {
      const a = measure(node.first), b = measure(node.second);
      if (a.tabs.length === 0) value = b;
      else if (b.tabs.length === 0) value = a;
      else value = { tabs: merge(a.tabs, b.tabs), first: a.first, min: {
        rows: node.orientation === "rows" ? a.min.rows + divider + b.min.rows : Math.max(a.min.rows, b.min.rows),
        cols: node.orientation === "cols" ? a.min.cols + divider + b.min.cols : Math.max(a.min.cols, b.min.cols),
      } };
    }
    metrics.set(node.id, value);
    return value;
  }
  measure(tree);
  return { nodes, leaves, membership, owner, metrics };
}
