import { computed, readonly, ref, toValue, watch, type ComputedRef, type DeepReadonly, type MaybeRefOrGetter } from "vue";
import { indexTree, type TreeIndex } from "./tree.js";

export type Orientation = "rows" | "cols";
export type PaneId = string;
export type SplitSide = "start" | "end";
export interface PaneNode { kind: "pane"; id: PaneId; tabs: string[]; active: string }
export interface CutNode { kind: "cut"; id: string; orientation: Orientation; ratio: number; first: LayoutNode; second: LayoutNode }
export type LayoutNode = PaneNode | CutNode;
export interface SplitTabsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SplitTabsIntent { tree: LayoutNode; firstActive: string; order: string[]; opened: string[]; ratio: number }
export interface SplitTabsPane {
  id: PaneId; index: number; tabs: readonly string[]; active: string;
  width: number; height: number; fits: { rows: boolean; cols: boolean };
}
export interface EffectiveCut {
  kind: "cut"; id: string; orientation: Orientation; ratio: number; width: number; height: number;
  first: EffectiveNode; second: EffectiveNode;
}
export type EffectiveNode = { kind: "pane"; pane: SplitTabsPane } | EffectiveCut;
export interface SplitTabsOptions {
  tabs: MaybeRefOrGetter<readonly string[]>;
  optional?: MaybeRefOrGetter<readonly string[]>;
  active?: { get(): string; set(id: string): void };
  entryKey: MaybeRefOrGetter<string>; storageKey: string; storage?: SplitTabsStorage; maxEntries?: number;
  minPaneWidth: number; minPaneHeight: number; dividerSize?: number; defaultRatio?: number;
}
export interface SplitTabsController {
  readonly isSplit: ComputedRef<boolean>;
  readonly orientation: ComputedRef<Orientation | null>;
  readonly panes: ComputedRef<readonly SplitTabsPane[]>;
  readonly layout: ComputedRef<EffectiveNode>;
  readonly cuts: ComputedRef<ReadonlyMap<string, EffectiveCut>>;
  readonly fits: ComputedRef<{ rows: boolean; cols: boolean }>;
  readonly canOfferSplit: ComputedRef<boolean>;
  readonly ratio: ComputedRef<number>;
  readonly restoredActive: ComputedRef<string>;
  readonly opened: ComputedRef<readonly string[]>;
  readonly intent: ComputedRef<DeepReadonly<SplitTabsIntent>>;
  readonly dividerSize: number;
  paneOf(id: string): PaneId | null;
  isOptional(id: string): boolean;
  open(id: string, pane: PaneId): void;
  insert(id: string, pane: PaneId, beforeId: string | null, register?: () => void): void;
  insertSplit(id: string, orientation: Orientation, side: SplitSide, pane?: PaneId, register?: () => void): void;
  close(id: string): void;
  replace(oldId: string, newId: string): void;
  split(id: string, orientation: Orientation, pane?: PaneId): void;
  splitAt(id: string, orientation: Orientation, side: SplitSide, pane?: PaneId): void;
  place(id: string, pane: PaneId, beforeId: string | null): void;
  moveTo(id: string, pane: PaneId): void;
  select(pane: PaneId, id: string): void;
  merge(): void;
  setRatioLive(ratio: number, cut?: string): void;
  commitRatio(ratio: number, cut?: string): void;
  equalize(cut?: string): void;
  setContainerSize(width: number, height: number): void;
  dispose(): void;
}
interface Entry { key: string; stamp: number; intent: SplitTabsIntent }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(id => typeof id === "string"); }
function fraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function leaf(id: string, tabs: string[] = [], active = ""): PaneNode { return { kind: "pane", id, tabs, active }; }
function leaves(node: LayoutNode): PaneNode[] {
  return node.kind === "pane" ? [node] : [...leaves(node.first), ...leaves(node.second)];
}
function cuts(node: LayoutNode): CutNode[] {
  return node.kind === "pane" ? [] : [node, ...cuts(node.first), ...cuts(node.second)];
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validTree(value: unknown, ids = new Set<string>(), tabs = new Set<string>()): value is LayoutNode {
  if (!record(value) || typeof value.id !== "string" || value.id === "" || ids.has(value.id)) return false;
  ids.add(value.id);
  if (value.kind === "pane") {
    if (!strings(value.tabs) || typeof value.active !== "string") return false;
    for (const id of value.tabs) { if (tabs.has(id)) return false; tabs.add(id); }
    return true;
  }
  return value.kind === "cut" && (value.orientation === "rows" || value.orientation === "cols") && fraction(value.ratio)
    && validTree(value.first, ids, tabs) && validTree(value.second, ids, tabs);
}
function parseIntent(value: unknown): SplitTabsIntent | null {
  if (!record(value) || !fraction(value.ratio) || (value.firstActive !== undefined && typeof value.firstActive !== "string")) return null;
  for (const field of [value.order, value.opened]) if (field !== undefined && field !== "" && !strings(field)) return null;
  let tree: LayoutNode;
  if (value.tree !== undefined) {
    if (!validTree(value.tree)) return null;
    tree = clone(value.tree);
  } else {
    if ((value.orientation !== null && value.orientation !== "rows" && value.orientation !== "cols")
      || !strings(value.second) || typeof value.secondActive !== "string") return null;
    tree = value.orientation === null ? leaf("pane-0") : {
      kind: "cut", id: "cut-0", orientation: value.orientation, ratio: value.ratio,
      first: leaf("pane-0"), second: leaf("pane-1", [...new Set(value.second)], value.secondActive),
    };
  }
  return { tree, firstActive: typeof value.firstActive === "string" ? value.firstActive : "",
    order: strings(value.order) ? value.order : [], opened: strings(value.opened) ? value.opened : [], ratio: value.ratio };
}
function browserStorage(): SplitTabsStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
function readTable(storage: SplitTabsStorage | undefined, key: string): Entry[] | null {
  if (storage === undefined) return null;
  try {
    const raw = storage.getItem(key);
    if (raw == null) return [];
    const table: unknown = JSON.parse(raw);
    if (!record(table) || !Array.isArray(table.entries)) return null;
    const entries = new Map<string, Entry>();
    for (const entry of table.entries) {
      if (!record(entry) || typeof entry.key !== "string" || typeof entry.stamp !== "number"
        || !Number.isSafeInteger(entry.stamp) || entry.stamp < 0) continue;
      const intent = parseIntent(entry.intent);
      if (intent !== null && entry.stamp >= (entries.get(entry.key)?.stamp ?? -1)) {
        entries.set(entry.key, { key: entry.key, stamp: entry.stamp, intent });
      }
    }
    return [...entries.values()].sort((a, b) => a.stamp - b.stamp);
  } catch { return null; }
}
function completeOrder(saved: readonly string[], natural: readonly string[]): string[] {
  const order = [...new Set(saved)];
  natural.forEach((id, index) => {
    if (order.includes(id)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const predecessor = natural[i];
      if (predecessor !== undefined && order.includes(predecessor)) { at = order.indexOf(predecessor) + 1; break; }
    }
    order.splice(at, 0, id);
  });
  return order;
}
function replaceNode(tree: LayoutNode, id: string, replacement: LayoutNode | null): LayoutNode | null {
  if (tree.id === id) return replacement;
  if (tree.kind === "pane") return tree;
  const first = replaceNode(tree.first, id, replacement);
  const second = replaceNode(tree.second, id, replacement);
  if (first === null) return second;
  if (second === null) return first;
  return { ...tree, first, second };
}

export function createSplitTabsController(options: SplitTabsOptions): SplitTabsController {
  const storage = options.storage ?? browserStorage();
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries ?? 50)) : 50;
  const dividerSize = Math.max(0, options.dividerSize ?? 6);
  const defaultRatio = Number.isFinite(options.defaultRatio) ? Math.max(0, Math.min(1, options.defaultRatio ?? 0.5)) : 0.5;
  let entries = (readTable(storage, options.storageKey) ?? []).slice(-maxEntries);
  const pending = new Map<string, Entry>();
  let stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), 0);
  let sequence = 0;
  const reserved = new Set<string>();
  function reserve(tree: LayoutNode): void {
    for (const node of [...leaves(tree), ...cuts(tree)]) reserved.add(node.id);
  }
  for (const entry of entries) reserve(entry.intent.tree);
  const present = computed(() => toValue(options.tabs));
  const optional = computed(() => options.optional === undefined ? [] : toValue(options.optional));
  function isOptional(id: string): boolean { return optional.value.includes(id); }
  const internalActive = ref(present.value.find(id => !isOptional(id)) ?? "");
  const active = options.active ?? { get: () => internalActive.value, set: (id: string) => { internalActive.value = id; } };
  const width = ref(0);
  const height = ref(0);
  const live = ref<Record<string, number>>({});
  const visits = new Map<PaneId, string[]>();
  function initial(): SplitTabsIntent { return { tree: leaf("pane-0"), firstActive: "", order: [], opened: [], ratio: defaultRatio }; }
  const state = ref<SplitTabsIntent>(initial());
  const visible = computed(() => present.value.filter(id => !isOptional(id) || state.value.opened.includes(id)));
  const fullOrder = computed(() => completeOrder(state.value.order, present.value));
  const ordered = computed(() => fullOrder.value.filter(id => visible.value.includes(id)));
  function fresh(prefix: string): string {
    let id: string;
    do { id = `${prefix}-${++sequence}`; } while (reserved.has(id));
    reserved.add(id);
    return id;
  }
  function refresh(): void {
    const stored = readTable(storage, options.storageKey);
    for (const entry of stored ?? entries) reserve(entry.intent.tree);
    const merged = new Map((stored ?? entries).map(entry => [entry.key, entry]));
    for (const [key, entry] of pending) {
      if (entry.stamp >= (merged.get(key)?.stamp ?? -1)) merged.set(key, entry);
    }
    entries = [...merged.values()].sort((a, b) => a.stamp - b.stamp).slice(-maxEntries);
  }
  function touch(key: string, intent: SplitTabsIntent): void {
    refresh();
    stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), stamp) + 1;
    const current = { key, stamp, intent: clone(intent) };
    entries = [...entries.filter(entry => entry.key !== key), current].slice(-maxEntries);
    pending.set(key, current);
    for (const k of pending.keys()) if (!entries.some(entry => entry.key === k)) pending.delete(k);
    try {
      if (storage === undefined) return;
      storage.setItem(options.storageKey, JSON.stringify({ entries }));
      pending.clear();
    } catch { /* Keep failed writes in memory for the next successful flush. */ }
  }
  const stopKey = watch(() => toValue(options.entryKey), key => {
    refresh();
    const existing = entries.find(entry => entry.key === key);
    const next = existing === undefined ? initial() : clone(existing.intent);
    if (existing === undefined && reserved.has(next.tree.id)) next.tree = leaf(fresh("pane"));
    reserve(next.tree);
    state.value = next;
    live.value = {};
    visits.clear();
    if (existing !== undefined) touch(key, existing.intent);
  }, { immediate: true, flush: "sync" });
  function fit(w: number, h: number) {
    return { cols: w > 0 && w >= 2 * options.minPaneWidth + dividerSize,
      rows: h > 0 && h >= 2 * options.minPaneHeight + dividerSize };
  }
  const fits = computed(() => fit(width.value, height.value));
  const treeIndex = computed(() => indexTree(state.value.tree, ordered.value, options.minPaneWidth, options.minPaneHeight, dividerSize));
  const membership = computed(() => treeIndex.value.membership);
  function minimum(node: LayoutNode, axis: Orientation, index = treeIndex.value): number {
    return index.metrics.get(node.id)!.min[axis];
  }
  function clamp(node: CutNode, value: number, w: number, h: number, display = false, index = treeIndex.value,
    bounds?: readonly [number, number]): number {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : defaultRatio));
    const axis = node.orientation;
    const available = (axis === "cols" ? w : h) - dividerSize;
    const min = axis === "cols" ? options.minPaneWidth : options.minPaneHeight;
    if (w <= 0 || h <= 0 || available < 2 * min) return display ? defaultRatio : normalized;
    let [a, b] = bounds ?? [minimum(node.first, axis, index), minimum(node.second, axis, index)];
    if (a + b > available) a = b = min;
    return Math.max(a / available, Math.min(1 - b / available, normalized));
  }
  interface Geometry {
    layout: EffectiveNode;
    panes: SplitTabsPane[];
    cuts: Map<string, EffectiveCut>;
    tabPane: Map<string, PaneId>;
    represented: Map<PaneId, LayoutNode>;
    minima: Map<string, { rows: number; cols: number }>;
  }
  function effectiveId(node: EffectiveNode): string { return node.kind === "pane" ? node.pane.id : node.id; }
  function measure(tree: LayoutNode, index: TreeIndex): Geometry {
    const paneList: SplitTabsPane[] = [];
    const cutLayouts = new Map<string, EffectiveCut>();
    const tabPane = new Map<string, PaneId>();
    const represented = new Map<PaneId, LayoutNode>();
    const minima = new Map<string, { rows: number; cols: number }>();
    function render(node: LayoutNode, w: number, h: number): EffectiveNode {
      const metrics = index.metrics.get(node.id)!;
      if (node.kind === "cut") {
        if (index.metrics.get(node.first.id)!.tabs.length === 0) return render(node.second, w, h);
        if (index.metrics.get(node.second.id)!.tabs.length === 0) return render(node.first, w, h);
        if (fit(w, h)[node.orientation]) {
          // Geometry reserves one pane per side. Resize actions separately clamp against full intent minima (S8).
          const min = node.orientation === "cols" ? options.minPaneWidth : options.minPaneHeight;
          const ratio = clamp(node, live.value[node.id] ?? node.ratio, w, h, true, index, [min, min]);
          const available = (node.orientation === "cols" ? w : h) - dividerSize;
          const a = available * ratio, b = available - a;
          const cut: EffectiveCut = { kind: "cut", id: node.id, orientation: node.orientation, ratio, width: w, height: h,
            first: render(node.first, node.orientation === "cols" ? a : w, node.orientation === "rows" ? a : h),
            second: render(node.second, node.orientation === "cols" ? b : w, node.orientation === "rows" ? b : h) };
          cutLayouts.set(cut.id, cut);
          const first = minima.get(effectiveId(cut.first))!, second = minima.get(effectiveId(cut.second))!;
          minima.set(cut.id, {
            rows: node.orientation === "rows" ? first.rows + dividerSize + second.rows : Math.max(first.rows, second.rows),
            cols: node.orientation === "cols" ? first.cols + dividerSize + second.cols : Math.max(first.cols, second.cols),
          });
          return cut;
        }
      }
      const { first, tabs } = metrics;
      const shown = tabs.includes(first.active) ? first.active : index.membership.get(first.id)?.[0] ?? tabs[0] ?? "";
      const pane: SplitTabsPane = { id: first.id, index: paneList.length, tabs, active: shown, width: w, height: h, fits: fit(w, h) };
      paneList.push(pane);
      represented.set(pane.id, node);
      minima.set(pane.id, { rows: options.minPaneHeight, cols: options.minPaneWidth });
      for (const id of tabs) tabPane.set(id, pane.id);
      return { kind: "pane", pane };
    }
    const layout = render(tree, width.value, height.value);
    return { layout, panes: paneList, cuts: cutLayouts, tabPane, represented, minima };
  }
  function selectGeometry(geometry: Geometry, requested: string): Geometry {
    const paneList = geometry.panes.map(pane => ({ ...pane, active: pane.index === 0
      ? requested === "" ? "" : geometry.tabPane.get(requested) === pane.id ? requested : pane.active
      : pane.tabs.includes(requested) ? requested : pane.active }));
    const byId = new Map(paneList.map(pane => [pane.id, pane]));
    const cutLayouts = new Map<string, EffectiveCut>();
    function selected(node: EffectiveNode): EffectiveNode {
      if (node.kind === "pane") return { kind: "pane", pane: byId.get(node.pane.id)! };
      const cut = { ...node, first: selected(node.first), second: selected(node.second) };
      cutLayouts.set(cut.id, cut);
      return cut;
    }
    return { ...geometry, layout: selected(geometry.layout), panes: paneList, cuts: cutLayouts };
  }
  const geometry = computed(() => measure(state.value.tree, treeIndex.value));
  const projection = computed(() => selectGeometry(geometry.value, active.get()));
  const layout = computed(() => projection.value.layout);
  const panes = computed(() => projection.value.panes);
  const cutLayouts = computed<ReadonlyMap<string, EffectiveCut>>(() => projection.value.cuts);
  function nextGeometry(next: SplitTabsIntent): Geometry {
    const visible = new Set(present.value.filter(id => !isOptional(id) || next.opened.includes(id)));
    const ordered = completeOrder(next.order, present.value).filter(id => visible.has(id));
    return measure(next.tree, indexTree(next.tree, ordered, options.minPaneWidth, options.minPaneHeight, dividerSize));
  }
  function primaryAfter(next: SplitTabsIntent, repair = true): string {
    const projected = nextGeometry(next);
    const primary = projected.panes[0]!;
    const requested = active.get();
    if (!repair && requested === "") return "";
    return primary.tabs.includes(requested) ? requested : primary.active;
  }
  const isSplit = computed(() => panes.value.length > 1);
  const orientation = computed(() => layout.value.kind === "cut" ? layout.value.orientation : null);
  const stopLive = watch([width, height, visible], () => { live.value = {}; }, { flush: "sync" });
  function paneOf(id: string): PaneId | null { return panes.value.find(p => p.tabs.includes(id))?.id ?? null; }
  function visit(pane: PaneId, id: string): void {
    if (id === "") return;
    visits.set(pane, [...(visits.get(pane) ?? []).filter(tab => tab !== id), id]);
  }
  function visitShown(shown: readonly SplitTabsPane[] = panes.value): void { for (const pane of shown) visit(pane.id, pane.active); }
  function previous(pane: SplitTabsPane, id: string, remaining: readonly string[]): string {
    const recent = [...(visits.get(pane.id) ?? [])].reverse().find(tab => tab !== id && remaining.includes(tab));
    if (recent !== undefined) return recent;
    const at = pane.tabs.indexOf(id);
    return pane.tabs.slice(at + 1).find(tab => remaining.includes(tab))
      ?? [...pane.tabs.slice(0, at)].reverse().find(tab => remaining.includes(tab)) ?? "";
  }
  function update(next: SplitTabsIntent, host: string | null = null): void {
    const remaining = new Set(leaves(next.tree).map(node => node.id));
    for (const id of visits.keys()) if (!remaining.has(id)) visits.delete(id);
    if (JSON.stringify(next) !== JSON.stringify(state.value)) { state.value = next; touch(toValue(options.entryKey), next); }
    if (host !== null) { active.set(host); visit(geometry.value.panes[0]!.id, host); }
  }
  function findLeaf(next: SplitTabsIntent, id: PaneId): PaneNode | undefined { return leaves(next.tree).find(p => p.id === id); }
  function selectIn(next: SplitTabsIntent, pane: PaneId, id: string): string | null {
    const node = findLeaf(next, pane);
    if (node === undefined) return null;
    node.active = id;
    visit(pane, id);
    const projected = nextGeometry(next);
    const primary = projected.panes[0]!;
    if (primary.id === pane) { next.firstActive = id; return id; }
    // Clear a host deep link that would otherwise override this explicit secondary selection.
    const hostPane = projected.tabPane.get(active.get());
    const invalidated = hostPane === undefined && projection.value.tabPane.has(active.get());
    if (invalidated || (hostPane !== undefined && hostPane !== primary.id && active.get() !== id)) {
      next.firstActive = primary.active;
      return primary.active;
    }
    return null;
  }
  function select(pane: PaneId, id: string): void {
    if (paneOf(id) !== pane) return;
    visitShown();
    const next = clone(state.value);
    update(next, selectIn(next, pane, id));
  }
  function placementOrder(id: string, destination: readonly string[], beforeId: string | null): string[] {
    const order = fullOrder.value.filter(tab => tab !== id);
    const last = destination.filter(tab => tab !== id).slice(-1)[0];
    const at = beforeId !== null ? order.indexOf(beforeId) : last === undefined ? order.length : order.indexOf(last) + 1;
    order.splice(at, 0, id);
    return order;
  }
  function removeMembership(next: SplitTabsIntent, id: string): void {
    for (const node of leaves(next.tree)) node.tabs = node.tabs.filter(tab => tab !== id);
  }
  function assign(next: SplitTabsIntent, pane: PaneId, id: string): void {
    removeMembership(next, id);
    const node = findLeaf(next, pane);
    if (node !== undefined) node.tabs.push(id);
  }
  function materializeFirst(next: SplitTabsIntent): void {
    const first = leaves(next.tree)[0]!;
    first.tabs = [...new Set([...first.tabs, ...(membership.value.get(first.id) ?? [])])];
  }
  function represented(pane: SplitTabsPane): LayoutNode | undefined {
    return geometry.value.represented.get(pane.id);
  }
  function prune(next: SplitTabsIntent, pane: SplitTabsPane): void {
    // An explicit action empties this effective pane, including a collapsed subtree.
    const removed = represented(pane);
    next.tree = replaceNode(next.tree, removed?.id ?? pane.id, null) ?? leaf(pane.id);
    live.value = {};
  }
  function departing(next: SplitTabsIntent, pane: SplitTabsPane, id: string): string | null {
    const remaining = pane.tabs.filter(tab => tab !== id);
    if (remaining.length === 0 && isSplit.value) {
      prune(next, pane);
      if (pane.index === 0 || active.get() === id) {
        const kept = primaryAfter(next);
        next.firstActive = kept;
        return kept;
      }
      return null;
    }
    if (pane.active !== id) return null;
    return selectIn(next, pane.id, previous(pane, id, remaining));
  }
  function destination(id: PaneId): SplitTabsPane | undefined { return panes.value.find(p => p.id === id); }
  function insert(id: string, pane: PaneId, beforeId: string | null, register?: () => void): void {
    const before = projection.value;
    const intent = state.value;
    const target = before.panes.find(p => p.id === pane);
    if (target === undefined || beforeId === id || (beforeId !== null && !target.tabs.includes(beforeId))) return;
    register?.();
    if (state.value !== intent || !present.value.includes(id)) return;
    if (before.tabPane.has(id)) { place(id, pane, beforeId); return; }
    visitShown(before.panes);
    const next = clone(state.value);
    if (isOptional(id) && !next.opened.includes(id)) next.opened.push(id);
    next.order = placementOrder(id, target.tabs, beforeId);
    assign(next, pane, id);
    update(next, selectIn(next, pane, id));
  }
  function open(id: string, pane: PaneId): void {
    if (!present.value.includes(id) || destination(pane) === undefined) return;
    const existing = paneOf(id);
    if (existing !== null) select(existing, id); else insert(id, pane, null);
  }
  function close(id: string): void {
    const pane = panes.value.find(p => p.tabs.includes(id));
    if (pane === undefined || !isOptional(id)) return;
    visitShown();
    const next = clone(state.value);
    next.opened = next.opened.filter(tab => tab !== id);
    removeMembership(next, id);
    const host = departing(next, pane, id);
    update(next, host);
  }
  function move(id: string, pane: PaneId, beforeId: string | null, reveal: boolean, reorder: boolean): void {
    const source = panes.value.find(p => p.tabs.includes(id));
    const target = destination(pane);
    if (source === undefined || target === undefined || beforeId === id || (beforeId !== null && !target.tabs.includes(beforeId))) return;
    if (source.id === pane && !reorder) { select(pane, id); return; }
    if (source.id === pane) {
      const tabs = target.tabs.filter(tab => tab !== id);
      tabs.splice(beforeId === null ? tabs.length : tabs.indexOf(beforeId), 0, id);
      if (tabs.every((tab, index) => tab === target.tabs[index])) return;
    }
    const next = clone(state.value);
    if (reorder) next.order = placementOrder(id, target.tabs, beforeId);
    if (source.id === pane) { update(next); return; }
    visitShown();
    // Materialize primary membership before pruning: a new first leaf must not steal sibling tabs.
    materializeFirst(next);
    assign(next, pane, id);
    let host = departing(next, source, id);
    if (reveal) host = selectIn(next, pane, id) ?? host;
    else {
      if (host === null) next.firstActive = primaryAfter(next, false);
      const node = findLeaf(next, pane);
      if (node !== undefined) node.active = target.active;
      if (nextGeometry(next).panes[0]?.id === pane) { next.firstActive = target.active; host = target.active; }
      else if (active.get() === id && host === null) { next.firstActive = primaryAfter(next); host = next.firstActive; }
    }
    if (next.tree.kind === "pane") {
      next.firstActive = reveal ? id : target.active;
      host = next.firstActive;
    }
    update(next, !reveal && host === active.get() ? null : host);
  }
  function place(id: string, pane: PaneId, beforeId: string | null): void { move(id, pane, beforeId, true, true); }
  function moveTo(id: string, pane: PaneId): void { if (isSplit.value) move(id, pane, null, false, false); }
  function replace(oldId: string, newId: string): void {
    const source = panes.value.find(p => p.tabs.includes(oldId));
    if (source === undefined || oldId === newId || !present.value.includes(newId)) return;
    visitShown();
    const next = clone(state.value);
    const existing = paneOf(newId);
    next.opened = next.opened.filter(id => id !== oldId);
    removeMembership(next, oldId);
    let host: string | null = null;
    if (existing !== null) {
      host = departing(next, source, oldId);
      host = selectIn(next, existing, newId) ?? host;
    } else {
      if (isOptional(newId) && !next.opened.includes(newId)) next.opened.push(newId);
      next.order = fullOrder.value.filter(id => id !== newId).map(id => id === oldId ? newId : id);
      assign(next, source.id, newId);
      if (source.active === oldId) host = selectIn(next, source.id, newId);
    }
    update(next, host);
  }
  function splitAction(id: string, axis: Orientation, side: SplitSide, targetId: PaneId | undefined, ratio: number,
    inserting = false, register?: () => void): void {
    const before = projection.value;
    const intent = state.value;
    const wasVisible = before.tabPane.has(id);
    const hidden = inserting && !wasVisible && (present.value.includes(id) || register !== undefined);
    const target = before.panes.find(p => p.id === (targetId ?? before.tabPane.get(id) ?? before.panes[0]!.id));
    if (target === undefined || (axis !== "rows" && axis !== "cols") || (side !== "start" && side !== "end")
      || !target.fits[axis] || (!wasVisible && !hidden)) return;
    const remaining = target.tabs.filter(tab => tab !== id);
    if (remaining.length === 0) return;
    const targetNode = represented(target);
    const beforeVisible = new Set(before.tabPane.keys());
    register?.();
    if (state.value !== intent || !present.value.includes(id)) return;
    visitShown(before.panes);
    const next = clone(state.value);
    // Split the effective pane, replacing a collapsed intent subtree only after an explicit user action.
    materializeFirst(next);
    removeMembership(next, id);
    let host: string | null = null;
    const source = before.panes.find(p => p.tabs.includes(id));
    if (source !== undefined && source.id !== target.id) host = departing(next, source, id);
    const kept = target.active === id ? previous(target, id, remaining) : target.active;
    const absent = targetNode === undefined ? [] : leaves(targetNode).flatMap(node => node.tabs)
      .filter(tab => tab !== id && !beforeVisible.has(tab));
    const keptNode = leaf(target.id, [...new Set([...remaining, ...absent])], kept);
    const newNode = leaf(fresh("pane"), [id], id);
    const cut: CutNode = { kind: "cut", id: fresh("cut"), orientation: axis, ratio,
      first: side === "start" ? newNode : keptNode, second: side === "start" ? keptNode : newNode };
    next.tree = replaceNode(next.tree, targetNode?.id ?? target.id, cut) ?? cut;
    if (hidden && isOptional(id) && !next.opened.includes(id)) next.opened.push(id);
    const postPrimary = nextGeometry(next).panes[0]!;
    if (postPrimary.id === newNode.id) { next.firstActive = id; host = id; }
    else if (postPrimary.id === keptNode.id) {
      next.firstActive = kept;
      if (target.active === id || postPrimary.id !== before.panes[0]!.id) host = kept;
    } else if (host !== null) {
      next.firstActive = postPrimary.tabs.includes(host) ? host : postPrimary.active;
      host = next.firstActive;
    }
    if (next.tree.id === cut.id) next.ratio = ratio;
    live.value = {};
    update(next, host);
  }
  function cutGeometry(id?: string): { node: CutNode; geometry: EffectiveCut | undefined } | undefined {
    const root = geometry.value.layout;
    const target = id ?? (root.kind === "cut" ? root.id : state.value.tree.id);
    const node = treeIndex.value.nodes.get(target);
    if (node === undefined || node.kind !== "cut") return undefined;
    return { node, geometry: cutLayouts.value.get(node.id) };
  }
  function resize(value: number, id: string | undefined, commit: boolean): void {
    const found = cutGeometry(id);
    const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : defaultRatio));
    if (found === undefined) {
      if (id === undefined && commit) update({ ...clone(state.value), ratio: normalized });
      return;
    }
    const { node, geometry } = found;
    const ratio = geometry === undefined ? normalized : clamp(node, value, geometry.width, geometry.height);
    if (!commit) { live.value = { ...live.value, [node.id]: ratio }; return; }
    const next = clone(state.value);
    cuts(next.tree).find(cut => cut.id === node.id)!.ratio = ratio;
    if (node.id === next.tree.id) next.ratio = ratio;
    live.value = {};
    update(next);
  }
  function equalize(id?: string): void {
    const found = cutGeometry(id);
    if (found?.geometry === undefined) return;
    const axis = found.node.orientation;
    let run = found.geometry;
    function ancestry(node: EffectiveNode): boolean {
      if (node.kind === "pane") return false;
      if (node.id === run.id) return true;
      if (!ancestry(node.first) && !ancestry(node.second)) return false;
      if (node.orientation === axis && [node.first, node.second].some(child => child.kind === "cut" && child.id === run.id)) run = node;
      return true;
    }
    ancestry(layout.value);
    const segments: EffectiveNode[] = [];
    function collect(node: EffectiveNode): void {
      if (node.kind === "cut" && node.orientation === axis) { collect(node.first); collect(node.second); } else segments.push(node);
    }
    collect(run);
    const length = axis === "cols" ? run.width : run.height;
    const available = length - (segments.length - 1) * dividerSize;
    const sizes = segments.map(() => available / segments.length);
    // Water-fill around subtree minima, so equalization cannot fold an inner split.
    const minima = segments.map(node => geometry.value.minima.get(effectiveId(node))![axis]);
    if (minima.reduce((sum, value) => sum + value, 0) <= available) {
      const fixed = new Set<number>();
      for (;;) {
        const remaining = available - [...fixed].reduce((sum, i) => sum + sizes[i]!, 0);
        const share = remaining / (segments.length - fixed.size);
        let changed = false;
        for (let i = 0; i < sizes.length; i++) if (!fixed.has(i)) {
          sizes[i] = Math.max(minima[i]!, share);
          if (minima[i]! > share) { fixed.add(i); changed = true; }
        }
        if (!changed || fixed.size === segments.length) break;
      }
    }
    const next = clone(state.value);
    const intentCuts = new Map(cuts(next.tree).map(node => [node.id, node]));
    let cursor = 0;
    function distribute(node: EffectiveNode): { node: EffectiveNode; length: number } {
      if (node.kind !== "cut" || node.orientation !== axis) return { node, length: sizes[cursor++]! };
      const a = distribute(node.first), b = distribute(node.second);
      return { node: { ...node, first: a.node, second: b.node, ratio: a.length / (a.length + b.length) },
        length: a.length + dividerSize + b.length };
    }
    function constrain(node: EffectiveNode, w: number, h: number): void {
      if (node.kind !== "cut" || node.orientation !== axis) return;
      const intent = intentCuts.get(node.id)!;
      const bounds = [geometry.value.minima.get(effectiveId(node.first))![axis],
        geometry.value.minima.get(effectiveId(node.second))![axis]] as const;
      const ratio = clamp(intent, node.ratio, w, h, false, treeIndex.value, bounds);
      intent.ratio = ratio;
      const available = (axis === "cols" ? w : h) - dividerSize;
      const a = available * ratio, b = available - a;
      constrain(node.first, axis === "cols" ? a : w, axis === "rows" ? a : h);
      constrain(node.second, axis === "cols" ? b : w, axis === "rows" ? b : h);
    }
    constrain(distribute(run).node, run.width, run.height);
    if (next.tree.kind === "cut" && next.tree.id === run.id) next.ratio = next.tree.ratio;
    live.value = {};
    update(next);
  }
  return {
    dividerSize, layout, panes, cuts: cutLayouts, isSplit, orientation, fits, paneOf, isOptional, open, insert, close, replace, place,
    moveTo, select, equalize,
    intent: computed(() => readonly(state.value)),
    opened: computed(() => readonly(ordered.value.filter(id => isOptional(id) && state.value.opened.includes(id)))),
    restoredActive: computed(() => state.value.tree.kind === "cut" && visible.value.includes(state.value.firstActive)
      && (membership.value.get(geometry.value.panes[0]!.id) ?? []).includes(state.value.firstActive) ? state.value.firstActive : ""),
    canOfferSplit: computed(() => panes.value.some(p => p.tabs.length >= 2 && (p.fits.rows || p.fits.cols))),
    ratio: computed(() => layout.value.kind === "cut" ? layout.value.ratio : width.value === 0 || height.value === 0 ? defaultRatio : state.value.ratio),
    split(id, axis, pane) { splitAction(id, axis, "end", pane, state.value.ratio); },
    splitAt(id, axis, side, pane) { splitAction(id, axis, side, pane, 0.5); },
    insertSplit(id, axis, side, pane, register) { splitAction(id, axis, side, pane, 0.5, true, register); },
    merge() {
      live.value = {};
      update({ ...clone(state.value), tree: leaf(leaves(state.value.tree)[0]!.id), firstActive: "" });
    },
    setRatioLive(value, cut) { resize(value, cut, false); },
    commitRatio(value, cut) { resize(value, cut, true); },
    setContainerSize(w, h) {
      width.value = Number.isFinite(w) ? Math.max(0, w) : 0;
      height.value = Number.isFinite(h) ? Math.max(0, h) : 0;
    },
    dispose() { stopKey(); stopLive(); },
  };
}
