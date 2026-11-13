import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium, webkit } from "playwright";

// Only built package artifacts + Vue + these two fixtures are served. No dev server,
// external network, user profile, downloads, screenshot files, or repository temp files.
const files = new Map([
  ["/", [new URL("browser.html", import.meta.url), "text/html"]],
  ["/frame.html", [new URL("browser-frame.html", import.meta.url), "text/html"]],
  ["/vue.js", [new URL("../node_modules/vue/dist/vue.esm-browser.prod.js", import.meta.url), "text/javascript"]],
  ...["index.js", "frame.js", "style.css"].map(name => [
    `/dist/${name}`, [new URL(`../dist/${name}`, import.meta.url), name.endsWith("css") ? "text/css" : "text/javascript"],
  ]),
]);
const label = (page, id) => page.locator(`[data-split-tabs-tab="${id}"] > .split-tab-strip-title > .split-tab-strip-tab`);
const notation = page => page.evaluate(() => window.controller.notation.value);
const order = page => page.evaluate(() => [...window.controller.panes.value[0].tabs]);
const frame = (page, id) => page.locator(`iframe[data-frame="${id}"]`);
const chord = (page, code) => page.keyboard.press(`Alt+Shift+Key${code}`);
async function expectNotation(page, expected) {
  await page.waitForFunction(value => window.controller.notation.value === value, expected);
  assert.equal(await notation(page), expected);
}
async function box(locator) {
  await locator.waitFor({ state: "visible" });
  const rect = await locator.boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0, "target has nonzero geometry");
  return rect;
}
async function point(locator, x = 0.5, y = 0.5) {
  const r = await box(locator);
  return { x: r.x + r.width * x, y: r.y + r.height * y };
}
async function pane(page, view) {
  const id = await page.evaluate(v => window.controller.paneOf(v), view);
  assert.ok(id, `pane of ${view} exists`);
  return page.locator(`[data-pane-id="${id}"]`);
}
async function startMouse(page, locator) {
  const p = await point(locator);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y, { steps: 2 });
  await page.waitForSelector(".split-tabs-drag-ghost");
}
async function moveMouse(page, p) { await page.mouse.move(p.x, p.y, { steps: 8 }); }
async function clean(page) {
  await page.waitForFunction(() => !document.querySelector([
    ".split-tabs-drag-ghost", ".split-tabs-drop-shade", ".split-tabs-bar-preview", ".split-tabs-guide", ".split-tab-strip-item--drag-armed",
    ".split-tab-strip-item--spring", ".split-tabs--dragging", ".split-tabs--resizing", "[data-split-tabs-bin]",
  ].join(",")));
  // Iframe keyup is delivered by postMessage after the native press resolves.
  await page.waitForFunction(() => window.listenersAtRest());
  const state = await page.evaluate(() => ({
    listeners: window.listenersAtRest(),
    types: window.listenerSnapshot().map(l => l.type),
    blocked: !window.dispatchEvent(new Event("touchmove", { cancelable: true })),
  }));
  assert.equal(state.listeners, true, `window gesture listeners restored: ${JSON.stringify(state.types)}`);
   assert.equal(state.blocked, await page.locator(".split-tabs--arranging").count() > 0, "touchmove blocked only during arrange");
}
async function releaseMouse(page) { await page.mouse.up(); await clean(page); }
async function splitOff(page, view, beside, side) {
  const result = await page.evaluate(({ view, beside, side }) => {
    const c = window.controller;
    return c.move({ view }, { kind: "split", target: c.paneOf(beside), side });
  }, { view, beside, side });
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForFunction(() => document.querySelectorAll("[data-pane-id]").length === window.controller.panes.value.length);
}
async function grid(page) {
  await page.evaluate(() => window.controller.open("d"));
  await splitOff(page, "b", "a", "right");
  await splitOff(page, "c", "a", "bottom");
  await splitOff(page, "d", "b", "bottom");
  await page.evaluate(() => window.controller.focusPane(window.controller.paneOf("a")));
  await expectNotation(page, "H[V[a c] V[b d]]");
}
async function touchStart(page, cdp, locator, hold = true) {
  const start = await point(locator);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  if (hold) await page.waitForSelector(".split-tab-strip-item--drag-armed");
  return start;
}
async function touchMove(page, cdp, start, end) {
  // Native compositor input paced at animation frames, not synthetic DOM events.
  for (let step = 1; step <= 12; step++) {
    const x = start.x + (end.x - start.x) * step / 12;
    const y = start.y + (end.y - start.y) * step / 12;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}
async function touchEnd(page, cdp) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await clean(page);
}
const fingers = (center, spread) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y], i) => ({
  id: i + 1, x: center.x + x * spread, y: center.y + y * spread,
}));
async function fourStart(cdp, center, spread) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(center, spread) });
}
async function pinch(page, cdp, center, from, to) {
  await fourStart(cdp, center, from);
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(center, from + (to - from) * i / 6) });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await touchEnd(page, cdp);
}
// Fingers landing one after another, as a hand does (Android sent them within ~10 ms).
async function landFingers(page, cdp, center, spread, count = 4) {
  const points = fingers(center, spread);
  for (let n = 1; n <= count; n++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n) });
    await page.waitForTimeout(10);
  }
  return points.slice(0, count);
}
async function moveFingers(page, cdp, points, dy, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points.map(p => ({ ...p, y: p.y + dy * i / steps })) });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}
async function iframeSnapshot(page) {
  await page.evaluate(() => {
    window.savedFrames = [...document.querySelectorAll("iframe[data-frame]")].map(el => ({
      el, marker: el.contentWindow.marker, count: el.contentWindow.loadCount,
    }));
  });
}
async function unchangedFrames(page) {
  assert.equal(await page.evaluate(() => window.savedFrames.every(({ el, marker, count }) =>
    el === document.querySelector(`iframe[data-frame="${el.dataset.frame}"]`) && el.isConnected &&
    el.contentWindow.marker === marker && el.contentWindow.loadCount === count && window.frameLoads[el.dataset.frame] === count)), true);
}
async function ready(page) {
  await page.waitForFunction(() => window.fixtureReady && window.controller.fits.value.cols && window.controller.fits.value.rows);
  await page.waitForFunction(() => [...document.querySelectorAll("iframe[data-frame]")].every(el => el.contentWindow.ready && el.contentWindow.identified));
  await page.evaluate(() => { window.gestureBaseline = window.listenerSnapshot(); });
}
const keep = (page, view) => page.locator(`[data-split-tabs-keep="${view}"]`);
async function screenshotPixel(page, x, y) {
  const png = await page.screenshot();
  return page.evaluate(async ({ png, x, y }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, { png: png.toString("base64"), x, y });
}

const acceptanceCases = [
  ...["hold", "pinch"].map(gesture => [`reused touch identifier keeps third-finger covers and ${gesture}`, async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    await label(page, "c").click();
    const center = await point(await pane(page, "c"));
    await page.evaluate(() => {
      window.reusedTouches = [];
      for (const type of ["touchstart", "touchend"]) window.addEventListener(type, e => {
        window.reusedTouches.push([type, [...e.touches].map(t => t.identifier), [...e.changedTouches].map(t => t.identifier)]);
      }, { passive: true });
    });
    const points = fingers(center, 30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, 1) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, 2) });
    await moveFingers(page, cdp, points.slice(0, 2), -5, 2);
    const shifted = points.map(p => ({ ...p, y: p.y - 5 }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: shifted.slice(1, 2) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: shifted.slice(0, 2) });
    // A content pan cancels the provisional pointer for the re-placed finger; touch events must keep counting it.
    await moveFingers(page, cdp, shifted.slice(0, 2), -40, 3);
    for (const p of shifted) p.y -= 40;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: shifted.slice(0, 3) });
    const starts = await page.evaluate(() => window.reusedTouches.filter(([type]) => type === "touchstart"));
    assert.deepEqual(starts[1][2], starts[2][2], "the re-placed finger reuses its native Touch.identifier");
    await page.waitForSelector(".split-tabs-pane-cover");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: shifted });
    if (gesture === "hold") await page.waitForSelector(".split-tabs--arranging");
    else {
      const spread = fingers({ x: center.x, y: center.y - 45 }, 65);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: spread });
      await page.waitForFunction(() => window.controller.zoomed.value !== null);
    }
    await touchEnd(page, cdp);
    if (gesture === "hold") await page.keyboard.press("Escape");
    assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0);
  }, "?scroll=1", { cdp: true }]),
  ...[false, true].map(delayed => [
    `pointer self-split transfers keyboard from the old iframe to the new pane${delayed ? " with delayed iframe modifiers" : ""}`, async page => {
    await page.frameLocator('iframe[data-frame="a"]').locator("#frame-input").focus();
    const original = await pane(page, "a");
    const start = delayed ? await point(original) : null;
    if (start) await page.mouse.move(start.x, start.y);
    if (delayed) await page.evaluate(() => {
      const post = window.postMessage;
      window.delayedModifiers = [];
      window.iframePresses = [];
      document.querySelector('iframe[data-frame="a"]').contentWindow.addEventListener("pointerdown", event => {
        window.iframePresses.push({ trusted: event.isTrusted, type: event.pointerType });
      }, true);
      window.postMessage = function(data, ...args) {
        if (data?.["split-tabs"] === 1 && ["key", "mods"].includes(data.type)) {
          window.delayedModifiers.push([data, ...args]);
          return;
        }
        return post.call(this, data, ...args);
      };
      window.releaseModifiers = () => {
        window.postMessage = post;
        for (const args of window.delayedModifiers) post.apply(window, args);
      };
    });
    await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
    if (delayed) {
      await page.waitForFunction(() => window.delayedModifiers.some(([data]) => data.code === "ShiftLeft"));
      assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0);
      await page.mouse.down();
      await page.mouse.move(start.x + 8, start.y, { steps: 2 });
      await page.waitForSelector(".split-tabs-drag-ghost");
      assert.deepEqual(await page.evaluate(() => window.iframePresses), [{ trusted: true, type: "mouse" }]);
      await page.evaluate(() => window.releaseModifiers());
    } else await startMouse(page, original);
    await moveMouse(page, await point(original, 0.85, 0.5));
    await releaseMouse(page);
    await page.keyboard.up("Shift"); await page.keyboard.up("Alt");
    await expectNotation(page, "H[new:1 a]");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.paneId === window.controller.focus.value), true);
    await page.keyboard.press("KeyX");
    assert.equal(await frame(page, "a").evaluate(el => el.contentWindow.keys.includes("x")), false);
  }, "?n=1"]),
  ["pointer chord held before an iframe loads still self-splits", async page => {
    const original = await pane(page, "a");
    let release;
    const loading = new Promise(resolve => { release = resolve; });
    const request = page.waitForRequest(request => request.url().endsWith("&delayed=1"));
    await page.route("**/frame.html?*delayed=1", async route => {
      await loading;
      await route.continue();
    });
    try {
      await page.locator("#shell-focus").focus();
      await frame(page, "a").evaluate(el => { el.src += "&delayed=1"; });
      await request;
      await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
      await page.waitForSelector(".split-tabs-pane-cover");
      await startMouse(page, original);
      release();
      await page.waitForFunction(() => window.frameLoads.a === 2 && document.querySelector('iframe[data-frame="a"]').contentWindow.identified);
      await moveMouse(page, await point(original, 0.85, 0.5));
      await releaseMouse(page);
      await page.keyboard.up("Shift"); await page.keyboard.up("Alt");
      await expectNotation(page, "H[new:1 a]");
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.paneId === window.controller.focus.value), true);
    } finally { release(); }
  }, "?n=1"],
  ["rename label by double click, Enter and persisted reload", async page => {
    await label(page, "a").dblclick();
    const editor = page.locator(".split-tab-strip-rename");
    await editor.waitFor({ state: "visible" });
    await editor.fill("My workspace");
    await editor.press("Enter");
    await page.waitForFunction(() => window.controller.titleOf("a") === "My workspace");
    assert.equal(await label(page, "a").textContent(), "My workspace");
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), ["rename", { ok: true }]);
    await chord(page, "A");
    await label(page, "a").dblclick();
    await editor.fill("Cancel this");
    await editor.press("Escape");
    assert.equal(await label(page, "a").textContent(), "My workspace");
    assert.equal(await page.locator(".split-tabs--arranging").count(), 1);
    await page.reload();
    await ready(page);
    assert.equal(await label(page, "a").textContent(), "My workspace");
    assert.equal(await page.evaluate(() => window.controller.titleOf("a")), "My workspace");
  }],
  ["rename label through native touch hold menu", async (page, cdp) => {
    await touchStart(page, cdp, label(page, "a"));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.locator('[data-menu-item="rename"]').click();
    const editor = page.locator(".split-tab-strip-rename");
    await editor.waitFor({ state: "visible" });
    assert.equal(await editor.evaluate(el => el === document.activeElement), true);
    await editor.fill("Touch title");
    await editor.press("Enter");
    assert.equal(await label(page, "a").textContent(), "Touch title");
  }, "", { cdp: true }],
  ...[1, 2].flatMap(n => (n === 1 ? ["mouse", "touch"] : ["mouse", "touch", "label"]).map(input => [
    `self-drop right quarter (${input}, ${n} tabs) splits shown content RIGHT`, async (page, cdp) => {
    const view = n === 1 ? "a" : "b";
    if (n === 2) {
      await label(page, "b").click();
      await page.evaluate(() => { window.writes.length = 0; });
    }
    const original = await pane(page, view), before = await box(original);
    const start = await point(original), end = await point(original, 0.85, 0.5);
    await iframeSnapshot(page);
    if (input === "touch") {
      await chord(page, "A");
      await page.waitForSelector(".split-tabs--arranging");
      await touchStart(page, cdp, original, false);
      await touchMove(page, cdp, start, end);
    } else if (input === "label") {
      await startMouse(page, label(page, view));
      await moveMouse(page, end);
    } else {
      await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
      await startMouse(page, original);
      await moveMouse(page, end);
    }
    const fresh = page.locator(".split-tabs-drop-preview--new");
    await fresh.waitFor();
    const left = await box(fresh), right = await box(page.locator(".split-tabs-drop-shade:not(.split-tabs-drop-preview--new)"));
    assert.ok(left.x < right.x);
    assert.ok(Math.abs(left.width - right.width) < 1);
    assert.equal(await fresh.textContent(), "New pane");
    assert.equal(await fresh.getAttribute("data-refused"), null);
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    if (input === "touch") await touchEnd(page, cdp);
    else {
      await releaseMouse(page);
      if (input === "mouse") { await page.keyboard.up("Shift"); await page.keyboard.up("Alt"); }
    }
    const expected = n === 1 ? "H[new:1 a]" : "T{a | *H[new:1 b]}";
    await expectNotation(page, expected);
    const contentBox = await box(await pane(page, view)), newBox = await box(await pane(page, "new:1"));
    assert.ok(newBox.x < contentBox.x, "placeholder left, original content right");
    assert.ok(Math.abs(contentBox.width - newBox.width) < 1);
    assert.ok(Math.abs(newBox.x - before.x) < 1);
    assert.ok(Math.abs(contentBox.x + contentBox.width - before.x - before.width) < 1);
    assert.equal(await page.evaluate(() => window.controller.panes.value.find(p => p.id === window.controller.focus.value).view), "new:1");
    assert.equal(await page.evaluate(() => window.writes.length), 1);
    if (n === 2) {
      const layout = await page.evaluate(() => window.controller.tabSet(window.controller.frames.value[0].id).active);
      await label(page, "a").click();
      assert.deepEqual(await page.evaluate(() => window.controller.panes.value.map(p => p.view)), ["a"]);
      await label(page, layout).click();
      await expectNotation(page, expected);
      assert.deepEqual(await page.evaluate(() => window.controller.panes.value.map(p => p.view)), ["new:1", "b"]);
    }
    await unchangedFrames(page);
  }, `?n=${n}`, input === "touch" ? { cdp: true } : {}])),
  ...["iframe-first", "shell-first"].map(order => [`cross-document hold ${order} uses still fingers`, async (page, cdp) => {
    await splitOff(page, "c", "a", "right");
    const a = await point(frame(page, "a")), c = await point(await pane(page, "c"));
    const points = [a, c, { x: c.x - 40, y: c.y - 40 }, { x: c.x + 40, y: c.y + 40 }];
    if (order === "shell-first") [points[0], points[1]] = [points[1], points[0]];
    for (let n = 1; n <= 4; n++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n).map((p, id) => ({ ...p, id })) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await page.waitForSelector(".split-tabs--arranging");
    await touchEnd(page, cdp);
    assert.ok(await frame(page, "a").evaluate(el => el.contentWindow.claims.includes("hold")));
  }, "?ordinary=c", { cdp: true }]),
  ["cross-document pan from a scrollable iframe never starts a browser gesture", async (page, cdp) => {
    await splitOff(page, "c", "a", "right");
    const a = await point(frame(page, "a")), c = await point(await pane(page, "c"));
    await frame(page, "a").evaluate(el => {
      el.contentWindow.cancels = 0;
      el.contentWindow.addEventListener("pointercancel", () => el.contentWindow.cancels++);
    });
    const points = [a, c, { x: c.x + 40, y: c.y }].map((p, id) => ({ ...p, id }));
    for (let n = 1; n <= 3; n++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await moveFingers(page, cdp, points, -120);
    assert.equal(await frame(page, "a").evaluate(el => el.contentDocument.scrollingElement.scrollTop), 0);
    assert.equal(await frame(page, "a").evaluate(el => el.contentWindow.cancels), 0);
    await touchEnd(page, cdp);
  }, "?ordinary=c&scroll=1", { cdp: true }],
  ["cross-document pinch across two iframes zooms only the layout", async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    const a = await point(frame(page, "a")), b = await point(frame(page, "b"));
    const points = [a, { x: a.x + 30, y: a.y + 30 }, b, { x: b.x - 30, y: b.y - 30 }].map((p, id) => ({ ...p, id }));
    for (let n = 1; n <= 4; n++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    for (let i = 1; i <= 8; i++) {
      const scale = 1 + i * 0.07;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points.map(p => ({
        id: p.id, x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale,
      })) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    assert.ok(await page.evaluate(() => window.commands.some(([name]) => name === "pinchOut")));
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
    await touchEnd(page, cdp);
  }, "", { cdp: true }],
  ["cross-document outside-root fingers never cover the layout", async (page, cdp) => {
    const a = await point(frame(page, "a")), outside = await point(page.locator("#shell-focus"));
    const points = [a, outside, { x: outside.x + 120, y: outside.y }].map((p, id) => ({ ...p, id }));
    for (let n = 1; n <= 3; n++) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n) });
    await moveFingers(page, cdp, points, -10, 2);
    assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.commands), []);
    await touchEnd(page, cdp);
  }, "", { cdp: true }],
  ...["arrange", "chord", "gesture", "display", "pick"].map(mode => [
    `dimmed pane covers and badges stay above overlay iframes (${mode})`, async page => {
    await splitOff(page, "b", "a", "right");
    await splitOff(page, "c", "a", "bottom");
    await page.evaluate(() => {
      const c = window.controller;
      c.focusPane(c.paneOf("a"));
      const root = document.querySelector(".split-tabs");
      root.style.setProperty("--split-tabs-unfocused-opacity", "0.3");
      root.style.setProperty("--split-tabs-focused-opacity", "0.7");
    });
    // Check effective dimming without prescribing which content ancestor owns it.
    for (const view of ["a", "b", "c"]) {
      const content = view === "c" ? page.locator('[data-content="c"]') : frame(page, view);
      const opacity = await content.evaluate(el => {
        let value = 1;
        for (; el && !el.classList.contains("split-tabs"); el = el.parentElement) value *= Number(getComputedStyle(el).opacity);
        return value;
      });
      assert.equal(opacity, view === "a" ? 0.7 : 0.3, `${view} content dimmed exactly once`);
    }
    if (mode === "arrange") await page.evaluate(() => window.runLayout("arrange"));
    if (mode === "chord") { await page.keyboard.down("Alt"); await page.keyboard.down("Shift"); }
    if (mode === "gesture") await page.evaluate(() => window.touchPane(window.controller.paneOf("b"), 3));
    if (mode === "display") await page.evaluate(() => window.runLayout("displayPanes"));
    if (mode === "pick") {
      await page.evaluate(() => { window.fixture.alwaysShow = true; });
      await label(page, "a").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to", exact: true }).hover();
      await page.keyboard.press("m");
    }
    const target = await pane(page, "b"), p = await point(target);
    const selector = ["display", "pick"].includes(mode) ? ".split-tabs-pane-number" : ".split-tabs-pane-cover";
    await page.waitForSelector(selector);
    assert.equal(await page.evaluate(({ p, selector }) => !!document.elementFromPoint(p.x, p.y)?.closest(selector), { p, selector }), true,
      `${mode} hit test reaches layout, not dimmed iframe`);
    await page.mouse.click(p.x, p.y);
    if (mode === "arrange" || mode === "chord") {
      assert.equal(await page.evaluate(() => window.controller.selection.value.includes(window.controller.paneOf("b"))), true);
    } else if (mode === "display") {
      await page.waitForFunction(() => window.controller.focus.value === window.controller.paneOf("b"));
      assert.equal(await page.locator('.split-tabs-pane-number[data-mode="display"]').count(), 0);
    } else if (mode === "pick") {
      await page.waitForFunction(() => window.controller.paneOf("a") === window.controller.paneOf("b"));
      assert.equal(await page.locator('.split-tabs-pane-number[data-mode="pick"]').count(), 0);
    } else assert.deepEqual(await page.evaluate(() => window.controller.selection.value), []);
    assert.equal(await frame(page, "b").evaluate(el => el.contentWindow.clicks), 0);
    if (mode === "chord") { await page.keyboard.up("Shift"); await page.keyboard.up("Alt"); }
    if (mode === "gesture") await page.evaluate(() => window.touchPane(window.controller.paneOf("b"), 0));
    if (mode === "arrange") await page.keyboard.press("Escape");
  }, "?ordinary=c"]),
  ["frame slot content does not take space from the nested layout", async page => {
    await splitOff(page, "c", "a", "right");
    await page.evaluate(() => {
      const c = window.controller;
      c.setSelection(c.panes.value.map(p => p.id));
      c.tabNext();
      const f = [...c.tabSets.value.values()].find(s => s.tabs.some(id => c.describe(id)?.kind === "layout"));
      c.select(f.id, f.tabs.find(id => c.describe(id)?.kind === "layout"));
    });
    const nested = page.locator(".split-tabs-frame-content > .split-tabs-cut");
    const before = await box(nested);
    await page.evaluate(() => { window.fixture.frameSlot = true; });
    await page.waitForSelector("#host-frame-slot");
    const after = await box(nested);
    assert.deepEqual(after, before, "host frame content cannot shrink or displace the nested layout");
    assert.equal(await page.locator(".split-tabs-frame-slot").evaluate(el => getComputedStyle(el).position), "absolute");
    const content = await box(page.locator(".split-tabs-frame-content"));
    assert.deepEqual(after, content, "nested layout fills the frame content box");
  }],
  ...["top", "left", "bottom", "right"].map(side => [`external bars geometry (${side})`, async page => {
    await splitOff(page, "b", "a", "right");
    await page.evaluate(side => {
      const c = window.controller;
      c.focusPane(c.paneOf("a"));
      while (c.tabSet(c.focus.value).side !== side) c.cycleBarSide();
      const root = document.querySelector(".split-tabs");
      root.style.setProperty("--split-tabs-focus-border", "4px solid rgb(255,0,0)");
      root.style.setProperty("--split-tabs-unfocused-opacity", "0.3");
      root.style.setProperty("--split-tabs-focused-opacity", "0.9");
    }, side);
    const content = await pane(page, "a");
    const id = await content.getAttribute("data-pane-id");
    const bar = page.locator(`[data-bar-id="${id}"]`);
    const tabset = page.locator(`[data-tabset-id="${id}"]`);
    const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1, `${message}: ${a} != ${b}`);
    const check = async () => {
      const [p, b, t, iframe, mark] = await Promise.all([box(content), box(bar), box(tabset), box(frame(page, "a")), box(page.locator(".split-tabs-focus"))]);
      for (const prop of ["x", "y", "width", "height"]) { close(mark[prop], p[prop], `mark ${prop}`); close(iframe[prop], p[prop], `iframe ${prop}`); }
      if (side === "top") close(p.y, b.y + b.height, "pane starts below bar");
      if (side === "bottom") close(p.y + p.height, b.y, "pane ends above bar");
      if (side === "left") close(p.x, b.x + b.width, "pane starts after left bar");
      if (side === "right") close(p.x + p.width, b.x, "pane ends before right bar");
      close(p.width + (["left", "right"].includes(side) ? b.width : 0), t.width, "bar plus pane width");
      close(p.height + (["top", "bottom"].includes(side) ? b.height : 0), t.height, "bar plus pane height");
      const red = await screenshotPixel(page, Math.floor(p.x + 1), Math.floor(p.y + p.height / 2));
      assert.ok(red[0] > 200 && red[1] < 60 && red[2] < 60, `focus is painted over pane: ${red}`);
      const barPixel = await screenshotPixel(page, Math.floor(b.x + b.width / 2), Math.floor(b.y + b.height - 1));
      assert.ok(!(barPixel[0] > 200 && barPixel[1] < 60 && barPixel[2] < 60), "focus border must not paint over bar");
      assert.equal(await bar.evaluate(el => getComputedStyle(el).opacity), "1");
    };
    await check();
    const other = await pane(page, "b");
    assert.equal(await other.evaluate(el => getComputedStyle(el).opacity), "1", "pane is not an opacity stacking context");
    assert.equal(await other.locator(":scope > .split-tabs-pane-content").evaluate(el => getComputedStyle(el).opacity), "0.3");
    assert.equal(await keep(page, "b").evaluate(el => getComputedStyle(el).opacity), "0.3");
    assert.equal(await content.locator(":scope > .split-tabs-pane-content").evaluate(el => getComputedStyle(el).opacity), "0.9");
    assert.equal(await keep(page, "a").evaluate(el => getComputedStyle(el).opacity), "0.9");
    const otherId = await other.getAttribute("data-pane-id");
    const otherSet = page.locator(`[data-tabset-id="${otherId}"]`);
    assert.deepEqual(await box(other), await box(otherSet), "hidden one-tab bar leaves whole rectangle for pane");
    await page.evaluate(() => { window.fixture.alwaysShow = true; });
    await page.waitForFunction(id => document.querySelector(`[data-bar-id="${id}"]`).getBoundingClientRect().height > 0, otherId);
    const singleBar = await box(page.locator(`[data-bar-id="${otherId}"]`));
    close((await box(other)).y, singleBar.y + singleBar.height, "always-shown bar reserves content space");
    await page.evaluate(() => { window.fixture.alwaysShow = false; });
    await page.waitForFunction(id => getComputedStyle(document.querySelector(`[data-bar-id="${id}"]`)).display === "none", otherId);
    assert.deepEqual(await box(other), await box(otherSet), "hiding bar restores the whole pane");
    await check();
  }]),
  ["selection union never paints across a neighboring bar with mixed sides", async page => {
    await splitOff(page, "b", "a", "right");
    await page.evaluate(() => {
      const c = window.controller;
      c.focusPane(c.paneOf("a"));
      c.cycleBarSide();
      window.fixture.alwaysShow = true;
      c.setSelection(c.panes.value.map(p => p.id));
      const root = document.querySelector(".split-tabs");
      root.style.setProperty("--split-tabs-focus-border", "none");
      root.style.setProperty("--split-tabs-selected-background", "transparent");
      root.style.setProperty("--split-tabs-selection-border", "4px solid rgb(255,0,0)");
    });
    await page.waitForSelector(".split-tabs-selection");
    const id = await (await pane(page, "b")).getAttribute("data-pane-id");
    const bar = await box(page.locator(`[data-bar-id="${id}"]`));
    const pixel = await screenshotPixel(page, Math.floor(bar.x + bar.width - 12), Math.floor(bar.y + 1));
    assert.ok(!(pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60), `selection must not paint over neighbor bar: ${pixel}`);
    const button = await box(page.locator(".split-tabs-selection-close"));
    const panes = await page.locator("[data-pane-id]").evaluateAll(nodes => nodes.map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }));
    assert.ok(panes.some(p => button.x >= p.x && button.y >= p.y
      && button.x + button.width <= p.right && button.y + button.height <= p.bottom), "selection close control is inside a pane");
  }],
  ...[false, true].map(picker => [`refused iframe chords report once without native host typing (picker=${picker})`, async page => {
    const input = page.frameLocator('iframe[data-frame="a"]').locator("#frame-input");
    await page.locator("#host-input").fill("host text");
    await page.evaluate(() => { document.querySelector("#host").style.width = "150px"; });
    await page.waitForFunction(() => !window.controller.fits.value.cols);
    await input.click();
    if (picker) {
      await page.keyboard.press("Alt+Shift+KeyM");
      await page.waitForSelector(".split-tabs--picking");
    }
    await page.evaluate(() => { window.commands.length = 0; window.forwardedKeys = 0;
      window.addEventListener("keydown", () => { window.forwardedKeys++; }); });
    await page.keyboard.press("E");
    await page.waitForFunction(() => window.commands.length === 1);
    assert.deepEqual(await page.evaluate(() => window.commands), [["splitRight", { ok: false, reason: "no-room" }]]);
    assert.equal(await page.evaluate(() => window.forwardedKeys), picker ? 1 : 0, "only the existing picker replay is dispatched");
    assert.equal(await input.inputValue(), "", "the iframe always cancels a bound chord");
    assert.equal(await page.locator("#host-input").inputValue(), "host text", "forwarding cannot type into the host field");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME");
    if (picker) await page.keyboard.press("Escape");
  }]),
  ["non-repeatable holds cancel successful repeats but preserve refused repeats in page fields", async page => {
    const input = page.locator("#host-input");
    await input.click();
    for (let i = 0; i < 3; i++) await page.keyboard.down("A");
    await page.keyboard.up("A");
    assert.equal(await input.inputValue(), "", "a successful arrange hold must not leak repeated characters");
    assert.deepEqual(await page.evaluate(() => window.commands.map(([command]) => command)), ["arrange"]);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
    await input.evaluate(el => { el.dataset.physicalCode = "KeyG"; });
    for (let i = 0; i < 3; i++) await page.keyboard.down("|");
    await page.keyboard.up("|");
    assert.equal(await input.inputValue(), "|||", "a refused hold keeps its initial and repeat characters");
    assert.deepEqual(await page.evaluate(() => window.commands), [
      ["arrange", { ok: true }], ["group", { ok: false, reason: "selection-too-small" }],
    ]);
  }],
  ["a refused layout chord preserves a host input character", async page => {
    const input = page.locator("#host-input");
    await input.evaluate(el => { el.dataset.physicalCode = "KeyL"; });
    await input.click();
    await page.keyboard.press("|");
    assert.equal(await input.inputValue(), "|", "one-pane focusRight refusal leaves the layout character to typing");
    assert.equal(await page.evaluate(() => window.controller.panes.value.length), 1);
  }],
  ...["page", "iframe"].map(where => [`layout chords preserve unbound typing and take successful commands in ${where} fields`, async page => {
    const input = where === "page" ? page.locator("#host-input") : page.frameLocator('iframe[data-frame="a"]').locator("#frame-input");
    await input.click();
    await page.keyboard.press("|");
    assert.equal(await input.inputValue(), "|", "an unbound Alt+Shift character arrives in the field");
    await page.keyboard.press("E");
    await page.waitForFunction(() => window.controller.panes.value.length === 2);
    assert.equal(await input.inputValue(), "|", "a successful bound command cancels typing in a text field");
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
  }]),
  ["tab menu right-click opens at pointer and splits with the controller", async page => {
    const p = await point(label(page, "b"));
    await page.mouse.click(p.x, p.y, { button: "right" });
    const menu = page.getByRole("menu", { name: "Tab options" });
    const r = await box(menu);
    assert.ok(Math.abs(r.x - p.x) <= 1 && Math.abs(r.y - p.y) <= 1, "menu opens at pointer");
    await menu.getByRole("menuitem", { name: "Split right", exact: true }).click();
    await expectNotation(page, "H[(*a c) b]");
    assert.equal(await menu.count(), 0);
  }],
  ["tab menu Shift+F10 arrows Enter split and Escape returns focus", async page => {
    await label(page, "b").focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await menu.waitFor();
    const r = await box(menu), anchor = await box(label(page, "b"));
    assert.ok(Math.abs(r.y - anchor.y - anchor.height - 6) <= 1, "keyboard menu is below label");
    await page.keyboard.press("Escape");
    assert.equal(await label(page, "b").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Shift+F10");
    await menu.waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.menuItem), "left");
    await page.keyboard.press("Enter");
    await expectNotation(page, "H[b (*a c)]");
  }],
  ["tab menu move previews numbers, M enters picker, digits move the tab", async page => {
    await page.evaluate(() => { window.fixture.alwaysShow = true; });
    await splitOff(page, "b", "a", "right");
    await splitOff(page, "c", "b", "bottom");
    await label(page, "a").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to", exact: true }).hover();
    await page.waitForSelector('.split-tabs-pane-number[data-mode="preview"]');
    await page.keyboard.press("m");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="pick"]');
    assert.equal(await page.getByRole("menu").count(), 0);
    await page.keyboard.press("2");
    await expectNotation(page, "V[(b *a) c]");
    await label(page, "b").click();
    await splitOff(page, "a", "b", "left");
    await label(page, "a").click({ button: "right" });
    await page.keyboard.press("3");
    await expectNotation(page, "V[b (c *a)]");
  }, "?paneSlot=1"],
  ["tab menu held CDP touch opens on release without dragging", async (page, cdp) => {
    const before = await notation(page);
    const p = await touchStart(page, cdp, label(page, "b"));
    await page.waitForTimeout(500); // Beyond native long-press contextmenu too; opening still belongs to release.
    assert.equal(await page.getByRole("menu").count(), 0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const r = await box(page.getByRole("menu"));
    assert.ok(Math.abs(r.x - p.x) <= 1 && Math.abs(r.y - p.y) <= 1);
    assert.equal(await page.evaluate(() => window.sawGhost), false);
    await page.keyboard.press("Escape");
    await clean(page);
    await expectNotation(page, before);
  }, "", { cdp: true }],
  ["plain iframe clicks focus either pane and clear selection even in the focused pane", async page => {
    await splitOff(page, "b", "a", "right");
    for (const view of ["a", "b", "a"]) {
      await page.frameLocator(`iframe[data-frame="${view}"]`).locator("#inside").click();
      await page.waitForFunction(v => window.controller.focus.value === window.controller.paneOf(v), view);
      assert.equal(await page.evaluate(() => window.controller.barFocus.value), null);
    }
    await page.locator("#shell-focus").click();
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await (await pane(page, "b")).locator(".split-tabs-pane-cover").click();
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 2);
    const focused = await page.evaluate(() => window.controller.panes.value.find(p => p.id === window.controller.focus.value).view);
    await page.frameLocator(`iframe[data-frame="${focused}"]`).locator("#inside").click();
    await page.waitForFunction(() => window.controller.selection.value.length === 0);
    assert.equal(await page.evaluate(v => window.controller.focus.value === window.controller.paneOf(v), focused), true);
  }],
  ["focus mark paints above iframe content and unfocused overlays dim independently", async page => {
    await splitOff(page, "b", "a", "right");
    await page.locator("#host").evaluate(el => {
      el.style.setProperty("--split-tabs-focus-border", "4px solid rgb(255,0,0)");
      el.style.setProperty("--split-tabs-unfocused-opacity", "0.3");
    });
    for (const view of ["a", "b"]) {
      await page.frameLocator(`iframe[data-frame="${view}"]`).locator("#inside").click();
      await page.waitForFunction(v => document.querySelector(".split-tabs-focus")?.dataset.paneOf === window.controller.paneOf(v), view);
      const mark = page.locator(".split-tabs-focus");
      assert.equal(await mark.getAttribute("data-pane-id"), null);
      const r = await box(await pane(page, view));
      const x = Math.floor(r.x + r.width - 2), y = Math.floor(r.y + r.height / 2);
      const iframe = await box(frame(page, view));
      assert.ok(x >= iframe.x && x < iframe.x + iframe.width && y >= iframe.y && y < iframe.y + iframe.height,
        "sample is inside the pane's iframe, not the tab bar");
      const [red, green, blue] = await screenshotPixel(page, x, y);
      assert.ok(red >= 200 && green <= 60 && blue <= 60, `focus border pixel: rgb(${red},${green},${blue})`);
      assert.equal(await keep(page, view).evaluate(el => getComputedStyle(el).opacity), "1");
      assert.equal(await keep(page, view === "a" ? "b" : "a").evaluate(el => getComputedStyle(el).opacity), "0.3");
    }
  }],
  ["closeButton defaults to active, selects inactive closable labels, and switches always/never live", async page => {
    await page.evaluate(() => { window.controller.open("d"); window.controller.open("e"); });
    await label(page, "d").click();
    const opened = await page.evaluate(() => [...window.controller.opened.value]);
    const inactive = page.locator('[data-split-tabs-tab="e"]');
    await inactive.hover();
    assert.equal(await inactive.locator(".split-tab-strip-close").count(), 0, "hover cannot expose an inactive default close button");
    await label(page, "e").click();
    assert.equal(await label(page, "e").getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.evaluate(() => [...window.controller.opened.value]), opened);
    assert.equal(await inactive.count(), 1, "label activation keeps the optional tab open");
    assert.equal(await inactive.locator(".split-tab-strip-close").evaluate(el => getComputedStyle(el).opacity), "1");
    await page.evaluate(() => { window.fixture.closeButton = "always"; });
    await page.locator("#shell-focus").hover();
    for (const view of ["d", "e"]) {
      assert.equal(await page.locator(`[data-split-tabs-tab="${view}"] .split-tab-strip-close`)
        .evaluate(el => getComputedStyle(el).opacity), "1", "always paints even the inactive, unhovered close button");
    }
    assert.equal(await page.locator(".split-tab-strip-close").count(), 2, "nonclosable tabs never get a close button");
    await page.evaluate(() => { window.fixture.closeButton = "never"; });
    await inactive.hover();
    assert.equal(await page.locator(".split-tab-strip-close").count(), 0);
    assert.deepEqual(await page.evaluate(() => [...window.controller.opened.value]), opened);
  }, "?n=5&optional=d,e"],
  ["side bar resize tracks overlays live over iframe content, writes once, and survives reload", async page => {
    assert.equal(await page.evaluate(() => window.controller.cycleBarSide().ok), true);
    const strip = page.locator('.split-tab-strip[data-side="left"]');
    const before = await page.evaluate(() => window.writes.length);
    const initial = await box(strip);
    const p = await point(strip.locator(".split-tab-strip-resize"));
    const content = await box(frame(page, "a"));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForSelector(".split-tabs--resizing");
    for (const delta of [30, 80, 50, 120]) {
      const x = p.x + delta;
      assert.ok(x > content.x && x < content.x + content.width, "real mouse crosses the iframe's initial content area");
      await page.mouse.move(x, p.y, { steps: 3 });
      await page.waitForFunction(() => {
        const bar = document.querySelector('.split-tab-strip[data-side="left"]').getBoundingClientRect();
        const overlay = document.querySelector('[data-split-tabs-keep="a"]').getBoundingClientRect();
        return Math.abs(overlay.left - bar.right) <= 1;
      });
      const bar = await box(strip), overlay = await box(keep(page, "a"));
      assert.ok(Math.abs(bar.width - initial.width - delta) <= 1, `bar follows mouse at ${delta}px`);
      assert.ok(Math.abs(overlay.x - bar.x - bar.width) <= 1, "overlay follows the bar at every step");
      assert.deepEqual(await page.locator("iframe[data-frame]").evaluateAll(els => els.map(el => getComputedStyle(el).pointerEvents)), ["none", "none"]);
      assert.equal(await page.evaluate(() => window.writes.length), before, "live resize does not persist");
    }
    const final = (await box(strip)).width;
    await releaseMouse(page);
    assert.equal(await page.evaluate(() => window.writes.length), before + 1);
    assert.equal(await frame(page, "a").evaluate(el => getComputedStyle(el).pointerEvents), "auto");
    await page.reload();
    await ready(page);
    assert.ok(Math.abs((await box(page.locator('.split-tab-strip[data-side="left"]'))).width - final) <= 1, "saved width restores");
  }, "?n=2"],
  ["dividerSize 1 paints one pixel but a press 3px off centre still resizes", async page => {
    await splitOff(page, "b", "a", "right");
    const divider = page.locator(".split-tabs-divider");
    const r = await box(divider);
    assert.ok(Math.abs(r.width - 1) <= 0.01, `divider width ${r.width}`);
    const p = { x: r.x + r.width / 2 + 3, y: r.y + r.height / 2 };
    const hit = await page.evaluate(({ x, y }) => ({
      target: document.elementFromPoint(x, y).tagName,
      divider: document.elementFromPoint(x, y).classList.contains("split-tabs-divider"),
      dividerZ: getComputedStyle(document.querySelector(".split-tabs-divider")).zIndex,
      overlayZ: getComputedStyle(document.querySelector(".split-tabs-keep-layer")).zIndex,
    }), p);
    assert.equal(hit.divider, true, `expanded hit zone wins even above iframe content: ${JSON.stringify(hit)}`);
    const before = await page.evaluate(() => window.writes.length);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForSelector(".split-tabs--resizing");
    await page.mouse.move(p.x + 80, p.y, { steps: 5 });
    await page.waitForFunction(() => [...window.controller.cuts.value.values()][0].ratio > 0.58);
    await releaseMouse(page);
    assert.equal(await page.evaluate(() => window.writes.length), before + 1);
    assert.ok(Math.abs((await box(divider)).width - 1) <= 0.01);
  }, "?dividerSize=1"],
  ["mouse label right-quarter drop splits the pane", async page => {
    await startMouse(page, label(page, "b"));
    await moveMouse(page, await point(await pane(page, "a"), 0.88, 0.5));
    await page.waitForSelector('.split-tabs-drop-shade[data-zone="split"][data-side="right"]:not([data-refused])');
    await releaseMouse(page);
    await expectNotation(page, "H[(*a c) b]");
  }],
  ["mouse middle drop creates an inner bar; bar drop inserts at its marker", async page => {
    await startMouse(page, label(page, "b"));
    await moveMouse(page, await point(await pane(page, "a")));
    await page.waitForSelector('.split-tabs-drop-shade[data-zone="inside"]:not([data-refused])');
    await releaseMouse(page);
    await expectNotation(page, "T{*(a *b) | c}");
    assert.equal(await page.locator("[data-frame-id]").count(), 1);
    const target = page.locator('[data-split-tabs-tab="b"]');
    const destination = await point(target, 0.1);
    await startMouse(page, label(page, "c"));
    await moveMouse(page, destination);
    const marker = page.locator('.split-tabs-drop-shade[data-marker]:not([data-refused])');
    await marker.waitFor();
    const mr = await box(marker), tr = await box(target);
    assert.ok(Math.abs(mr.x + mr.width / 2 - tr.x) <= 1, "marker aligns with insertion slot");
    await releaseMouse(page);
    await expectNotation(page, "(a *c b)");
  }],
  ["mouse drag spring-loads a hidden tab after 500ms", async page => {
    await startMouse(page, label(page, "b"));
    await moveMouse(page, await point(label(page, "c")));
    await page.waitForSelector('[data-split-tabs-tab="c"].split-tab-strip-item--spring');
    await page.waitForFunction(() => window.controller.panes.value[0].view === "c");
    await page.keyboard.press("Escape");
    await releaseMouse(page);
    await expectNotation(page, "(a b *c)");
  }],
  ["bin appears only during a drag; optional close and Undo restore exact notation", async page => {
    await page.evaluate(() => window.controller.open("d"));
    const before = await notation(page);
    assert.equal(await page.locator("[data-split-tabs-bin]").count(), 0);
    await startMouse(page, label(page, "d"));
    assert.equal(await page.locator("[data-split-tabs-bin]").evaluate(el => el.tabIndex), -1, "pointer-only bin is not a keyboard stop");
    await moveMouse(page, await point(page.locator("[data-split-tabs-bin]")));
    await page.waitForSelector('[data-split-tabs-bin][data-hot]');
    await releaseMouse(page);
    await expectNotation(page, "(*a b c)");
    assert.deepEqual(await page.evaluate(() => [...window.controller.opened.value]), []);
    await page.locator("#undo").click();
    await expectNotation(page, before);
    assert.equal(await page.locator("#undo").count(), 0);
  }],
  ["close button closes without dragging; Undo restores the optional view", async page => {
    await page.evaluate(() => window.controller.open("d"));
    const before = await notation(page);
    await page.locator('[data-split-tabs-tab="d"] .split-tab-strip-close').click();
    assert.equal(await page.evaluate(() => window.sawGhost), false);
    await page.locator("#undo").click();
    await expectNotation(page, before);
  }],
  ["R12 arrange controls swallow E and X without moving keyboard focus", async page => {
    await page.evaluate(() => {
      window.controller.open("d"); window.controller.close("d"); window.controller.split("right"); window.runLayout("arrange");
    });
    await page.waitForSelector("#done");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".split-tabs-arrange-menu-button").evaluate(el => el === document.activeElement), true);
    for (const selector of ["#done", ".split-tabs-arrange-menu-button", "#undo", ".split-tab-strip-tab"]) {
      const target = page.locator(selector).first();
      await target.focus();
      const before = await page.evaluate(() => ({ intent: JSON.stringify(window.controller.intent.value),
        commands: window.commands.length, writes: window.writes.length }));
      for (const letter of ["E", "X"]) {
        await chord(page, letter);
        assert.deepEqual(await page.evaluate(() => ({ intent: JSON.stringify(window.controller.intent.value),
          commands: window.commands.length, writes: window.writes.length })), before);
        assert.equal(await target.evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator(".split-tabs--arranging").count(), 1);
      }
    }
    await chord(page, "A");
    await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
  }, "?arrangeSlot=1"],
  ["physical E O T I chords create the specified placeholder layouts", async page => {
    await chord(page, "E");
    await expectNotation(page, "H[(*a b c) new:1]");
    await chord(page, "O");
    await expectNotation(page, "H[(*a b c) V[new:1 new:2]]");
    await chord(page, "T");
    await expectNotation(page, "H[(*a b c) V[new:1 (new:2 *new:3)]]");
    await chord(page, "I");
    await expectNotation(page, "H[(*a b c) V[new:1 T{new:2 | *(new:3 *new:4)}]]");
  }],
  ["H J K L chords move focus geometrically", async page => {
    await grid(page);
    for (const [key, view] of [["L", "b"], ["J", "d"], ["H", "c"], ["K", "a"]]) {
      await chord(page, key);
      // The keyboard follows the focus into pane iframes: their chords reach the shell one message later.
      await page.waitForFunction(v => window.controller.panes.value.find(p => p.id === window.controller.focus.value)?.view === v, view);
    }
  }],
  ["M letters toggle selection, G groups, Escape clears, Z zooms/restores", async page => {
    await grid(page);
    await chord(page, "M");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="letter"]');
    assert.deepEqual(await page.locator(".split-tabs-pane-number-badge").allTextContents(), ["a", "b", "c", "d"]);
    await page.keyboard.press("c");
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 2);
    await page.keyboard.press("c");
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 1);
    await page.keyboard.press("c");
    await page.keyboard.press("Enter");
    await chord(page, "G");
    await expectNotation(page, "V[H[a b] H[c d]]");
    assert.deepEqual(await page.evaluate(() => window.commands.filter(([name]) => name === "group").map(([, r]) => r.kind)), ["exact"]);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 0);
    const before = await notation(page);
    await chord(page, "Z");
    await expectNotation(page, "a");
    assert.notEqual(await page.evaluate(() => window.controller.zoomed.value), null);
    await chord(page, "Z");
    await expectNotation(page, before);
  }],
  ["R cycles the visible bar through all four sides", async page => {
    for (const side of ["left", "bottom", "right", "top"]) {
      await chord(page, "R");
      const strip = page.locator(".split-tab-strip");
      assert.equal(await strip.getAttribute("data-side"), side);
      assert.equal(await strip.evaluate(el => el.classList.contains("split-tab-strip--vertical")), ["left", "right"].includes(side));
    }
  }],
  ["focused labels reorder with Alt+Shift+arrows and retain keyboard activation", async page => {
    const button = label(page, "b");
    await button.focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    assert.deepEqual(await order(page), ["a", "c", "b"]);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Enter");
    await expectNotation(page, "(a c *b)");
  }],
  ["iframe-focused physical chords are forwarded to the shell", async page => {
    await page.frameLocator('iframe[data-frame="a"]').locator("#inside").click();
    assert.equal(await frame(page, "a").evaluate(el => document.activeElement === el && el.contentDocument.activeElement.id === "inside"), true);
    await chord(page, "E");
    await expectNotation(page, "H[(*a b c) new:1]");
    // The E release happens in the iframe and is reported AFTER the page saw Shift and Alt released:
    // that late report must not turn the covers back on.
    await page.waitForFunction(() => !document.querySelector(".split-tabs--grab"));
  }],
  ["a layout key that moves the focus also moves the keyboard into the newly focused pane", async page => {
    await grid(page);
    const keysIn = view => frame(page, view).evaluate(el => [...el.contentWindow.keys]);
    await page.frameLocator('iframe[data-frame="a"]').locator("#inside").click();
    await page.keyboard.press("Alt+Shift+KeyL");
    await page.waitForFunction(() => window.controller.focus.value === window.controller.paneOf("b"));
    await page.waitForFunction(() => document.activeElement === document.querySelector('iframe[data-frame="b"]'));
    await page.keyboard.press("x");
    assert.deepEqual((await keysIn("b")).filter(k => k === "x"), ["x"], "typing goes to the newly focused iframe");
    assert.deepEqual((await keysIn("a")).filter(k => k === "x"), [], "the previous iframe no longer receives typing");
    // Pane c holds no iframe: the keyboard leaves iframe b for the pane c itself.
    await page.keyboard.press("Alt+Shift+KeyH");
    await page.keyboard.press("Alt+Shift+KeyJ");
    await page.waitForFunction(() => window.controller.focus.value === window.controller.paneOf("c"));
    assert.equal(await page.evaluate(() => document.activeElement?.closest("[data-pane-id]")?.dataset.paneId ?? null),
      await page.evaluate(() => window.controller.paneOf("c")));
    await page.keyboard.press("y");
    assert.deepEqual((await keysIn("b")).filter(k => k === "y"), []);
  }],
  ["from inside an iframe, Alt+Shift+M then letters select panes, and Escape cancels a keyboard move", async page => {
    await grid(page);
    await page.frameLocator('iframe[data-frame="a"]').locator("#inside").click();
    await page.keyboard.press("Alt+Shift+KeyM");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="letter"]');
    await page.keyboard.press("c");
    await page.waitForFunction(() => window.controller.selection.value.length === 2);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".split-tabs-pane-number"));
    await page.keyboard.press("Alt+Shift+KeyV");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="letter"]');
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".split-tabs-pane-number"));
    await expectNotation(page, "H[V[a c] V[b d]]");
  }],
  ["with the keyboard outside the layout, chord+click still selects panes, over iframes and plain content", async page => {
    await grid(page);
    await page.frameLocator("#foreign").locator("#outside").click();
    for (const key of ["Control", "Alt", "Shift"]) await page.keyboard.down(key);
    try {
      const selected = () => page.evaluate(() => [...window.controller.selection.value].sort());
      const ids = await page.evaluate(() => Object.fromEntries(["a", "b", "c", "d"].map(v => [v, window.controller.paneOf(v)])));
      // Pane b holds an iframe: the click itself lands in it (no cover yet), and the iframe reports it.
      const b = await point(await pane(page, "b"));
      await page.mouse.click(b.x, b.y);
      await page.waitForFunction(n => window.controller.selection.value.length === n, 2);
      assert.deepEqual(await selected(), [ids.a, ids.b].sort());
      // Pane c holds plain content in this document.
      const c = await point(await pane(page, "c"));
      await page.mouse.click(c.x, c.y);
      await page.waitForFunction(n => window.controller.selection.value.length === n, 3);
      // Moving over pane d with the keys held shows the cover before the click.
      const d = await point(await pane(page, "d"));
      await page.mouse.move(d.x - 20, d.y);
      await page.mouse.move(d.x, d.y, { steps: 3 });
      await page.waitForSelector(".split-tabs-pane-cover");
      await page.mouse.click(d.x, d.y);
      await page.waitForFunction(n => window.controller.selection.value.length === n, 4);
      assert.equal(await page.evaluate(() => window.controller.focus.value), ids.a, "selection clicks never move the focus");
    } finally {
      for (const key of ["Shift", "Alt", "Control"]) await page.keyboard.up(key);
    }
  }, "?chords=ctrl"],
  ["overlay content follows its pane's content area when a bar appears without a layout change", async page => {
    await splitOff(page, "b", "a", "right");
    const gap = () => page.evaluate(() => ["a", "b"].map(v => {
      const strip = document.querySelector(`[data-bar-id="${window.controller.paneOf(v)}"]`).getBoundingClientRect();
      const content = document.querySelector(`[data-split-tabs-keep="${v}"]`).getBoundingClientRect();
      return { bar: Math.round(strip.height), top: Math.round(content.top - strip.bottom) };
    }));
    await page.evaluate(() => { window.fixture.alwaysShow = true; });
    await page.waitForFunction(() => [...document.querySelectorAll(".split-tab-strip")].every(s => s.getBoundingClientRect().height > 0));
    await page.waitForFunction(() => ["a", "b"].every(v => {
      const strip = document.querySelector(`[data-bar-id="${window.controller.paneOf(v)}"]`).getBoundingClientRect();
      return Math.abs(document.querySelector(`[data-split-tabs-keep="${v}"]`).getBoundingClientRect().top - strip.bottom) <= 1;
    }), undefined, { timeout: 2000 }).catch(async () => assert.fail(`content does not start under its bar: ${JSON.stringify(await gap())}`));
  }, "?paneSlot=1"],
  ["chord-selecting two panes of a row then Alt+Shift+Z zooms exactly them; again restores all", async page => {
    await grid(page);
    for (const key of ["Control", "Alt", "Shift"]) await page.keyboard.down(key);
    try {
      const b = await point(await pane(page, "b"));
      await page.mouse.move(b.x - 20, b.y);
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await page.waitForSelector(".split-tabs-pane-cover");
      await page.mouse.click(b.x, b.y);
      await page.waitForFunction(() => window.controller.selection.value.length === 2);
    } finally {
      for (const key of ["Shift", "Alt", "Control"]) await page.keyboard.up(key);
    }
    await chord(page, "Z");
    await page.waitForFunction(() => window.controller.panes.value.map(p => p.view).join() === "a,b");
    await chord(page, "Z");
    await page.waitForFunction(() => window.controller.panes.value.length === 4);
    await expectNotation(page, "V[H[a b] H[c d]]");
  }, "?chords=ctrl"],
  ["overlay iframes keep their DOM nodes, markers and load counts across split/move/zoom/restore", async page => {
    await iframeSnapshot(page);
    await startMouse(page, label(page, "b"));
    await moveMouse(page, await point(await pane(page, "a"), 0.88, 0.5));
    await releaseMouse(page);
    await expectNotation(page, "H[(*a c) b]");
    await unchangedFrames(page);
    await page.locator("#shell-focus").click();
    await chord(page, "Z");
    await expectNotation(page, "b");
    await unchangedFrames(page);
    await chord(page, "Z");
    await expectNotation(page, "H[(*a c) b]");
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await startMouse(page, (await pane(page, "b")).locator(".split-tabs-pane-cover"));
    await moveMouse(page, await point(await pane(page, "a"), 0.5, 0.88));
    await releaseMouse(page);
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    await expectNotation(page, "V[(*a c) b]");
    await unchangedFrames(page);
  }],
  ["Alt+Shift covers intercept iframe clicks for selection and pane drags", async page => {
    await splitOff(page, "b", "a", "right");
    await page.locator("#shell-focus").click();
    await page.evaluate(() => window.controller.focusPane(window.controller.paneOf("a")));
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    const cover = (await pane(page, "b")).locator(".split-tabs-pane-cover");
    const p = await point(cover);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).classList.contains("split-tabs-pane-cover"), p), true);
    await cover.click();
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 2);
    await page.evaluate(() => window.controller.clearSelection());
    await clean(page);
    await startMouse(page, cover);
    await moveMouse(page, await point(await pane(page, "a"), 0.5, 0.88));
    await releaseMouse(page);
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    await expectNotation(page, "V[(*a c) b]");
    assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0);
  }],
  ["divider drag changes ratio live, writes once on release; double press equalizes", async page => {
    await splitOff(page, "b", "a", "right");
    const divider = page.getByRole("separator", { name: "Resize", exact: true });
    const p = await point(divider);
    const before = await page.evaluate(() => window.writes.length);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForSelector(".split-tabs--resizing");
    await page.mouse.move(p.x + 100, p.y, { steps: 8 });
    await page.waitForFunction(() => [...window.controller.cuts.value.values()][0].ratio > 0.6);
    assert.equal(await page.evaluate(() => window.writes.length), before);
    await releaseMouse(page);
    assert.equal(await page.evaluate(() => window.writes.length), before + 1);
    // A moved drag is not a first click of the next double press.
    await divider.dblclick();
    await page.waitForFunction(() => Math.abs([...window.controller.cuts.value.values()][0].ratio - 0.5) < 0.001);
    assert.equal(await page.evaluate(() => window.writes.length), before + 2);
    await clean(page);
  }],
  ["a dragged divider snaps exactly onto a parallel divider, from either side, under its guide", async page => {
    await grid(page);
    const dragged = (await pane(page, "b")).locator("xpath=ancestor::*[@data-split-tabs-cut][1]").locator(":scope > .split-tabs-divider");
    const all = page.locator('.split-tabs-divider[aria-orientation="horizontal"]');
    assert.equal(await all.count(), 2);
    const other = await all.nth(0).evaluate(el => el.dataset.cut) === await dragged.getAttribute("data-cut") ? all.nth(1) : all.nth(0);
    for (const offset of [4, -4]) {
      const p = await point(dragged);
      const goal = await box(other);
      const centre = goal.y + goal.height / 2;
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x, p.y + 40 * Math.sign(-offset || 1), { steps: 4 });
      await page.mouse.move(p.x, centre + offset, { steps: 4 });
      await page.waitForSelector('.split-tabs-guide[data-axis="y"]');
      const guide = await box(page.locator(".split-tabs-guide"));
      assert.ok(Math.abs(guide.y + guide.height / 2 - centre) <= 0.01, `guide ${guide.y + guide.height / 2} at divider centre ${centre}`);
      await releaseMouse(page);
      const a = await box(dragged), b = await box(other);
      assert.ok(Math.abs(a.y - b.y) <= 0.01 && Math.abs(a.height - b.height) <= 0.01,
        `pointer ${offset}px from it: dragged divider ${a.y}-${a.y + a.height}, other ${b.y}-${b.y + b.height}`);
      // Move away again before approaching from the other side.
      const q = await point(dragged);
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      await page.mouse.move(q.x, q.y + 60 * Math.sign(offset), { steps: 6 });
      await releaseMouse(page);
    }
  }],
  ["held horizontal CDP touch reorders and ends on pointerup", async (page, cdp) => {
    const start = await touchStart(page, cdp, label(page, "b"));
    const dest = await point(page.locator('[data-split-tabs-tab="c"]'), 0.9);
    await touchMove(page, cdp, start, dest);
    await page.waitForSelector(".split-tabs-drop-shade[data-marker]");
    await touchEnd(page, cdp);
    assert.deepEqual(await order(page), ["a", "c", "b"]);
    const log = await page.evaluate(() => window.pointerLog);
    assert.ok(log.includes("pointerup:touch"), JSON.stringify(log));
    assert.ok(!log.includes("pointercancel:touch"), JSON.stringify(log));
  }, "", { cdp: true }],
  ["held vertical CDP touch splits at a pane bottom quarter", async (page, cdp) => {
    const start = await touchStart(page, cdp, label(page, "b"));
    await touchMove(page, cdp, start, await point(await pane(page, "a"), 0.5, 0.88));
    await page.waitForSelector('.split-tabs-drop-shade[data-zone="split"][data-side="bottom"]:not([data-refused])');
    await touchEnd(page, cdp);
    await expectNotation(page, "V[(*a c) b]");
    assert.ok(!(await page.evaluate(() => window.pointerLog)).includes("pointercancel:touch"));
  }, "", { cdp: true }],
  ["quick CDP strip swipe scrolls without arming or dragging", async (page, cdp) => {
    await page.locator("#host").evaluate(el => { el.style.width = "200px"; });
    await page.waitForFunction(() => document.querySelector(".split-tab-strip").scrollWidth > 200);
    const before = await order(page);
    const start = await touchStart(page, cdp, label(page, "b"), false);
    await touchMove(page, cdp, start, { x: start.x - 90, y: start.y });
    await touchEnd(page, cdp);
    await page.waitForFunction(() => document.querySelector(".split-tab-strip").scrollLeft > 0);
    assert.deepEqual(await order(page), before);
    assert.equal(await page.evaluate(() => window.sawGhost), false);
  }, "?n=12", { cdp: true }],
  ["Escape cancels an armed touch drag and removes its listeners", async (page, cdp) => {
    const before = await notation(page);
    const start = await touchStart(page, cdp, label(page, "b"));
    await touchMove(page, cdp, start, { x: start.x + 100, y: start.y + 60 });
    await page.waitForSelector(".split-tabs-drag-ghost");
    await page.keyboard.press("Escape");
    await touchEnd(page, cdp);
    await expectNotation(page, before);
  }, "", { cdp: true }],
  ["shell four-finger hold toggles arrange; one-finger cover tap selects; pinch zooms/restores", async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    // c is ordinary shell content, not an iframe; native touches reach shell.ts directly.
    await label(page, "c").click();
    const center = await point(await pane(page, "c"));
    await fourStart(cdp, center, 35);
    await page.waitForSelector(".split-tabs--arranging");
    await touchEnd(page, cdp);
    const cover = (await pane(page, "c")).locator(".split-tabs-pane-cover");
    const p = await point(cover);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
    await touchEnd(page, cdp);
    assert.equal(await page.evaluate(() => window.controller.selection.value.length), 1);
    await pinch(page, cdp, center, 30, 65);
    await page.waitForFunction(() => window.controller.zoomed.value !== null);
    await pinch(page, cdp, await point(await pane(page, "c")), 65, 25);
    await page.waitForFunction(() => window.controller.zoomed.value === null);
    await fourStart(cdp, center, 35);
    await page.waitForFunction(() => !document.querySelector(".split-tabs--arranging"));
    await touchEnd(page, cdp);
  }, "", { cdp: true }],
  ["iframe four-finger reports hold and pinch to the shell without reloading", async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    await iframeSnapshot(page);
    const center = await point(frame(page, "a"));
    await fourStart(cdp, center, 35);
    await page.waitForSelector(".split-tabs--arranging");
    await touchEnd(page, cdp);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".split-tabs--arranging"));
    await pinch(page, cdp, center, 30, 65);
    await page.waitForFunction(() => window.controller.zoomed.value !== null);
    await pinch(page, cdp, await point(frame(page, "a")), 65, 25);
    await page.waitForFunction(() => window.controller.zoomed.value === null);
    await unchangedFrames(page);
    assert.ok(await frame(page, "a").evaluate(el => el.contentWindow.claims.includes("hold")));
    assert.ok(await frame(page, "a").evaluate(el => el.contentWindow.claims.includes("pinch-out")));
    assert.ok(await frame(page, "a").evaluate(el => el.contentWindow.claims.includes("pinch-in")));
  }, "", { cdp: true }],
  ...["iframe-first", "shell-first"].map(lift => [`mixed-document releases promptly clear covers and blockers: ${lift}`, async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    await label(page, "c").click();
    const inside = await point(frame(page, "b")), outside = await point(await pane(page, "c"));
    const points = [{ ...inside, id: 1 }, { x: inside.x + 35, y: inside.y, id: 2 },
      { ...outside, id: 3 }, { x: outside.x + 35, y: outside.y, id: 4 }];
    for (let n = 1; n <= points.length; n++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, n) });
    }
    await moveFingers(page, cdp, points, -20, 2);
    await page.waitForSelector(".split-tabs-pane-cover");
    const releasedFirst = lift === "iframe-first" ? points.slice(0, 2) : points.slice(2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: releasedFirst.map(p => ({ ...p, y: p.y - 20 })) });
    // Deliberately bypass touchEnd()/clean(): their 5s wait used to hide ghost fingers.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const released = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      covers: document.querySelectorAll(".split-tabs-pane-cover").length,
      shell: window.listenersAtRest(),
      frames: [...document.querySelectorAll("iframe[data-frame]")].map(el => el.contentWindow.touchBlockers()),
    })))));
    assert.deepEqual(released, { covers: 0, shell: true, frames: [0, 0] });
  }, "?scroll=1", { cdp: true }]),
  ["from the third finger the layout owns touch over scrollable and iframe panes: no scroll, no click, hold toggles", async (page, cdp) => {
    await splitOff(page, "b", "a", "right");
    await label(page, "c").click();
    const scroll = {
      c: () => page.locator('[data-content="c"]').evaluate(el => el.scrollTop),
      b: () => frame(page, "b").evaluate(el => el.contentDocument.scrollingElement.scrollTop),
    };
    const reset = view => view === "c" ? page.locator('[data-content="c"]').evaluate(el => { el.scrollTop = 0; })
      : frame(page, "b").evaluate(el => { el.contentDocument.scrollingElement.scrollTop = 0; el.contentWindow.clicks = 0; });
    for (const [view, target] of [["c", await pane(page, "c")], ["b", frame(page, "b")]]) {
      const center = await point(target);
      // Controls: one finger scrolls this content and a tap clicks it, so their absence below is the library's doing.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...center, id: 9 }] });
      await moveFingers(page, cdp, [{ ...center, id: 9 }], -150);
      await page.waitForTimeout(300); // Resting before the lift leaves no fling to scroll on after the reset.
      await touchEnd(page, cdp);
      assert.ok(await scroll[view]() > 0, `one finger scrolls ${view}`);
      if (view === "b") {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...center, id: 9 }] });
        await touchEnd(page, cdp);
        await page.waitForFunction(() => document.querySelector('iframe[data-frame="b"]').contentWindow.clicks > 0);
      }
      await reset(view);
      await page.evaluate(() => { window.pointerLog.length = 0; });
      // Four fingers land one by one and pan: the browser never starts its own gesture.
      const four = await landFingers(page, cdp, center, 35);
      await page.waitForSelector(".split-tabs-pane-cover");
      await moveFingers(page, cdp, four, -150);
      await touchEnd(page, cdp);
      assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0, "covers end when every finger lifted");
      assert.equal(await scroll[view](), 0, `four fingers do not scroll ${view}`);
      assert.deepEqual(await page.evaluate(() => window.pointerLog.filter(e => e === "pointercancel:touch")), []);
      // A four-finger hold toggles arrange mode, and again back, without scrolling or clicking the content.
      await landFingers(page, cdp, center, 35);
      await page.waitForSelector(".split-tabs--arranging");
      await touchEnd(page, cdp);
      await landFingers(page, cdp, center, 35);
      await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
      await touchEnd(page, cdp);
      assert.equal(await scroll[view](), 0);
      if (view === "b") assert.equal(await frame(page, "b").evaluate(el => el.contentWindow.clicks), 0, "iframe content got no click");
    }
  }, "?scroll=1", { cdp: true }],
];

