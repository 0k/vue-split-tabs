import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// Real-input acceptance against local built artifacts: no external network,
// existing app, user profile or background server.
const files = new Map([
  ["/", [new URL("browser.html", import.meta.url), "text/html"]],
  ["/vue.js", [new URL("../node_modules/vue/dist/vue.esm-browser.prod.js", import.meta.url), "text/javascript"]],
  ["/dist/index.js", [new URL("../dist/index.js", import.meta.url), "text/javascript"]],
  ["/dist/style.css", [new URL("../dist/style.css", import.meta.url), "text/css"]],
]);

async function center(locator) {
  await locator.waitFor({ state: "visible" });
  const rect = await locator.boundingBox();
  assert.ok(rect, "target has a rendered bounding box");
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function touchStart(context, page, index, hold = true) {
  const start = await center(page.locator(".split-tab-strip-tab").nth(index));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  if (hold) await page.waitForSelector(".split-tab-strip-item--drag-armed");
  return { cdp, start };
}

async function touchMove(page, cdp, start, end) {
  // Frame-paced native events, not DOM-dispatched PointerEvents: the compositor
  // must get a chance to pan/cancel through the native input pipeline.
  for (let step = 1; step <= 12; step++) {
    const x = start.x + (end.x - start.x) * step / 12;
    const y = start.y + (end.y - start.y) * step / 12;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(20);
  }
}

async function touchEnd(page, cdp) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => !document.querySelector(".split-tabs-drag-ghost"));
}

