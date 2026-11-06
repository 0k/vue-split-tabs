import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const mode of ["NodeNext", "Bundler"]) {
  const result = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc", "test/consumer.mts", "--noEmit", "--strict",
    "--module", mode === "NodeNext" ? "NodeNext" : "ESNext", "--moduleResolution", mode,
    "--target", "ES2020", "--lib", "ES2020,DOM,DOM.Iterable", "--types", "node",
  ], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, `${mode}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  console.log(`PASS types: ${mode} consumer resolves emitted declarations`);
}
