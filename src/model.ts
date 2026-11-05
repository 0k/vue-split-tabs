// Saved layout intent: the tree grammar, its notation, and validation of
// stored JSON (including the 0.1 and 0.2 formats).  Pure, no Vue.

/** `rows`: the two sides are stacked top / bottom.  `cols`: side by side. */
export type Orientation = "rows" | "cols";
/** A side of an area: where a tab bar sits, or where a split puts the new part. */
export type Side = "top" | "right" | "bottom" | "left";
/** Two parts of an area, one on each side of a divider. */
export interface CutNode { kind: "cut"; id: string; orientation: Orientation; ratio: number; first: LayoutNode; second: LayoutNode }
/**
 * A tab set: one tab bar and the tab it shows.  Each tab holds a view (a host
 * tab id or a placeholder), a layout (a cut) or another tab set.  `active` is
 * the key of the shown tab; `side` defaults to `top`; `barWidth` sizes a left
 * or right bar.
 */
export interface TabSetNode { kind: "tabs"; id: string; tabs: TabEntry[]; active: string; side?: Side; barWidth?: number }
export type LayoutNode = CutNode | TabSetNode;
/** A view id, or a nested layout / tab set. */
export type TabEntry = string | LayoutNode;

export const SIDES: readonly Side[] = ["top", "left", "bottom", "right"];
export const INTENT_VERSION = 3;

export function keyOf(entry: TabEntry): string { return typeof entry === "string" ? entry : entry.id; }
export function isNode(entry: TabEntry): entry is LayoutNode { return typeof entry !== "string"; }
export function sideOf(node: TabSetNode): Side { return node.side ?? "top"; }
export function isVertical(side: Side): boolean { return side === "left" || side === "right"; }
export function tabSet(id: string, tabs: TabEntry[], active = keyOf(tabs[tabs.length - 1] ?? "")): TabSetNode {
  return { kind: "tabs", id, tabs, active };
}
export function cut(id: string, orientation: Orientation, ratio: number, first: LayoutNode, second: LayoutNode): CutNode {
  return { kind: "cut", id, orientation, ratio, first, second };
}

/** Nested nodes directly below `node` (views excluded). */
export function childNodes(node: LayoutNode): LayoutNode[] {
  return node.kind === "cut" ? [node.first, node.second] : node.tabs.filter(isNode);
}
/** Every view id below `entry`, depth first, in tab order. */
export function viewsOf(entry: TabEntry): string[] {
  if (typeof entry === "string") return [entry];
  if (entry.kind === "cut") return [...viewsOf(entry.first), ...viewsOf(entry.second)];
  return entry.tabs.flatMap(viewsOf);
}
export function nodesOf(node: LayoutNode): LayoutNode[] { return [node, ...childNodes(node).flatMap(nodesOf)]; }
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return root;
  for (const child of childNodes(root)) {
    const hit = findNode(child, id);
    if (hit !== null) return hit;
  }
  return null;
}
/** True when `key` (a node id or view id) is `entry` itself or below it. */
export function contains(entry: TabEntry, key: string): boolean {
  if (keyOf(entry) === key) return true;
  if (typeof entry === "string") return false;
  return entry.kind === "cut" ? contains(entry.first, key) || contains(entry.second, key) : entry.tabs.some(t => contains(t, key));
}
export interface Slot { parent: LayoutNode; slot: "first" | "second" | number }
/** Where `key` sits: its parent node and slot, or null for the root. Throws when absent. */
export function parentOf(root: LayoutNode, key: string): Slot | null {
  if (root.id === key) return null;
  const stack: LayoutNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === "cut") {
      if (node.first.id === key) return { parent: node, slot: "first" };
      if (node.second.id === key) return { parent: node, slot: "second" };
    } else {
      const index = node.tabs.findIndex(entry => keyOf(entry) === key);
      if (index >= 0) return { parent: node, slot: index };
    }
    stack.push(...childNodes(node));
  }
  throw new Error(`split-tabs: ${key} is not in the layout`);
}

/** i3-like one-line readout: `H[a V[b c]]`, `(a *b)` for a bar of views, `T{H[a b] | *c}` for a bar with a layout. */
export function notation(entry: TabEntry, shown: (node: TabSetNode) => string = node => node.active,
  visible: (entry: TabEntry) => boolean = () => true): string {
  if (typeof entry === "string") return entry;
  if (entry.kind === "cut") {
    return `${entry.orientation === "cols" ? "H" : "V"}[${notation(entry.first, shown, visible)} ${notation(entry.second, shown, visible)}]`;
  }
  const tabs = entry.tabs.filter(visible);
  const active = shown(entry);
  const mark = (tab: TabEntry) => (tabs.length > 1 && keyOf(tab) === active ? "*" : "") + notation(tab, shown, visible);
  if (tabs.every(tab => typeof tab === "string")) return tabs.length === 1 ? notation(tabs[0]!, shown, visible) : `(${tabs.map(mark).join(" ")})`;
  return `T{${tabs.map(mark).join(" | ")}}`;
}

// --- stored JSON -----------------------------------------------------------------

export interface SplitTabsIntent { version: typeof INTENT_VERSION; tree: LayoutNode; focus: string; opened: string[]; titles?: Record<string, string> }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(id => typeof id === "string"); }
function fraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value !== ""; }