acceptanceCases.push(["modal exit keys capture page and iframe input after divider long press without clear", async page => {
  await splitOff(page, "b", "a", "right");
  const paneFrame = page.frameLocator('iframe[data-frame="a"]');
  const input = paneFrame.locator("#frame-input");
  for (const target of [page.locator("#host-input"), page.locator("#host-editable"), input]) {
    await target.evaluate(el => {
      window.modalEvents = [];
      for (const type of ["keydown", "keyup"]) {
        el.addEventListener(type, e => { if (["Escape", "KeyG", "KeyD"].includes(e.code)) window.modalEvents.push(`target:${type}`); });
        if (!window.modalObserved) window.addEventListener(type, e => {
          if (["Escape", "KeyG", "KeyD"].includes(e.code)) window.modalEvents.push(`bubble:${type}`);
        });
      }
      window.modalObserved = true;
    });
    for (const key of ["Escape", "Control+KeyG", "Control+KeyD"]) {
      const p = await point(page.locator(".split-tabs-divider"));
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForSelector(".split-tabs--arranging");
      await page.mouse.up();
      await page.waitForFunction(() => [...document.querySelectorAll("iframe[data-frame]")].every(el => el.contentWindow.exitKeys.length === 4));
      // Programmatic focus avoids an outside press; the native keyboard still targets the real field.
      await target.focus();
      await target.evaluate(el => { window.modalEvents = []; if (el instanceof HTMLInputElement) el.value = "sentinel"; else el.textContent = "sentinel"; });
      await page.keyboard.press(key);
      await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
      assert.deepEqual(await target.evaluate(el => ({ events: window.modalEvents, value: el instanceof HTMLInputElement ? el.value : el.textContent })),
        { events: [], value: "sentinel" });
      await page.waitForFunction(() => [...document.querySelectorAll("iframe[data-frame]")].every(el => el.contentWindow.exitKeys.length === 0));
      await page.keyboard.press(key);
      assert.deepEqual(await target.evaluate(() => window.modalEvents), ["target:keydown", "bubble:keydown", "target:keyup", "bubble:keyup"]);
    }
  }
}, "?keymap=zoom"]);

