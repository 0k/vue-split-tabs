import { computed, readonly, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from "vue";

export type Orientation = "rows" | "cols";
export type PaneIndex = 0 | 1;
export type SplitSide = "start" | "end";
export interface SplitTabsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SplitTabsIntent {
  orientation: Orientation | null;
  firstActive: string;
  order: string[];
  second: string[];
  secondActive: string;
  ratio: number;
}
export interface SplitTabsPane {
  index: PaneIndex;
  tabs: readonly string[];
  active: string;
}
export interface SplitTabsOptions {
  tabs: MaybeRefOrGetter<readonly string[]>;
  active?: { get(): string; set(id: string): void };
  entryKey: MaybeRefOrGetter<string>;
  storageKey: string;
  storage?: SplitTabsStorage;
  maxEntries?: number;
  minPaneWidth: number;
  minPaneHeight: number;
  dividerSize?: number;
  defaultRatio?: number;
}
export interface SplitTabsController {
  readonly isSplit: ComputedRef<boolean>;
  readonly orientation: ComputedRef<Orientation | null>;
  readonly panes: ComputedRef<readonly SplitTabsPane[]>;
  readonly fits: ComputedRef<{ rows: boolean; cols: boolean }>;
  readonly canOfferSplit: ComputedRef<boolean>;
  readonly ratio: ComputedRef<number>;
  readonly restoredActive: ComputedRef<string>;
  readonly intent: ComputedRef<{
    readonly orientation: Orientation | null;
    readonly firstActive: string;
    readonly order: readonly string[];
    readonly second: readonly string[];
    readonly secondActive: string;
    readonly ratio: number;
  }>;
  readonly dividerSize: number;
  paneOf(id: string): PaneIndex | null;
  split(id: string, orientation: Orientation): void;
  splitAt(id: string, orientation: Orientation, side: SplitSide): void;
  place(id: string, pane: PaneIndex, beforeId: string | null): void;
  moveTo(id: string, pane: PaneIndex): void;
  moveToOther(id: string): void;
  select(pane: PaneIndex, id: string): void;
  merge(): void;
  setRatioLive(ratio: number): void;
  commitRatio(ratio: number): void;
  setContainerSize(width: number, height: number): void;
  dispose(): void;
}

interface Entry { key: string; stamp: number; intent: SplitTabsIntent }
type StoredIntent = Omit<SplitTabsIntent, "firstActive" | "order"> & { firstActive?: string; order?: string[] | "" };
interface StoredEntry { key: string; stamp: number; intent: StoredIntent }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIntent(value: unknown): value is StoredIntent {
  // Stored selection/order fields may be omitted; the reader supplies neutral defaults.
  return isRecord(value)
    && (value.orientation === null || value.orientation === "rows" || value.orientation === "cols")
    && (value.firstActive === undefined || typeof value.firstActive === "string")
    && (value.order === undefined || value.order === "" || (Array.isArray(value.order) && value.order.every((id: unknown) => typeof id === "string")))
    && Array.isArray(value.second) && value.second.every((id: unknown) => typeof id === "string")
    && typeof value.secondActive === "string"
    && typeof value.ratio === "number" && Number.isFinite(value.ratio) && value.ratio >= 0 && value.ratio <= 1;
}
function isEntry(value: unknown): value is StoredEntry {
  return isRecord(value) && typeof value.key === "string"
    && typeof value.stamp === "number" && Number.isSafeInteger(value.stamp) && value.stamp >= 0
    && isIntent(value.intent);
}
function browserStorage(): SplitTabsStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}
function readTable(storage: SplitTabsStorage | undefined, key: string): Entry[] | null {
  if (storage === undefined) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return [];
    const table: unknown = JSON.parse(raw);
    if (!isRecord(table) || !Array.isArray(table.entries)) return null;
    const entries = new Map<string, Entry>();
    for (const entry of table.entries.filter(isEntry)) {
      const previous = entries.get(entry.key);
      if (previous === undefined || entry.stamp >= previous.stamp) {
        entries.set(entry.key, {
          ...entry,
          intent: {
            ...entry.intent,
            firstActive: entry.intent.firstActive ?? "",
            order: Array.isArray(entry.intent.order) ? entry.intent.order : [],
          },
        });
      }
    }
    return [...entries.values()].sort((a, b) => a.stamp - b.stamp);
  } catch { return null; }
}
function copy(intent: SplitTabsIntent): SplitTabsIntent { return { ...intent, order: [...intent.order], second: [...intent.second] }; }
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
function neighbor(id: string, order: readonly string[], remaining: readonly string[]): string {
  const index = order.indexOf(id);
  for (let i = index + 1; i < order.length; i++) {
    const candidate = order[i];
    if (candidate !== undefined && remaining.includes(candidate)) return candidate;
  }
  for (let i = index - 1; i >= 0; i--) {
    const candidate = order[i];
    if (candidate !== undefined && remaining.includes(candidate)) return candidate;
  }
  return "";
}

