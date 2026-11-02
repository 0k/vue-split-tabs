import assert from "node:assert/strict";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { withBrowser, open, viewport, edge, reset, expectState, nestedEdge } from "./browser.mjs";

const images = new URL("../doc/images/", import.meta.url);
const scratch = new URL("./.capture/", import.meta.url);
const ffmpeg = process.env.FFMPEG ?? "/usr/bin/ffmpeg";
try { await access(ffmpeg, constants.X_OK); }
catch { throw new Error(`demo:capture requires ffmpeg at ${ffmpeg}; install it or set FFMPEG to its executable path.`); }

function convert(args) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`ffmpeg failed: ${result.error?.message ?? result.stderr}`);
}
await mkdir(images, { recursive: true });
await rm(scratch, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });
const saved = [];
await withBrowser(async (browser, origin) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-US", colorScheme: "dark", reducedMotion: "reduce" });
  try {
    const { page, errors } = await open(context, origin);
    async function shot(name) {
      await page.mouse.move(15, 15);
      await page.screenshot({ path: fileURLToPath(new URL(name, images)), animations: "disabled" });
      saved.push(name);
      console.log(`Captured ${name}`);
    }
    await shot("demo-single.png");
    await edge(page, "chart", "cols");
    await shot("demo-columns.png");
    await nestedEdge(page, "log", "chart", "cols");
    await page.getByRole("separator").nth(1).dblclick();
    await shot("demo-thirds.png");
    await reset(page);
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "rows");
    await shot("demo-nested.png");
    await reset(page);
    await edge(page, "chart", "rows");
    await shot("demo-rows.png");
    await reset(page);
    await edge(page, "chart", "cols", false);
    // Keep the real pointer, ghost and labelled shade in the screenshot.
    await page.screenshot({ path: fileURLToPath(new URL("demo-drag.png", images)) });
    saved.push("demo-drag.png");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.getByRole("button", { name: "Open tab menu" }).click();
    await shot("demo-menu.png");
    await page.keyboard.press("Escape");
    await reset(page);
    await edge(page, "chart", "cols");
    await page.setViewportSize({ width: 390, height: 720 });
    await expectState(page, { orientation: null }, "Capture narrow collapsed layout");
    await page.getByRole("textbox", { name: "Notes draft" }).fill("A little room to think.\n\nDrag me anywhere.\nYour draft stays with you.");
    await shot("demo-phone.png");
    assert.deepEqual(errors, [], "Expected capture without runtime errors");
  } finally { await context.close(); }

  const videoContext = await browser.newContext({
    viewport, deviceScaleFactor: 1, locale: "en-US", colorScheme: "dark", reducedMotion: "reduce",
    recordVideo: { dir: fileURLToPath(scratch), size: viewport },
  });
  let video;
  try {
    const { page, errors } = await open(videoContext, origin);
    video = page.video();
    // Presentation beats only: tests use condition polling, never these pauses.
    const beat = () => page.waitForTimeout(1100);
    await beat();
    await page.getByRole("textbox", { name: "Notes draft" }).fill("A little room to think.\n\nSame draft. A new perspective.");
    await beat();
    await edge(page, "chart", "cols", false);
    await beat();
    await page.mouse.up();
    await expectState(page, { orientation: "cols" }, "Video split");
    await beat();
    await nestedEdge(page, "log", "chart", "cols");
    await beat();
    await page.getByRole("separator").nth(1).dblclick();
    await beat();
    await page.getByRole("button", { name: "Merge panes", exact: true }).click();
    await edge(page, "chart", "cols");
    await nestedEdge(page, "log", "chart", "rows");
    await beat();
    await reset(page);
    await page.getByRole("button", { name: "Open tab menu" }).click();
    await beat();
    await page.getByRole("menuitem", { name: "Checklist" }).click();
    await beat();
    await reset(page);
    await beat();
    assert.deepEqual(errors, [], "Expected recording without runtime errors");
  } finally { await videoContext.close(); }
  assert.ok(video, "Expected recorded video, observed none");
  const input = await video.path();
  const gif = fileURLToPath(new URL("demo.gif", images));
  convert(["-i", input, "-t", "18", "-filter_complex",
    "fps=8,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop", "0", gif]);
  assert.ok((await stat(gif)).size < 3_000_000, `Expected GIF < 3 MB, observed ${(await stat(gif)).size} bytes`);
  for (const [index, second] of [2, 7, 9, 11].entries()) {
    convert(["-ss", String(second), "-i", gif, "-frames:v", "1", fileURLToPath(new URL(`frame-${index + 1}.png`, scratch))]);
  }
  convert(["-i", gif, "-vf", "fps=1,scale=450:-1,tile=6x3", "-frames:v", "1",
    fileURLToPath(new URL("storyboard.png", scratch))]);
  await rm(input);
  saved.push("demo.gif");
});
for (const name of saved) console.log(`${name}\t${(await stat(new URL(name, images))).size} bytes`);
console.log("GIF review frames: demo/.capture/frame-{1,2,3,4}.png (ignored; remove after review)");
console.log("GIF one-second storyboard: demo/.capture/storyboard.png");