acceptanceCases.push(["arrange isolates iframe typing and clicks; Q exits; menu creates a placeholder", async (page, cdp) => {
  await splitOff(page, "b", "a", "right");
  const input = page.frameLocator('iframe[data-frame="a"]').locator("#frame-input");
  await input.evaluate(el => {
    window.arrangeEvents = [];
    for (const type of ["keydown", "keyup", "pointerdown", "click", "touchstart", "touchmove", "wheel"])
      window.addEventListener(type, e => window.arrangeEvents.push(e.type));
    el.value = "sentinel";
  });
  const divider = await point(page.locator(".split-tabs-divider"));
  await page.mouse.move(divider.x, divider.y); await page.mouse.down();
  await page.waitForSelector(".split-tabs--arranging"); await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll("iframe[data-frame]")].every(el => el.contentWindow.exitKeys.includes("KeyQ")));
  const p = await point(frame(page, "a"));
  await page.mouse.click(p.x, p.y);
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await input.focus(); await page.keyboard.press("KeyX");
  assert.deepEqual(await input.evaluate(el => ({ value: el.value, events: window.arrangeEvents })), { value: "sentinel", events: [] });
  await page.keyboard.press("KeyQ");
  await page.waitForSelector(".split-tabs--arranging", { state: "detached" });
  await page.waitForFunction(() => [...document.querySelectorAll("iframe[data-frame]")].every(el => el.contentWindow.exitKeys.length === 0));
  await page.keyboard.press("KeyX");
  assert.equal(await input.inputValue(), "sentinelx");
  await page.evaluate(() => window.runLayout("arrange"));
  await page.locator(".split-tabs-arrange-menu-button").click();
  const before = await page.evaluate(() => window.controller.panes.value.length);
  await page.locator('[data-menu-item="splitRight"]').click();
  assert.equal(await page.evaluate(() => window.controller.panes.value.length), before + 1);
  assert.match(await page.evaluate(() => window.controller.panes.value.find(p => p.id === window.controller.focus.value).view), /^new:/);
  await page.keyboard.press("KeyQ");
}, "", { touch: true }]);

