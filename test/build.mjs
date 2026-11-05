import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Run after npm run build: prove the real emitted artifacts, not the source.
for (const file of ["index.js", "frame.js", "index.d.ts", "frame.d.ts", "style.css"]) {
  assert.ok(statSync(resolve("dist", file)).size > 0, `${file} is nonempty`);
}
const esm = await import("@0k/vue-split-tabs");
assert.deepEqual(Object.keys(esm).sort(), ["SplitTabStrip", "SplitTabs", "SplitTabsAnchor", "SplitTabsGlyph", "SplitTabsKeep", "SplitTabsMenu",
  "createChordTracker", "createSplitTabsController", "defaultExitKeys", "defaultKeymap", "defaultPointerChords", "notation", "useSplitTabsPick"]);
assert.deepEqual(esm.defaultExitKeys, ["Escape", "Ctrl+KeyG", "Ctrl+KeyD"]);
const frame = await import("@0k/vue-split-tabs/frame");
assert.deepEqual(Object.keys(frame).sort(), ["FRAME_MESSAGE", "SHELL_FINGERS", "connectSplitTabsFrame"]);
const c = esm.createSplitTabsController({
  tabs: ["a", "b", "c"], optional: ["c"], entryKey: "build-smoke", storageKey: "build-smoke",
  minPaneWidth: 50, minPaneHeight: 50, placeholderPrefix: "new:",
});
c.setContainerSize(400, 300);
assert.equal(c.notation.value, "(*a b)");
assert.equal(c.move({ view: "b" }, { kind: "split", target: c.paneOf("a"), side: "right" }).ok, true);
assert.equal(c.notation.value, "H[a b]");
c.focusPane(c.paneOf("a"));
c.selectRectangle(c.paneOf("b"));
assert.deepEqual({ ok: c.plan.value.ok, kind: c.plan.value.kind }, { ok: true, kind: "already" });
assert.equal(c.tabNext().view, "new:1");
assert.equal(c.notation.value, "T{H[a b] | *new:1}");
c.replace("new:1", "c");
assert.deepEqual([...c.opened.value], ["c"]);
assert.deepEqual(c.closeTarget(), { ok: false, reason: "not-closable", nodes: ["a", "b"] });
assert.equal(c.close("c").ok, true);
assert.equal(c.undo().ok, true);
assert.equal(c.notation.value, "T{H[a b] | *c}");
assert.equal(c.cycleBarSide().ok, true);
assert.equal(c.tabSet(c.paneOf("c")).side, "left");
assert.deepEqual(c.close("a"), { ok: false, reason: "not-closable", nodes: ["a"] });
c.dispose();
assert.equal(typeof esm.defaultKeymap.splitRight[0], "string");
assert.equal(esm.notation({ kind: "tabs", id: "t", tabs: ["x", "y"], active: "y" }), "(x *y)");
assert.doesNotMatch(readFileSync(resolve("dist/index.d.ts"), "utf8"), /import\s*["'][^"']*\.css/);
assert.equal(readFileSync(resolve("dist/style.css"), "utf8"), readFileSync(resolve("src/style.css"), "utf8"));
const expectedFiles = [
  "index.js", "frame.js", "index.d.ts", "style.css", "algebra.d.ts", "context.d.ts", "controller.d.ts", "drag.d.ts", "frame.d.ts",
  "keymap.d.ts", "menu.d.ts", "modal.d.ts", "model.d.ts", "pick.d.ts", "projection.d.ts", "shell.d.ts",
  "SplitFrame.vue.d.ts", "SplitLayout.vue.d.ts", "SplitPane.vue.d.ts", "SplitTabSet.vue.d.ts", "SplitTabStrip.vue.d.ts", "SplitTabs.vue.d.ts",
  "SplitTabsAnchor.vue.d.ts", "SplitTabsGlyph.vue.d.ts", "SplitTabsKeep.vue.d.ts", "SplitTabsMenu.vue.d.ts", "SplitTabsRename.vue.d.ts",
];
assert.deepEqual(readdirSync(resolve("dist")).sort(), expectedFiles.sort());
const declarations = readFileSync(resolve("dist/controller.d.ts"), "utf8");
for (const signature of [
  /move\(source: SplitTabsSource, zone: SplitTabsZone\): SplitTabsResult/,
  /insert\(id: string, zone: SplitTabsZone, register\?: \(\) => void\): SplitTabsResult/,
  /split\(side: Side\): SplitTabsResult/, /tabNext\(\): SplitTabsResult/, /tabInside\(\): SplitTabsResult/,
  /rename\(key: string, title: string\): SplitTabsResult/, /titleOf\(key: string\): string \| null/,
  /readonly plan: ComputedRef<SplitTabsPlan \| null>/, /readonly frames: ComputedRef<readonly SplitTabsFrame\[\]>/,
]) assert.match(declarations, signature);
assert.match(readFileSync(resolve("dist/SplitTabs.vue.d.ts"), "utf8"), /startExternalDrag:/);
assert.match(readFileSync(resolve("dist/SplitTabs.vue.d.ts"), "utf8"), /startRename:/);
for (const file of ["index.js", "frame.js"]) {
  const code = readFileSync(resolve("dist", file), "utf8");
  if (file === "index.js") assert.match(code, /from\s*["']vue["']/);
  for (const unsupported of [/\.at\s*\(/, /\.findLast\s*\(/, /\.toSorted\s*\(/, /Object\.hasOwn\s*\(/,
    /structuredClone\s*\(/, /static\s*\{/, /Promise\.withResolvers/]) assert.doesNotMatch(code, unsupported);
}
assert.doesNotMatch(readFileSync(resolve("dist/frame.js"), "utf8"), /from\s*["']vue["']/);
console.log("PASS: ESM exports, frame entry, layout algebra smoke, clean output, explicit CSS, declarations, external Vue, WebView91 API scan");
