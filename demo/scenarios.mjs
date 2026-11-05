import assert from "node:assert/strict";
import { defaultKeymap } from "../dist/index.js";
import {
  tab, state, expectState, point, paneFor, reset, chord, cast, drag, select, startMouse,
  fourStart, touchEnd, touchMove, pinch, clean, focusShell,
} from "./browser.mjs";

const notation = async (page, value) => expectState(page, { notation: value });
async function beat(page, pause, text) { await cast(page, text); await pause(); }
async function one(page) {
  await reset(page);
  for (const view of ["2", "3", "4"]) {
    await page.frameLocator(`iframe[data-frame="${view}"]`).locator("#content").click();
    await chord(page, "X");
    await page.waitForFunction(view => !JSON.parse(document.querySelector("#layout-json").textContent).opened.includes(view), view);
  }
  await notation(page, "1");
  await page.getByRole("button", { name: "Dismiss undo", exact: true }).click();
  await focusShell(page);
}
async function next(page) { await chord(page, "T"); }

export const scenarios = [
  { name: "split", async run(page, _context, pause) {
    await one(page);
    await chord(page, "E"); await beat(page, pause, "Alt + Shift + E  /  split right");
    await chord(page, "O"); await beat(page, pause, "Alt + Shift + O  /  split below");
    await reset(page);
    const misaligned = (await paneFor(page, "2")).locator("xpath=ancestor::*[@data-split-tabs-cut][1]").locator(":scope > .split-tabs-divider");
    const offset = await point(misaligned);
    await dragDivider(page, misaligned, { x: offset.x, y: offset.y + 70 });
    const lower = await (await paneFor(page, "3")).boundingBox();
    const divider = (await paneFor(page, "2")).locator("xpath=ancestor::*[@data-split-tabs-cut][1]").locator(":scope > .split-tabs-divider");
    const p = await point(divider);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x, lower.y + 2, { steps: 10 });
    await page.waitForSelector(".split-tabs-guide");
    await beat(page, pause, "Drag divider  /  snap to parallel divider");
    await page.mouse.up();
    await one(page); await chord(page, "E"); await chord(page, "E");
    await page.getByRole("separator", { name: "Resize panes", exact: true }).last().dblclick();
    const widths = await page.locator("[data-pane-id]").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
    assert.ok(Math.max(...widths) - Math.min(...widths) < 2, `Equal thirds: ${widths}`);
    await beat(page, pause, "Double press divider  /  equal thirds");
  } },
  { name: "group", async run(page, _context, pause) {
    await select(page, ["2"]);
    await page.waitForSelector('.split-tabs-selection[data-kind="ok"]');
    await beat(page, pause, "Ctrl + Alt + Shift + click  /  select top row");
    await chord(page, "G"); await notation(page, "V[H[1 2] H[3 4]]");
    await beat(page, pause, "Alt + Shift + G  /  regroup the tree");
    await reset(page); await select(page, ["4"]);
    await page.waitForSelector('.split-tabs-selection[data-kind="refused"]');
    assert.equal(await page.locator(".split-tabs-selection").evaluate(el => getComputedStyle(el).borderTopColor), "rgb(255, 139, 145)");
    const before = (await state(page)).notation;
    await chord(page, "G"); await notation(page, before);
    assert.match(await page.locator("#status").textContent(), /rectangle/i);
    await beat(page, pause, "Diagonal selection  /  refused, no layout change");
  } },
  { name: "layout-tab", async run(page, _context, pause) {
    await select(page, ["2", "3", "4"]);
    assert.equal((await state(page)).selection.length, 4);
    await beat(page, pause, "Ctrl + Alt + Shift + clicks  /  select all four panes");
    await chord(page, "T"); await notation(page, "T{H[V[1 3] V[2 4]] | *5}");
    await beat(page, pause, "Alt + Shift + T  /  layout and new tab");
    await page.locator('[data-kind="layout"] .split-tab-strip-tab').click();
    assert.equal((await state(page)).panes.length, 4);
    await beat(page, pause, "Click layout tab  /  all four panes return");
  } },
  { name: "inner-tab", async run(page, _context, pause) {
    await one(page); await next(page); await chord(page, "I");
    await notation(page, "T{1 | *(5 *6)}");
    await beat(page, pause, "Alt + Shift + I  /  tabs inside the shown tab");
    await one(page); await next(page); await next(page);
    await drag(page, tab(page, "5"), await point(await paneFor(page, "6")), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-zone="inside"]');
    await beat(page, pause, "Drag to MIDDLE  /  new inner bar");
    await page.mouse.up(); await clean(page);
    await notation(page, "T{1 | *(6 *5)}");
    await drag(page, tab(page, "1"), await point(tab(page, "5"), 0.1), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-marker]');
    await beat(page, pause, "Drop on BAR  /  next to the other tabs");
    await page.mouse.up(); await clean(page);
    await notation(page, "(6 *1 5)"); await pause();
  } },
  { name: "drag", async run(page, _context, pause) {
    await one(page); await next(page); await next(page);
    await drag(page, tab(page, "5"), await point(await paneFor(page, "6"), 0.88, 0.5), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-side="right"]');
    await beat(page, pause, "Drag label to edge QUARTER  /  split pane");
    await page.mouse.up(); await clean(page);
    await drag(page, tab(page, "1"), await point(page.locator(".split-tabs"), 0.5, 0.006), false);
    await page.waitForSelector('.split-tabs-drop-shade[data-side="top"]');
    await beat(page, pause, "Drag to OUTER edge  /  split whole area");
    await page.mouse.up(); await clean(page);
    await one(page); await next(page); await next(page);
    await startMouse(page, tab(page, "5"));
    const p = await point(tab(page, "1")); await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.waitForSelector('[data-split-tabs-tab="1"].split-tab-strip-item--spring');
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes[0].view === "1");
    await beat(page, pause, "Rest on hidden tab  /  spring-loaded opening");
    await page.keyboard.press("Escape"); await page.mouse.up();
  } },
  { name: "bars", async run(page, _context, pause) {
    await one(page); await next(page);
    for (const side of ["left", "bottom", "right", "top"]) {
      await chord(page, "R");
      await page.waitForSelector(`.split-tab-strip[data-side="${side}"]:visible`);
      await beat(page, pause, `Alt + Shift + R  /  bar ${side}`);
      if (side === "left") {
        const handle = page.getByRole("separator", { name: "Resize side bar", exact: true });
        const p = await point(handle);
        await dragDivider(page, handle, { x: p.x + 52, y: p.y });
        await page.waitForFunction(() => document.querySelector('.split-tab-strip[data-side="left"]').getBoundingClientRect().width > 110);
        const width = await page.locator('.split-tab-strip[data-side="left"]').evaluate(el => el.getBoundingClientRect().width);
        assert.ok(width > 110, `Resized bar: ${width}`);
        await beat(page, pause, "Drag inner edge  /  resize left bar");
      }
    }
  } },
  { name: "zoom", async run(page, _context, pause) {
    const before = (await state(page)).notation;
    await beat(page, pause, "Focus pane 1");
    await chord(page, "Z"); await notation(page, "1");
    assert.notEqual((await state(page)).zoomed, null);
    await beat(page, pause, "Alt + Shift + Z  /  zoom");
    await chord(page, "Z"); await notation(page, before);
    await beat(page, pause, "Alt + Shift + Z  /  restore exact layout");
  } },
  { name: "close", async run(page, _context, pause) {
    await one(page); await next(page);
    const before = (await state(page)).notation;
    await startMouse(page, tab(page, "5"));
    const p = await point(page.locator("[data-split-tabs-bin]"));
    await page.mouse.move(p.x, p.y, { steps: 12 });
    await page.waitForSelector("[data-split-tabs-bin][data-hot]");
    await beat(page, pause, "Drag to bin  /  close view 5");
    await page.mouse.up(); await clean(page); await notation(page, "1");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await notation(page, before);
    await beat(page, pause, "Undo  /  restore closed view");
    await drag(page, tab(page, "5"), await point(await paneFor(page, "1"), 0.88, 0.5));
    const split = (await state(page)).notation;
    assert.notEqual(split, before, "The shown tab self-splits inside its existing bar");
    await page.waitForFunction(() => {
      const view = JSON.parse(document.querySelector("#layout-json").textContent).focusedView;
      const frame = document.querySelector(`iframe[data-frame="${view}"]`);
      return frame?.contentWindow.ready && document.activeElement === frame;
    });
    await beat(page, pause, "Drop shown tab on its own edge  /  split inside its bar");
    await chord(page, "X"); await notation(page, before);
    await beat(page, pause, "Alt + Shift + X  /  close focused pane");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await notation(page, split); await pause();
  } },
  { name: "keyboard", async run(page, _context, pause) {
    for (const [key, view] of [["L", "2"], ["J", "4"], ["H", "3"], ["K", "1"]]) {
      await chord(page, key);
      // The keyboard follows the focus into pane iframes: the next chord reaches the layout one message later.
      await page.waitForFunction(v => JSON.parse(document.querySelector("#layout-json").textContent).focusedView === v, view);
      await page.waitForFunction(() => document.querySelector(".split-tabs-focus")?.getAttribute("data-pane-of")
        === JSON.parse(document.querySelector("#layout-json").textContent).focus);
      await beat(page, pause, `Alt + Shift + ${key}  /  focus pane ${view}`);
    }
    await chord(page, "M"); await page.waitForSelector('.split-tabs-pane-number[data-mode="letter"]');
    assert.equal(await page.locator(".split-tabs-pane-number").first().evaluate(el => getComputedStyle(el).alignItems), "flex-end");
    await beat(page, pause, "Alt + Shift + M  /  select by letter");
    await page.keyboard.press("c");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).selection.length === 2);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".split-tabs-pane-number"));
    await page.keyboard.press("Escape");
    await chord(page, "V"); await page.keyboard.press("c");
    await page.waitForSelector(".split-tabs-destination");
    await beat(page, pause, "Alt + Shift + V, c  /  choose destination");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).notation !== "H[V[1 3] V[2 4]]");
    await beat(page, pause, "Right arrow  /  move beside destination");
  } },
  { name: "touch", async run(page, context, pause) {
    const cdp = await context.newCDPSession(page);
    try {
      const center = await point(await paneFor(page, "1"));
      await fourStart(cdp, center);
      await page.waitForSelector(".split-tabs--arranging");
      await touchEnd(cdp);
      await page.waitForSelector(".arrange-toolbar");
      await page.waitForSelector(".split-tabs-nest");
      await beat(page, pause, "Four-finger hold  /  arrange mode");
      const cover = (await paneFor(page, "1")).locator(".split-tabs-pane-cover");
      const p = await point(cover);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
      await touchEnd(cdp); await expectState(page, { selection: [(await state(page)).focus] });
      await beat(page, pause, "Tap  /  select pane");
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      const start = await point((await paneFor(page, "1")).locator(".split-tabs-pane-cover"));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
      await touchMove(page, cdp, start, await point(await paneFor(page, "2"), 0.5, 0.88));
      await page.waitForSelector(".split-tabs-drop-shade:not([data-refused])");
      await beat(page, pause, "One-finger drag  /  move pane");
      await touchEnd(cdp);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
      await clean(page);
      await pinch(page, cdp, await point(await paneFor(page, "1")), 25, 58);
      await page.waitForSelector(".split-tabs--zoomed");
      await beat(page, pause, "Four-finger pinch OUT  /  zoom");
      await pinch(page, cdp, await point(await paneFor(page, "1")), 60, 24);
      await page.waitForFunction(() => !document.querySelector(".split-tabs--zoomed"));
      await beat(page, pause, "Four-finger pinch IN  /  restore");
    } finally { await cdp.detach(); }
  } },
];