acceptanceCases.push(["trusted physical Meta survives synthetic releases and clears on real release", async page => {
  await splitOff(page, "b", "a", "right");
  await page.locator("#host-input").focus();
  await page.evaluate(async () => {
    const { createChordTracker } = await import("/dist/index.js");
    window.hostTracker = createChordTracker();
  });
  try {
    await page.keyboard.down("Meta");
    const held = () => page.evaluate(() => window.hostTracker.modifiers({ ctrlKey: false, altKey: false,
      shiftKey: false, metaKey: false }).metaKey);
    assert.equal(await held(), true, "trusted down records the physical key independently of native modifier flags");
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("blur"));
      // A real, non-bubbling element focus must cancel the pending 500 ms Meta clear.
      document.querySelector(".split-tabs-pane").focus();
      await new Promise(resolve => setTimeout(resolve, 550));
    });
    assert.equal(await held(), true, "content refocus preserves trusted Win beyond the blur deadline");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", code: "MetaLeft" })));
    assert.equal(await held(), true, "a synthetic release cannot clear physical state");
    await page.keyboard.up("Meta");
    assert.equal(await held(), false);
    await page.evaluate(() => window.controller.focusPane(window.controller.paneOf("a")));
    await page.locator("#host-input").focus();
    await chord(page, "L");
    await page.waitForFunction(() => window.controller.focus.value === window.controller.paneOf("b"));
  } finally {
    await page.keyboard.up("Meta");
    await page.evaluate(() => { window.hostTracker.dispose(); delete window.hostTracker; });
  }
}]);