/** Validate a 0.3 tree: unique keys (node ids and views together), known kinds, sane values. */
export function validTree(value: unknown, keys = new Set<string>()): value is LayoutNode {
  if (!record(value) || !nonEmpty(value.id) || keys.has(value.id)) return false;
  keys.add(value.id);
  if (value.kind === "cut") {
    return (value.orientation === "rows" || value.orientation === "cols") && fraction(value.ratio)
      && validTree(value.first, keys) && validTree(value.second, keys);
  }
  if (value.kind !== "tabs" || !Array.isArray(value.tabs) || typeof value.active !== "string") return false;
  if (value.side !== undefined && !SIDES.includes(value.side as Side)) return false;
  if (value.barWidth !== undefined && !(typeof value.barWidth === "number" && Number.isFinite(value.barWidth) && value.barWidth > 0)) return false;
  for (const entry of value.tabs) {
    if (typeof entry === "string") {
      if (entry === "" || keys.has(entry)) return false;
      keys.add(entry);
    } else if (!validTree(entry, keys)) return false;
  }
  return true;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/** 0.2 trees: `{ kind:'pane', id, tabs, active }` leaves; the first leaf also implicitly holds every unassigned tab. */
function legacyTree(value: unknown, ids = new Set<string>(), tabs = new Set<string>()): boolean {
  if (!record(value) || !nonEmpty(value.id) || ids.has(value.id)) return false;
  ids.add(value.id);
  if (value.kind === "pane") {
    if (!strings(value.tabs) || typeof value.active !== "string") return false;
    for (const id of value.tabs) { if (tabs.has(id)) return false; tabs.add(id); }
    return true;
  }
  return value.kind === "cut" && (value.orientation === "rows" || value.orientation === "cols") && fraction(value.ratio)
    && legacyTree(value.first, ids, tabs) && legacyTree(value.second, ids, tabs);
}
interface LegacyPane { kind: "pane"; id: string; tabs: string[]; active: string }
interface LegacyCut { kind: "cut"; id: string; orientation: Orientation; ratio: number; first: LegacyNode; second: LegacyNode }
type LegacyNode = LegacyPane | LegacyCut;
function legacyLeaves(node: LegacyNode): LegacyPane[] {
  return node.kind === "pane" ? [node] : [...legacyLeaves(node.first), ...legacyLeaves(node.second)];
}
function migrate(tree: LegacyNode, order: readonly string[], firstActive: string): LayoutNode {
  const leaves = legacyLeaves(tree);
  const assigned = new Set(leaves.slice(1).flatMap(leaf => leaf.tabs));
  const rank = (id: string) => { const at = order.indexOf(id); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
  const byOrder = (ids: readonly string[]) => [...ids].sort((a, b) => rank(a) - rank(b));
  const first = leaves[0]!;
  const keys = new Set<string>();
  function convert(node: LegacyNode): LayoutNode {
    if (node.kind === "cut") return cut(node.id, node.orientation, node.ratio, convert(node.first), convert(node.second));
    const views = node === first
      ? byOrder([...new Set([...node.tabs, ...order.filter(id => !assigned.has(id))])])
      : byOrder(node.tabs);
    const unique = views.filter(id => !keys.has(id) && id !== "");
    unique.forEach(id => keys.add(id));
    const active = node === first && firstActive !== "" ? firstActive : node.active;
    return tabSet(node.id, unique, unique.includes(active) ? active : unique[0] ?? "");
  }
  return convert(tree);
}

/** Read one stored intent of any supported version, or null when invalid. */
export function parseIntent(value: unknown): SplitTabsIntent | null {
  if (!record(value)) return null;
  const opened = value.opened === undefined || value.opened === "" ? [] : strings(value.opened) ? value.opened : null;
  if (opened === null) return null;
  if (value.version === INTENT_VERSION) {
    if (!validTree(value.tree) || typeof value.focus !== "string") return null;
    if (value.titles !== undefined && (!record(value.titles) || !Object.values(value.titles).every(title => typeof title === "string"))) return null;
    const titles = Object.fromEntries(Object.entries((value.titles ?? {}) as Record<string, string>)
      .filter(([key, title]) => title.trim() !== "" && contains(value.tree as LayoutNode, key)));
    return { version: INTENT_VERSION, tree: clone(value.tree), focus: value.focus, opened: [...opened],
      ...(Object.keys(titles).length === 0 ? {} : { titles }) };
  }
  if (value.version !== undefined || !fraction(value.ratio)) return null;
  if (value.firstActive !== undefined && typeof value.firstActive !== "string") return null;
  if (value.order !== undefined && value.order !== "" && !strings(value.order)) return null;
  const order = strings(value.order) ? value.order : [];
  const firstActive = typeof value.firstActive === "string" ? value.firstActive : "";
  let legacy: LegacyNode;
  if (value.tree !== undefined) {
    if (!legacyTree(value.tree)) return null;
    legacy = clone(value.tree) as LegacyNode;
  } else {
    if ((value.orientation !== null && value.orientation !== "rows" && value.orientation !== "cols")
      || !strings(value.second) || typeof value.secondActive !== "string") return null;
    const first: LegacyPane = { kind: "pane", id: "pane-0", tabs: [], active: "" };
    legacy = value.orientation === null ? first : {
      kind: "cut", id: "cut-0", orientation: value.orientation, ratio: value.ratio,
      first, second: { kind: "pane", id: "pane-1", tabs: [...new Set(value.second)], active: value.secondActive },
    };
  }
  const tree = migrate(legacy, order, firstActive);
  if (!validTree(tree)) return null;
  return { version: INTENT_VERSION, tree, focus: firstActive, opened: [...opened] };
}
