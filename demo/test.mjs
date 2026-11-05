import assert from "node:assert/strict";
import { withBrowser, open, viewport, state, clean, point, paneFor, select, fourStart, touchEnd,
  chord, reset, focusShell, expectState } from "./browser.mjs";
import { scenarios, extraCases } from "./scenarios.mjs";

const frame = (page, id) => page.frameLocator(`iframe[data-frame="${id}"]`);
const logs = page => page.locator("iframe").evaluateAll(nodes => nodes.map(node => node.contentDocument.querySelector("#event-log")?.textContent));
const types = (page, id) => frame(page, id).locator("#event-log li").evaluateAll(nodes => nodes.map(node => node.dataset.type));
const received = [
  { name: "close waits for a new pane's iframe to load before its layout key", async run(page, context) {
    await context.route("**/pane.html?n=6", async route => {
      // Inject navigation latency: keys sent to the initial blank document cannot reach the frame helper.
      await page.waitForTimeout(250);
      await route.continue();
    });
    await scenarios.find(test => test.name === "close").run(page, context, async () => {});
  } },
  { name: "rename label inline and through menu", async run(page) {
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("always");
    const label = page.locator('[data-split-tabs-tab="1"] .split-tab-strip-tab');
    await label.dblclick();
    const editor = page.getByRole("textbox", { name: "Tab name", exact: true });
    await editor.fill("My workspace");
    await editor.press("Enter");
    assert.equal(await label.textContent(), "My workspace");
    await label.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await editor.fill("Renamed from menu");
    await editor.press("Enter");
    assert.equal(await label.textContent(), "Renamed from menu");
  } },
  { name: "iframe ordered mouse events", async run(page) {
    const before = await logs(page);
    await frame(page, "2").locator("#content").click();
    const events = (await types(page, "2")).filter(type => ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].includes(type));
    assert.deepEqual(events, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    const after = await logs(page);
    for (const index of [0, 2, 3]) assert.equal(after[index], before[index], `Other pane ${index + 1} unchanged`);
    assert.match(await frame(page, "2").locator("#log-title").textContent(), /Pane 2/);
  } },
  { name: "iframe keyboard receiver and focus", async run(page) {
    await frame(page, "3").locator("#content").click();
    const before = await logs(page);
    await page.keyboard.press("KeyQ");
    assert.match(await frame(page, "3").locator("#event-log").textContent(), /keydown.*KeyQ.*keyup.*KeyQ/s);
    assert.equal(await frame(page, "3").locator("#keyboard").textContent(), "keyboard: here");
    assert.equal(await frame(page, "3").locator("body").getAttribute("data-key-flash"), "");
    const after = await logs(page);
    for (const index of [0, 1, 3]) assert.equal(after[index], before[index]);
    await focusShell(page);
    assert.equal(await frame(page, "3").locator("#keyboard").textContent(), "keyboard: elsewhere");
    assert.ok((await types(page, "3")).includes("blur"));
  } },
  { name: "iframe two-finger pinch and browser cancellation", async run(page, context) {
    const cdp = await context.newCDPSession(page);
    try {
      const center = await point(page.locator('iframe[data-frame="2"]'));
      const points = spread => [-1, 1].map((sign, i) => ({ id: i + 1, x: center.x + sign * spread, y: center.y }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(15) });
      for (const spread of [25, 40, 55]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(spread) });
      await touchEnd(cdp);
      const meter = await frame(page, "2").locator("#meter").textContent();
      assert.match(meter, /2 fingers.*pinch.*\d+ ms/s);
      assert.match(meter, /events: pointer \d+ · touch [1-9]/);
      if ((await types(page, "2")).some(type => type === "pointercancel" || type === "touchcancel")) {
        assert.match(meter, /cancelled by the browser \(it took over: scroll\/zoom\)/);
      }
    } finally { await cdp.detach(); }
  } },
  { name: "iframe four-finger hold claim persistence", async run(page, context) {
    const cdp = await context.newCDPSession(page);
    try {
      await fourStart(cdp, await point(await paneFor(page, "1")));
      await page.waitForSelector(".split-tabs--arranging");
      const meter = frame(page, "1").locator("#meter");
      await meter.getByText("claimed by the shell", { exact: false }).waitFor();
      await touchEnd(cdp);
      await page.waitForTimeout(1500);
      assert.match(await meter.textContent(), /claimed by the shell \(this pane received it anyway\)/);
      assert.match(await meter.textContent(), /4-finger hold/);
      // Arrange isolation still owns page touches after the gesture ends (2026-11-09 decision).
      assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("touchmove", { cancelable: true }))), true);
      await page.keyboard.press("Escape");
      await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
    } finally { await cdp.detach(); }
  } },
  { name: "iframe log visibility and folding", async run(page) {
    const content = frame(page, "2").locator("#content");
    await content.hover();
    const p = await point(content);
    for (let i = 1; i <= 5; i++) await page.mouse.move(p.x + i, p.y);
    assert.match(await frame(page, "2").locator("#event-log").textContent(), /pointermove ×/);
    await page.getByLabel("Event logs", { exact: true }).uncheck();
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentDocument.querySelector("#event-panel").hidden));
    await reset(page);
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
    assert.equal(await frame(page, "1").locator("#event-panel").isVisible(), false);
    await page.getByLabel("Event logs", { exact: true }).check();
    await frame(page, "1").locator("#event-panel").waitFor({ state: "visible" });
  } },
  { name: "iframe gesture vocabulary and event details", async run(page) {
    const iframe = page.frames().find(candidate => candidate.url().endsWith("pane.html?n=2"));
    assert.ok(iframe);
    async function gesture(fingers, dx, hold = false, cancel = false) {
      await iframe.evaluate(({ fingers, dx }) => {
        const points = Array.from({ length: fingers }, (_, identifier) => new Touch({
          identifier, target: document.querySelector("#content"), clientX: 30 + identifier * 20, clientY: 30,
        }));
        window.gesturePoints = points;
        window.dispatchEvent(new TouchEvent("touchstart", { touches: points, changedTouches: points, cancelable: true }));
        if (dx) {
          const moved = points.map(t => new Touch({ identifier: t.identifier, target: t.target, clientX: t.clientX + dx, clientY: 30 }));
          window.dispatchEvent(new TouchEvent("touchmove", { touches: moved, changedTouches: moved, cancelable: true }));
        }
      }, { fingers, dx });
      if (hold) await page.waitForTimeout(475);
      await iframe.evaluate(cancel => {
        window.dispatchEvent(new TouchEvent(cancel ? "touchcancel" : "touchend", { touches: [], changedTouches: window.gesturePoints }));
      }, cancel);
      return frame(page, "2").locator("#meter").textContent();
    }
    for (const [fingers, dx, hold, expected] of [[1, 0, false, "tap"], [1, 0, true, "long press"],
      [1, 30, false, "drag / swipe"], [2, 0, false, "two-finger tap"], [2, 30, false, "two-finger drag"],
      [3, 0, false, "3-finger hold"], [3, 30, false, "3-finger swipe"]]) {
      assert.ok((await gesture(fingers, dx, hold)).includes(expected), expected);
    }
    assert.match(await gesture(1, 0, false, true), /cancelled by the browser \(it took over: scroll\/zoom\)/);
    await frame(page, "2").locator("#content").dblclick();
    assert.ok((await types(page, "2")).includes("dblclick"));
    await frame(page, "2").locator("#content").click({ button: "right" });
    assert.ok((await types(page, "2")).includes("contextmenu"));
    await page.mouse.wheel(0, 20);
    await frame(page, "2").locator('#event-log li[data-type="wheel"]').waitFor();
    await page.keyboard.press("Alt+Shift+KeyQ");
    const text = await frame(page, "2").locator("#event-log").textContent();
    assert.match(text, /keydown Alt\+Shift KeyQ \(Q\)/);
    assert.ok((await types(page, "2")).length <= 12);
  } },
  { name: "Workbench pointer chords", async run(page) {
    await select(page, ["2"]);
    assert.equal((await state(page)).selection.length, 2);
    await select(page, ["2"]);
    assert.equal((await state(page)).selection.length, 1);
    await page.keyboard.press("Escape");
    await frame(page, "2").locator("#content").click({ modifiers: ["Alt", "Shift"] });
    assert.equal((await state(page)).selection.length, 0);
    assert.ok((await types(page, "2")).includes("click"));
    await focusShell(page);
    await page.keyboard.down("Control"); await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
    try {
      const source = (await paneFor(page, "2")).locator(".split-tabs-pane-cover");
      const from = await point(source), to = await point(await paneFor(page, "3"), 0.9, 0.5);
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.waitForSelector(".split-tabs-drop-shade:not([data-refused])");
      await page.mouse.up();
      assert.notEqual((await state(page)).notation, "H[V[1 3] V[2 4]]");
    } finally {
      await page.keyboard.up("Shift"); await page.keyboard.up("Alt"); await page.keyboard.up("Control");
    }
  } },
];

