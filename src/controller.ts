import { computed, readonly, ref, shallowRef, toValue, watch, type ComputedRef, type DeepReadonly, type MaybeRefOrGetter } from "vue";
import * as A from "./algebra.js";
import {
  contains, findNode, INTENT_VERSION, isNode, keyOf, notation, parentOf, parseIntent, tabSet, viewsOf, nodesOf,
  type CutNode, type LayoutNode, type Orientation, type Side, type SplitTabsIntent, type TabEntry, type TabSetNode,
} from "./model.js";
import {
  clampRatio, fit, idOf, project, type EffectiveCut, type EffectiveNode, type PaneId, type Projection, type Sizes,
  type SplitTabsBarVisibility,
  type SplitTabsFrame, type SplitTabsPane, type SplitTabsTabSet,
} from "./projection.js";

export type { PaneId };
export type SplitTabsResult = A.Result;
export type SplitTabsReason = A.Reason;
/** What a move or a drop carries: one view, one node (a pane, a layout, a tab set), or the current selection. */
export type SplitTabsSource = { view: string } | { node: string } | { selection: true };
/**
 * Where a move or a drop lands:
 * - `bar`: one more tab of that tab bar (next to the others), before tab `index` (end when null);
 * - `inside`: a tab INSIDE that zone (a new inner bar, like `tabInside`);
 * - `split`: a new part on that side of a pane, a tab set, a layout, or the whole area (`root`).
 * Any target may be `selection`: group the current selection first. A bar index of 0
 * inserts immediately before that group in its holder; null inserts immediately after.
 */
export type SplitTabsZone =
  | { kind: "bar"; target: string; index: number | null }
  | { kind: "inside"; target: string }
  | { kind: "split"; target: string; side: Side };
export interface SplitTabsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** What a key of a tab bar holds. */
export interface SplitTabsEntry { kind: "view" | "layout" | "tabs"; views: readonly string[] }
/** A selection preview: whether it can be grouped, and which panes the group would span. */
export interface SplitTabsPlan {
  ok: boolean;
  kind: "single" | "already" | "exact" | "snap" | "error";
  /** Panes inside the rectangle the group would take. */
  panes: readonly PaneId[];
  /** Panes in the way (refused) or whose edges grouping aligns (snap). */
  intruders: readonly PaneId[];
  moved: readonly PaneId[];
  /** Visible bar of which the prospective group is a direct tab, else null. Derived on a copy. */
  holder: string | null;
}
export interface SplitTabsOptions {
  /** Host tab ids, in their natural order. */
  tabs: MaybeRefOrGetter<readonly string[]>;
  /** Host tabs (a subset of `tabs`) shown only once opened, and closable. */
  optional?: MaybeRefOrGetter<readonly string[]>;
  /** Binds the focused pane's shown view (a router, for instance); `get` may catch up with `set` later. */
  active?: { get(): string; set(id: string): void };
  entryKey: MaybeRefOrGetter<string>; storageKey: string; storage?: SplitTabsStorage; maxEntries?: number;
  minPaneWidth: number; minPaneHeight: number;
  /**
   * Divider thickness in pixels, at least 1 (default 6); its grab zone is wider (see `--split-tabs-divider-hit-extra`).
   * A ref or getter re-lays the panes when it changes, without writing storage.
   */
  dividerSize?: MaybeRefOrGetter<number>;
  /** Actual thickness of a top / bottom tab bar, included in layout minima. Default 32. */
  barThickness?: number;
  /** Default width of a left / right tab bar. Default 96. */
  sideBarWidth?: number;
  /** Grouping aligns edges closer than this many pixels. Default 40. */
  snap?: number;
  /** Prefix of placeholder view ids created by new panes and tabs. Default `split-tabs:new-`. */
  placeholderPrefix?: string;
}
export interface SplitTabsController {
  readonly layout: ComputedRef<EffectiveNode>;
  readonly panes: ComputedRef<readonly SplitTabsPane[]>;
  readonly frames: ComputedRef<readonly SplitTabsFrame[]>;
  readonly cuts: ComputedRef<ReadonlyMap<string, EffectiveCut>>;
  readonly tabSets: ComputedRef<ReadonlyMap<string, SplitTabsTabSet>>;
  readonly isSplit: ComputedRef<boolean>;
  /** Two or more visible panes in the unzoomed working tree, independent of size and bar policy. */
  readonly hasSplit: ComputedRef<boolean>;
  readonly orientation: ComputedRef<Orientation | null>;
  readonly fits: ComputedRef<{ rows: boolean; cols: boolean }>;
  /** Focused pane (effective id). */
  readonly focus: ComputedRef<PaneId>;
  readonly selection: ComputedRef<readonly PaneId[]>;
  readonly plan: ComputedRef<SplitTabsPlan | null>;
  /** The tab bar T and R act on after its label was clicked, else null. */
  readonly barFocus: ComputedRef<string | null>;
  readonly zoomed: ComputedRef<string | null>;
  readonly canUndo: ComputedRef<boolean>;
  /** Rises with every close that can be undone: an undo offer starts again at each change. */
  readonly undoSerial: ComputedRef<number>;
  readonly restoredActive: ComputedRef<string>;
  readonly opened: ComputedRef<readonly string[]>;
  readonly intent: ComputedRef<DeepReadonly<SplitTabsIntent>>;
  readonly dividerSize: number;
  readonly sideBarWidth: number;
  readonly barThickness: number;
  /** Runtime bar visibility, never saved; managed by SplitTabs while mounted. */
  setAlwaysShow(policy: SplitTabsBarVisibility): void;
  /** i3-like readout of the rendered layout, e.g. `H[a V[b c]]`. */
  readonly notation: ComputedRef<string>;
  paneOf(view: string): PaneId | null;
  /** The pane, then each layout and tab set around it on screen, innermost first (keyboard-move destinations). */
  scopes(pane: PaneId): string[];
  tabSet(id: string): SplitTabsTabSet | undefined;
  describe(key: string): SplitTabsEntry | null;
  isOptional(id: string): boolean;
  isPlaceholder(id: string): boolean;
  isClosable(key: string): boolean;
  // focus and selection
  focusPane(pane: PaneId): void;
  toggleSelected(pane: PaneId): void;
  selectRectangle(pane: PaneId): void;
  setSelection(panes: readonly PaneId[]): void;
  clearSelection(): void;
  focusBar(tabSet: string | null): void;
  focusDirection(side: Side, extend?: boolean): SplitTabsResult;
  // tabs
  select(tabSet: string, key: string): void;
  switchTab(delta: number): SplitTabsResult;
  /** Move one tab within its bar, by visible slots, without changing what the bar shows. */
  reorder(tabSet: string, key: string, delta: number): SplitTabsResult;
  /** Set a trimmed title; an empty title clears it. Unknown keys are refused. */
  rename(key: string, title: string): SplitTabsResult;
  /** Reactive when read in a Vue render/computed; null when unset or no longer in the tree. */
  titleOf(key: string): string | null;
  open(id: string, pane?: PaneId): void;
  close(key: string): SplitTabsResult;
  replace(oldId: string, newId: string): void;
  // commands on the target: the selection (grouped first), else the focused pane
  /** Test a target command on a disposable workspace, without writes or allocating real ids. */
  canTarget(command: SplitTabsTargetCommand): SplitTabsResult;
  group(): SplitTabsResult;
  split(side: Side): SplitTabsResult;
  tabNext(): SplitTabsResult;
  tabInside(): SplitTabsResult;
  closeTarget(): SplitTabsResult;
  zoom(pane?: PaneId): SplitTabsResult;
  restore(): SplitTabsResult;
  toggleZoom(pane?: PaneId): SplitTabsResult;
  cycleBarSide(): SplitTabsResult;
  setBarWidth(tabSet: string, width: number | null): void;
  /** Show a side bar at this width while it is dragged, without saving; `null` drops the live width. */
  setBarWidthLive(tabSet: string, width: number | null): void;
  undo(): SplitTabsResult;
  dropUndo(): void;
  // moves
  move(source: SplitTabsSource, zone: SplitTabsZone): SplitTabsResult;
  canMove(source: SplitTabsSource, zone: SplitTabsZone): SplitTabsResult;
  insert(id: string, zone: SplitTabsZone, register?: () => void): SplitTabsResult;
  merge(): void;
  // sizes
  nudge(px: number): SplitTabsResult;
  equalize(cut?: string): void;
  setRatioLive(ratio: number, cut?: string): void;
  commitRatio(ratio: number, cut?: string): void;
  setContainerSize(width: number, height: number): void;
  dispose(): void;
}