const order = page => page.evaluate(() => [...window.controller.panes.value[0].tabs]);
const cases = [
  ["held horizontal touch reorders with pointerup; first keyboard activation selects", async (page, context) => {
    const before = await order(page);
    const { cdp, start } = await touchStart(context, page, 1);
    const destination = await page.locator(".split-tab-strip-item").nth(3).boundingBox();
    assert.ok(destination);
    await touchMove(page, cdp, start, { x: destination.x + 3, y: start.y });
    assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 1,
      JSON.stringify(await page.evaluate(() => ({ log: window.pointerLog,
        scrollLeft: document.querySelector(".split-tab-strip").scrollLeft }))));
    await touchEnd(page, cdp);
    const log = await page.evaluate(() => window.pointerLog);
    assert.ok(log.includes("pointerup:touch"), JSON.stringify(log));
    assert.ok(!log.includes("pointercancel:touch"), JSON.stringify(log));
    assert.notDeepEqual(await order(page), before);
    assert.deepEqual((await order(page)).slice(0, 4), ["tab-a", "tab-c", "tab-b", "tab-d"]);
    await page.evaluate(() => window.controller.select(0, "tab-a"));
    const button = page.locator('[data-split-tabs-tab="tab-b"] .split-tab-strip-tab');
    await button.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.controller.panes.value[0].active === "tab-b");
  }],
  ["held vertical touch shows an edge shade and splits on pointerup", async (page, context) => {
    const { cdp, start } = await touchStart(context, page, 0);
    const root = await page.locator(".split-tabs").boundingBox();
    assert.ok(root);
    await touchMove(page, cdp, start, { x: root.x + root.width / 2, y: root.y + root.height - 10 });
    assert.equal(await page.locator('.split-tabs-drop-shade[data-orientation="rows"][data-side="end"]').count(), 1);
    await touchEnd(page, cdp);
    await page.waitForFunction(() => window.controller.orientation.value === "rows");
    assert.deepEqual(await page.evaluate(() => [...window.controller.panes.value[1].tabs]), ["tab-a"]);
    assert.ok(!(await page.evaluate(() => window.pointerLog)).includes("pointercancel:touch"));
  }],
  ["quick touch swipe scrolls natively without a drag or order change", async (page, context) => {
    const before = await order(page);
    const { cdp, start } = await touchStart(context, page, 3, false);
    await touchMove(page, cdp, start, { x: start.x - 180, y: start.y });
    await touchEnd(page, cdp);
    await page.waitForFunction(() => document.querySelector(".split-tab-strip").scrollLeft > 0);
    assert.deepEqual(await order(page), before);
    assert.equal(await page.locator(".split-tab-strip-item--drag-armed").count(), 0);
    assert.equal(await page.locator(".split-tab-strip-marker").count(), 0);
    assert.equal(await page.evaluate(() => window.sawGhost), false);
  }],
  ...[false, true].map(transform => [
    `mouse reorder and marker alignment with scrolled strip, transformed=${transform}`,
    async page => {
      if (transform) await page.locator("#host").evaluate(el => {
        el.style.transform = "translate(40px, 30px) scale(0.75)";
        el.style.transformOrigin = "0 0";
      });
      await page.locator(".split-tab-strip").evaluate(el => { el.scrollLeft = 150; });
      const start = await center(page.locator(".split-tab-strip-tab").nth(2));
      const destination = await page.locator(".split-tab-strip-item").nth(5).boundingBox();
      assert.ok(destination);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(destination.x + 3, start.y, { steps: 12 });
      const marker = page.locator(".split-tab-strip-marker");
      await marker.waitFor();
      const bounds = await marker.boundingBox();
      assert.ok(bounds);
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - destination.x) < 1);
      assert.equal(await marker.getAttribute("data-before"), "tab-f");
      await page.mouse.up();
      assert.deepEqual((await order(page)).slice(0, 6), ["tab-a", "tab-b", "tab-d", "tab-e", "tab-c", "tab-f"]);
    },
  ]),
  ...["reorder", "cross-pane", "escape-release-away", "outside", "edge-split", "current-slot"].map(variant => [
    variant === "current-slot"
      ? "current-slot mouse drag preserves selection/order and allows first Enter"
      : `mouse ${variant} allows first subsequent keyboard Enter`,
    async page => {
      const before = await page.evaluate(() => ({
        active: window.controller.panes.value[0].active,
        tabs: [...window.controller.panes.value[0].tabs],
      }));
      if (variant === "cross-pane") {
        await page.evaluate(() => window.controller.split("tab-l", "cols"));
        await page.waitForSelector('[data-split-tabs-pane="1"] .split-tab-strip-tab');
      }
      const tab = page.locator('[data-split-tabs-tab="tab-c"] .split-tab-strip-tab');
      await tab.scrollIntoViewIfNeeded();
      const start = await center(tab);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (variant === "reorder") {
        const first = await page.locator(".split-tab-strip-item").first().boundingBox();
        assert.ok(first);
        await page.mouse.move(first.x + 3, start.y, { steps: 8 });
      } else if (variant === "cross-pane") {
        const target = await page.locator('[data-split-tabs-pane="1"] .split-tab-strip').boundingBox();
        assert.ok(target);
        await page.mouse.move(target.x + 12, target.y + target.height / 2, { steps: 8 });
      } else if (variant === "edge-split") {
        const root = await page.locator(".split-tabs").boundingBox();
        assert.ok(root);
        await page.mouse.move(root.x + root.width - 10, root.y + root.height / 2, { steps: 8 });
      } else if (variant === "escape-release-away") {
        await page.mouse.move(start.x + 30, start.y + 60, { steps: 6 });
        await page.keyboard.press("Escape");
        await page.mouse.move(start.x + 30, start.y + 120, { steps: 3 });
      } else if (variant === "outside") {
        await page.mouse.move(800, 500, { steps: 8 });
      } else {
        await page.mouse.move(start.x + 10, start.y, { steps: 4 });
      }
      await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector(".split-tabs-drag-ghost"));
      if (variant === "current-slot") {
        assert.equal(await page.evaluate(() => window.controller.panes.value[0].active), before.active);
        assert.deepEqual(await order(page), before.tabs);
      }
      if (variant === "reorder") assert.equal((await order(page))[0], "tab-c");
      if (variant === "cross-pane" || variant === "edge-split") {
        assert.equal(await page.evaluate(() => window.controller.paneOf("tab-c")), 1);
      }
      await page.evaluate(() => {
        const c = window.controller;
        const pane = c.paneOf("tab-c");
        const other = c.panes.value[pane].tabs.find(id => id !== "tab-c");
        if (other) c.select(pane, other);
        window.keyboardSelections = [];
        const select = c.select;
        c.select = (index, id) => { window.keyboardSelections.push([index, id]); select(index, id); };
      });
      await tab.focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.keyboardSelections),
        [[await page.evaluate(() => window.controller.paneOf("tab-c")), "tab-c"]]);
    },
  ]),
  ["Alt+Shift+arrows reorder one slot and retain focus", async page => {
    const button = page.locator('[data-split-tabs-tab="tab-b"] .split-tab-strip-tab');
    await button.focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    assert.deepEqual((await order(page)).slice(0, 3), ["tab-a", "tab-c", "tab-b"]);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    assert.deepEqual((await order(page)).slice(0, 3), ["tab-a", "tab-b", "tab-c"]);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
  }],
  ["Escape removes touch previews and restores native scrolling", async (page, context) => {
    const { cdp, start } = await touchStart(context, page, 0);
    await touchMove(page, cdp, start, { x: start.x + 160, y: start.y });
    assert.equal(await page.locator(".split-tabs-drag-ghost").count(), 1);
    await page.keyboard.press("Escape");
    await touchEnd(page, cdp);
    assert.equal(await page.locator(".split-tab-strip-marker").count(), 0);
    assert.equal(await page.locator(".split-tab-strip-item--drag-armed").count(), 0);
    await page.evaluate(() => { window.sawGhost = false; });
    const swipe = await touchStart(context, page, 3, false);
    await touchMove(page, swipe.cdp, swipe.start, { x: swipe.start.x - 180, y: swipe.start.y });
    await touchEnd(page, swipe.cdp);
    await page.waitForFunction(() => document.querySelector(".split-tab-strip").scrollLeft > 0);
    assert.equal(await page.evaluate(() => window.sawGhost), false);
  }],
];

const browser = await chromium.launch({ headless: true });
let passed = 0;
try {
  for (const [name, test] of cases) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 600 }, hasTouch: true, isMobile: true,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        const entry = url.origin === "http://split-tabs.test" ? files.get(url.pathname) : undefined;
        if (!entry) throw new Error(`Unexpected browser request: ${url}`);
        return route.fulfill({ body: readFileSync(entry[0]), contentType: entry[1] });
      });
      await page.goto("http://split-tabs.test/");
      await page.waitForSelector(".split-tab-strip-tab");
      await page.waitForFunction(() => window.controller.canOfferSplit.value);
      assert.equal(await page.locator(".split-tab-strip-tab--active").count(), 1);
      assert.equal(await page.locator(".split-tab-strip-tab.active").count(), 0);
      await test(page, context);
      assert.deepEqual(errors, []);
      passed++;
      console.log(`PASS browser: ${name}`);
    } finally {
      await context.close();
    }
  }
  console.log(`Browser tests: ${passed} passed`);
} finally {
  await browser.close();
}
