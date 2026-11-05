// Random sequences of every public controller command on varied layouts, checking after
// EACH step the invariants that must always hold, whatever the sequence. A failure prints
// its seed and step, so it can be replayed and turned into a fixed case.
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSplitTabsController, notation, type LayoutNode, type Side, type SplitTabsStorage } from "../src/index";
import { findNode, parseIntent, viewsOf } from "../src/model";

function memoryStorage(): SplitTabsStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } };
}
function rng(seed: number) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
const SIDES: Side[] = ["left", "right", "top", "bottom"];

function run(seed: number, steps: number) {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const tabs = ref(["a", "b", "c", "d", "e", "f"]);
  const storage = memoryStorage();
  const active = ref("");
  const make = () => createSplitTabsController({
    tabs, optional: ["d", "e", "f"], entryKey: "page", storageKey: "layouts", storage, placeholderPrefix: "new:",
    minPaneWidth: 80, minPaneHeight: 60, active: { get: () => active.value, set: id => { active.value = id; } },
  });
  let c = make();
  c.setContainerSize(1200, 800);
  const log: string[] = [];
  const fail = (what: string) => { throw new Error(`seed ${seed}, after ${log.length} steps [${log.join(" ; ")}]: ${what}\n${c.notation.value}`); };
  const panes = () => c.panes.value.map(p => p.id);
  const views = () => c.panes.value.flatMap(p => p.tabs);
  // Views listed on screen: in panes, and as view tabs of the bars that frame a layout.
  // Every tab of every rendered bar, a hidden layout / inner-bar tab standing for all the views it holds;
  // the shown tab of a frame is not expanded: it is rendered, so its views are counted where they are rendered.
  const expand = (key: string) => c.describe(key)?.views ?? [];
  const listed = () => [
    ...c.panes.value.flatMap(p => p.tabs.flatMap(k => c.describe(k)?.kind === "view" ? [k] : expand(k))),
    ...c.frames.value.flatMap(f => f.tabs.filter(k => k !== f.active).flatMap(expand)),
  ];
  const ops: [string, () => void][] = [
    ["focus", () => c.focusPane(pick(panes()))],
    ["toggle", () => c.toggleSelected(pick(panes()))],
    ["rect", () => c.selectRectangle(pick(panes()))],
    ["clear", () => c.clearSelection()],
    ["dir", () => c.focusDirection(pick(SIDES), rand() < 0.3)],
    ["group", () => c.group()],
    ["split", () => c.split(pick(SIDES))],
    ["tabNext", () => c.tabNext()],
    ["tabInside", () => c.tabInside()],
    ["close", () => c.closeTarget()],
    ["closeTab", () => { const p = pick(c.panes.value); if (p.tabs.length > 0) c.close(pick(p.tabs)); }],
    ["undo", () => c.undo()],
    ["zoom", () => c.toggleZoom(rand() < 0.5 ? pick(panes()) : undefined)],
    ["bar", () => c.cycleBarSide()],
    ["barWidth", () => c.setBarWidth(pick([...c.tabSets.value.keys()]), rand() < 0.5 ? null : 100 + rand() * 200)],
    ["select", () => { const t = pick([...c.tabSets.value.values()]); if (t.tabs.length > 0) c.select(t.id, pick(t.tabs)); }],
    ["switch", () => c.switchTab(rand() < 0.5 ? 1 : -1)],
    ["open", () => c.open(pick(["d", "e", "f"]), rand() < 0.5 ? pick(panes()) : undefined)],
    ["replace", () => { const ph = views().filter(v => c.isPlaceholder(v)); if (ph.length > 0) c.replace(pick(ph), pick(["d", "e", "f"])); }],
    ["move", () => {
      const source = rand() < 0.5 ? { view: pick(views()) } : rand() < 0.5 ? { node: pick(panes()) } : { selection: true as const };
      const target = rand() < 0.15 ? "root" : pick(panes());
      const zone = rand() < 0.3 ? { kind: "inside" as const, target: target === "root" ? pick(panes()) : target }
        : rand() < 0.5 ? { kind: "bar" as const, target: target === "root" ? pick(panes()) : target, index: rand() < 0.5 ? null : 0 }
          : { kind: "split" as const, target, side: pick(SIDES) };
      c.move(source, zone);
    }],
    ["ratio", () => { const cut = pick([...c.cuts.value.keys(), ""]); if (cut !== "") c.commitRatio(rand(), cut); }],
    ["equalize", () => { const cut = pick([...c.cuts.value.keys(), ""]); if (cut !== "") c.equalize(cut); }],
    ["nudge", () => c.nudge(rand() < 0.5 ? -40 : 40)],
    ["resize", () => c.setContainerSize(pick([1200, 700, 300, 180, 1600]), pick([800, 400, 150, 1000]))],
    ["hostTabs", () => { tabs.value = rand() < 0.5 ? ["a", "b", "c", "d", "e", "f"] : ["a", "c", "d", "f"]; }],
    ["navigate", () => { active.value = pick(["a", "b", "c", "d", "zzz", ""]); }],
    ["reload", () => { c.dispose(); c = make(); c.setContainerSize(1200, 800); }],
  ];
  for (let step = 0; step < steps; step++) {
    const [name, op] = pick(ops);
    log.push(name);
    try { op(); } catch (error) { fail(`command threw: ${String(error)}`); }
    // What the controller points to exists.
    const ids = new Set(panes());
    if (c.panes.value.length === 0) fail("no pane rendered");
    if (!ids.has(c.focus.value)) fail(`focus ${c.focus.value} is not a rendered pane`);
    for (const s of c.selection.value) if (!ids.has(s)) fail(`selected ${s} is not a rendered pane`);
    const tree = c.intent.value.tree as LayoutNode;
    if (c.zoomed.value !== null && findNode(tree, c.zoomed.value) === null) fail(`zoom target ${c.zoomed.value} is not in the saved tree`);
    if (c.barFocus.value !== null && !c.tabSets.value.has(c.barFocus.value) && findNode(tree, c.barFocus.value) === null) {
      fail(`bar focus ${c.barFocus.value} does not exist`);
    }
    // A view is never shown twice, and every rendered pane shows a view it holds.
    const all = listed();
    if (new Set(all).size !== all.length) fail(`a view is listed twice: ${all.join(",")}`);
    for (const p of c.panes.value) if (p.view !== "" && !p.tabs.includes(p.view)) fail(`pane ${p.id} shows ${p.view} it does not hold`);
    // The saved intent reloads into exactly the same tree, with unique keys.
    const parsed = parseIntent(JSON.parse(JSON.stringify(c.intent.value)));
    if (parsed === null) fail("saved intent does not validate");
    if (notation(parsed!.tree) !== notation(tree)) fail("saved intent does not reload into the same tree");
    const keys = viewsOf(tree);
    if (new Set(keys).size !== keys.length) fail("a view is stored twice in the tree");
    // Every host tab that is visible appears exactly once on screen (absent and closed ones do not).
    for (const id of c.zoomed.value === null ? tabs.value : []) {
      const visible = !["d", "e", "f"].includes(id) || c.opened.value.includes(id);
      const shown = all.filter(v => v === id).length;
      if (visible && shown !== 1) fail(`visible host tab ${id} is listed ${shown} times`);
      if (!visible && shown !== 0) fail(`hidden host tab ${id} is listed`);
    }
  }
  c.dispose();
}

describe("controller invariants under random command sequences", () => {
  it.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i: 120 random commands keep every invariant", (seed) => {
    vi.useRealTimers();
    run(seed, 120);
  });
  // Sequences that once broke an invariant, kept as fixed cases:
  // 1003: a keyboard divider nudge saved a negative ratio when both sides' minimums exceeded the room;
  // 1298, 1327: a move whose target was hidden once the source left measured an undrawn node and threw.
  it.each([1003, 1298, 1327])("found by search, seed %i: 200 random commands keep every invariant", (seed) => {
    run(seed, 200);
  });
});