acceptanceCases.push(["display-panes numbers focus pane 2 and transfer typing without leaking digit events", async page => {
  await splitOff(page, "b", "a", "right");
  const second = page.frameLocator('iframe[data-frame="b"]').locator("#frame-input");
  await second.evaluate(() => {
    window.displayDigits = [];
    for (const type of ["keydown", "keyup"]) window.addEventListener(type, e => {
      if (e.code === "Digit2") window.displayDigits.push(type);
    });
  });
  for (const origin of [page.locator("#host-input"), page.frameLocator('iframe[data-frame="a"]').locator("#frame-input")]) {
    await origin.focus();
    await chord(page, "Q");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="display"]');
    assert.deepEqual(await page.locator('.split-tabs-pane-number[data-mode="display"] .split-tabs-pane-number-badge').allTextContents(), ["1", "2"]);
    await page.keyboard.press("Digit2");
    await page.waitForSelector('.split-tabs-pane-number[data-mode="display"]', { state: "detached" });
    await page.waitForFunction(() => window.controller.focus.value === window.controller.paneOf("b"));
    assert.equal(await frame(page, "b").evaluate(el => document.activeElement === el), true);
    assert.deepEqual(await second.evaluate(() => window.displayDigits), []);
    await page.keyboard.press("KeyX");
    assert.equal(await frame(page, "b").evaluate(el => el.contentWindow.keys.at(-1)), "x");
  }
}]);

