import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

export const viewport = { width: 1200, height: 800 };
export const tab = (page, id) => page.locator(`[data-split-tabs-tab="${id}"] .split-tab-strip-tab`);
export async function state(page) {
  return JSON.parse(await page.locator("#layout-json").textContent());
}
export async function expectState(page, expected, description) {
  try {
    await page.waitForFunction(({ expected }) => {
      const actual = JSON.parse(document.querySelector("#layout-json").textContent);
      return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
    }, { expected });
  } catch (error) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(await state(page))}`, { cause: error });
  }
}
export async function point(locator, x = 0.5, y = 0.5) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, `Expected rendered target ${locator}, observed no bounding box`);
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}
export async function drag(page, source, destination, release = true) {
  const from = await point(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 18 });
  if (release) await page.mouse.up();
}
export async function edge(page, id, axis, release = true) {
  const target = await point(page.locator(".split-tabs"), axis === "cols" ? 0.88 : 0.5, axis === "rows" ? 0.94 : 0.5);
  await drag(page, tab(page, id), target, false);
  await page.waitForSelector(`.split-tabs-drop-shade[data-orientation="${axis}"]`);
  if (release) {
    await page.mouse.up();
    await expectState(page, { orientation: axis }, `Drop ${id} at ${axis} edge`);
  }
}
export async function reset(page) {
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await expectState(page, { orientation: null }, "Reset removes split");
}
export async function paneFor(page, id) {
  const pane = (await state(page)).panes.find(p => p.tabs.includes(id));
  assert.ok(pane, `Expected pane containing ${id}; observed ${JSON.stringify(await state(page))}`);
  return page.locator(`[data-pane-id="${pane.id}"]`);
}
export async function nestedEdge(page, id, targetTab, axis, external = false) {
  const pane = await paneFor(page, targetTab);
  const destination = await point(pane, axis === "cols" ? 0.97 : 0.5, axis === "rows" ? 0.97 : 0.55);
  const count = (await state(page)).panes.length;
  await drag(page, external ? page.getByRole("button", { name: `Drag ${id}` }) : tab(page, id), destination, false);
  await page.waitForSelector(`.split-tabs-drop-shade[data-zone="split"][data-orientation="${axis}"]`);
  await page.mouse.up();
  await page.waitForFunction(count => JSON.parse(document.querySelector("#layout-json").textContent).panes.length === count + 1, count);
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
    assert.equal(server.listening, false, "Expected server closed, observed listening server");
    console.log("Cleanup: browser closed; loopback server closed");
  }
}
export async function open(context, origin) {
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
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
  await page.waitForSelector(".split-tab-strip-tab");
  await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).fits.cols);
  return { page, errors };
}
