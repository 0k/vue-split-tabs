import assert from "node:assert/strict";
import { runCases, grid, point, pane, chord, clean, ready, touchStart, touchMove, touchEnd, fourStart, pinch } from "./browser-lib.mjs";

// Actions use native Playwright input, never dispatchEvent/controller commands.
// grid() alone constructs start states through the shared acceptance fixture helper.
const KEYS = ["KeyE", "KeyO", "KeyT", "KeyI", "KeyG", "KeyR", "KeyZ", "KeyX", "KeyU", "BracketLeft", "BracketRight",
  "Equal", "Comma", "Period", "KeyH", "KeyJ", "KeyK", "KeyL", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA",
  ...["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyH", "KeyJ", "KeyK", "KeyL"].map(k => `Control+${k}`), "Escape"];
const KINDS = ["click", "chordClick", "paneDrag", "labelClick", "labelDrag", "menu", "key", "select", "move",
  "divider", "double", "barResize", "alwaysShow", "resize"];
const ZONES = [[0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88], [0.5, 0.5]];
const SIZES = [[1000, 700], [360, 500], [240, 320], [1280, 900], [640, 480]];
const coverage = new Map();
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
const sample = (random, values) => values[Math.floor(random() * values.length)];
const count = name => coverage.set(name, (coverage.get(name) ?? 0) + 1);
const rectPoint = (r, x = 0.5, y = 0.5) => ({ x: r.x + x * r.width, y: r.y + y * r.height });