const keep = (page, view) => page.locator(`[data-split-tabs-keep="${view}"]`);
const opacity = locator => locator.evaluate(el => getComputedStyle(el).opacity);
async function setOpacity(page, value) {
  await page.getByLabel("Unfocused opacity", { exact: true }).focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < Math.round((value - 0.2) / 0.05); step++) await page.keyboard.press("ArrowRight");
}
const optionCases = [
  { name: "external bars stay outside pane marks, dimming and iframe content", async run(page) {
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("always");
    await page.getByLabel("Focus indication", { exact: true }).selectOption("both");
    await setOpacity(page, 0.4);
    await focusShell(page);
    await chord(page, "T");
    await page.locator('[data-split-tabs-tab="1"] .split-tab-strip-tab').click();
    await focusShell(page);
    for (const side of ["top", "left", "bottom", "right"]) {
      await page.waitForFunction(side => document.querySelector(".split-tabs-tabset").dataset.side === side, side);
      await page.waitForFunction(() => {
        const pane = document.querySelector(".split-tabs-pane--focused").getBoundingClientRect();
        const mark = document.querySelector(".split-tabs-focus").getBoundingClientRect();
        return Math.abs(pane.x - mark.x) < 1 && Math.abs(pane.y - mark.y) < 1 && Math.abs(pane.width - mark.width) < 1;
      });
      const boxes = await page.locator(".split-tabs-tabset").evaluateAll(sets => sets.map(set => {
        const pane = set.querySelector(":scope > .split-tabs-pane"), bar = set.querySelector(":scope > .split-tabs-bar");
        const p = pane.getBoundingClientRect(), b = bar.getBoundingClientRect();
        return { side: set.dataset.side, overlap: Math.min(p.right, b.right) > Math.max(p.left, b.left)
          && Math.min(p.bottom, b.bottom) > Math.max(p.top, b.top), opacity: getComputedStyle(bar).opacity };
      }));
      assert.ok(boxes.every(box => !box.overlap && box.opacity === "1"), JSON.stringify(boxes));
      const p = await (await paneFor(page, "1")).boundingBox();
      const iframe = await page.locator('iframe[data-frame="1"]').boundingBox();
      for (const prop of ["x", "y", "width", "height"]) assert.ok(Math.abs(p[prop] - iframe[prop]) < 1, `iframe ${side} ${prop}`);
      await chord(page, "R");
    }
    assert.equal(await opacity(keep(page, "2")), "0.4");
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("hidden");
    const pane = await paneFor(page, "2");
    assert.deepEqual(await pane.boundingBox(), await pane.locator("..").boundingBox());
  } },
  { name: "display panes with layout keys and Shift Win", async run(page) {
    for (const key of ["Alt+Shift+KeyQ", "Meta+Shift+KeyQ"]) {
      await focusShell(page);
      await page.keyboard.press(key);
      await page.locator('.split-tabs-pane-number[data-mode="display"]').first().waitFor();
      await page.keyboard.press("Digit2");
      await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).focusedView === "2");
      assert.equal(await page.locator('iframe[data-frame="2"]').evaluate(el => document.activeElement === el), true);
      assert.equal(await page.locator('.split-tabs-pane-number[data-mode="display"]').count(), 0);
    }
  } },
  { name: "option close buttons", async run(page) {
    await chord(page, "T");
    const closes = page.locator(".split-tab-strip:visible .split-tab-strip-close");
    assert.equal(await closes.count(), 1, "active default only offers the shown tab");
    await page.getByLabel("✕ on tabs", { exact: true }).selectOption("always");
    assert.equal(await closes.count(), 2);
    for (const close of await closes.all()) assert.equal(await opacity(close), "1");
    await page.getByLabel("✕ on tabs", { exact: true }).selectOption("never");
    assert.equal(await closes.count(), 0);
    await page.getByLabel("✕ on tabs", { exact: true }).selectOption("hover");
    const inactive = page.locator('.split-tab-strip:visible [data-split-tabs-tab="1"]');
    assert.equal(await opacity(inactive.locator(".split-tab-strip-close")), "0");
    await inactive.hover();
    assert.equal(await opacity(inactive.locator(".split-tab-strip-close")), "1");
  } },
  { name: "option focus indication and opacity", async run(page) {
    const border = () => page.locator(".split-tabs-focus").evaluate(el => getComputedStyle(el).borderTopStyle);
    assert.equal(await border(), "solid");
    assert.equal(await opacity(keep(page, "2")), "1");
    await page.getByLabel("Focus indication", { exact: true }).selectOption("dim");
    await setOpacity(page, 0.4);
    assert.equal(await border(), "none");
    assert.equal(await opacity(keep(page, "1")), "1");
    assert.equal(await opacity(keep(page, "2")), "0.4");
    await page.getByLabel("Focus indication", { exact: true }).selectOption("both");
    assert.equal(await border(), "solid");
    assert.equal(await opacity(keep(page, "2")), "0.4");
    await page.frameLocator('iframe[data-frame="2"]').locator("#content").click();
    await expectState(page, { focusedView: "2" });
    assert.equal(await opacity(keep(page, "1")), "0.4");
    assert.equal(await opacity(keep(page, "2")), "1");
    await page.getByLabel("Focus indication", { exact: true }).selectOption("border");
    assert.equal(await opacity(keep(page, "1")), "1");
    await select(page, ["4"]);
    assert.equal(await page.locator(".split-tabs-selected-mark").count(), 2);
  } },
  { name: "option divider thickness and controller recreation", async run(page) {
    await chord(page, "E");
    const before = (await state(page)).notation;
    const marker = await page.locator('iframe[data-frame="1"]').evaluate(el => el.contentWindow.marker);
    for (const size of [1, 2, 10, 6]) {
      await page.getByLabel("Divider thickness", { exact: true }).selectOption(String(size));
      await expectState(page, { ready: true, notation: before, dividerSize: size });
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
      const widths = await page.locator('.split-tabs-divider[aria-orientation="vertical"]').evaluateAll(nodes =>
        nodes.map(el => el.getBoundingClientRect().width));
      assert.ok(widths.length && widths.every(width => width === size), `Divider widths: ${widths}`);
    }
    assert.notEqual(await page.locator('iframe[data-frame="1"]').evaluate(el => el.contentWindow.marker), marker);
    await page.frameLocator('iframe[data-frame="2"]').locator("#content").click();
    await chord(page, "E");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === 6);
    assert.equal((await state(page)).panes.length, 6, "fresh frame helper still forwards keys");
  } },
  { name: "option pane mouse chords", async run(page) {
    await page.getByLabel("Pane mouse chords", { exact: true }).selectOption("Alt+Shift");
    await focusShell(page);
    await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
    try { await (await paneFor(page, "2")).locator(".split-tabs-pane-cover").click(); }
    finally { await page.keyboard.up("Shift"); await page.keyboard.up("Alt"); }
    assert.equal((await state(page)).selection.length, 2);
    assert.match(await page.locator("#pointer-keys").textContent(), /Alt\+Shift\+click/);
    assert.match(await page.locator("#pointer-keys").textContent(), /Ctrl\+Alt\+Shift\+click.*rectangle/s);
  } },
  { name: "option one-tab bar", async run(page) {
    assert.equal(await page.locator(".split-tab-strip:visible").count(), 0);
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("always");
    assert.equal(await page.locator(".split-tab-strip:visible").count(), 4);
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("hidden");
    assert.equal(await page.locator(".split-tab-strip:visible").count(), 0);
  } },
  { name: "option context menu items and split", async run(page) {
    await chord(page, "T");
    const label = page.locator('.split-tab-strip:visible [data-split-tabs-tab="1"] .split-tab-strip-tab');
    await label.click({ button: "right" });
    await page.getByRole("menu", { name: "Tab options" }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "Split left", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await page.getByLabel("Split left", { exact: true }).uncheck();
    await label.click({ button: "right" });
    assert.equal(await page.getByRole("menuitem", { name: "Split left", exact: true }).count(), 0);
    await page.getByRole("menuitem", { name: "Split right", exact: true }).click();
    assert.equal((await state(page)).panes.length, 5);
  } },
  { name: "option layout keys", async run(page) {
    const before = (await state(page)).notation;
    await page.getByLabel("Layout keys", { exact: true }).uncheck();
    await focusShell(page); await chord(page, "E");
    assert.equal((await state(page)).notation, before);
    assert.equal(await page.locator("#keys li").count(), 1, "modal exits remain independent of layout keys");
    assert.equal(await page.locator("#keys li").innerText(), "Escape / Ctrl+G / Ctrl+D\nExit mode");
    await page.frameLocator('iframe[data-frame="2"]').locator("#content").click();
    await chord(page, "E");
    assert.equal((await state(page)).notation, before, "forwarded iframe keys also stay unbound");
    await page.getByLabel("Layout keys", { exact: true }).check();
    await focusShell(page); await chord(page, "E");
    assert.equal((await state(page)).panes.length, 5);
  } },
  { name: "option reload resets layout and persists only options", async run(page) {
    await chord(page, "E");
    await page.getByLabel("✕ on tabs", { exact: true }).selectOption("always");
    await page.getByLabel("Focus indication", { exact: true }).selectOption("both");
    await setOpacity(page, 0.3);
    await page.getByLabel("Divider thickness", { exact: true }).selectOption("2");
    await page.getByLabel("Pane mouse chords", { exact: true }).selectOption("Alt+Shift");
    await page.getByLabel("One-tab bar", { exact: true }).selectOption("always");
    await page.getByLabel("Split left", { exact: true }).uncheck();
    for (const label of ["Layout keys", "Event logs"]) await page.getByLabel(label, { exact: true }).uncheck();
    const options = (await state(page)).options;
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["split-tabs.demo.options.v1"]);
    await reset(page);
    await expectState(page, { notation: "H[V[1 3] V[2 4]]", options });
    assert.equal(await page.locator(".split-tab-strip:visible").count(), 4);
    assert.equal(await opacity(keep(page, "2")), "0.3");
    assert.equal(await frame(page, "1").locator("#event-panel").isVisible(), false);
    assert.equal((await page.locator(".layout-surface").boundingBox()).y, 0);
  } },
];

let passed = 0;
await withBrowser(async (browser, origin) => {
  const cases = [...optionCases, ...received, ...scenarios, ...extraCases]
    .filter(test => !process.env.DEMO_CASE || test.name.includes(process.env.DEMO_CASE));
  assert.ok(cases.length, "DEMO_CASE must match a scenario");
  for (const test of cases) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: test.name === "touch",
      deviceScaleFactor: 1, reducedMotion: "reduce" });
    let page;
    try {
      const fixture = await open(context, origin);
      page = fixture.page;
      await test.run(page, context, async () => {});
      await clean(page);
      assert.deepEqual(fixture.errors, [], "No runtime errors or external requests");
      console.log(`PASS demo: ${test.name}`);
      passed++;
    } catch (error) {
      console.error(`FAIL demo: ${test.name}`);
      if (page) console.error(JSON.stringify(await state(page)));
      throw error;
    } finally { await context.close(); }
  }
});
console.log(`Demo tests: ${passed} passed`);
