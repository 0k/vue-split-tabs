import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const started = performance.now();
const topics = ["index", "concepts", "layout-model", "interaction", "iframes", "theming", "api", "migration"];
const root = new URL("./dist/", import.meta.url);
const prefix = "/vue-split-tabs/";
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    assert.ok(path.startsWith(prefix));
    const relative = path.slice(prefix.length);
    const file = new URL(relative.endsWith("/") || relative === "" ? `${relative}index.html` : relative, root);
    assert.ok(file.href.startsWith(root.href));
    const type = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", gif: "image/gif" };
    response.setHeader("Content-Type", type[file.pathname.split(".").pop()] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end("Not found"); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + prefix;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    errors.push(`External request: ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const screenshotDir = new URL("./dist/review/", import.meta.url);
  if (process.env.SITE_SCREENSHOTS) await mkdir(screenshotDir, { recursive: true });
  for (const topic of topics) {
    assert.equal((await page.goto(`${base}${topic}.html`)).status(), 200);
    await page.locator("main h1").waitFor();
    assert.equal(await page.locator(".spurious-link").count(), 0, `Unresolved Org link in ${topic}`);
    assert.equal(await page.locator('nav[aria-label="Chapters"] a').count(), topics.length);
    assert.equal(await page.locator('[aria-current="page"]').count(), 1);
    // API/migration tables keep union punctuation outside cells, with no phantom columns.
    assert.deepEqual(await page.locator("main table").evaluateAll(tables => tables.flatMap(table => {
      const width = table.querySelector("thead tr")?.children.length;
      return [...table.querySelectorAll("tbody tr")].filter(row => row.children.length !== width).map(row => row.textContent);
    })), [], `${topic}: table column counts`);
    if (topic === "api") {
      assert.equal(await page.locator("main").evaluate(el => el.textContent.includes("kind: 'split' | 'move' | 'close'")), true);
      assert.ok((await page.locator("main").textContent()).includes("labels: { divider, closeSelection?, newPane? }"));
    }
    if (topic === "layout-model" || topic === "interaction") {
      const text = await page.locator("main").textContent();
      for (const term of ["tab-menu direction actions", "into-itself", "nothing-to-move", "only visible tab"]) {
        assert.ok(text.includes(term), `${topic} documents ${term}`);
      }
    }
    if (topic === "theming") {
      const text = await page.locator("main").textContent();
      assert.ok(text.includes(".split-tabs-pane-content") && text.includes(".split-tabs-keep--overlay"),
        "custom dimming names both content wrappers");
      assert.ok(text.includes("never .split-tabs-pane"), "custom dimming never creates a pane stacking context");
    }
    if (topic === "migration") {
      const mapping = await page.locator("main table").first().textContent();
      for (const api of ["defaultRatio", "dividerSize", "split-tab-strip-marker", "data-before", "--split-tabs-marker-width",
        ".split-tabs-drop-shade[data-marker]", ':always-show="controller.hasSplit.value"']) {
        assert.ok(mapping.includes(api), `Missing migration mapping: ${api}`);
      }
    }
    const links = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.href));
    for (const link of new Set(links)) {
      const url = new URL(link);
      if (url.origin !== origin) continue;
      assert.ok(url.pathname.startsWith(prefix), `Escaped project sub-path: ${link}`);
      const response = await context.request.get(link);
      assert.equal(response.status(), 200, `Broken link from ${topic}: ${link}`);
      if (url.hash) {
        const html = await response.text();
        assert.ok(html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `Missing anchor: ${link}`);
      }
    }
    for (const image of await page.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(image => image.decode());
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.locator("img").evaluateAll(nodes => nodes.every(image => image.naturalWidth > 0)), true);
    for (const [width, scheme] of [[1440, "light"], [390, "dark"]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${topic}: overflow at ${width}`);
      assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).display !== "none"), true);
      if (process.env.SITE_SCREENSHOTS) {
        await page.screenshot({ path: new URL(`${topic}-${scheme}.png`, screenshotDir).pathname, fullPage: true });
      }
    }
    console.log(`PASS page ${topic}: links, images, light/desktop and dark/mobile`);
  }
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto(`${base}workbench/`);
  await page.waitForFunction(() => {
    const snapshot = document.querySelector("#layout-json");
    return snapshot && JSON.parse(snapshot.textContent).ready && document.querySelectorAll("iframe").length === 4
      && [...document.querySelectorAll("iframe")].every(frame => frame.contentWindow.ready);
  });
  for (const id of ["1", "2", "3", "4"]) {
    const frame = page.frameLocator(`iframe[data-frame="${id}"]`);
    await frame.locator("#content").click();
    await page.keyboard.press("KeyQ");
    await frame.locator('#event-log li[data-type="keydown"]').waitFor();
    assert.match(await frame.locator("#log-title").textContent(), new RegExp(`Pane ${id}`));
  }
  await page.frameLocator('iframe[data-frame="1"]').locator("#content").click();
  await page.keyboard.press("Alt+Shift+KeyL");
  await page.waitForFunction(() => JSON.parse(document.querySelector("#layout-json").textContent).focusedView === "2");
  await page.keyboard.press("KeyQ");
  assert.equal(await page.frameLocator('iframe[data-frame="2"]').locator("#keyboard").textContent(), "keyboard: here");
  if (process.env.SITE_SCREENSHOTS) await page.screenshot({ path: new URL("workbench.png", screenshotDir).pathname });
  assert.deepEqual(errors, []);
  console.log(`PASS Workbench: four live iframes, forwarded layout key and keyboard focus (${((performance.now() - started) / 1000).toFixed(2)}s)`);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(server.listening, false);
  console.log("Cleanup: browser and scoped static server closed");
}