async function clusterFixture(page, arrange = false) {
  await grid(page);
  if (arrange) await page.evaluate(() => window.runLayout("arrange"));
  await page.evaluate(() => {
    const c = window.controller;
    c.setSelection([c.paneOf("a"), c.paneOf("b")]);
    window.writes.length = 0;
  });
}
async function startPaneMouse(page, view) {
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await startMouse(page, (await pane(page, view)).locator(".split-tabs-pane-cover"));
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
}
const layoutSnapshot = page => page.evaluate(() => JSON.stringify({ notation: window.controller.notation.value,
  intent: window.controller.intent.value, selection: window.controller.selection.value, focus: window.controller.focus.value,
  storage: Object.entries(localStorage), writes: window.writes }));

acceptanceCases.push(["cluster bar pops on full rectangle entry; pane drop groups in one write", async page => {
  await clusterFixture(page);
  const before = await layoutSnapshot(page);
  await startPaneMouse(page, "c");
  await moveMouse(page, await point(await pane(page, "b")));
  const preview = page.locator(".split-tabs-bar-preview");
  await preview.waitFor();
  assert.equal(await preview.locator('.split-tab-strip-item[data-kind="layout"]').textContent(), "a+b");
  assert.equal(await layoutSnapshot(page), before, "hover must not group, focus, select or save");
  const p = await point(preview.locator(".split-tab-strip-item"), 0.8);
  await moveMouse(page, p);
  await page.waitForSelector('.split-tabs-drop-shade[data-zone="bar"][data-marker]');
  await releaseMouse(page);
  await expectNotation(page, "V[T{H[a b] | *c} d]");
  assert.equal(await page.evaluate(() => window.writes.length), 1);
}]);

