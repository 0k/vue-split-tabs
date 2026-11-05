import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { withBrowser, open, viewport, clean, cast } from "./browser.mjs";
import { scenarios } from "./scenarios.mjs";

const images = new URL("../doc/images/", import.meta.url);
const scratch = process.env.SPLIT_TABS_CAPTURE_SCRATCH
  ? pathToFileURL(`${process.env.SPLIT_TABS_CAPTURE_SCRATCH}/`) : new URL("./.capture/", import.meta.url);
const ffmpeg = process.env.FFMPEG ?? "/usr/bin/ffmpeg";
const ffprobe = process.env.FFPROBE ?? "/usr/bin/ffprobe";
await access(ffmpeg, constants.X_OK);
await access(ffprobe, constants.X_OK);
await mkdir(images, { recursive: true });
await mkdir(scratch, { recursive: true });
const path = (root, name) => fileURLToPath(new URL(name, root));
function exec(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function convert(args) { exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]); }
function probe(file) {
  return JSON.parse(exec(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]));
}
const options = { viewport, deviceScaleFactor: 1, locale: "en-US", colorScheme: "dark", reducedMotion: "reduce", hasTouch: true };
const manifest = [];
await withBrowser(async (browser, origin) => {
  const still = await browser.newContext(options);
  try {
    const { page, errors } = await open(still, origin);
    await page.screenshot({ path: path(images, "demo-workbench.png"), animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log("Captured demo-workbench.png");
  } finally { await still.close(); }

  for (const scenario of scenarios) {
    const context = await browser.newContext({ ...options, isMobile: scenario.name === "touch" });
    const raw = await mkdtemp(path(scratch, `${scenario.name}-raw-`));
    const samples = [];
    let sampling = true;
    let sampler;
    let started;
    let elapsed;
    const beats = [];
    try {
      const { page, errors } = await open(context, origin);
      started = performance.now();
      sampler = (async () => {
        while (sampling) {
          const at = (performance.now() - started) / 1000;
          const file = `${raw}/${samples.length}.png`;
          await page.screenshot({ path: file, animations: "disabled" });
          samples.push({ at, file });
          if (sampling) await page.waitForTimeout(100);
        }
      })();
      await cast(page, scenario.name === "touch" ? "Native touch / tablet" : `Workbench / ${scenario.name}`);
      // Presentation pauses belong only to recordings; the shared tests pass a no-op.
      async function pause() {
        await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every(el => el.contentWindow.ready));
        await page.getByLabel("Last key or gesture").waitFor({ state: "visible" });
        beats.push({ at: (performance.now() - started) / 1000 + 0.35, text: await page.getByLabel("Last key or gesture").textContent() });
        await page.waitForTimeout(850);
      }
      await scenario.run(page, context, pause);
      await clean(page);
      assert.deepEqual(errors, [], `Capture ${scenario.name}: runtime errors`);
      elapsed = (performance.now() - started) / 1000;
    } finally {
      sampling = false;
      let sampled = false;
      try { await sampler; sampled = true; }
      finally {
        await context.close();
        if (!sampled || elapsed === undefined) await rm(raw, { recursive: true });
      }
    }
    assert.ok(samples.length > 1 && elapsed, `Recording ${scenario.name} finished`);
    try {
      const seconds = Math.min(9.5, Math.max(6, elapsed));
      const speed = seconds / elapsed;
      const input = `${raw}/frames.txt`;
      const concat = samples.flatMap((sample, i) => [
        `file '${sample.file}'`, `duration ${Math.max(0.01, (samples[i + 1]?.at ?? elapsed) - sample.at).toFixed(4)}`,
      ]);
      await writeFile(input, `ffconcat version 1.0\n${concat.join("\n")}\nfile '${samples.at(-1).file}'\n`);
      const gif = path(images, `clip-${scenario.name}.gif`);
      convert(["-f", "concat", "-safe", "0", "-i", input, "-t", seconds.toFixed(3), "-filter_complex",
        `setpts=${speed.toFixed(6)}*(PTS-STARTPTS),fps=10,scale=900:-1:flags=lanczos,split[a][b];` +
        "[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p];" +
        "[b][p]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", gif]);
      const size = (await stat(gif)).size;
      const info = probe(gif);
      assert.ok(size < 1_500_000, `${scenario.name}: ${size} bytes exceeds 1.5 MB`);
      assert.ok(info.streams[0].width <= 900);
      assert.ok(Number(info.format.duration) >= 5 && Number(info.format.duration) <= 10, `${scenario.name}: GIF duration`);
      const frames = [];
      const captions = [];
      for (let i = 0; i < 4; i++) {
        const beat = beats[Math.round(i * (beats.length - 1) / 3)];
        const second = Math.min(seconds - 0.2, beat.at * speed);
        const output = path(scratch, `clip-${scenario.name}-review-${i + 1}.png`);
        convert(["-ss", second.toFixed(3), "-i", gif, "-frames:v", "1", output]);
        frames.push(output); captions.push(beat.text);
      }
      convert([...frames.flatMap(frame => ["-i", frame]), "-filter_complex",
        "[0:v]scale=450:-1[a];[1:v]scale=450:-1[b];[2:v]scale=450:-1[c];[3:v]scale=450:-1[d];" +
        "[a][b]hstack[top];[c][d]hstack[bottom];[top][bottom]vstack", "-frames:v", "1", path(scratch, `clip-${scenario.name}-review.png`)]);
      manifest.push({ name: `clip-${scenario.name}.gif`, bytes: size, seconds: Number(info.format.duration), frames, captions });
      console.log(`Captured clip-${scenario.name}.gif: ${size} bytes, ${info.format.duration}s`);
    } finally { await rm(raw, { recursive: true }); }
  }
});
await writeFile(new URL("manifest.json", scratch), `${JSON.stringify(manifest, null, 2)}\n`);

// Remove only named, obsolete outputs, and only once the README no longer links them.
const readme = await readFile(new URL("../README.org", import.meta.url), "utf8");
const legacy = ["demo-single.png", "demo-columns.png", "demo-thirds.png", "demo-nested.png", "demo-rows.png",
  "demo-drag.png", "demo-menu.png", "demo-phone.png", "demo.gif"];
for (const name of legacy) {
  assert.ok(!readme.includes(name), `README still references ${name}`);
  try { await rm(new URL(name, images)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const clip of manifest) console.log(`${clip.name}\t${clip.bytes} bytes\n${clip.frames.join("\n")}`);
console.log(`demo-workbench.png\t${(await stat(new URL("demo-workbench.png", images))).size} bytes`);
console.log(`Review manifest: ${path(scratch, "manifest.json")}`);
