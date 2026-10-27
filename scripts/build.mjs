import { copyFileSync, existsSync, rmSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const action = process.argv[2];

if (action === "clean") {
  if (existsSync(dist)) rmSync(dist, { recursive: true });
} else if (action === "css") {
  copyFileSync(new URL("../src/style.css", import.meta.url), new URL("style.css", dist));
} else {
  throw new Error(`Unknown build action: ${action}`);
}