for (const end of ["Escape", "no zone"]) acceptanceCases.push([`cluster enter, leave and ${end} cancel without any mutation`, async page => {
  await clusterFixture(page);
  const before = await layoutSnapshot(page);
  await startPaneMouse(page, "c");
  await moveMouse(page, await point(await pane(page, "b")));
  await page.waitForSelector(".split-tabs-bar-preview");
  await moveMouse(page, { x: 1, y: 1 });
  await page.waitForSelector(".split-tabs-bar-preview", { state: "detached" });
  if (end === "Escape") await page.keyboard.press("Escape");
  await releaseMouse(page);
  assert.equal(await layoutSnapshot(page), before);
  assert.equal(await page.locator(".split-tabs-bar-preview").count(), 0);
}]);

acceptanceCases.push(["hidden one-tab strip previews; below it top quarter splits; strip drop adds next tab", async page => {
  await grid(page);
  await page.evaluate(() => { window.writes.length = 0; });
  const target = await box(await pane(page, "b"));
  await startPaneMouse(page, "c");
  await moveMouse(page, { x: target.x + target.width / 2, y: target.y + 16 });
  await page.waitForSelector(".split-tabs-bar-preview.split-tab-strip--drop-target");
  assert.equal(await page.locator(".split-tabs-bar-preview .split-tab-strip-tab").textContent(), "b");
  await moveMouse(page, { x: target.x + target.width / 2, y: target.y + 36 });
  await page.waitForSelector('.split-tabs-drop-shade[data-zone="split"][data-side="top"]');
  assert.equal(await page.locator(".split-tabs-bar-preview").count(), 0);
  await moveMouse(page, { x: target.x + target.width / 2, y: target.y + 16 });
  await releaseMouse(page);
  await expectNotation(page, "H[a V[(b *c) d]]");
  assert.equal(await page.evaluate(() => window.writes.length), 1);
}]);

acceptanceCases.push(["cluster CDP arrange pane drag pops bar before top and drops in one write", async (page, cdp) => {
  await clusterFixture(page, true);
  const source = (await pane(page, "c")).locator(".split-tabs-pane-cover");
  const start = await touchStart(page, cdp, source, false);
  await touchMove(page, cdp, start, await point(await pane(page, "b")));
  await page.waitForSelector(".split-tabs-bar-preview");
  const p = await point(page.locator(".split-tabs-bar-preview .split-tab-strip-item"), 0.8);
  await touchMove(page, cdp, await point(await pane(page, "b")), p);
  await page.waitForSelector('.split-tabs-drop-shade[data-zone="bar"]');
  await touchEnd(page, cdp);
  await expectNotation(page, "V[T{H[a b] | *c} d]");
  assert.equal(await page.evaluate(() => window.writes.length), 1);
}, "", { cdp: true }]);

acceptanceCases.push(["same-origin mixed-document release clears blockers before queued ownership delivery", async (page, cdp) => {
  // Hold posted releases, not native input: cleanup must finish in the shell's release handler.
  await frame(page, "b").evaluate(el => {
    const w = el.contentWindow, post = w.postMessage;
    window.heldOwnership = [];
    w.postMessage = function(data, ...args) {
      if (data?.["split-tabs"] === 1 && data.type === "own-touch" && data.count < 2) {
        window.heldOwnership.push(() => post.call(w, data, ...args));
      } else post.call(w, data, ...args);
    };
    window.restoreOwnership = () => {
      w.postMessage = post;
      for (const deliver of window.heldOwnership) deliver();
    };
  });
  try {
    const original = acceptanceCases.find(([name]) => name === "mixed-document releases promptly clear covers and blockers: iframe-first");
    assert.ok(original);
    await original[1](page, cdp);
  } finally {
    await page.evaluate(() => window.restoreOwnership());
  }
}, "?scroll=1", { cdp: true }]);