async function dragDivider(page, locator, destination) {
  const start = await point(locator);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 }); await page.mouse.up();
}
export const extraCases = [
  { name: "initial layout and host content", async run(page) {
    await notation(page, "H[V[1 3] V[2 4]]");
    assert.equal(await page.locator("#keys li").count(), Object.keys(defaultKeymap).length + 1);
    assert.equal(await page.locator("#keys li").first().innerText(), "Escape / Ctrl+G / Ctrl+D\nExit mode");
    assert.equal(await page.locator(".split-tab-strip:visible").count(), 0, "Single-view bars stay hidden");
    await chord(page, "E");
    assert.ok((await state(page)).opened.includes("5"), "Placeholder replaced by registered closable host view");
    assert.equal((await state(page)).notation.includes("new:"), false);
  } },
  { name: "iframe keys and identity", async run(page) {
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
    await page.evaluate(() => { window.witness = document.querySelector('iframe[data-frame="1"]').contentWindow.marker; });
    await page.frameLocator('iframe[data-frame="1"]').locator("#content").click();
    await chord(page, "E");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 5);
    await chord(page, "Z"); await chord(page, "Z");
    assert.equal(await page.evaluate(() => document.querySelector('iframe[data-frame="1"]').contentWindow.marker === window.witness), true);
  } },
];