// Poll both geometry and asynchronous frame-helper messages. Two animation frames
// provide a render opportunity, not a fixed sleep or a substitute for assertions.
async function rendered(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
function domInvariant({ keyboard = false } = {}) {
  const c = window.controller, failures = [];
  const all = selector => [...document.querySelectorAll(selector)];
  const visible = el => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const pane = id => all("[data-pane-id]").find(el => el.dataset.paneId === id);
  const match = (a, b, name) => {
    if (!a || !b) { failures.push(`${name}: missing element`); return; }
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    if (["left", "top", "width", "height"].some(k => Math.abs(x[k] - y[k]) > 1)) {
      failures.push(`${name}: ${JSON.stringify(x.toJSON())} != ${JSON.stringify(y.toJSON())}`);
    }
  };
  const panes = all("[data-pane-id]");
  if (panes.length !== c.panes.value.length || panes.length === 0) failures.push("pane count");
  for (const keep of all(".split-tabs-keep--overlay").filter(visible)) {
    const p = c.panes.value.find(p => p.view === keep.dataset.splitTabsKeep);
    match(keep, pane(p?.id)?.querySelector(".split-tabs-anchor"), `anchorRect ${keep.dataset.splitTabsKeep}`);
  }
  for (const strip of all(".split-tab-strip").filter(visible)) {
    const r = strip.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Offscreen content is clipped by the viewport, not covered by another layer.
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const hit = document.elementsFromPoint(x, y).find(el => getComputedStyle(el).pointerEvents !== "none");
    if (!hit || !strip.contains(hit)) failures.push(`stripHit ${strip.dataset.tabSet}: ${hit?.outerHTML.slice(0, 240)}`);
  }
  const focus = all(".split-tabs-focus");
  if (focus.length !== (panes.length >= 2 ? 1 : 0)) failures.push("focus mark count");
  if (focus.length) {
    if (focus[0].dataset.paneOf !== c.focus.value) failures.push("focus mark id");
    match(focus[0], pane(c.focus.value), "focus rect");
  }
  const selected = all(".split-tabs-selected-mark");
  if (JSON.stringify(selected.map(el => el.dataset.paneOf).sort()) !== JSON.stringify([...c.selection.value].sort())) failures.push("selection set");
  for (const mark of selected) match(mark, pane(mark.dataset.paneOf), "selection rect");
  if (keyboard) {
    const p = c.panes.value.find(p => p.id === c.focus.value);
    const keep = all("[data-split-tabs-keep]").find(el => el.dataset.splitTabsKeep === p?.view && visible(el));
    const active = document.activeElement;
    if (!pane(c.focus.value)?.contains(active) && !keep?.contains(active)) failures.push(`keyboard: ${active?.outerHTML.slice(0, 240)}`);
  }
  if (document.querySelector(".split-tabs--dragging,.split-tabs--resizing,.split-tabs-drag-ghost,.split-tabs-drop-shade")) failures.push("stuck drag");
  if (!window.listenersAtRest()) failures.push(`idle listeners: ${window.listenerSnapshot().map(l => l.type)}`);
  // Hidden single-tab strips still represent a rendered bar. A hidden layout tab
  // stands for all its views; an ACTIVE layout tab's views are counted in its child bars.
  const listed = [];
  for (const strip of all(".split-tab-strip[data-tab-set]")) {
    const id = strip.dataset.tabSet, bar = c.tabSet(id);
    if (!bar) { failures.push(`unknown bar ${id}`); continue; }
    const keys = [...strip.querySelectorAll(":scope > [data-split-tabs-tab]")].map(el => el.dataset.splitTabsTab);
    if (JSON.stringify(keys) !== JSON.stringify([...bar.tabs])) failures.push(`rendered tabs ${id}`);
    const frame = c.frames.value.find(f => f.id === id);
    for (const key of keys) if (!frame || key !== frame.active) listed.push(...(c.describe(key)?.views ?? []));
  }
  if (c.zoomed.value === null) {
    for (const id of ["a", "b", "c", "d"]) {
      const expected = id !== "d" || c.opened.value.includes(id) ? 1 : 0;
      if (listed.filter(v => v === id).length !== expected) failures.push(`listed ${id}: ${JSON.stringify(listed)}`);
    }
    if (new Set(listed).size !== listed.length) failures.push("duplicate listed view");
  }
  return failures;
}
async function roundTrip(page) {
  const result = await page.evaluate(async () => {
    const { createSplitTabsController, notation } = await import("/dist/index.js");
    const c = window.controller, intent = JSON.parse(JSON.stringify(c.intent.value));
    const stored = localStorage.getItem("browser-layouts");
    const validate = (data, active) => {
      const copy = createSplitTabsController({ tabs: ["a", "b", "c", "d"], optional: ["d"], entryKey: "browser",
        storageKey: "browser-layouts", placeholderPrefix: "new:", minPaneWidth: 100, minPaneHeight: 80,
        active, storage: { getItem: () => data, setItem() {}, removeItem() {} } });
      return copy;
    };
    const raw = JSON.stringify({ entries: [{ key: "browser", stamp: 1, intent }] });
    const focused = c.panes.value.find(p => p.id === c.focus.value)?.view ?? "";
    const copy = validate(raw, { get: () => focused, set() {} });
    try {
      if (JSON.stringify(copy.intent.value) !== JSON.stringify(intent)) return "intent rejected/changed on reload";
      const root = document.querySelector(".split-tabs");
      copy.setContainerSize(root.clientWidth, root.clientHeight);
      if (notation(copy.intent.value.tree) !== notation(intent.tree)) return "saved tree notation changed";
      // Zoom is deliberately not persisted. A host's current active view restores
      // memory-only keyboard focus too (important when the viewport has collapsed).
      if (c.zoomed.value === null && copy.notation.value !== c.notation.value) return "rendered notation changed on reload";
      if (stored !== null) {
        const saved = JSON.parse(stored).entries.find(e => e.key === "browser");
        const savedCopy = validate(stored);
        try {
          if (!saved || JSON.stringify(savedCopy.intent.value) !== JSON.stringify(saved.intent)) return "stored intent rejected";
        } finally { savedCopy.dispose(); }
      }
      return null;
    } finally { copy.dispose(); }
  });
  assert.equal(result, null, result ?? "roundTrip");
}
async function invariants(page, errors, keyboard = false) {
  await rendered(page);
  try { await page.waitForFunction(arg => window.randomInvariant(arg).length === 0, { keyboard }, { timeout: 1800, polling: "raf" }); }
  catch (cause) { throw new Error(JSON.stringify(await page.evaluate(arg => window.randomInvariant(arg), { keyboard })), { cause }); }
  assert.deepEqual(errors, [], "console/page errors");
  await clean(page);
  await roundTrip(page);
}
async function targets(page) {
  return page.evaluate(() => {
    const collect = selector => [...document.querySelectorAll(selector)].flatMap(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).display === "none") return [];
      // Use in-viewport targets, never Playwright auto-scrolling a different point under a held pointer.
      if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight) return [];
      return [{ x: r.x, y: r.y, width: r.width, height: r.height, id: el.dataset.paneId ?? el.closest("[data-split-tabs-tab]")?.dataset.splitTabsTab,
        axis: el.getAttribute("aria-orientation") }];
    });
    return { panes: collect("[data-pane-id]"), labels: collect(".split-tab-strip-tab"), strips: collect(".split-tab-strip"),
      dividers: collect(".split-tabs-divider"), edges: collect(".split-tab-strip-resize"), root: collect(".split-tabs")[0],
      frames: [...document.querySelectorAll("iframe[data-frame]")].filter(el => el.getBoundingClientRect().width > 0 &&
        getComputedStyle(el.parentElement).display !== "none").map(el => el.dataset.frame) };
  });
}
async function keyboardAt(page, source, t) {
  if (source === "iframe" && t.frames.length) {
    const p = await point(page.locator(`iframe[data-frame="${t.frames[0]}"]`));
    await page.mouse.click(p.x, p.y);
  } else if (source === "foreign") await page.frameLocator("#foreign").locator("#outside").click();
  else await page.locator("#shell-focus").click();
  await rendered(page);
}
async function modifiers(page, ctrl, work) {
  const keys = ctrl ? ["Control", "Alt", "Shift"] : ["Alt", "Shift"];
  for (const key of keys) await page.keyboard.down(key);
  try { await work(); } finally { for (const key of [...keys].reverse()) await page.keyboard.up(key); }
}
async function act(page, cdp, a, ctrl) {
  const before = await page.evaluate(() => window.controller.focus.value);
  const arranging = await page.locator(".split-tabs--arranging").count() > 0;
  const click = p => page.mouse.click(p.x, p.y);
  const drag = async () => {
    await page.mouse.move(a.from.x, a.from.y);
    await page.mouse.down();
    try {
      await page.mouse.move(a.from.x + 9, a.from.y, { steps: 2 });
      await page.mouse.move(a.to.x, a.to.y, { steps: 4 });
    } finally { await page.mouse.up(); }
  };
  switch (a.kind) {
    case "click": await click(a.from); break;
    case "chordClick": await modifiers(page, ctrl, () => click(a.from)); break;
    case "paneDrag": await modifiers(page, ctrl, drag); break;
    case "labelClick": await click(a.from); break;
    case "labelDrag": await drag(); break;
    case "menu": {
      await page.mouse.click(a.from.x, a.from.y, { button: "right" });
      await rendered(page);
      const items = page.locator('[role="menuitem"]:enabled');
      const n = await items.count();
      if (n) {
        a.chosen = await items.nth(a.item % n).getAttribute("data-menu-item");
        await items.nth(a.item % n).click();
      }
      // A move menu item deliberately leaves a picker active, until real Escape.
      await page.keyboard.press("Escape");
      break;
    }
    case "key": await page.keyboard.press(a.key); break;
    case "select":
    case "move":
      await chord(page, a.kind === "select" ? "M" : "V");
      await page.waitForSelector('.split-tabs-pane-number[data-mode="letter"]');
      await page.keyboard.press(a.letter);
      if (a.kind === "move" && a.widen) await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press(a.end);
      await rendered(page);
      // An invalid move is allowed to keep the picker; end the compound action.
      if (await page.locator(".split-tabs--picking").count()) await page.keyboard.press("Escape");
      break;
    case "divider":
    case "barResize": await drag(); break;
    case "double": await page.mouse.dblclick(a.from.x, a.from.y); break;
    case "alwaysShow": await page.evaluate(value => { window.fixture.alwaysShow = value; }, a.value); break;
    case "resize":
      await page.setViewportSize({ width: a.size[0], height: a.size[1] });
      // The shared fixture is fixed-size for acceptance screenshots; fit its host
      // to the actual viewport here so small viewports exercise controller collapse.
      await page.locator("#host").evaluate((el, size) => {
        el.style.width = `${Math.min(800, size[0] - 40)}px`;
        el.style.height = `${Math.min(560, size[1] - 110)}px`;
      }, a.size);
      break;
    case "touchLabel": {
      const locator = page.locator(`[data-split-tabs-tab="${a.id}"] .split-tab-strip-tab`);
      const start = await touchStart(page, cdp, locator);
      try { await touchMove(page, cdp, start, a.to); } finally { await touchEnd(page, cdp); }
      break;
    }
    case "hold":
      a.arranging = await page.locator(".split-tabs--arranging").count() > 0;
      await fourStart(cdp, a.from, 15);
      await page.waitForFunction(before => !!document.querySelector(".split-tabs--arranging") !== before, a.arranging);
      await touchEnd(page, cdp);
      break;
    case "pinchOut": await pinch(page, cdp, a.from, 12, 40); break;
    case "pinchIn": await pinch(page, cdp, a.from, 40, 12); break;
    case "invalid": await page.mouse.click(5, 5); break;
    default: throw new Error(`Unknown action ${a.kind}`);
  }
  await rendered(page);
  // Arrange swallows layout chords; Enter can still activate a label without handing typing to pane content.
  return !arranging && ["key", "move", "select"].includes(a.kind) && before !== await page.evaluate(() => window.controller.focus.value);
}
function action(random, t, cdp) {
  const kinds = cdp ? [...KINDS, "touchLabel", "hold", "pinchOut", "pinchIn"] : KINDS;
  const kind = sample(random, kinds), fromPane = sample(random, t.panes), fromLabel = sample(random, t.labels);
  const dest = sample(random, t.panes), zone = Math.floor(random() * 7);
  const to = zone < 5 && dest ? rectPoint(dest, ...ZONES[zone]) : zone === 5 && t.strips.length
    ? rectPoint(sample(random, t.strips), 0.7) : t.root ? rectPoint(t.root, 0.995) : { x: 5, y: 5 };
  const a = { kind, source: sample(random, ["page", "iframe", "foreign"]), to, zone };
  if (["click", "chordClick", "paneDrag", "hold", "pinchOut", "pinchIn"].includes(kind)) a.from = fromPane && rectPoint(fromPane);
  if (["labelClick", "labelDrag", "menu", "touchLabel"].includes(kind)) {
    a.from = fromLabel && rectPoint(fromLabel); a.id = fromLabel?.id; a.item = Math.floor(random() * 20);
  }
  if (["divider", "double", "barResize"].includes(kind)) {
    const target = sample(random, kind === "barResize" ? t.edges : t.dividers);
    a.from = target && rectPoint(target);
    if (a.from) a.to = { x: a.from.x + (target.axis === "horizontal" ? 0 : sample(random, [-70, 40, 100])),
      y: a.from.y + (target.axis === "horizontal" ? sample(random, [-60, 50, 90]) : 0) };
  }
  if (kind === "key") { a.key = sample(random, KEYS); if (a.key !== "Escape") a.key = `Alt+Shift+${a.key}`; }
  if (["select", "move", "key"].includes(kind) && a.source === "foreign") a.source = "page";
  if (kind === "select" || kind === "move") {
    a.letter = sample(random, ["a", "b", "c", "d", "z"]);
    a.end = sample(random, kind === "select" ? ["Enter", "Escape"] : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape"]);
    a.widen = random() < 0.3;
  }
  if (kind === "alwaysShow") a.value = random() < 0.5;
  if (kind === "resize") a.size = sample(random, SIZES);
  if (!["key", "select", "move", "alwaysShow", "resize"].includes(kind) && !a.from) a.kind = "invalid";
  return a;
}

// Fixed regressions discovered by this browser search belong here as concrete
// action lists, independent of later generator changes. Mouse/keyboard cases run
// on both engines; native CDP touch cases run on Chromium (WebKit has no CDP).
const regressions = [["random regression seed 1: arrange covers never cover tab strips", async (page, _cdp, { errors }) => {
  await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
  await page.locator("#shell-focus").click();
  await chord(page, "A");
  await invariants(page, errors);
  await chord(page, "A");
}], ["random regression seed 9: keyboard move hands typing to the destination pane", async (page, _cdp, { errors }) => {
  await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
  await grid(page);
  await page.locator("#shell-focus").click();
  assert.equal(await act(page, null, { kind: "move", letter: "c", end: "Enter" }, false), true);
  await invariants(page, errors, true);
}]];
regressions.push(["random regression seed 11: four-finger hold after pinch removes the old pane", async (page, cdp, { errors }) => {
  await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
  await page.locator("#shell-focus").click();
  await chord(page, "E");
  await pinch(page, cdp, await point(await pane(page, "new:1")), 12, 40);
  await page.waitForFunction(() => window.controller.zoomed.value !== null);
  await act(page, cdp, { kind: "hold", from: await point(await pane(page, "new:1")) }, false);
  await invariants(page, errors);
}, "?paneSlot=1", { cdp: true }]);
regressions.push(["random regression seed 15: fourth finger cannot restart the canceled pane press", async (page, cdp, { errors }) => {
  await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
  await page.locator("#shell-focus").click();
  await chord(page, "A");
  await act(page, cdp, { kind: "hold", from: await point(await pane(page, "a")) }, false);
  await invariants(page, errors);
}, "", { cdp: true }]);
regressions.push(["random regression seed 7: a fresh iframe hold discards the removed cover's fingers", async (page, cdp, { errors }) => {
  await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
  await page.locator("#shell-focus").click();
  await chord(page, "A");
  const from = await point(await pane(page, "a"));
  await act(page, cdp, { kind: "hold", from }, false);
  await act(page, cdp, { kind: "hold", from }, false);
  await invariants(page, errors);
}, "", { cdp: true }]);
const keyMatrix = ["page", "iframe"].map(source => [`keymap matrix from ${source}`, async (page, _cdp, { engine, errors }) => {
  for (const code of [...KEYS, "KeyM", "KeyV"]) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(page.url());
    await ready(page);
    await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
    const t = await targets(page);
    await keyboardAt(page, source, t);
    if (source === "iframe") assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME");
    const kind = code === "KeyM" ? "select" : code === "KeyV" ? "move" : "key";
    const a = { kind, key: code === "Escape" ? code : `Alt+Shift+${code}`, letter: "a", end: "Enter" };
    await invariants(page, errors, await act(page, null, a, false));
    count(`${engine}:${source}:${code}`);
  }
}]);
const seeds = Number(process.env.BROWSER_RANDOM_SEEDS ?? 16);
const steps = Number(process.env.BROWSER_RANDOM_STEPS ?? 24);
const first = Number(process.env.BROWSER_SEED ?? process.env.BROWSER_RANDOM_START ?? 1);
const workers = Number(process.env.BROWSER_RANDOM_WORKERS ?? 2);
assert.ok(Number.isSafeInteger(seeds) && seeds > 0 && Number.isSafeInteger(steps) && steps > 0 && Number.isSafeInteger(first));
assert.ok(Number.isSafeInteger(workers) && workers >= 1 && workers <= 16, "BROWSER_RANDOM_WORKERS must be 1..16");
const cases = Array.from({ length: process.env.BROWSER_SEED ? 1 : seeds }, (_, i) => first + i).map(seed => {
  const ctrl = seed % 2 === 0, slot = Math.floor((seed - 1) / 2) % 2 === 1, start = Math.floor((seed - 1) / 4) % 4;
  const query = `?chords=${ctrl ? "ctrl" : "default"}&paneSlot=${slot ? 1 : 0}`;
  return [`random seed ${seed}`, async (page, cdp, { engine, errors }) => {
    const random = rng(seed), log = [];
    await page.evaluate(fn => { window.randomInvariant = (0, eval)(`(${fn})`); }, domInvariant.toString());
    await page.evaluate(() => {
      window.randomTouches = [];
      for (const type of ["touchstart", "touchend", "touchcancel", "pointercancel"]) window.addEventListener(type, e => {
        window.randomTouches.push([type, e.touches?.length, e.pointerId, e.target.className]);
      }, true);
    });
    try {
      if (start === 1 || start === 2) await grid(page);
      if (start === 2) {
        await page.locator("#shell-focus").click();
        const b = await point(await pane(page, "b"));
        await modifiers(page, ctrl, () => page.mouse.click(b.x, b.y));
        await chord(page, "T");
      }
      if (start === 3) { await page.locator("#shell-focus").click(); await chord(page, "R"); }
      if (slot) await page.evaluate(() => { window.fixture.alwaysShow = true; });
      await invariants(page, errors);
      for (let step = 0; step < steps; step++) {
        const t = await targets(page), a = action(random, t, cdp);
        log.push(a);
        if (["chordClick", "paneDrag", "key", "select", "move"].includes(a.kind)) await keyboardAt(page, a.source, t);
        const keyboard = await act(page, cdp, a, ctrl);
        await invariants(page, errors, keyboard);
        count(`${engine}:${a.kind}${a.key ? `:${a.key}` : ""}`);
      }
    } catch (cause) {
      throw new Error(`engine=${engine} seed=${seed} step=${log.length - 1} start=${start} query=${query}\n` +
        `Replay: BROWSER_SEED=${seed} BROWSER_RANDOM_STEPS=${steps} node test/browser-random.mjs\nActions: ${JSON.stringify(log)}\n` +
        `Touch: ${JSON.stringify(await page.evaluate(() => ({ events: window.randomTouches, scale: visualViewport.scale })))}`, { cause });
    }
  }, query, { touch: true }];
});
const started = performance.now();
await runCases([...regressions, ...(process.env.BROWSER_SEED ? [] : keyMatrix), ...cases],
  { workers });
console.log(`Random browser runtime: ${((performance.now() - started) / 1000).toFixed(1)}s; ${JSON.stringify(Object.fromEntries(coverage))}`);