export type SplitTabsTargetCommand = "splitRight" | "splitLeft" | "splitBelow" | "splitAbove"
  | "tabNext" | "tabInside" | "group" | "zoom" | "barSide" | "close";
interface Entry { key: string; stamp: number; intent: SplitTabsIntent }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
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
      if (intent !== null && entry.stamp >= (entries.get(entry.key)?.stamp ?? -1)) entries.set(entry.key, { key: entry.key, stamp: entry.stamp, intent });
    }
    return [...entries.values()].sort((a, b) => a.stamp - b.stamp);
  } catch { return null; }
}
const fail = (reason: A.Reason): A.Result => ({ ok: false, reason });
// Public computed identities describe value changes, not working-copy rebuilds.
function stableComputed<T>(read: () => T, serialize: (value: T) => string | undefined = JSON.stringify): ComputedRef<T> {
  let key: string | undefined;
  return computed<T>(previous => {
    const next = read(), nextKey = serialize(next);
    if (previous !== undefined && key === nextKey) return previous;
    key = nextKey;
    return next;
  });
}

export function createSplitTabsController(options: SplitTabsOptions): SplitTabsController {
  const storage = options.storage ?? browserStorage();
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries ?? 50)) : 50;
  const divider = computed(() => {
    const size = options.dividerSize === undefined ? 6 : toValue(options.dividerSize);
    if (!Number.isFinite(size) || size < 1) {
      throw new Error(`split-tabs: dividerSize must be a finite number of at least 1 (pixels), got ${size}`);
    }
    return size;
  });
  void divider.value; // Refuse an invalid initial thickness at creation.
  const barThickness = Math.max(0, options.barThickness ?? 32);
  const alwaysShow = shallowRef<SplitTabsBarVisibility>(false);
  const sideBarWidth = Math.max(1, options.sideBarWidth ?? 96);
  const snap = Math.max(0, options.snap ?? 40);
  const prefix = options.placeholderPrefix ?? "split-tabs:new-";
  let entries = (readTable(storage, options.storageKey) ?? []).slice(-maxEntries);
  const pending = new Map<string, Entry>();
  let stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), 0);
  let sequence = 0;
  let placeholders = 0;
  const reserved = new Set<string>();
  function reserve(tree: LayoutNode): void {
    for (const n of nodesOf(tree)) reserved.add(n.id);
    for (const v of viewsOf(tree)) reserved.add(v);
  }
  for (const entry of entries) reserve(entry.intent.tree);
  function fresh(kind: string, peek = false, exclude?: string): string {
    let id: string;
    let next = sequence;
    do { id = `${kind}-${++next}`; } while (reserved.has(id) || id === exclude);
    if (!peek) { sequence = next; reserved.add(id); }
    return id;
  }
  function freshPlaceholder(peek = false): string {
    let id: string;
    let next = placeholders;
    do { id = `${prefix}${++next}`; } while (reserved.has(id));
    if (!peek) { placeholders = next; reserved.add(id); }
    return id;
  }
  const present = computed(() => toValue(options.tabs));
  const optional = computed(() => options.optional === undefined ? [] : toValue(options.optional));
  function isOptional(id: string): boolean { return optional.value.includes(id); }
  function isPlaceholder(id: string): boolean { return id.startsWith(prefix); }
  const internalActive = ref("");
  const active = options.active ?? { get: () => internalActive.value, set: (id: string) => { internalActive.value = id; } };
  // Values given to `active.set` that the getter has not caught up with, plus the value it showed before them.
  // A lagging getter (an asynchronous router) passing through them is not a host request.
  const inFlight = new Set<string>();
  let lastSent: string | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  function clearActiveTimer(): void {
    if (activeTimer !== null) clearTimeout(activeTimer);
    activeTimer = null;
  }
  function tell(view: string): void {
    if (view === "" || view === (lastSent ?? active.get())) return;
    clearActiveTimer();
    const duplicate = view === active.get();
    if (lastSent === null) inFlight.add(active.get());
    inFlight.add(view);
    lastSent = view;
    active.set(view);
    if (duplicate && lastSent !== null) activeTimer = setTimeout(() => {
      // Allow asynchronous router resolution across ticks, but bound suppression
      // when the router drops both a pending request and its duplicate return.
      activeTimer = null;
      inFlight.clear();
      lastSent = null;
    }, 250);
  }
  const stopActive = watch(() => active.get(), value => {
    if (lastSent !== null && value !== lastSent && inFlight.has(value)) return;
    clearActiveTimer();
    inFlight.clear();
    lastSent = null;
  }, { flush: "sync" });
  const width = ref(0);
  const height = ref(0);
  const live = ref<Record<string, number>>({});
  const liveBars = ref<Record<string, number>>({});
  // Memory: which view the focused pane shows, which views the selected panes show.
  const focusView = ref("");
  const selectedViews = ref<string[]>([]);
  const zoomNode = ref<string | null>(null);
  const barFocusNode = ref<string | null>(null);
  interface Snapshot { intent: SplitTabsIntent; focus: string; selection: string[]; zoom: string | null }
  const undoSnapshot = shallowRef<Snapshot | null>(null);
  const undoSerial = ref(0);
  const visits = new Map<string, string[]>();
  function initial(): SplitTabsIntent { return { version: INTENT_VERSION, tree: tabSet(fresh("tabs"), []), focus: "", opened: [] }; }
  const state = ref<SplitTabsIntent>(initial());

  function refresh(): void {
    const stored = readTable(storage, options.storageKey);
    for (const entry of stored ?? entries) reserve(entry.intent.tree);
    const merged = new Map((stored ?? entries).map(entry => [entry.key, entry]));
    for (const [key, entry] of pending) if (entry.stamp >= (merged.get(key)?.stamp ?? -1)) merged.set(key, entry);
    entries = [...merged.values()].sort((a, b) => a.stamp - b.stamp).slice(-maxEntries);
  }
  function touch(key: string, intent: SplitTabsIntent): void {
    refresh();
    stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), stamp) + 1;
    const saved = clone(intent);
    if (saved.titles !== undefined) {
      saved.titles = Object.fromEntries(Object.entries(saved.titles).filter(([id]) => contains(saved.tree, id)));
      if (Object.keys(saved.titles).length === 0) delete saved.titles;
    }
    const current = { key, stamp, intent: saved };
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
    reserve(next.tree);
    state.value = next;
    live.value = {};
    visits.clear();
    focusView.value = next.focus;
    selectedViews.value = [];
    zoomNode.value = null;
    barFocusNode.value = null;
    undoSnapshot.value = null;
    if (existing !== undefined) touch(key, existing.intent);
  }, { immediate: true, flush: "sync" });

  // --- the working copy -------------------------------------------------------------

  // Reads `opened` at call time: a step that opens a tab sees it at once.
  function visibleIn(opened: readonly string[]): (view: string) => boolean {
    const presentSet = new Set(present.value);
    const optionalSet = new Set(optional.value);
    return view => isPlaceholder(view) || (presentSet.has(view) && (!optionalSet.has(view) || opened.includes(view)));
  }
  function makeEnv(opened: readonly string[]): A.Env {
    return {
      visible: visibleIn(opened),
      closable: view => isPlaceholder(view) || isOptional(view),
      fresh, placeholder: freshPlaceholder,
      stage: { x: 0, y: 0, w: width.value, h: height.value },
      min: { w: options.minPaneWidth, h: options.minPaneHeight },
      snap, bar: { thickness: barThickness, width: sideBarWidth },
      alwaysShow: alwaysShow.value, barWidths: liveBars.value, divider: divider.value,
      recent(id, keys) { return [...(visits.get(id) ?? [])].reverse().find(k => keys.includes(k)); },
    };
  }
  function paneOfView(ws: A.Workspace, view: string, env: A.Env): string | null {
    if (view === "" || !contains(ws.root, view)) return null;
    const at = parentOf(ws.root, view)!.parent;
    return at.kind === "tabs" && A.shownEntry(at, env) === view ? at.id : null;
  }
  function viewOfPane(ws: A.Workspace, id: string, env: A.Env): string {
    const n = findNode(ws.root, id);
    const shown = n === null || n.kind !== "tabs" ? undefined : A.shownEntry(n, env);
    return typeof shown === "string" ? shown : "";
  }
  // Visible host tabs not placed yet go to the first pane, after their nearest natural predecessor there.
  function placeImplicit(ws: A.Workspace, env: A.Env): void {
    const placed = new Set(viewsOf(ws.root));
    const missing = present.value.filter(id => env.visible(id) && !placed.has(id));
    if (missing.length === 0) return;
    const primary = A.visiblePanes(ws.root, env)[0] ?? (ws.root.kind === "tabs" ? ws.root : null);
    if (primary === null) return;
    for (const id of missing) {
      const natural = present.value.indexOf(id);
      let at = 0;
      for (let i = natural - 1; i >= 0; i--) {
        const index = primary.tabs.findIndex(t => keyOf(t) === present.value[i]);
        if (index >= 0) { at = index + 1; break; }
      }
      primary.tabs.splice(at, 0, id);
    }
    if (!primary.tabs.some(t => keyOf(t) === primary.active && A.hasVisible(t, env))) {
      const first = primary.tabs.find(t => A.hasVisible(t, env));
      if (first !== undefined) primary.active = keyOf(first);
    }
  }
  function build(opened: readonly string[] = state.value.opened, overlay = true): { ws: A.Workspace; env: A.Env } {
    const env = makeEnv(opened);
    const ws: A.Workspace = { root: clone(state.value.tree), focus: "", selection: [], zoom: zoomNode.value, barFocus: barFocusNode.value };
    // The first pane receives unplaced tabs before folding, so an empty first pane takes them (as in 0.1 / 0.2).
    placeImplicit(ws, env);
    A.normalize(ws, env);
    ws.focus = paneOfView(ws, focusView.value, env) ?? "";
    ws.selection = selectedViews.value.map(v => paneOfView(ws, v, env)).filter((id): id is string => id !== null);
    A.normalize(ws, env);
    const requested = active.get();
    const request = overlay && requested !== "" && !inFlight.has(requested) && requested !== viewOfPane(ws, ws.focus, env);
    if (request && env.visible(requested) && contains(ws.root, requested)) {
      A.reveal(ws, requested, env);
    }
    return { ws, env };
  }
  const working = computed(() => build());
  const sizes = computed<Sizes>(() => ({ width: width.value, height: height.value, divider: divider.value,
    minWidth: options.minPaneWidth, minHeight: options.minPaneHeight, live: live.value, bars: liveBars.value }));
  let projectionKey = "";
  let projecting = false;
  function guardProjection<T>(value: ComputedRef<T>): ComputedRef<T> {
    // Guard the read, not the computed callback: Vue may return a cached value on re-entry.
    return new Proxy(value, { get(target, key, receiver) {
      if (key === "value" && projecting) {
        throw new Error("split-tabs: alwaysShow policy must not read the controller; use the tab set argument or compute a boolean in the host render");
      }
      return Reflect.get(target, key, receiver);
    } });
  }
  function projectedComputed<T>(read: () => T, serialize?: (value: T) => string | undefined): ComputedRef<T> {
    return guardProjection(stableComputed(read, serialize));
  }
  const projection = guardProjection(computed<Projection>(previous => {
    projecting = true;
    try {
      const { ws, env } = working.value;
      const next = project(A.viewRoot(ws), env, sizes.value, viewOfPane(ws, ws.focus, env));
      // A fresh inline policy is not a layout change. Keep public object-valued
      // computeds stable, but include hidden intent used by hit tests and commands.
      const key = JSON.stringify([next.layout, [...next.represented], [...next.minima]]);
      if (previous !== undefined && key === projectionKey) return previous;
      projectionKey = key;
      return next;
    } finally { projecting = false; }
  }));
  // The effective pane standing for an intent pane (itself, or the collapsed subtree holding it).
  function effectivePane(id: string, p = projection.value): string | null {
    if (p.tabSets.has(id) && p.panes.some(q => q.id === id)) return id;
    for (const [pane, n] of p.represented) if (contains(n, id)) return pane;
    return null;
  }
  // The intent pane a public pane id means: a collapsed pane stands for the pane of its shown view.
  function intentPane(ws: A.Workspace, id: string, env: A.Env): string | null {
    const pane = projection.value.panes.find(p => p.id === id);
    if (pane?.collapsed === true) return paneOfView(ws, pane.view, env);
    const n = findNode(ws.root, id);
    return n !== null && A.isPane(n, env) && A.visiblePanes(A.viewRoot(ws), env).some(p => p.id === id) ? id : null;
  }
  function intentTarget(ws: A.Workspace, id: string, env: A.Env, holder: boolean): string | null {
    if (id === "selection") return ws.selection.length > 0 ? "selection" : null;
    if (id === "root") return holder ? null : "root";
    const pane = projection.value.panes.find(p => p.id === id);
    if (pane?.collapsed === true && holder) return paneOfView(ws, pane.view, env);
    return findNode(ws.root, id) === null ? null : id;
  }

  function visitShown(): void {
    for (const t of projection.value.tabSets.values()) visit(t.id, t.active);
  }
  function visit(id: string, key: string): void {
    if (key === "") return;
    visits.set(id, [...(visits.get(id) ?? []).filter(k => k !== key), key]);
  }
  function commit(ws: A.Workspace, env: A.Env, opened: readonly string[], titles: Record<string, string>): void {
    const view = viewOfPane(ws, ws.focus, env);
    focusView.value = view;
    selectedViews.value = ws.selection.map(id => viewOfPane(ws, id, env)).filter(v => v !== "");
    zoomNode.value = ws.zoom;
    barFocusNode.value = ws.barFocus;
    const placed = new Set(viewsOf(ws.root));
    const next: SplitTabsIntent = { version: INTENT_VERSION, tree: ws.root, focus: view, opened: opened.filter(id => placed.has(id)) };
    const kept = Object.fromEntries(Object.entries(titles).filter(([key]) => contains(ws.root, key)));
    if (Object.keys(kept).length > 0) next.titles = kept;
    for (const t of nodesOf(ws.root)) if (t.kind === "tabs") visit(t.id, t.active);
    live.value = {};
    liveBars.value = {};
    if (JSON.stringify(next) !== JSON.stringify(state.value)) {
      state.value = next;
      touch(toValue(options.entryKey), next);
    }
    tell(view);
  }
  type Step = (ws: A.Workspace, env: A.Env, opened: string[], titles: Record<string, string>) => A.Result;
  function act(step: Step, { snapshot = false, overlay = true, unzoom = false } = {}): A.Result {
    visitShown();
    const opened = [...state.value.opened];
    const { ws, env } = build(opened, overlay);
    // Like tmux: a command that changes the layout first ends the zoom.
    if (unzoom && ws.zoom !== null) A.restore(ws, env);
    const before: Snapshot = { intent: clone(state.value), focus: focusView.value, selection: [...selectedViews.value], zoom: zoomNode.value };
    const titles = { ...state.value.titles };
    const result = step(ws, env, opened, titles);
    if (!result.ok) return result;
    commit(ws, env, opened, titles);
    if (snapshot) { undoSnapshot.value = before; undoSerial.value++; }
    return result;
  }
  // Like act, without a write: focus, selection and zoom are memory only.
  function memory(step: (ws: A.Workspace, env: A.Env) => A.Result | void): A.Result {
    const { ws, env } = build();
    const result = step(ws, env) ?? { ok: true };
    if (!result.ok) return result;
    const view = viewOfPane(ws, ws.focus, env);
    focusView.value = view;
    selectedViews.value = ws.selection.map(id => viewOfPane(ws, id, env)).filter(v => v !== "");
    zoomNode.value = ws.zoom;
    barFocusNode.value = ws.barFocus;
    tell(view);
    return result;
  }
  function source(ws: A.Workspace, s: SplitTabsSource): A.MoveSource | null {
    if ("selection" in s) return { selection: ws.selection };
    if ("view" in s) return contains(ws.root, s.view) && findNode(ws.root, s.view) === null ? { view: s.view } : null;
    return findNode(ws.root, s.node) === null ? null : { node: s.node };
  }
  function move(s: SplitTabsSource, z: SplitTabsZone): A.Result {
    return act((ws, env) => {
      const src = source(ws, s), dest = zone(ws, z, env);
      if (src === null || dest === null) return fail("unknown");
      return A.move(ws, src, dest, env);
    });
  }
  function zone(ws: A.Workspace, z: SplitTabsZone, env: A.Env): A.Zone | null {
    const target = intentTarget(ws, z.target, env, z.kind !== "split");
    if (target === null) return null;
    if (z.kind === "split") return { kind: "split", target, side: z.side };
    if (z.kind === "inside") return { kind: "inside", target };
    if (target === "selection") return { kind: "bar", target, index: z.index };
    // A bar index counts visible tabs; the tree also keeps hidden ones.
    const n = findNode(ws.root, target);
    if (z.index === null || n === null || n.kind !== "tabs") return { kind: "bar", target, index: null };
    const visible = n.tabs.filter(t => A.hasVisible(t, env));
    const before = visible[z.index];
    return { kind: "bar", target, index: before === undefined ? null : n.tabs.indexOf(before) };
  }
  function placeInsert(ws: A.Workspace, env: A.Env, id: string, dest: A.Zone, dryRun = false): A.Result {
    if (findNode(ws.root, id) !== null) return fail("unknown");
    if (contains(ws.root, id)) {
      const holder = parentOf(ws.root, id)!.parent as TabSetNode;
      holder.tabs = holder.tabs.filter(t => t !== id);
    }
    // Park the prospective view in the destination before using the ordinary move validator.
    const target = dest.target === "root" ? ws.root : findNode(ws.root, dest.target === "selection" ? ws.selection[0]! : dest.target);
    if (target === null) return fail("unknown");
    const anchor = A.visiblePanes(target, env)[0];
    if (anchor === undefined) return fail("unknown");
    anchor.tabs.push(id);
    return A.move(ws, { view: id }, dest, env, dryRun);
  }
  function canInsert(id: string, z: SplitTabsZone): A.Result {
    const { ws, env } = build();
    const dest = zone(ws, z, env);
    if (dest === null) return fail("unknown");
    return placeInsert(ws, { ...env, visible: view => view === id || env.visible(view) }, id, dest, true);
  }
  function removedViews(before: LayoutNode, after: LayoutNode): string[] {
    const kept = new Set(viewsOf(after));
    return viewsOf(before).filter(v => !kept.has(v));
  }
  function closing(step: Step): A.Result {
    return act((ws, env, opened, titles) => {
      const before = clone(ws.root);
      const result = step(ws, env, opened, titles);
      if (result.ok) {
        const gone = new Set(removedViews(before, ws.root));
        opened.splice(0, opened.length, ...opened.filter(id => !gone.has(id)));
      }
      return result;
    }, { snapshot: true });
  }

  // --- full minimums for divider clamps --------------------------------------------------
  function fullMin(n: LayoutNode, axis: Orientation, env: A.Env): number {
    return A.minExtent(n, axis === "cols" ? "x" : "y", env);
  }
  function rootCut(): string | undefined {
    const l = projection.value.layout;
    return l.kind === "cut" ? l.id : undefined;
  }
  function resize(value: number, id: string | undefined, commitIt: boolean): void {
    const cutId = id ?? rootCut();
    if (cutId === undefined) return;
    const geometry = projection.value.cuts.get(cutId);
    const { ws, env } = working.value;
    const n = findNode(ws.root, cutId);
    if (n === null || n.kind !== "cut") return;
    const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
    const ratio = geometry === undefined ? normalized
      : clampRatio(n.orientation, value, geometry.width, geometry.height, sizes.value,
        [fullMin(n.first, n.orientation, env), fullMin(n.second, n.orientation, env)]);
    if (!commitIt) { live.value = { ...live.value, [cutId]: ratio }; return; }
    act(w => { (findNode(w.root, cutId) as CutNode).ratio = ratio; return { ok: true }; }, { overlay: false });
  }
  function equalize(id?: string): void {
    const cutId = id ?? rootCut();
    const found = cutId === undefined ? undefined : projection.value.cuts.get(cutId);
    if (found === undefined) return;
    const p = projection.value;
    const axis = found.orientation;
    let run: EffectiveCut = found;
    function ancestry(n: EffectiveNode): boolean {
      if (n.kind === "pane") return false;
      if (n.kind === "frame") return ancestry(n.content);
      if (n.id === run.id) return true;
      if (!ancestry(n.first) && !ancestry(n.second)) return false;
      if (n.orientation === axis && [n.first, n.second].some(c => c.kind === "cut" && c.id === run.id)) run = n;
      return true;
    }
    ancestry(p.layout);
    const segments: EffectiveNode[] = [];
    (function collect(n: EffectiveNode): void {
      if (n.kind === "cut" && n.orientation === axis) { collect(n.first); collect(n.second); } else segments.push(n);
    })(run);
    const length = axis === "cols" ? run.width : run.height;
    const available = length - (segments.length - 1) * divider.value;
    const sizesOf = segments.map(() => available / segments.length);
    // Water-fill around effective minima, so equalization cannot fold an inner split.
    const minima = segments.map(n => p.minima.get(idOf(n))![axis]);
    if (minima.reduce((sum, v) => sum + v, 0) <= available) {
      const fixed = new Set<number>();
      for (;;) {
        const remaining = available - [...fixed].reduce((sum, i) => sum + sizesOf[i]!, 0);
        const share = remaining / (segments.length - fixed.size);
        let changed = false;
        for (let i = 0; i < sizesOf.length; i++) if (!fixed.has(i)) {
          sizesOf[i] = Math.max(minima[i]!, share);
          if (minima[i]! > share) { fixed.add(i); changed = true; }
        }
        if (!changed || fixed.size === segments.length) break;
      }
    }
    const ratios = new Map<string, number>();
    let cursor = 0;
    function distribute(n: EffectiveNode): { node: EffectiveNode; length: number } {
      if (n.kind !== "cut" || n.orientation !== axis) return { node: n, length: sizesOf[cursor++]! };
      const a = distribute(n.first), b = distribute(n.second);
      return { node: { ...n, first: a.node, second: b.node, ratio: a.length / (a.length + b.length) }, length: a.length + divider.value + b.length };
    }
    function constrain(n: EffectiveNode, w: number, h: number): void {
      if (n.kind !== "cut" || n.orientation !== axis) return;
      const bounds = [p.minima.get(idOf(n.first))![axis], p.minima.get(idOf(n.second))![axis]] as const;
      const ratio = clampRatio(axis, n.ratio, w, h, sizes.value, bounds);
      ratios.set(n.id, ratio);
      const avail = (axis === "cols" ? w : h) - divider.value;
      const a = avail * ratio, b = avail - a;
      constrain(n.first, axis === "cols" ? a : w, axis === "rows" ? a : h);
      constrain(n.second, axis === "cols" ? b : w, axis === "rows" ? b : h);
    }
    constrain(distribute(run).node, run.width, run.height);
    act(ws => {
      for (const [cid, ratio] of ratios) { const n = findNode(ws.root, cid); if (n?.kind === "cut") n.ratio = ratio; }
      return { ok: true };
    }, { overlay: false });
  }

  // Zoom is memory only, except that zooming a selection may first regroup it: that regroup is a real
  // tree change (same picture), so it is committed, otherwise the zoom would point at a node that only
  // existed in the working copy.
  function zoomIn(pane?: PaneId): A.Result {
    const step = (ws: A.Workspace, env: A.Env) => A.zoom(ws, env, pane === undefined ? null : intentPane(ws, pane, env));
    return working.value.ws.selection.length > 0 ? act(step, { overlay: false }) : memory(step);
  }
  const stopLive = watch([width, height, present, optional], () => { live.value = {}; }, { flush: "sync" });
  const panes = projectedComputed(() => projection.value.panes);

  function describe(key: string): SplitTabsEntry | null {
    const { ws, env } = working.value;
    const n = findNode(ws.root, key);
    if (n !== null) return { kind: n.kind === "cut" ? "layout" : "tabs", views: viewsOf(n).filter(v => env.visible(v)) };
    return contains(ws.root, key) ? { kind: "view", views: [key] } : null;
  }
  function isClosable(key: string): boolean {
    const d = describe(key);
    return d !== null && d.views.length > 0 && d.views.every(v => isPlaceholder(v) || isOptional(v));
  }

  return {
    layout: projectedComputed(() => projection.value.layout),
    panes,
    frames: projectedComputed(() => projection.value.frames),
    cuts: projectedComputed(() => projection.value.cuts, map => JSON.stringify([...map])),
    tabSets: projectedComputed(() => projection.value.tabSets, map => JSON.stringify([...map])),
    isSplit: projectedComputed(() => panes.value.length > 1),
    hasSplit: computed(() => {
      const { ws, env } = working.value;
      return A.visiblePanes(ws.root, env).length > 1;
    }),
    orientation: projectedComputed(() => projection.value.layout.kind === "cut" ? projection.value.layout.orientation : null),
    fits: stableComputed(() => fit(width.value, height.value, sizes.value)),
    focus: projectedComputed(() => effectivePane(working.value.ws.focus) ?? panes.value[0]?.id ?? ""),
    selection: projectedComputed(() => [...new Set(working.value.ws.selection.map(id => effectivePane(id)).filter((id): id is string => id !== null))]),
    plan: projectedComputed<SplitTabsPlan | null>(() => {
      const { ws, env: realEnv } = working.value;
      const env = A.probeEnv(ws, realEnv);
      if (ws.selection.length === 0) return null;
      const plan = A.planGroup(ws, ws.selection, env);
      let holder: string | null = null;
      if (plan.ok) {
        const copy = { ...ws, root: clone(ws.root), selection: [...ws.selection] };
        const grouped = A.applyGroup(copy, A.planGroup(copy, copy.selection, env));
        const parent = parentOf(copy.root, grouped.id)?.parent;
        if (parent?.kind === "tabs" && A.showsBar(parent, env)) holder = parent.id;
      }
      const panesOf = (nodes: readonly LayoutNode[]) => [...new Set(nodes.flatMap(n => A.visiblePanes(n, env))
        .map(q => effectivePane(q.id)).filter((id): id is string => id !== null))];
      return {
        ok: plan.ok, kind: plan.kind, panes: panesOf(plan.selected), holder,
        intruders: plan.ok ? [] : panesOf(plan.intruders),
        moved: plan.kind === "snap" ? panesOf(plan.moved.map(t => t.node)) : [],
      };
    }),
    barFocus: computed(() => working.value.ws.barFocus),
    zoomed: computed(() => working.value.ws.zoom),
    canUndo: computed(() => undoSnapshot.value !== null),
    undoSerial: computed(() => undoSerial.value),
    restoredActive: computed(() => {
      const view = state.value.focus;
      return view !== "" && working.value.env.visible(view) && contains(working.value.ws.root, view) ? view : "";
    }),
    opened: stableComputed(() => readonly(viewsOf(working.value.ws.root).filter(id => isOptional(id) && working.value.env.visible(id)))),
    intent: stableComputed(() => readonly(state.value)),
    get dividerSize() { return divider.value; },
    sideBarWidth, barThickness,
    setAlwaysShow: policy => { alwaysShow.value = policy; },
    notation: computed(() => {
      const { ws, env } = working.value;
      return notation(A.viewRoot(ws), n => keyOf(A.shownEntry(n, env) ?? ""), t => A.hasVisible(t, env));
    }),
    paneOf(view) { return panes.value.find(p => p.tabs.includes(view))?.id ?? null; },
    scopes(id) {
      const { ws, env } = working.value;
      const start = intentPane(ws, id, env);
      if (start === null) return [];
      const top = A.viewRoot(ws).id;
      const chain = [effectivePane(start) ?? start];
      for (let key = start; key !== top;) {
        const at = parentOf(ws.root, key);
        if (at === null) break;
        key = at.parent.id;
        const n = at.parent;
        const shown = n.kind === "cut" || (A.showsLayout(n, env) && A.visibleTabs(n, env).length > 1);
        const effective = projection.value.cuts.has(key) || projection.value.tabSets.has(key) ? key : effectivePane(key);
        if (shown && effective !== null && !chain.includes(effective)) chain.push(effective);
      }
      return chain;
    },
    tabSet(id) { return projection.value.tabSets.get(id); },
    describe, isOptional, isPlaceholder, isClosable,

    focusPane(pane) {
      memory((ws, env) => {
        const id = intentPane(ws, pane, env);
        if (id === null) return fail("unknown");
        ws.focus = id;
        ws.selection = [];
        ws.barFocus = null;
      });
      if (focusView.value !== state.value.focus) act(() => ({ ok: true }));
    },
    toggleSelected(pane) {
      memory((ws, env) => {
        const id = intentPane(ws, pane, env);
        if (id === null) return fail("unknown");
        ws.barFocus = null;
        if (ws.selection.length === 0 && id !== ws.focus) ws.selection = [ws.focus];
        ws.selection = ws.selection.includes(id) ? ws.selection.filter(p => p !== id) : [...ws.selection, id];
      });
    },
    selectRectangle(pane) {
      memory((ws, env) => {
        const id = intentPane(ws, pane, env);
        if (id === null) return fail("unknown");
        ws.barFocus = null;
        ws.selection = A.rectangleSelection(ws, ws.focus, id, env);
      });
    },
    setSelection(list) {
      memory((ws, env) => {
        ws.selection = list.map(p => intentPane(ws, p, env)).filter((id): id is string => id !== null);
      });
    },
    clearSelection() { memory(ws => { ws.selection = []; }); },
    focusBar(id) {
      memory(ws => {
        if (id !== null && findNode(ws.root, id)?.kind !== "tabs") return fail("unknown");
        ws.barFocus = id;
      });
    },
    focusDirection(side, extend = false) { return memory((ws, env) => A.focusMove(ws, side, env, extend)); },

    select(id, key) {
      const pane = projection.value.panes.find(p => p.id === id);
      act((ws, env) => {
        if (pane?.collapsed === true) return A.reveal(ws, key, env);
        const r = A.activate(ws, id, key, env);
        if (r.ok) ws.barFocus = null;
        return r;
      }, { overlay: false });
    },
    switchTab(delta) { return act((ws, env) => A.switchTab(ws, delta, env)); },
    titleOf(key) {
      return contains(working.value.ws.root, key) && Object.prototype.hasOwnProperty.call(state.value.titles ?? {}, key)
        ? state.value.titles![key]! : null;
    },
    rename(key, title) {
      if (!contains(working.value.ws.root, key)) return fail("unknown");
      const trimmed = title.trim();
      const old = Object.prototype.hasOwnProperty.call(state.value.titles ?? {}, key) ? state.value.titles![key] : undefined;
      if ((old ?? "") === trimmed) return { ok: true };
      return act((_ws, _env, _opened, titles) => {
        if (trimmed === "") delete titles[key];
        else Object.defineProperty(titles, key, { value: trimmed, writable: true, enumerable: true, configurable: true });
        return { ok: true };
      });
    },
    reorder(id, key, delta) {
      return act((ws, env) => {
        const n = findNode(ws.root, id);
        if (n === null || n.kind !== "tabs") return fail("unknown");
        const visible = n.tabs.filter(t => A.hasVisible(t, env));
        const from = visible.findIndex(t => keyOf(t) === key);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= visible.length || delta === 0) return fail("at-limit");
        const entry = visible[from]!, other = visible[to]!;
        const a = n.tabs.indexOf(entry), b = n.tabs.indexOf(other);
        n.tabs.splice(a, 1);
        n.tabs.splice(n.tabs.indexOf(other) + (b > a ? 1 : 0), 0, entry);
        return { ok: true, node: id };
      }, { overlay: false });
    },
    open(id, pane) {
      if (!present.value.includes(id) && !isPlaceholder(id)) return;
      act((ws, env, opened) => {
        if (contains(ws.root, id) && env.visible(id)) return A.reveal(ws, id, env);
        if (isOptional(id) && !opened.includes(id)) opened.push(id);
        if (contains(ws.root, id)) {
          // A closed optional tab still placed (hidden): take it out before placing it again.
          const at = parentOf(ws.root, id)!.parent as TabSetNode;
          at.tabs = at.tabs.filter(t => t !== id);
        }
        const target = (pane === undefined ? null : intentPane(ws, pane, env)) ?? ws.focus;
        const host = findNode(ws.root, target);
        if (host === null || host.kind !== "tabs") return fail("unknown");
        host.tabs.push(id);
        return A.reveal(ws, id, env);
      });
    },
    close(key) {
      return closing((ws, env) => {
        if (!contains(ws.root, key)) return fail("unknown");
        return A.close(ws, env, findNode(ws.root, key) === null ? { view: key } : { node: key });
      });
    },
    replace(oldId, newId) {
      if (oldId === newId || (!present.value.includes(newId) && !isPlaceholder(newId))) return;
      act((ws, env, opened) => {
        if (!contains(ws.root, oldId) || findNode(ws.root, oldId) !== null) return fail("unknown");
        const at = parentOf(ws.root, oldId)!.parent as TabSetNode;
        const removeOld = () => { const i = opened.indexOf(oldId); if (i >= 0) opened.splice(i, 1); };
        if (contains(ws.root, newId) && env.visible(newId)) {
          removeOld();
          const r = A.close(ws, { ...env, closable: () => true }, { view: oldId });
          if (!r.ok) return r;
          return A.reveal(ws, newId, env);
        }
        if (contains(ws.root, newId)) {
          const holder = parentOf(ws.root, newId)!.parent as TabSetNode;
          holder.tabs = holder.tabs.filter(t => t !== newId);
        }
        at.tabs[at.tabs.indexOf(oldId)] = newId;
        if (at.active === oldId) at.active = newId;
        removeOld();
        if (isOptional(newId) && !opened.includes(newId)) opened.push(newId);
        if (focusView.value === oldId) ws.focus = at.id;
        A.normalize(ws, env);
        return { ok: true };
      });
    },

    canTarget(command) {
      const { ws, env } = build();
      let serial = 0;
      const fresh = () => { let id: string; do { id = `__probe:${++serial}`; } while (contains(ws.root, id)); return id; };
      const probe = { ...env, fresh, placeholder: fresh };
      if (command !== "zoom" && command !== "close" && ws.zoom !== null) A.restore(ws, probe);
      switch (command) {
        case "splitRight": return A.splitNew(ws, "right", probe);
        case "splitLeft": return A.splitNew(ws, "left", probe);
        case "splitBelow": return A.splitNew(ws, "bottom", probe);
        case "splitAbove": return A.splitNew(ws, "top", probe);
        case "tabNext": return A.tabNext(ws, probe);
        case "tabInside": return A.tabInside(ws, probe);
        case "group": return A.group(ws, probe);
        case "barSide": return A.cycleBarSide(ws, probe);
        case "close": return A.close(ws, probe);
        case "zoom": return ws.zoom !== null ? A.restore(ws, probe) : A.zoom(ws, probe);
      }
    },
    group() { return act((ws, env) => A.group(ws, env), { unzoom: true }); },
    split(side) { return act((ws, env) => A.splitNew(ws, side, env), { unzoom: true }); },
    tabNext() { return act((ws, env) => A.tabNext(ws, env), { unzoom: true }); },
    tabInside() { return act((ws, env) => A.tabInside(ws, env), { unzoom: true }); },
    closeTarget() { return closing((ws, env) => A.close(ws, env)); },
    zoom(pane) { return zoomIn(pane); },
    restore() { return memory((ws, env) => A.restore(ws, env)); },
    toggleZoom(pane) {
      return working.value.ws.zoom !== null ? memory((ws, env) => A.restore(ws, env)) : zoomIn(pane);
    },
    cycleBarSide() { return act((ws, env) => A.cycleBarSide(ws, env), { unzoom: true }); },
    setBarWidth(id, value) {
      act(ws => {
        const n = findNode(ws.root, id);
        if (n === null || n.kind !== "tabs") return fail("unknown");
        if (value === null || !Number.isFinite(value) || value <= sideBarWidth) delete n.barWidth;
        else n.barWidth = Math.round(value);
        return { ok: true };
      }, { overlay: false });
    },
    setBarWidthLive(id, value) {
      const next = { ...liveBars.value };
      if (value === null || !Number.isFinite(value)) delete next[id];
      else next[id] = Math.max(sideBarWidth, Math.round(value));
      liveBars.value = next;
    },
    undo() {
      const snap = undoSnapshot.value;
      if (snap === null) return fail("unknown");
      undoSnapshot.value = null;
      state.value = clone(snap.intent);
      touch(toValue(options.entryKey), state.value);
      focusView.value = snap.focus;
      selectedViews.value = snap.selection;
      zoomNode.value = snap.zoom;
      tell(snap.focus);
      return { ok: true };
    },
    dropUndo() { undoSnapshot.value = null; },

    move,
    canMove(s, z) {
      if ("view" in s && !working.value.env.visible(s.view)) return canInsert(s.view, z);
      if ("view" in s && !contains(working.value.ws.root, s.view)) return canInsert(s.view, z);
      const { ws, env } = build();
      const src = source(ws, s), dest = zone(ws, z, env);
      if (src === null || dest === null) return fail("unknown");
      return A.move(ws, src, dest, env, true);
    },
    insert(id, z, register) {
      if (contains(working.value.ws.root, id) && working.value.env.visible(id)) return move({ view: id }, z);
      const checked = canInsert(id, z);
      if (!checked.ok) return checked;
      const intent = state.value;
      register?.();
      if (state.value !== intent || (!present.value.includes(id) && !isPlaceholder(id))) return fail("unknown");
      return act((ws, env, opened) => {
        const dest = zone(ws, z, env);
        if (dest === null) return fail("unknown");
        if (isOptional(id) && !opened.includes(id)) opened.push(id);
        return placeInsert(ws, env, id, dest);
      });
    },
    merge() {
      act((ws, env) => {
        const views = viewsOf(ws.root);
        const shown = viewOfPane(ws, ws.focus, env);
        ws.root = tabSet(fresh("tabs"), views, views.includes(shown) ? shown : views[0] ?? "");
        ws.focus = ws.root.id;
        ws.selection = [];
        ws.zoom = null;
        A.normalize(ws, env);
        return { ok: true };
      });
    },

    nudge(px) { return act((ws, env) => A.nudge(ws, px, env)); },
    equalize,
    setRatioLive(value, cut) { resize(value, cut, false); },
    commitRatio(value, cut) { resize(value, cut, true); },
    setContainerSize(w, h) {
      width.value = Number.isFinite(w) ? Math.max(0, w) : 0;
      height.value = Number.isFinite(h) ? Math.max(0, h) : 0;
    },
    dispose() { clearActiveTimer(); stopKey(); stopLive(); stopActive(); },
  };
}

export type { EffectiveCut, EffectiveNode, SplitTabsFrame, SplitTabsPane, SplitTabsTabSet, TabEntry };
