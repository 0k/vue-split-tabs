import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const mode of ["NodeNext", "Bundler"]) {
  const result = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "test/consumer.mts", "--noEmit", "--strict",
    "--module", mode === "NodeNext" ? "NodeNext" : "ESNext", "--moduleResolution", mode,
    "--target", "ES2020", "--lib", "ES2020,DOM,DOM.Iterable", "--types", "node",
  ], { encoding: "utf8", timeout: 30000 });
  if (mode === "NodeNext" && result.status !== 0) {
    assert.equal(result.status, 2, String(result.error ?? result.stderr));
    const diagnostics = result.stdout.trim().split("\n");
    assert.equal(diagnostics.length, 4, result.stdout);
    for (const component of ["SplitTabs", "SplitTabStrip", "SplitTabsAnchor", "SplitTabsKeep"]) {
      assert.ok(diagnostics.some(line => line.includes(`'./${component}.vue'`)), result.stdout);
    }
    assert.ok(diagnostics.every(line => /TS2307: Cannot find module '\.\/.+\.vue'/.test(line)), result.stdout);
    console.log("NOTE types: NodeNext probe is limited by four Vue SFC exports; supported resolution is bundler");
  } else {
    assert.equal(result.status, 0, `${mode}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    console.log(`PASS types: ${mode} consumer resolves emitted declarations`);
  }
}
