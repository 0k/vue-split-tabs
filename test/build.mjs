import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Run after npm run build: prove the real emitted artifacts, not the source.
for (const file of ["index.js", "index.d.ts", "style.css"]) {
  assert.ok(statSync(resolve("dist", file)).size > 0, `${file} is nonempty`);
}
const esm = await import("@0k/vue-split-tabs");
const expectedExports = ["SplitTabStrip", "SplitTabs", "SplitTabsAnchor", "SplitTabsKeep", "createSplitTabsController"];
assert.deepEqual(Object.keys(esm).sort(), expectedExports);
const controller = esm.createSplitTabsController({
  tabs: ["a", "b"], entryKey: "build-smoke", storageKey: "build-smoke",
  minPaneWidth: 50, minPaneHeight: 50,
});
controller.setContainerSize(206, 206);
controller.split("b", "cols");
assert.equal(controller.isSplit.value, true);
controller.select(0, "a");
assert.equal(controller.intent.value.firstActive, "a");
assert.equal(controller.restoredActive.value, "a");
controller.setContainerSize(0, 0);
assert.equal(controller.restoredActive.value, "a");
controller.merge();
assert.equal(controller.restoredActive.value, "");
controller.place("b", 0, "a");
assert.deepEqual([...controller.intent.value.order], ["b", "a"]);
assert.deepEqual([...controller.panes.value[0].tabs], ["b", "a"]);
controller.setContainerSize(206, 206);
controller.splitAt("a", "rows", "start");
assert.deepEqual(controller.panes.value.map((pane) => [...pane.tabs]), [["a"], ["b"]]);
controller.merge();
assert.deepEqual([...controller.panes.value[0].tabs], ["b", "a"]);
controller.dispose();
const optional = esm.createSplitTabsController({
  tabs: ["a", "b"], optional: ["b"], entryKey: "optional-smoke", storageKey: "optional-smoke",
  minPaneWidth: 50, minPaneHeight: 50,
});
assert.deepEqual([...optional.panes.value[0].tabs], ["a"]);
assert.equal(optional.isOptional("b"), true);
optional.open("b", 1);
assert.deepEqual([...optional.opened.value], ["b"]);
assert.equal(optional.panes.value[0].active, "b");
optional.close("b");
assert.deepEqual([...optional.opened.value], []);
assert.equal(optional.panes.value[0].active, "a");
optional.open("b", 0);
optional.replace("b", "a");
assert.deepEqual([...optional.opened.value], []);
assert.equal(optional.panes.value[0].active, "a");
optional.insert("b", 0, "a");
assert.deepEqual([...optional.panes.value[0].tabs], ["b", "a"]);
optional.close("b");
optional.setContainerSize(206, 206);
optional.insertSplit("b", "cols", "end");
assert.deepEqual(optional.panes.value.map(pane => [...pane.tabs]), [["a"], ["b"]]);
optional.dispose();
const declarations = readFileSync(resolve("dist/controller.d.ts"), "utf8");
assert.doesNotMatch(readFileSync(resolve("dist/index.d.ts"), "utf8"), /import\s*["'][^"']*\.css/);
assert.equal(readFileSync(resolve("dist/style.css"), "utf8"), readFileSync(resolve("src/style.css"), "utf8"));
const expectedFiles = [
  "index.js", "index.js.map", "index.d.ts", "style.css", "controller.d.ts", "context.d.ts", "drag.d.ts",
  "SplitPane.vue.d.ts", "SplitTabs.vue.d.ts", "SplitTabsAnchor.vue.d.ts", "SplitTabsKeep.vue.d.ts", "SplitTabStrip.vue.d.ts",
];
assert.deepEqual(readdirSync(resolve("dist")).sort(), expectedFiles.sort());
assert.match(declarations, /firstActive: string/);
assert.match(declarations, /restoredActive: ComputedRef<string>/);
assert.match(declarations, /order: string\[\]/);
assert.match(declarations, /splitAt\(id: string, orientation: Orientation, side: SplitSide\): void/);
assert.match(declarations, /place\(id: string, pane: PaneIndex, beforeId: string \| null\): void/);
assert.match(declarations, /optional\?: MaybeRefOrGetter<readonly string\[\]>/);
assert.match(declarations, /readonly opened: ComputedRef<readonly string\[\]>/);
assert.match(declarations, /open\(id: string, pane: PaneIndex\): void/);
assert.match(declarations, /close\(id: string\): void/);
assert.match(declarations, /replace\(oldId: string, newId: string\): void/);
assert.match(declarations, /insert\(id: string, pane: PaneIndex, beforeId: string \| null\): void/);
assert.match(declarations, /insertSplit\(id: string, orientation: Orientation, side: SplitSide\): void/);
assert.match(readFileSync(resolve("dist/SplitTabs.vue.d.ts"), "utf8"), /startExternalDrag:/);
assert.match(declarations, /isOptional\(id: string\): boolean/);
const code = readFileSync(resolve("dist/index.js"), "utf8");
assert.match(code, /from\s*["']vue["']/);
for (const unsupported of [
  /\.at\s*\(/, /\.findLast\s*\(/, /\.toSorted\s*\(/, /Object\.hasOwn\s*\(/,
  /structuredClone\s*\(/, /static\s*\{/, /Promise\.withResolvers/,
]) {
  assert.doesNotMatch(code, unsupported);
}
console.log("PASS: ESM exports/order/restoration/on-demand tabs, clean output, explicit CSS, declarations, external Vue, WebView91 API scan");
