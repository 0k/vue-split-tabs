import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
function validVersion(value: unknown): boolean {
  if (value === "%%version%%") return true;
  if (typeof value !== "string" || value.trim() !== value) return false;
  const number = "(?:0|[1-9]\\d*)";
  const pre = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
  return new RegExp(`^${number}\\.${number}\\.${number}(?:-${pre}(?:\\.${pre})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`)
    .test(value);
}
describe("compatibility and packaging", () => {
  it("Pandoc-rendered README preserves every stylesheet variable's double hyphen", (context) => {
    const docs = readFileSync("README.org", "utf8");
    const autogen = readFileSync(".package.d/autogen.d/20-org-to-md.sh", "utf8");
    const args = ["README.org", "-f", "org", "-t", "gfm"];
    if (docs.match(/^#\+title:[ \t]*(.*)$/im)?.[1]?.trim()) args.push("--shift-heading-level-by=1");
    expect(autogen.split("\n").map(line => line.trim())).toContain(`pandoc ${args.join(" ")}`);
    const rendered = spawnSync("pandoc", args, { encoding: "utf8", timeout: 30000 });
    if (rendered.error && "code" in rendered.error && rendered.error.code === "ENOENT") {
      console.warn("SKIP README rendering: pandoc executable is not on PATH");
      context.skip();
      return;
    }
    expect(rendered.error).toBeUndefined();
    expect(rendered.status, rendered.stderr).toBe(0);
    const css = readFileSync("src/style.css", "utf8");
    const variables = [...new Set(css.match(/--split-tabs-[a-z0-9-]+/g) ?? [])];
    expect(variables.length).toBeGreaterThan(0);
    expect(variables.filter(variable => !rendered.stdout.includes(variable))).toEqual([]);
    expect(rendered.stdout).not.toContain("\u2013split-tabs-");
  }, 35000);

  it.each([
    ["%%version%%", true], ["0.0.0", true], ["1.2.3", true], ["1.0.0-rc.1", true],
    ["2.3.4+build.007", true], ["1.2.3-dev.20261031", true],
    ["", false], ["1.2", false], ["01.2.3", false], ["1.2.3-01", false],
    ["v1.2.3", false], ["1.2.3+", false], ["1.2.3\n", false],
  ])("version metadata %s is accepted=%s", (version, accepted) => {
    expect(validVersion(version)).toBe(accepted);
  });
  it("source contract excludes post-WebView91 APIs, unsafe types and 1px borders", () => {
    const source = files(resolve("src")).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const pattern of [/\.at\s*\(/, /\.findLast\s*\(/, /\.toSorted\s*\(/, /Object\.hasOwn\s*\(/, /structuredClone\s*\(/, /static\s*\{/, /Promise\.withResolvers/, /\bas any\b/, /@ts-(ignore|expect-error)/, /border[^:;{}]*:\s*1px/, /color-mix\s*\(/]) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toMatch(/touch-action:\s*none/);
    expect(source).toMatch(/\.split-tabs-divider::(?:before|after)/);
  });

  it("package files preserve release, peer, license, symlink and ignore contracts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
    expect(validVersion(pkg.version)).toBe(true);
    expect(pkg.peerDependencies).toEqual({ vue: "^3.5.0" });
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./style.css": "./dist/style.css",
    });
    expect(pkg.main === undefined || pkg.main === "./dist/index.js").toBe(true);
    expect(pkg.module).toBe("./dist/index.js");
    expect(pkg.homepage).toBe("https://github.com/0k/vue-split-tabs");
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/0k/vue-split-tabs.git" });
    expect(pkg.bugs).toEqual({ url: "https://github.com/0k/vue-split-tabs/issues" });
    expect(lstatSync("CLAUDE.md").isSymbolicLink()).toBe(true);
    expect(readFileSync("LICENSE", "utf8")).toContain("Valentin Lab <valentin.lab@kalysto.org>");
    for (const entry of ["node_modules/", "dist/", "/README.md", "AGENTS.local.md", "CLAUDE.local.md"]) expect(readFileSync(".gitignore", "utf8")).toContain(entry);
    expect(readFileSync(".package.d/config", "utf8")).toContain('NAME="@0k/vue-split-tabs"');
    expect(readFileSync("README.org", "utf8")).toContain("* Theming");
    expect(readFileSync("README.org", "utf8")).toContain("%%version%%");
    expect(readFileSync("vite.config.ts", "utf8")).toContain('target: "chrome91"');
  });

  it("styles full-size flex panes, a larger divider hit area, and swipe-friendly tab touch behavior", () => {
    const css = readFileSync("src/style.css", "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(selector)).split("}")[0] ?? "";
    const root = rule(".split-tabs {");
    for (const declaration of ["display: flex", "width: 100%", "height: 100%", "min-width: 0", "min-height: 0", "flex-direction: column"]) expect(root).toContain(declaration);
    expect(rule(".split-tabs--cols {")).toContain("flex-direction: row");
    const pane = rule(".split-tabs-pane {");
    for (const declaration of ["display: flex", "flex-direction: column", "overflow: hidden", "min-width: 0", "min-height: 0"]) expect(pane).toContain(declaration);
    expect(rule(".split-tabs-divider::before {")).toContain("--split-tabs-divider-hit-extra, 4px");
    expect(rule(".split-tabs--cols > .split-tabs-divider::before {")).toContain("--split-tabs-divider-hit-extra, 4px");
    expect(rule(".split-tabs-divider {")).toContain("touch-action: none");
    expect(rule(".split-tab-strip-tab {")).toContain("touch-action: pan-x");
    expect(css).not.toMatch(/\.split-tab-strip-item--drag-armed[^{}]*\{[^}]*touch-action/);
    expect(rule(".split-tabs-anchor {")).toContain("display: contents");
    expect(rule(".split-tabs-keep-holder {")).toContain("display: none");
    expect(rule(".split-tab-strip-send svg {")).toContain("--split-tabs-icon-size, 18px");
    const variables = [...css.matchAll(/var\((--split-tabs-[a-z-]+)/g)].map((match) => match[1]);
    const docs = readFileSync("README.org", "utf8");
    for (const variable of variables) expect(docs).toContain(variable);
  });

  it("icon reveal keeps layout and focusability while active, hover and focus items expose 24px hit boxes", () => {
    const css = readFileSync("src/style.css", "utf8");
    const button = css.match(/(?:^|\})\s*\.split-tab-strip-send\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(button).toMatch(/opacity:\s*0/);
    expect(button).toMatch(/pointer-events:\s*none/);
    expect(button).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(button).toMatch(/min-width:\s*var\(--split-tabs-icon-hit-size,\s*24px\)/);
    expect(button).toMatch(/min-height:\s*var\(--split-tabs-icon-hit-size,\s*24px\)/);
    expect(button).toMatch(/align-items:\s*center/);
    expect(button).toMatch(/justify-content:\s*center/);
    for (const item of [".split-tab-strip-item--active", ".split-tab-strip-item:hover", ".split-tab-strip-item:focus-within"]) {
      const rule = css.slice(css.indexOf(`${item} .split-tab-strip-send`)).split("}")[0] ?? "";
      expect(rule).toMatch(/opacity:\s*(?:1|var\(--split-tabs-icon-visible-opacity,\s*1\))/);
      expect(rule).toMatch(/pointer-events:\s*auto/);
    }
  });

  it("removes all obsolete menu implementation and label/class APIs", () => {
    const source = ["src/SplitTabStrip.vue", "src/context.ts", "src/style.css", "README.org"].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/split-tab-strip-menu|menuClass|menuItemClass|labels\.split|split:\s*string|split:\s*['"]/);
    expect(source).not.toContain("--split-tabs-menu-");
  });

  it("ESM shape explicitly ships CSS and runs clean build and artifact verification in check", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>; sideEffects: string[];
    };
    expect(pkg.scripts.check).toMatch(/npm run build\s*&&\s*node test\/build\.mjs/);
    expect(pkg.scripts.check).toContain("npm run test:browser");
    expect(pkg.scripts.build).toMatch(/^node scripts\/build\.mjs clean &&/);
    expect(pkg.scripts.build).toMatch(/node scripts\/build\.mjs css$/);
    expect(pkg.sideEffects).toContain("*.css");
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toMatch(/formats:\s*\["es"\]/);
    expect(config).not.toMatch(/\bglobals\s*:/);
    expect(readFileSync("src/index.ts", "utf8")).not.toMatch(/import\s*["']\.\/style\.css/);
    const features = readFileSync(".package.d/features", "utf8");
    expect(["registry\ngithub-release\n", "registry\ngithub-release\npublished\n"]).toContain(features);
  });

  it("overflow rules keep items and labels unshrunk and markers absolute inside the scrollable strip", () => {
    const css = readFileSync("src/style.css", "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(selector)).split("}")[0] ?? "";
    expect(rule(".split-tab-strip {")).toMatch(/overflow-x:\s*auto/);
    expect(rule(".split-tab-strip {")).toMatch(/position:\s*relative/);
    expect(rule(".split-tab-strip {")).toMatch(/scrollbar-width:\s*var\(--split-tabs-strip-scrollbar,\s*thin\)/);
    expect(rule(".split-tab-strip-item {")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(".split-tab-strip-tab {")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(".split-tab-strip-tab {")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".split-tab-strip-marker {")).toMatch(/position:\s*absolute/);
  });

  it("readable source lines stay within 160 characters", () => {
    const oversized = files(resolve("src")).flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        line.length > 160 ? [`${file}:${index + 1} (${line.length})`] : []));
    expect(oversized).toEqual([]);
  });
});