acceptanceCases.push(["ownership falls back to posted delivery when direct frame access is refused", async (page, cdp) => {
  const inside = frame(page, "a");
  await inside.evaluate(el => {
    const w = el.contentWindow, dispatch = w.dispatchEvent, post = w.postMessage;
    window.postedOwnership = [];
    w.dispatchEvent = function(event) {
      if (event.type === "message" && event.data?.type === "own-touch") throw new DOMException("Cross-origin access", "SecurityError");
      return dispatch.call(w, event);
    };
    w.postMessage = function(data, ...args) {
      if (data?.type === "own-touch") window.postedOwnership.push(data.count);
      post.call(w, data, ...args);
    };
    window.restoreOwnership = () => { w.dispatchEvent = dispatch; w.postMessage = post; };
  });
  try {
    const p = await point(inside);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }, { x: p.x + 35, y: p.y, id: 2 }] });
    await page.waitForFunction(() => window.postedOwnership.includes(2));
    assert.equal(await inside.evaluate(el => el.contentWindow.touchBlockers()), 1);
    await touchEnd(page, cdp);
    await page.waitForFunction(() => window.postedOwnership.at(-1) === 0
      && document.querySelector('iframe[data-frame="a"]').contentWindow.touchBlockers() === 0);
  } finally {
    await page.evaluate(() => window.restoreOwnership());
  }
}, "", { cdp: true }]);

acceptanceCases.push(["frame ownership acknowledges synchronous cross-window delivery and clears immediately", async page => {
  const result = await frame(page, "a").evaluate(el => {
    const w = el.contentWindow;
    const own = count => w.dispatchEvent(new MessageEvent("message", { cancelable: true,
      data: { "split-tabs": 1, type: "own-touch", count }, origin: location.origin, source: window }));
    const primed = own(3), blocking = w.touchBlockers();
    const released = own(0), cleared = w.touchBlockers();
    return { primed, blocking, released, cleared };
  });
  assert.deepEqual(result, { primed: false, blocking: 1, released: false, cleared: 0 });
}]);

// Review acceptance ledger: native undo click (H1), frame press loss with no later write (H2),
// contained keyboard navigation/toggle (M1), cross-engine move-while-renaming commit (M6).
acceptanceCases.push(["review H1 arrange bin drop can be undone through the root slot", async page => {
  await page.evaluate(() => { window.controller.open("d"); window.runLayout("arrange"); });
  const before = await notation(page);
  await startMouse(page, label(page, "d"));
  await moveMouse(page, await point(page.locator("[data-split-tabs-bin]")));
  await releaseMouse(page);
  assert.notEqual(await notation(page), before);
  await page.locator("#undo").click();
  await expectNotation(page, before);
  assert.equal(await page.locator(".split-tabs--arranging").count(), 1);
}]);
for (const loss of ["arrange", "blur", "hover"]) acceptanceCases.push([
  `review H2 iframe ${loss} cancels its armed drag without a later write`, async page => {
    const inside = frame(page, "a");
    await page.evaluate(() => window.controller.focusPane(window.controller.paneOf("a")));
    const before = await notation(page);
    await page.evaluate(() => {
      window.reviewCancel = new Promise(resolve => {
        const receive = event => {
          if (event.data?.type !== "pointer" || event.data.pointerId !== 71 || event.data.phase !== "cancel") return;
          window.removeEventListener("message", receive); resolve();
        };
        window.addEventListener("message", receive);
      });
    });
    await inside.evaluate(el => {
      const w = el.contentWindow;
      w.dispatchEvent(new w.PointerEvent("pointerdown", { pointerId: 71, pointerType: "mouse", button: 0, buttons: 1,
        clientX: 100, clientY: 100, altKey: true, shiftKey: true }));
    });
    await page.waitForFunction(() => window.pointerDowns.some(event => event.target.includes("split-tabs-pane")));
    if (loss === "arrange") await page.evaluate(() => window.runLayout("arrange"));
    else await inside.evaluate((el, loss) => {
      const w = el.contentWindow;
      if (loss === "blur") w.dispatchEvent(new w.Event("blur"));
      else w.dispatchEvent(new w.PointerEvent("pointermove", { pointerId: 71, pointerType: "mouse", buttons: 0 }));
    }, loss);
    await page.evaluate(() => window.reviewCancel);
    assert.equal(await page.evaluate(() => window.listenersAtRest()), true, "the armed iframe drag removed its listeners");
    await page.evaluate(() => { window.writes.length = 0; });
    const target = await point(await pane(page, "a"), 0.8, 0.5);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down(); await page.mouse.up();
    assert.equal(await notation(page), before);
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 0);
    if (loss === "arrange") await page.evaluate(() => window.runLayout("arrange"));
  }, "?n=1",
]);
acceptanceCases.push(["review M1 Tab stays in arrange UI and the bound toggle exits", async page => {
  await page.locator("#host-input").focus();
  await page.evaluate(() => window.runLayout("arrange"));
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("split-tabs-arrange-menu-button")), true);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".split-tabs-menu");
  for (const key of ["Tab", "Shift+Tab", "Tab"]) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest(".split-tabs-menu, .split-tabs-arrange-menu-button")), true);
  }
  const before = await notation(page);
  await chord(page, "H"); assert.equal(await notation(page), before);
  await chord(page, "A");
  assert.equal(await page.locator(".split-tabs--arranging").count(), 0);
}]);
acceptanceCases.push(["review M6 moving a renamed tab commits and closes its editor", async page => {
  await label(page, "a").dblclick();
  await page.locator(".split-tab-strip-rename").fill("Moving draft");
  await page.evaluate(() => window.controller.move({ view: "a" }, {
    kind: "split", target: window.controller.focus.value, side: "right",
  }));
  await page.waitForFunction(() => window.controller.titleOf("a") === "Moving draft");
  assert.equal(await page.locator(".split-tab-strip-rename").count(), 0);
  assert.equal(await page.evaluate(() => window.commands.filter(([name]) => name === "rename").length), 1);
}]);
acceptanceCases.push(["review M4 pane picker leaves inline rename typing and Enter alone", async page => {
  await label(page, "a").dblclick();
  const editor = page.locator(".split-tab-strip-rename");
  await editor.fill("");
  await page.evaluate(() => window.runLayout("pick"));
  await page.keyboard.type("ab2");
  assert.equal(await editor.inputValue(), "ab2");
  assert.deepEqual(await page.evaluate(() => window.controller.selection.value), []);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.controller.titleOf("a") === "ab2");
  await page.keyboard.press("Escape");
}]);
acceptanceCases.push(["review M5 rename modifier releases remove covers without a pointer move", async page => {
  await label(page, "a").dblclick();
  await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
  await page.waitForSelector(".split-tabs--grab");
  await page.keyboard.up("Shift"); await page.keyboard.up("Alt");
  await page.waitForFunction(() => !document.querySelector(".split-tabs--grab"));
  assert.equal(await page.locator(".split-tabs-pane-cover").count(), 0);
  await page.keyboard.press("Escape");
}]);

export { box, point, pane, label, frame, chord, notation, expectNotation, grid, clean, ready,
  startMouse, moveMouse, releaseMouse, touchStart, touchMove, touchEnd, fourStart, pinch };

export async function runCases(cases = acceptanceCases, { workers = 1 } = {}) {
const serverErrors = [];
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const entry = files.get(pathname);
  if (!entry) {
    serverErrors.push(`Unexpected server request: ${request.url}`);
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-store" });
  response.end(readFileSync(entry[0]));
});
let browser;
let passed = 0;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const selected = cases.filter(([name]) => !process.env.BROWSER_CASE || name.includes(process.env.BROWSER_CASE));
  assert.ok(selected.length > 0, "BROWSER_CASE must match an acceptance case");
  console.log("CDP-touch cases run Chromium-only; WebKit runs every other acceptance case.");
  for (const [engine, launcher] of [["chromium", chromium], ["webkit", webkit]]) {
    browser = await launcher.launch({ headless: true });
    const runCase = async ([name, test, query = "", options = {}]) => {
      if (engine === "webkit" && options.cdp) return;
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true, isMobile: true });
      try {
        const errors = [];
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin === origin && files.has(url.pathname)) return route.continue();
          errors.push(`Unexpected browser request: ${url}`);
          return route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        // Emulate a character-producing Option+Shift layout on Linux without an OS keymap dependency.
        // The native trusted key and text default remain intact; cancellation alone decides whether text is inserted.
        await page.addInitScript(() => window.addEventListener("keydown", event => {
          if (!(event.target instanceof HTMLInputElement) || !["host-input", "frame-input"].includes(event.target.id)) return;
          if (!["|", "E", "A"].includes(event.key)) return;
          Object.defineProperties(event, { altKey: { value: true }, shiftKey: { value: true } });
          if (event.target.dataset.physicalCode) Object.defineProperty(event, "code", { value: event.target.dataset.physicalCode });
        }, true));
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(5000);
        page.on("pageerror", error => errors.push(String(error)));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(`${origin}/${query}`);
        await ready(page);
        assert.equal(await page.evaluate(() => localStorage.length), 0, "each case starts with fresh storage");
        assert.equal(await page.evaluate(() => window.writes.length), 0);
        const cdp = options.cdp || (options.touch && engine === "chromium") ? await context.newCDPSession(page) : null;
        try {
          await test(page, cdp, { engine, errors });
          await clean(page);
          await page.evaluate(() => window.unmountFixture());
          assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 0);
          assert.deepEqual(await page.evaluate(() => window.listenerSnapshot().map(l => l.type).sort()), []);
          assert.deepEqual(errors, []);
          assert.deepEqual(serverErrors, []);
        } catch (cause) {
          const observed = await page.evaluate(() => ({ notation: window.controller.notation.value, commands: window.commands,
            pointerLog: window.pointerLog, pointerDowns: window.pointerDowns,
            frameLoads: window.frameLoads, html: document.querySelector("#host").innerHTML }));
          throw new Error(`FAIL browser [${engine}]: ${name}\n${JSON.stringify({ ...observed, errors })}`, { cause });
        } finally {
          await cdp?.detach();
        }
        passed++;
        console.log(`PASS browser [${engine}]: ${name}`);
      } finally {
        await context.close();
      }
    };
    // Contexts are independent; acceptance stays serial, random hunts may opt in.
    // allSettled keeps resource ownership until EVERY worker has closed its context.
    // Resume an interrupted engine at its first failed case; later engines still run in full.
    const resume = process.env.BROWSER_RESUME;
    const resumeName = resume?.startsWith(`${engine}:`) ? resume.slice(engine.length + 1) : null;
    let next = resumeName === null ? 0 : selected.findIndex(([name]) => name === resumeName), failed = false;
    assert.ok(next >= 0, "BROWSER_RESUME must name an acceptance case");
    const results = await Promise.allSettled(Array.from({ length: workers }, async () => {
      while (!failed && next < selected.length) {
        const index = next++;
        try { await runCase(selected[index]); } catch (error) { failed = true; throw error; }
      }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    await browser.close();
    browser = null;
  }
  console.log(`Browser tests: ${passed} passed`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
}
