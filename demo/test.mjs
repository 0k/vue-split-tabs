import assert from "node:assert/strict";
import { withBrowser, open, viewport, tab, state, expectState, point, drag, edge, reset, paneFor, nestedEdge } from "./browser.mjs";

const paneIntent = (id, tabs, active) => ({ kind: "pane", id, tabs, active });
const columnsIntent = (id, first, second) => ({ kind: "cut", id, orientation: "cols", ratio: 0.5, first, second });
async function seedReview(context, tree, opened = []) {
  await context.addInitScript(({ tree, opened }) => {
    localStorage.setItem("split-tabs.demo.fieldwork.v1", JSON.stringify({ entries: [{ key: "fieldwork", stamp: 1,
      intent: { tree, opened, firstActive: "notes", order: [], ratio: 0.5 } }] }));
  }, { tree, opened });
}

// Acceptance ledger: each named case below owns one user-visible contract.
const cases = [
  ["second review finding 3: absent nonoptional external registration applies the exact edge preview", async (page, context, origin) => {
    await seedReview(context, columnsIntent("hidden-outer", paneIntent("hidden-first", [], "absent"),
      paneIntent("target", ["notes", "log", "chart", "guide"], "notes")));
    await page.goto(`${origin}/?incoming=colors&active=notes`);
    await page.waitForSelector('[data-pane-id="target"]');
    // The root is wider than a pane minimum pair, but two resurrected branches would each be too narrow to split again.
    await page.setViewportSize({ width: 750, height: 800 });
    await page.waitForFunction(() => {
      const p = JSON.parse(document.querySelector("#layout-json").textContent).panes;
      return p.length === 1 && p[0].fits.cols && p[0].width < 900;
    });
    const before = await state(page);
    const box = await (await paneFor(page, "notes")).boundingBox();
    const half = (box.width - 6) / 2;
    await drag(page, page.getByRole("button", { name: "Drag Color study" }), await point(await paneFor(page, "notes"), 0.97, 0.55), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-zone="split"][data-orientation="cols"][data-side="end"]');
    const shade = await page.locator('.split-tabs-drop-shade').boundingBox();
    assert.ok(Math.abs(shade.width - half) <= 1, `Expected ${half}px half-pane preview, observed ${shade.width}`);
    assert.equal((await state(page)).registrations, 0, "Expected no host registration before pointer-up");
    await page.mouse.up();
    const after = await state(page);
    assert.deepEqual(after.panes.map(p => p.tabs), [before.panes[0].tabs, ["colors"]], "Expected the advertised new right pane, not default placement in resurrected first branch");
    assert.equal(after.panes[1].active, "colors", "Expected incoming tab revealed where previewed");
    assert.equal(after.registrations, 1, "Expected one registration on the valid drop");
    for (const p of await page.locator('[data-pane-id]').all()) {
      const rendered = await p.boundingBox();
      assert.ok(Math.abs(rendered.width - half) <= 1, `Expected preview-sized pane ${half}px, observed ${rendered.width}`);
    }
  }],
  ["review finding 2: closing the host-linked last secondary tab keeps the primary body visible", async (page, context, origin) => {
    await seedReview(context, columnsIntent("outer", paneIntent("first", [], "notes"), columnsIntent("inner",
      paneIntent("middle", ["checklist"], "checklist"), paneIntent("last", ["chart"], "chart"))), ["checklist"]);
    await page.goto(`${origin}/?active=checklist`);
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 3);
    await page.locator('[data-split-tabs-tab="checklist"]').hover();
    await page.locator('[data-split-tabs-tab="checklist"] .split-tab-strip-close').click();
    await expectState(page, { hostActive: "notes" }, "Closing a host-linked secondary pane must repair navigation");
    assert.equal((await state(page)).intent.firstActive, "notes");
    await page.getByRole("textbox", { name: "Notes draft" }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("active"), "notes", "Expected repaired host URL selection");
  }],
  ["review finding 3: an empty host request stays empty in the first rendered pane", async (page, context, origin) => {
    await seedReview(context, columnsIntent("outer", paneIntent("empty-first", [], ""),
      paneIntent("rendered-first", ["notes", "log", "chart", "guide"], "notes")));
    await page.goto(`${origin}/?active=`);
    await page.waitForSelector('.split-tab-strip-tab');
    let actual = await state(page);
    assert.equal(actual.panes[0].active, "", `Expected first rendered pane to preserve empty host selection, observed ${actual.panes[0].active}`);
    assert.equal(await page.locator('.split-tab-strip-tab[aria-pressed="true"]').count(), 0, "Expected no tab selected for an empty host request");
    await tab(page, "chart").click();
    actual = await state(page);
    assert.equal(actual.hostActive, "chart");
    assert.equal(actual.intent.firstActive, "chart");
  }],
  ["review finding 4: dropping the first pane into the last keeps promoted primary navigation", async (page, context, origin) => {
    await seedReview(context, columnsIntent("outer", paneIntent("first", [], "notes"), columnsIntent("inner",
      paneIntent("middle", ["log", "guide"], "log"), paneIntent("last", ["chart"], "chart"))));
    await page.goto(`${origin}/?active=log`);
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 3);
    await drag(page, tab(page, "notes"), await point(await paneFor(page, "chart"), 0.5, 0.55));
    const actual = await state(page);
    assert.equal(actual.hostActive, "log", `Expected promoted primary navigation log, observed ${actual.hostActive}`);
    assert.equal(actual.intent.firstActive, "log");
    assert.equal(actual.panes[0].active, "log");
    assert.equal(actual.panes[1].active, "notes");
  }],
  ["review finding 6: a recreated split never reuses a removed migrated pane id", async (page, context) => {
    await context.addInitScript(() => localStorage.setItem("split-tabs.demo.fieldwork.v1", JSON.stringify({ entries: [{
      key: "fieldwork", stamp: 1, intent: { orientation: "cols", second: ["chart"], secondActive: "chart", ratio: 0.5, firstActive: "notes" },
    }] })));
    await page.reload();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    const removed = (await state(page)).panes.find(p => p.tabs.includes("chart")).id;
    await drag(page, tab(page, "chart"), await point(await paneFor(page, "notes"), 0.5, 0.55));
    await expectState(page, { orientation: null }, "Move removes the migrated secondary pane");
    await edge(page, "chart", "cols");
    const created = (await state(page)).panes.find(p => p.tabs.includes("chart")).id;
    assert.notEqual(created, removed, `Expected a fresh pane id, observed reused ${created}`);
  }],
  ["review finding 1: dropping into a collapsed first pane survives storage validation and reload", async page => {
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "notes", "cols");
    await page.setViewportSize({ width: 850, height: 800 });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    await drag(page, tab(page, "chart"), await point(await paneFor(page, "notes"), 0.5, 0.55));
    const before = await state(page);
    await page.reload();
    await expectState(page, { intent: before.intent }, "Collapsed-pane drop must reload the same validated tree, not defaults");
  }],
  ["review finding 5: double-click equalizes only visible segments after an absent middle leaf", async (page, context) => {
    await context.addInitScript(() => localStorage.setItem("split-tabs.demo.fieldwork.v1", JSON.stringify({ entries: [{
      key: "fieldwork", stamp: 1, intent: { firstActive: "notes", order: [], opened: [], ratio: 0.4, tree: {
        kind: "cut", id: "outer", orientation: "cols", ratio: 0.4,
        first: { kind: "pane", id: "notes-pane", tabs: [], active: "notes" },
        second: { kind: "cut", id: "inner", orientation: "cols", ratio: 0.5,
          first: { kind: "pane", id: "absent-pane", tabs: ["absent"], active: "absent" },
          second: { kind: "pane", id: "chart-pane", tabs: ["chart"], active: "chart" } },
      } },
    }] })));
    await page.reload();
    await page.getByRole("separator").waitFor();
    assert.equal(await page.getByRole("separator").count(), 1, "Expected the empty branch's separator not to render");
    await page.getByRole("separator").dblclick();
    const widths = await page.locator("[data-pane-id]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `Expected equal visible panes within 1px, observed ${widths}`);
  }],
  ["selection, scrolling content, keyboard order and focus", async page => {
    await tab(page, "log").click();
    await page.locator(".activity").evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.locator(".activity").evaluate(el => el.scrollTop > 0), "Expected scrolling log, observed no scroll");
    await tab(page, "notes").focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    const actual = await state(page);
    assert.deepEqual(actual.panes[0].tabs.slice(0, 2), ["log", "notes"], "Expected Notes after Log; observed order differs");
    assert.equal(await tab(page, "notes").evaluate(el => el === document.activeElement), true, "Expected retained keyboard focus");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Notes draft" }).waitFor();
  }],
  ["mouse reorder preserves selection", async page => {
    await drag(page, tab(page, "chart"), await point(page.locator('[data-split-tabs-tab="notes"]'), 0.05));
    const actual = await state(page);
    assert.equal(actual.panes[0].tabs[0], "chart", `Expected Chart first, observed ${actual.panes[0].tabs}`);
    assert.equal(actual.panes[0].active, "notes", `Expected Notes selected, observed ${actual.panes[0].active}`);
  }],
  ["right and bottom edge splits, merge and direct split controls", async page => {
    for (const axis of ["cols", "rows"]) {
      await edge(page, "chart", axis);
      assert.equal((await state(page)).panes.length, 2, "Expected two panes after edge drop");
      await page.getByRole("button", { name: "Merge panes", exact: true }).click();
      await expectState(page, { orientation: null }, "Merge panes");
    }
    await page.locator('[data-split-tabs-tab="notes"]').hover();
    await page.locator('[data-split-tabs-tab="notes"] [data-orientation="cols"]').click();
    await expectState(page, { orientation: "cols" }, "Direct split button");
  }],
  ["Notes instance and draft survive pane move and collapse/restore", async page => {
    const notes = page.getByRole("textbox", { name: "Notes draft" });
    await notes.fill("A draft that must stay mounted.");
    await notes.evaluate(el => { el.dataset.instanceWitness = "original"; });
    await edge(page, "chart", "cols");
    const destination = page.locator("[data-split-tabs-pane]").filter({ has: tab(page, "chart") });
    await drag(page, tab(page, "notes"), await point(destination, 0.5, 0.6));
    await notes.waitFor();
    const moved = (await state(page)).panes.find(pane => pane.tabs.includes("chart"));
    assert.ok(moved.tabs.includes("notes"), `Expected Notes in Orbit's pane after drop, observed ${JSON.stringify(moved)}`);
    assert.equal(moved.active, "notes", `Expected dropped Notes revealed, observed ${moved.active}`);
    await page.setViewportSize({ width: 390, height: 720 });
    await expectState(page, { orientation: null }, "Small viewport collapses layout");
    await tab(page, "notes").click();
    assert.equal(await notes.inputValue(), "A draft that must stay mounted.", "Expected retained draft after collapse");
    await page.setViewportSize(viewport);
    await expectState(page, { orientation: "cols" }, "Wide viewport restores split");
    assert.equal(await notes.inputValue(), "A draft that must stay mounted.", "Expected retained draft after restore");
    assert.equal(await notes.getAttribute("data-instance-witness"), "original", "Expected original textarea, observed remount");
  }],
  ["divider pointer, keyboard and double-click centring", async page => {
    await edge(page, "chart", "cols");
    const divider = page.getByRole("separator", { name: "Resize panes" });
    const start = await point(divider);
    await drag(page, divider, { x: start.x + 70, y: start.y });
    let ratio = (await state(page)).intent.ratio;
    assert.ok(ratio > 0.55, `Expected ratio > .55 after pointer resize, observed ${ratio}`);
    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    assert.ok((await state(page)).intent.ratio < ratio, "Expected ArrowLeft to reduce ratio");
    await divider.dblclick();
    assert.equal((await state(page)).intent.ratio, 0.5, "Expected double click to centre divider");
    await divider.press("End");
    await divider.press("Enter");
    assert.equal((await state(page)).intent.ratio, 0.5, "Expected Enter to centre divider");
  }],
  ["optional menu, close, replacement, and persistence across reload", async page => {
    await page.getByRole("button", { name: "Open tab menu" }).click();
    await page.getByRole("menuitem", { name: "Checklist" }).click();
    await tab(page, "checklist").waitFor();
    await page.getByRole("button", { name: "Replace with Reference" }).click();
    assert.equal(await tab(page, "checklist").count(), 0, "Expected placeholder consumed by replacement");
    await page.locator('[data-split-tabs-tab="reference"] .split-tab-strip-close').click();
    assert.equal(await tab(page, "reference").count(), 0, "Expected optional Reference closed");
    await edge(page, "chart", "cols");
    const before = await state(page);
    await page.reload();
    await expectState(page, { intent: before.intent, panes: before.panes }, "Reload restores intent and panes");
  }],
  ["external handoff into strip and edge, cancellation does not open", async page => {
    const source = page.getByRole("button", { name: "Drag Color study" });
    const start = await point(source);
    const slot = await point(page.locator('[data-split-tabs-tab="log"]'), 0.05);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 3, start.y);
    assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 0, "Expected no ghost below host threshold");
    await page.mouse.move(slot.x, slot.y, { steps: 18 });
    await page.waitForSelector('.split-tab-strip-marker[data-before="log"]');
    await page.mouse.up();
    await tab(page, "colors").waitFor();
    assert.deepEqual((await state(page)).panes[0].tabs.slice(0, 3), ["notes", "colors", "log"], "Expected external tab at requested slot");
    const source2 = page.getByRole("button", { name: "Drag Reading list" });
    await drag(page, source2, await point(page.locator(".split-tabs"), 0.98, 0.5), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-orientation="cols"]');
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await tab(page, "reading").count(), 0, "Expected cancelled external id still hidden");
    await drag(page, source2, await point(page.locator(".split-tabs"), 0.98, 0.5));
    await expectState(page, { orientation: "cols" }, "External edge handoff creates split");
    await tab(page, "reading").waitFor();
  }],
  ["CDP touch long-press splits without native pointer cancellation", async (page, context) => {
    const start = await point(tab(page, "notes"));
    const end = await point(page.locator(".split-tabs"), 0.5, 0.98);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    await page.waitForSelector(".split-tab-strip-item--drag-armed");
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
        x: start.x + (end.x - start.x) * i / 12, y: start.y + (end.y - start.y) * i / 12, id: 1,
      }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await page.waitForSelector('.split-tabs-drop-shade[data-orientation="rows"]');
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expectState(page, { orientation: "rows" }, "Held touch drop splits vertically");
    await cdp.detach();
  }],
  ["per-pane split controls, drag-only setting, inspector and reset", async page => {
    await edge(page, "chart", "cols");
    await page.locator('[data-split-tabs-tab="notes"]').hover();
    await page.locator('[data-split-tabs-tab="notes"] [data-orientation="rows"]').click();
    const actual = await state(page);
    assert.equal(actual.panes.length, 3, `Expected nested split from per-pane control, observed ${JSON.stringify(actual.panes)}`);
    await page.getByLabel("Show split buttons").uncheck();
    assert.equal(await page.locator(".split-tab-strip-send").count(), 0, "Expected drag-only mode without split buttons");
    await page.getByText("Layout inspector", { exact: true }).click();
    assert.equal(await page.locator("#layout-json").isVisible(), true, "Expected expanded inspector visible");
    await reset(page);
    assert.deepEqual((await state(page)).panes[0].tabs, ["notes", "log", "chart", "guide"], "Expected initial tabs after reset");
  }],
  ["nested columns and mixed edges; equalize thirds and subtree resize clamps", async page => {
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "cols");
    const dividers = page.getByRole("separator");
    assert.equal(await dividers.count(), 2, "Expected two recursive separators");
    await dividers.nth(1).dblclick();
    const widths = await page.locator("[data-pane-id]").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, `Expected equal thirds within 2px, observed ${widths}`);
    const tree = (await state(page)).intent.tree;
    const outer = page.locator(`[data-cut="${tree.id}"]`);
    await outer.press("End");
    const handle = await point(outer);
    const root = await page.locator(".split-tabs").boundingBox();
    await drag(page, outer, { x: root.x + root.width - 1, y: handle.y });
    const min = await (await paneFor(page, "chart")).boundingBox();
    const last = await (await paneFor(page, "log")).boundingBox();
    assert.ok(min.width >= 224.9 && last.width >= 224.9, `Expected both inner panes >=225px, observed ${min.width},${last.width}`);
    assert.equal(await dividers.count(), 2, "Expected divider clamp not to fold inner split");
    await outer.press("Enter");
    const equal = await page.locator("[data-pane-id]").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    assert.ok(Math.max(...equal) - Math.min(...equal) <= 2, `Expected keyboard equalized thirds, observed ${equal}`);
    await reset(page);
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "rows");
    assert.deepEqual((await state(page)).panes.map(p => p.tabs), [["notes", "guide"], ["chart"], ["log"]]);
    assert.deepEqual(await dividers.evaluateAll(elements => elements.map(el => el.getAttribute("aria-orientation"))), ["vertical", "horizontal"]);
  }],
  ["nested inner-first collapse, exact restoration and reload persistence", async page => {
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "cols");
    await page.getByRole("separator").nth(1).dblclick();
    const before = await state(page);
    const saved = await page.evaluate(() => localStorage.getItem("split-tabs.demo.fieldwork.v1"));
    await page.setViewportSize({ width: 850, height: 800 });
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    assert.equal(await page.getByRole("separator").count(), 1, "Expected outer cut to survive inner collapse");
    assert.deepEqual((await state(page)).panes[1].tabs, ["log", "chart"], "Expected collapsed subtree custom order");
    assert.equal(await page.evaluate(() => localStorage.getItem("split-tabs.demo.fieldwork.v1")), saved, "Expected zero storage changes from size");
    await page.setViewportSize(viewport);
    await expectState(page, { intent: before.intent, panes: before.panes }, "Exact nested tree restoration");
    await page.reload();
    await expectState(page, { intent: before.intent, panes: before.panes }, "Nested tree reload");
  }],
  ["nested Notes instance and draft survive moves and collapse", async page => {
    const notes = page.getByRole("textbox", { name: "Notes draft" });
    await notes.fill("Recursive draft witness");
    await notes.evaluate(el => { el.dataset.instanceWitness = "nested-original"; });
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "rows");
    await drag(page, tab(page, "notes"), await point(await paneFor(page, "log"), 0.5, 0.55));
    await notes.waitFor();
    await page.setViewportSize({ width: 390, height: 720 });
    await expectState(page, { orientation: null }, "Collapse nested Notes layout");
    await tab(page, "notes").click();
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 3);
    assert.equal(await notes.inputValue(), "Recursive draft witness", "Expected draft retained through nested moves");
    assert.equal(await notes.getAttribute("data-instance-witness"), "nested-original", "Expected identical textarea instance");
    const padding = await notes.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
    assert.ok(padding >= 10, `Expected focus-outline inset padding >=10px, observed ${padding}`);
    await drag(page, tab(page, "log"), await point(await paneFor(page, "guide"), 0.5, 0.55));
    await drag(page, tab(page, "notes"), await point(await paneFor(page, "guide"), 0.5, 0.55));
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    assert.equal(await notes.inputValue(), "Recursive draft witness", "Expected draft after moving last nested tab");
    assert.equal(await notes.getAttribute("data-instance-witness"), "nested-original", "Expected identical instance after leaf removal");
  }],
  ["closing and moving last nested tabs promote the sibling", async page => {
    await edge(page, "chart", "cols");
    await nestedEdge(page, "Color study", "chart", "rows", true);
    const before = (await state(page)).intent.tree;
    await page.locator('[data-split-tabs-tab="colors"] .split-tab-strip-close').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    assert.equal((await state(page)).intent.tree.second.id, before.second.first.id, "Expected sibling leaf to replace nested cut");
    await nestedEdge(page, "log", "chart", "rows");
    await drag(page, tab(page, "log"), await point(await paneFor(page, "notes"), 0.5, 0.55));
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 2);
    assert.equal((await state(page)).intent.tree.second.kind, "pane", "Expected last-tab move to remove nested cut");
  }],
  ["legacy stored layout migrates before first render", async (page, context) => {
    await context.addInitScript(() => localStorage.setItem("split-tabs.demo.fieldwork.v1", JSON.stringify({ entries: [{
      key: "fieldwork", stamp: 20, intent: { orientation: "cols", second: ["chart"], secondActive: "chart", ratio: 0.6,
        firstActive: "notes", order: ["notes", "log", "chart", "guide"], opened: [] },
    }] })));
    await page.reload();
    await expectState(page, { orientation: "cols" }, "Migrated legacy split");
    const actual = await state(page);
    assert.equal(actual.intent.tree.kind, "cut");
    assert.equal(actual.intent.tree.ratio, 0.6);
    assert.deepEqual(actual.panes.map(p => p.tabs), [["notes", "log", "guide"], ["chart"]]);
  }],
];

let passed = 0;
try {
  await withBrowser(async (browser, origin) => {
    const selected = process.env.DEMO_CASE ? cases.filter(([name]) => name.includes(process.env.DEMO_CASE)) : cases;
    assert.ok(selected.length > 0, `Expected a matching demo case; observed filter ${process.env.DEMO_CASE}`);
    for (const [name, test] of selected) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
      let page;
      try {
        const fixture = await open(context, origin);
        page = fixture.page;
        await test(page, context, origin);
        assert.deepEqual(fixture.errors, [], "Expected no runtime errors or external requests");
        assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 0, "Expected no ghost after completed gesture");
        passed++;
        console.log(`PASS demo: ${name}`);
      } catch (error) {
        console.error(`FAIL demo: ${name}\nExpected scenario to complete; observed: ${error.stack}`);
        if (page) console.error("Observed layout:", JSON.stringify(await state(page)));
        throw error;
      } finally { await context.close(); }
    }
  });
  console.log(`Demo tests: ${passed} passed`);
} catch { process.exitCode = 1; }
