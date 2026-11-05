import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it.each(["temporary files unavailable", "pandoc unavailable"])("README table verification works with %s", condition => {
  const args = [resolve("node_modules/vitest/vitest.mjs"), "run", "--bail", "1", "--configLoader", "runner", "--cache", "false",
    "test/compat.test.ts", "-t", "Pandoc"];
  const env = { ...process.env };
  if (condition === "temporary files unavailable") {
    const preload = 'import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module";'
      + 'fs.mkdtempSync = () => { throw new Error("Temporary files unavailable"); }; syncBuiltinESMExports();';
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=data:text/javascript,${encodeURIComponent(preload)}`;
  }
  if (condition === "pandoc unavailable") env.PATH = "";
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8", timeout: 30000,
    env,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  if (condition === "pandoc unavailable") expect(result.stdout).toMatch(/Tests\s+\d+ skipped/);
  else expect(result.stdout).toMatch(/Tests\s+(?:3 passed|\d+ skipped)/);
}, 35000);