export function createSplitTabsController(options: SplitTabsOptions): SplitTabsController {
  const storage = options.storage ?? browserStorage();
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries ?? 50)) : 50;
  const dividerSize = Math.max(0, options.dividerSize ?? 6);
  const defaultRatio = Number.isFinite(options.defaultRatio) ? Math.max(0, Math.min(1, options.defaultRatio ?? 0.5)) : 0.5;
  let entries = (readTable(storage, options.storageKey) ?? []).slice(-maxEntries);
  const pending = new Map<string, Entry>();
  let stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), 0);
  const present = computed(() => toValue(options.tabs));
  const internalActive = ref(present.value[0] ?? "");
  const active = options.active ?? { get: () => internalActive.value, set: (id: string) => { internalActive.value = id; } };
  const width = ref(0);
  const height = ref(0);
  const liveRatio = ref<number | null>(null);
  // Per pane, tabs in the order the user last viewed them there, most recent last. Memory-only and per page:
  // learned from controller actions (the tabs shown when acting, and every tab the controller selects).
  const visits: [string[], string[]] = [[], []];
  function initial(): SplitTabsIntent { return { orientation: null, firstActive: "", order: [], second: [], secondActive: "", ratio: defaultRatio }; }
  const state = ref<SplitTabsIntent>(initial());
  const fullOrder = computed(() => completeOrder(state.value.order, present.value));
  const ordered = computed(() => fullOrder.value.filter((id) => present.value.includes(id)));

  function writeTable(): void {
    try {
      if (storage === undefined) return;
      storage.setItem(options.storageKey, JSON.stringify({ entries }));
      pending.clear();
    }
    catch { /* Storage is best-effort; entries and current intent remain in memory. */ }
  }
  function refresh(): void {
    const stored = readTable(storage, options.storageKey);
    const merged = new Map((stored ?? entries).map((entry) => [entry.key, entry]));
    for (const [key, entry] of pending) {
      const saved = merged.get(key);
      if (saved === undefined || entry.stamp >= saved.stamp) merged.set(key, entry);
    }
    entries = [...merged.values()].sort((a, b) => a.stamp - b.stamp).slice(-maxEntries);
  }
  function touch(key: string, intent: SplitTabsIntent): void {
    refresh();
    stamp = entries.reduce((max, entry) => Math.max(max, entry.stamp), stamp) + 1;
    const current = { key, stamp, intent: copy(intent) };
    entries = entries.filter((entry) => entry.key !== key);
    entries.push(current);
    entries = entries.slice(-maxEntries);
    pending.set(key, current);
    for (const pendingKey of pending.keys()) {
      if (!entries.some((entry) => entry.key === pendingKey)) pending.delete(pendingKey);
    }
    writeTable();
  }
  const stopKey = watch(() => toValue(options.entryKey), (key) => {
    refresh();
    const existing = entries.find((entry) => entry.key === key);
    state.value = existing === undefined ? initial() : copy(existing.intent);
    liveRatio.value = null;
    visits[0].length = 0;
    visits[1].length = 0;
    if (existing !== undefined) touch(key, existing.intent);
  }, { immediate: true, flush: "sync" });

  const fits = computed(() => ({
    cols: width.value > 0 && width.value >= 2 * options.minPaneWidth + dividerSize,
    rows: height.value > 0 && height.value >= 2 * options.minPaneHeight + dividerSize,
  }));
  const second = computed(() => ordered.value.filter((id) => state.value.second.includes(id)));
  const first = computed(() => ordered.value.filter((id) => !state.value.second.includes(id)));
  const isSplit = computed(() => state.value.orientation !== null && second.value.length > 0 && first.value.length > 0 && fits.value[state.value.orientation]);
  const orientation = computed(() => isSplit.value ? state.value.orientation : null);
  const stopSplit = watch(isSplit, (split) => {
    if (!split) liveRatio.value = null;
  }, { flush: "sync" });
  const panes = computed<readonly SplitTabsPane[]>(() => {
    const a = active.get();
    if (!isSplit.value) return [{ index: 0, tabs: ordered.value, active: a }];
    const deepLink = second.value.includes(a);
    return [
      { index: 0, tabs: first.value, active: deepLink ? first.value[0] ?? "" : a },
      {
        index: 1,
        tabs: second.value,
        active: deepLink ? a : second.value.includes(state.value.secondActive)
          ? state.value.secondActive : second.value[0] ?? "",
      },
    ];
  });
  function clamp(r: number, display = false): number {
    const o = state.value.orientation;
    const value = Number.isFinite(r) ? r : defaultRatio;
    const normalized = Math.max(0, Math.min(1, value));
    if (width.value === 0 || height.value === 0) return display ? defaultRatio : normalized;
    if (o === null) return Math.max(0, Math.min(1, value));
    const available = (o === "rows" ? height.value : width.value) - dividerSize;
    const min = o === "rows" ? options.minPaneHeight : options.minPaneWidth;
    if (available < 2 * min || available <= 0) return display ? defaultRatio : normalized;
    return Math.max(min / available, Math.min(1 - min / available, value));
  }
  function visit(pane: PaneIndex, id: string): void {
    if (id === "") return;
    const list = visits[pane];
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    list.push(id);
  }
  function shown(pane: PaneIndex): string { return panes.value.find((p) => p.index === pane)?.active ?? ""; }
  function visitShown(): void { visit(0, shown(0)); if (isSplit.value) visit(1, shown(1)); }
  function setActive(id: string): void {
    visit(0, id);
    active.set(id);
  }
  /** Replacement for the shown tab `id` leaving `from` in `pane`: the last viewed remaining tab there, else its neighbor. */
  function previousOf(pane: PaneIndex, id: string, from: readonly string[], remaining: readonly string[]): string {
    const list = visits[pane];
    for (let i = list.length - 1; i >= 0; i--) {
      const candidate = list[i];
      if (candidate !== undefined && candidate !== id && remaining.includes(candidate)) return candidate;
    }
    return neighbor(id, from, remaining);
  }
  function update(next: SplitTabsIntent): void {
    if (JSON.stringify(next) === JSON.stringify(state.value)) return;
    state.value = next;
    touch(toValue(options.entryKey), next);
  }
  function mergeWithActive(firstActive: string): void {
    update({ orientation: null, firstActive, order: state.value.order, second: [], secondActive: "", ratio: state.value.ratio });
    liveRatio.value = null;
  }
  function merge(): void { mergeWithActive(""); }
  function paneOf(id: string): PaneIndex | null {
    return panes.value.find((pane) => pane.tabs.includes(id))?.index ?? null;
  }
  function select(pane: PaneIndex, id: string): void {
    if ((pane !== 0 && pane !== 1) || paneOf(id) !== pane) return;
    visitShown();
    if (pane === 0) {
      update({ ...state.value, firstActive: id });
      setActive(id);
    }
    else {
      visit(1, id);
      update({ ...state.value, secondActive: id });
    }
  }
  function relocation(id: string, source: PaneIndex, pane: PaneIndex): { intent: SplitTabsIntent; active: string | null } {
    const from = source === 0 ? first.value : second.value;
    const remaining = from.filter((tab) => tab !== id);
    visitShown();
    if (remaining.length === 0) return { intent: { ...state.value, orientation: null, firstActive: id, second: [], secondActive: "" }, active: id };
    if (pane === 1) {
      const nextActive = active.get() === id ? previousOf(0, id, from, remaining) : null;
      return {
        intent: {
          ...state.value,
          firstActive: nextActive ?? state.value.firstActive,
          second: [...state.value.second, id],
          secondActive: id,
        },
        active: nextActive,
      };
    }
    return { intent: { ...state.value,
        firstActive: id,
        second: state.value.second.filter((tab) => tab !== id),
        secondActive: state.value.secondActive === id ? previousOf(1, id, from, remaining) : state.value.secondActive,
      }, active: id };
  }
  /** Move without revealing: `id` goes behind the destination's shown tab, which stays shown (also after a merge). */
  function stow(id: string, source: PaneIndex, pane: PaneIndex): { intent: SplitTabsIntent; active: string } {
    const top = shown(0);
    const bottom = shown(1);
    const from = source === 0 ? first.value : second.value;
    const remaining = from.filter((tab) => tab !== id);
    visitShown();
    if (remaining.length === 0) {
      const kept = pane === 0 ? top : bottom;
      return { intent: { ...state.value, orientation: null, firstActive: kept, second: [], secondActive: "" }, active: kept };
    }
    if (pane === 1) {
      const nextTop = top === id ? previousOf(0, id, from, remaining) : top;
      return { intent: { ...state.value, firstActive: nextTop, second: [...state.value.second, id], secondActive: bottom }, active: nextTop };
    }
    const nextBottom = bottom === id ? previousOf(1, id, from, remaining) : bottom;
    visit(1, nextBottom);
    return {
      intent: { ...state.value, firstActive: top, second: state.value.second.filter((tab) => tab !== id), secondActive: nextBottom },
      active: top,
    };
  }
  function moveTo(id: string, pane: PaneIndex): void {
    if (!isSplit.value || (pane !== 0 && pane !== 1)) return;
    const source = paneOf(id);
    if (source === null) return;
    if (source === pane) { select(pane, id); return; }
    const next = stow(id, source, pane);
    update(next.intent);
    if (next.intent.orientation === null) liveRatio.value = null;
    if (next.active !== active.get()) setActive(next.active);
  }
  function place(id: string, pane: PaneIndex, beforeId: string | null): void {
    if ((pane !== 0 && pane !== 1) || (beforeId !== null && typeof beforeId !== "string")) return;
    const source = paneOf(id);
    const destination = panes.value.find((p) => p.index === pane);
    if (source === null || destination === undefined || beforeId === id || (beforeId !== null && !destination.tabs.includes(beforeId))) return;
    const targetTabs = destination.tabs.filter((tab) => tab !== id);
    const at = beforeId === null ? targetTabs.length : targetTabs.indexOf(beforeId);
    targetTabs.splice(at, 0, id);
    if (source === pane && targetTabs.every((tab, index) => tab === destination.tabs[index])) return;
    const order = fullOrder.value.filter((tab) => tab !== id);
    const last = destination.tabs.filter((tab) => tab !== id).slice(-1)[0];
    const position = beforeId !== null ? order.indexOf(beforeId) : last === undefined ? order.length : order.indexOf(last) + 1;
    order.splice(position, 0, id);
    const next = source === pane ? { intent: state.value, active: null } : relocation(id, source, pane);
    update({ ...next.intent, order });
    if (next.intent.orientation === null) liveRatio.value = null;
    if (next.active !== null) setActive(next.active);
  }
  function applySplit(id: string, o: Orientation, side: SplitSide, ratio: number): void {
    if (
      isSplit.value || (o !== "rows" && o !== "cols") || (side !== "start" && side !== "end")
      || !fits.value[o] || present.value.length < 2 || !present.value.includes(id)
    ) return;
    const others = ordered.value.filter((tab) => tab !== id);
    const previous = active.get();
    visit(0, previous);
    const replacement = previousOf(0, id, ordered.value, others);
    if (side === "start") {
      update({ ...state.value, orientation: o, ratio, firstActive: id, second: others, secondActive: others.includes(previous) ? previous : replacement });
      setActive(id);
    } else {
      // The top pane keeps showing what the user saw, so record it over any older request.
      const nextActive = previous === id ? replacement : null;
      update({ ...state.value, orientation: o, ratio, firstActive: nextActive ?? previous, second: [id], secondActive: id });
      if (nextActive !== null) setActive(nextActive);
    }
    liveRatio.value = null;
  }
  return {
    dividerSize, isSplit, orientation, panes, fits,
    intent: computed(() => readonly(state.value)),
    restoredActive: computed(() => state.value.orientation !== null
      && present.value.includes(state.value.firstActive) && !state.value.second.includes(state.value.firstActive)
      ? state.value.firstActive : ""),
    canOfferSplit: computed(() => !isSplit.value && present.value.length >= 2 && (fits.value.rows || fits.value.cols)),
    ratio: computed(() => clamp(liveRatio.value ?? state.value.ratio, true)),
    paneOf, select, moveTo, merge, place,
    splitAt(id, o, side) { applySplit(id, o, side, 0.5); },
    moveToOther(id) { const pane = paneOf(id); if (pane !== null) moveTo(id, pane === 0 ? 1 : 0); },
    split(id, o) { applySplit(id, o, "end", state.value.ratio); },
    setRatioLive(r) { liveRatio.value = clamp(r); },
    commitRatio(r) {
      update({ ...state.value, ratio: clamp(r) });
      liveRatio.value = null;
    },
    setContainerSize(w, h) {
      width.value = Number.isFinite(w) ? Math.max(0, w) : 0;
      height.value = Number.isFinite(h) ? Math.max(0, h) : 0;
    },
    dispose() { stopKey(); stopSplit(); },
  };
}
