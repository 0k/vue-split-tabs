import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

export const viewport = { width: 900, height: 650 };
export const tab = (page, id) => page.locator(`[data-split-tabs-tab="${id}"] > .split-tab-strip-title > .split-tab-strip-tab`);
export const state = page => page.locator("#layout-json").textContent().then(JSON.parse);
export async function expectState(page, expected) {
  await page.waitForFunction(expected => {
    const actual = JSON.parse(document.querySelector("#layout-json").textContent);
    return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
  }, expected);
}
export async function point(locator, x = 0.5, y = 0.5) {
  await locator.waitFor({ state: "visible" });
  const r = await locator.boundingBox();
  assert.ok(r && r.width > 0 && r.height > 0, `Nonzero geometry: ${locator}`);
  return { x: r.x + r.width * x, y: r.y + r.height * y };
}
export async function paneFor(page, view) {
  const p = (await state(page)).panes.find(p => p.tabs.includes(view));
  assert.ok(p, `Pane for view ${view}`);
  return page.locator(`[data-pane-id="${p.id}"]`);
}
export async function reset(page) {
  await page.reload();
  await expectState(page, { ready: true });
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
}
export const focusShell = page => page.getByRole("heading", { name: "Library options", exact: true }).click();
export const chord = (page, code) => page.keyboard.press(`Alt+Shift+Key${code}`);
export async function cast(page, text) {
  await page.evaluate(text => window.dispatchEvent(new CustomEvent("workbench-keycast", { detail: text })), text);
}
export async function startMouse(page, source) {
  const from = await point(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y, { steps: 2 });
  await page.waitForSelector(".split-tabs-drag-ghost");
}
export async function drag(page, source, destination, release = true) {
  await startMouse(page, source);
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  if (release) { await page.mouse.up(); await clean(page); }
}
export async function select(page, ids) {
  await focusShell(page);
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.keyboard.down("Control");
  try {
    for (const id of ids) await (await paneFor(page, id)).locator(".split-tabs-pane-cover").click();
  } finally {
    await page.keyboard.up("Control");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
  }
}
export async function clean(page) {
  await page.waitForFunction(() => !document.querySelector([
    ".split-tabs-drag-ghost", ".split-tabs-drop-shade", ".split-tabs-guide", ".split-tab-strip-item--drag-armed",
    ".split-tabs--dragging", ".split-tabs--resizing", "[data-split-tabs-bin]",
  ].join(",")));
  assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("touchmove", { cancelable: true }))), false);
}
export const fingers = (center, spread) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y], i) => ({
  id: i + 1, x: center.x + x * spread, y: center.y + y * spread,
}));
export const fourStart = (cdp, center, spread = 30) => cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart", touchPoints: fingers(center, spread),
});
export const touchEnd = cdp => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
export async function touchMove(page, cdp, start, end) {
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
      x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12, id: 1,
    }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}
export async function pinch(page, cdp, center, from, to) {
  await fourStart(cdp, center, from);
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(center, from + (to - from) * i / 6) });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await touchEnd(cdp);
}
export async function withBrowser(run) {
  const root = new URL("./dist/", import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file = new URL(pathname === "/" ? "index.html" : `.${pathname}`, root);
      if (!file.href.startsWith(root.href)) throw new Error("Path outside demo");
      const extension = file.pathname.split(".").pop();
      response.setHeader("Content-Type", { html: "text/html", js: "text/javascript", css: "text/css" }[extension] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await run(browser, origin);
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
    console.log("Cleanup: browser and loopback server closed");
  }
}
export async function open(context, origin) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin) {
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin);
  await expectState(page, { ready: true });
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
  return { page, errors };
}
