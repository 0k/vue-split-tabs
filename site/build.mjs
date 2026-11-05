import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("./dist/", import.meta.url);
const chapters = [
  ["index", "Start here"], ["concepts", "Concepts & notation"], ["layout-model", "The layout model"],
  ["interaction", "Interaction"], ["iframes", "Iframes & Keep"], ["theming", "Theming"],
  ["api", "API reference"], ["migration", "Migration to 0.3"],
];
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, input, encoding: "utf8", stdio: input === undefined ? "inherit" : "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stderr ?? ""}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}
const read = path => readFile(new URL(path, root), "utf8");
const readme = await read("README.org");
const css = await read("src/style.css");
const controller = await read("src/controller.ts");
const fallbacks = new Map();
for (const match of css.matchAll(/var\((--split-tabs-[\w-]+),\s*/g)) {
  let depth = 1;
  let end = match.index + match[0].length;
  const start = end;
  for (; end < css.length; end++) {
    if (css[end] === "(") depth++;
    if (css[end] === ")" && --depth === 0) break;
  }
  if (!fallbacks.has(match[1])) fallbacks.set(match[1], css.slice(start, end));
}
const table = readme.split("\n").filter(line => /^\| ~--split-tabs-/.test(line)).map(line => {
  const variable = line.match(/--split-tabs-[\w-]+/)[0];
  const fallback = fallbacks.get(variable);
  // Keep README explanations, but take literal CSS fallbacks from the stylesheet.
  return fallback === undefined ? line : line.replace(/(\| ~--split-tabs-[\w-]+~ \| )~[^~]+~/, `$1~${fallback}~`);
});
const documented = new Set(table.map(line => line.match(/--split-tabs-[\w-]+/)[0]));
const variables = [...new Set(css.match(/--split-tabs-[\w-]+/g))].sort();
for (const variable of variables) {
  if (!documented.has(variable)) throw new Error(`Document ${variable} in README.org before building the site`);
}
function section(heading, end) {
  const start = readme.indexOf(`** ${heading}\n`);
  const finish = readme.indexOf(`\n${end}`, start + 1);
  if (start < 0 || finish < 0) throw new Error(`README reference section not found: ${heading}`);
  return readme.slice(start + heading.length + 4, finish).trim();
}
const options = section("Controller options", "** Controller members");
const components = section("Components", "~SplitTabStrip~ hides");
const migration = section("Breaking changes from 0.2.x", "** Controller options");
const declaration = controller.match(/export interface SplitTabsController \{[\s\S]*?\n\}/)?.[0];
if (!declaration) throw new Error("Controller interface not found");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
run("npm", ["run", "demo:build", "--", "--base", "./", "--outDir", fileURLToPath(new URL("workbench/", output))]);
const { defaultKeymap } = await import(new URL("dist/index.js", root));
const keyRows = Object.entries(defaultKeymap).map(([command, keys]) => `| ~${command}~ | ${keys.map(key => `~${key}~`).join(", ")} |`);
const generated = {
  "CSS-TABLE": ["| Variable | Default / notes |", "|----------+-----------------|", ...table].join("\n"),
  "KEY-TABLE": ["| Command | Physical chord |", "|---------+----------------|", ...keyRows].join("\n"),
  OPTIONS: options,
  COMPONENTS: components,
  CONTROLLER: `#+begin_src typescript\n${declaration}\n#+end_src`,
  MIGRATION: migration,
};
await cp(new URL("doc/images/", root), new URL("images/", output), { recursive: true });
await cp(new URL("./style.css", import.meta.url), new URL("style.css", output));
await writeFile(new URL(".nojekyll", output), "");
for (const [index, [slug, title]] of chapters.entries()) {
  let source = await read(`site/${slug}.org`);
  source = source.replace(/@@([A-Z-]+)@@/g, (_, name) => {
    if (!(name in generated)) throw new Error(`Unknown generated reference: ${name}`);
    return generated[name];
  });
  const nav = chapters.map(([id, label], i) =>
    `<a href="${id}.html"${id === slug ? ' aria-current="page"' : ""}><span>${String(i + 1).padStart(2, "0")}</span>${label}</a>`).join("\n");
  const neighbor = (at, label) => chapters[at] ? `<a href="${chapters[at][0]}.html">${label}: ${chapters[at][1]}</a>` : "<span></span>";
  const html = run("pandoc", ["--from=org", "--to=html5", "--standalone", "--toc", "--toc-depth=2", "--wrap=none",
    "--shift-heading-level-by=1",
    `--template=${fileURLToPath(new URL("./template.html", import.meta.url))}`,
    "--metadata=lang:en", `--variable=chapter:${String(index + 1).padStart(2, "0")}`,
    `--variable=nav:${nav}`, `--variable=pagination:${neighbor(index - 1, "Previous")}${neighbor(index + 1, "Next")}`,
  ], source);
  await writeFile(new URL(`${slug}.html`, output), html);
  console.log(`Built ${slug}.html — ${title}`);
}
console.log(`Site built: ${chapters.length} chapters, ${variables.length} documented CSS variables, Workbench and media`);
