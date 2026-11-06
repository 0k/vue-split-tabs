import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const action = process.argv[2];

if (action === "clean") {
  if (existsSync(dist)) rmSync(dist, { recursive: true });
} else if (action === "css") {
  // TypeScript resolves Component.vue.js to Component.vue.d.ts in both
  // NodeNext and Bundler modes; bare .vue specifiers fail under NodeNext.
  for (const file of readdirSync(dist).filter(name => name.endsWith(".d.ts"))) {
    const path = new URL(file, dist);
    const source = readFileSync(path, "utf8");
    const qualified = source.replace(/(from\s+["'])(\.\/[^"']+\.vue)(["'])/g, "$1$2.js$3");
    if (qualified !== source) writeFileSync(path, qualified);
  }
  copyFileSync(new URL("../src/style.css", import.meta.url), new URL("style.css", dist));
} else {
  throw new Error(`Unknown build action: ${action}`);
}
