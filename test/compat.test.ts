import { readFileSync, readdirSync, existsSync } from "node:fs";
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
function declarations(css: string, selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^}]+)\}/g)]
    .filter((match) => match[1]?.split(",").some((part) => part.trim() === selector))
    .map((match) => match[2]).join("\n");
}
describe("compatibility and packaging", () => {
  it("demo acceptance lists every named executable scenario", () => {
    const table = readFileSync("demo/acceptance.org", "utf8");
    const names = ["demo/test.mjs", "demo/scenarios.mjs"].flatMap(path =>
      [...readFileSync(path, "utf8").matchAll(/\{ name: "([^"]+)", (?:async )?run\(/g)].map(match => match[1]!));
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(table, name).toContain(`| ${name} |`);
  });

  it("README image links point at the main branch and existing image files, never at a version", () => {
    const docs = readFileSync("README.org", "utf8");
    const links = [...docs.matchAll(/\[\[([^\]]+)\]/g)].map(m => m[1]!);
    expect(links.filter(url => url.includes("%%version%%"))).toEqual([]);
    const images = links.filter(url => url.startsWith("https://raw.githubusercontent.com/0k/vue-split-tabs/"));
    expect(images).toHaveLength(11);
    for (const url of images) {
      const match = url.match(/^https:\/\/raw\.githubusercontent\.com\/0k\/vue-split-tabs\/main\/(doc\/images\/[^?#]+)$/);
      expect(match, url).not.toBeNull();
      expect(existsSync(match![1]!)).toBe(true);
    }
  });

  it("public docs state bundler types and keyed controller replacement", () => {
    const docs = readFileSync("README.org", "utf8");
    expect(docs).toContain('moduleResolution: "bundler"');
    expect(docs).toContain("NodeNext");
    expect(docs).toMatch(/controller~ prop is read once/);
    expect(docs).toContain(':key="controllerKey"');
  });

  it("public focus documentation distinguishes pane clicks from directional keyboard focus", () => {
    const docs = readFileSync("README.org", "utf8");
    expect(docs).toContain("~focusPane~ saves a changed focused view immediately");
    expect(docs).toMatch(/~focusDirection~[^.]*next write/);
  });

  it("public docs warn which default chords take their host-field characters", () => {
    for (const path of ["README.org", "site/interaction.org"]) {
      const docs = readFileSync(path, "utf8");
      expect(docs).toMatch(/~pick~, ~move~, and ~arrange~ always succeed; ~tabNext~ and ~tabInside~ succeed/);
      expect(docs).toContain("Option+Shift+M/V/A and Option+Shift+T/I");
      expect(docs).toContain("Option+Shift+E/O when there is room");
      expect(docs).toMatch(/characters cannot be typed in host fields/);
    }
  });

  it("README describes already-visible drops and every glyph union", () => {
    const docs = readFileSync("README.org", "utf8");
    expect(docs).toMatch(/already-visible id[^.]*~beforeDrop~[^.]*not called/);
    expect(docs).toContain("~orientation: 'rows' | 'cols'~");
  });

  it("Pandoc README images have descriptive alt text without changing their URLs", context => {
    const rendered = spawnSync("pandoc", ["README.org", "-f", "org", "-t", "gfm"], { encoding: "utf8", timeout: 30000 });
    if (rendered.error && "code" in rendered.error && rendered.error.code === "ENOENT") { context.skip(); return; }
    expect(rendered.error).toBeUndefined();
    expect(rendered.status, rendered.stderr).toBe(0);
    const document = new DOMParser().parseFromString(rendered.stdout, "text/html");
    const htmlImages = [...document.querySelectorAll('img[src^="https://raw.githubusercontent.com/"]')]
      .map(image => ({ alt: image.getAttribute("alt") ?? "", url: image.getAttribute("src") }));
    const markdownImages = [...rendered.stdout.matchAll(/!\[([^\]]*)\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+)\)/g)]
      .map(image => ({ alt: image[1]!, url: image[2] }));
    const images = [...htmlImages, ...markdownImages];
    expect(images).toHaveLength(11);
    for (const image of images) expect(image.alt.trim().length, image.url ?? "").toBeGreaterThan(5);
    const source = readFileSync("README.org", "utf8");
    const urls = [...source.matchAll(/\[\[(https:\/\/raw\.githubusercontent\.com\/[^\]]+)\]/g)].map(match => match[1]);
    expect(images.map(image => image.url)).toEqual(urls);
  });

  it("public README describes the public demo and development commands", () => {
    const docs = readFileSync("README.org", "utf8");
    expect(docs).toContain("npm run check");
    expect(docs).toContain("npm run demo");
  });

  it("documented divider stacking default matches the stylesheet", () => {
    const css = readFileSync("src/style.css", "utf8");
    const value = css.match(/var\(--split-tabs-divider-z-index,\s*(\d+)\)/)![1];
    expect(readFileSync("README.org", "utf8")).toContain(`| ~--split-tabs-divider-z-index~ | ~${value}~ |`);
  });

  it("Pandoc GFM API tables keep unions and their intended column counts", context => {
    const rendered = spawnSync("pandoc", ["README.org", "-f", "org", "-t", "gfm", "--shift-heading-level-by=1"], {
      encoding: "utf8", timeout: 30000,
    });
    if (rendered.error && "code" in rendered.error && rendered.error.code === "ENOENT") {
      console.warn("SKIP README rendering: pandoc executable is not on PATH");
      context.skip();
      return;
    }
    expect(rendered.error).toBeUndefined();
    expect(rendered.status, rendered.stderr).toBe(0);
    const markdown = rendered.stdout;
    for (const [name, columns] of [["SplitSide", 2], ["paneOf", 2], ["tabSet", 2], ["describe", 2], ["focusBar", 2],
      ["setBarWidth", 2], ["setBarWidthLive", 2], ["SplitTabsGlyph", 3]] as const) {
      const row = markdown.split("\n").find(line => line.startsWith(`| \`${name}\``))!;
      expect(row, name).toBeDefined();
      expect(row.match(/(?<!\\)\|/g)?.length, name).toBe(columns + 1);
    }
    expect(markdown.replace(/\\\|/g, "|")).toContain("(view: string): PaneId | null");
    expect(markdown.replace(/\\\|/g, "|")).toContain("(tabSet: string, width: number | null): void");
  });
  it("documents the 0.3 public API and breaking changes and excludes demo assets from the package", () => {
    const docs = readFileSync("README.org", "utf8");
    for (const api of ["Breaking changes from 0.2.x", "intent.tree", "tabInside", "placeholderPrefix", "defaultKeymap",
      "@0k/vue-split-tabs/frame", "SplitTabsKeep", "overlay"]) {
      expect(docs, `Expected 0.3 API documentation: ${api}`).toContain(api);
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };
    expect(pkg.files, "Expected package allowlist to exclude demo and documentation assets").toEqual(["dist", "README.md", "LICENSE"]);
  });

  it("documents self-split labels, tab-menu paths and source-specific own-middle refusals", () => {
    const docs = readFileSync("README.org", "utf8");
    expect(docs).toContain("labels: { divider, closeSelection?, newPane? }");
    const selfDrop = docs.split("Dropping a pane or its SHOWN tab's label on its OWN")[1]!.split("** Keyboard")[0]!;
    for (const text of ["tab-menu direction actions", "~into-itself~", "~nothing-to-move~", "only visible tab"]) {
      expect(selfDrop).toContain(text);
    }
    const menu = docs.split("** Tab context menu")[1]!.split("**")[0]!;
    expect(menu).toContain("a lone visible tab self-splits");
  });

  it("maps removed ratio, zero-divider and marker APIs in the migration table", () => {
    const docs = readFileSync("README.org", "utf8");
    const migration = docs.split("** Breaking changes from 0.2.x")[1]!.split("** Controller options")[0]!;
    for (const api of ["defaultRatio", "dividerSize", "split-tab-strip-marker", "data-before", "--split-tabs-marker-width",
      ".split-tabs-drop-shade[data-marker]", ':always-show="controller.hasSplit.value"',
      "--split-tabs-icon-size", "--split-tabs-icon-hit-size"]) expect(migration).toContain(api);
    const theming = docs.split("* Theming")[1]!;
    expect(theming).toContain(".split-tabs-drop-shade[data-marker]");
    expect(theming).toContain("--split-tabs-marker-color");
  });

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
    for (const pattern of [/\.at\s*\(/, /\.findLast\s*\(/, /\.toSorted\s*\(/, /Object\.hasOwn\s*\(/, /structuredClone\s*\(/,
      /static\s*\{/, /Promise\.withResolvers/, /\bas any\b/, /@ts-(ignore|expect-error)/, /border[^:;{}]*:\s*1px/, /color-mix\s*\(/]) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toMatch(/touch-action:\s*none/);
    expect(source).toMatch(/\.split-tabs-divider::(?:before|after)/);
  });

  it("package files preserve release, peer and license contracts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
    expect(validVersion(pkg.version)).toBe(true);
    expect(pkg.peerDependencies).toEqual({ vue: "^3.5.3" });
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.packages[""].peerDependencies).toEqual({ vue: "^3.5.3" });
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./frame": { types: "./dist/frame.d.ts", default: "./dist/frame.js" },
      "./style.css": "./dist/style.css",
    });
    expect(pkg.main === undefined || pkg.main === "./dist/index.js").toBe(true);
    expect(pkg.module).toBe("./dist/index.js");
    expect(pkg.homepage).toBe("https://github.com/0k/vue-split-tabs");
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/0k/vue-split-tabs.git" });
    expect(pkg.bugs).toEqual({ url: "https://github.com/0k/vue-split-tabs/issues" });
    expect(readFileSync("LICENSE", "utf8")).toContain("Valentin Lab <valentin.lab@kalysto.org>");
    expect(readFileSync(".package.d/config", "utf8")).toContain('NAME="@0k/vue-split-tabs"');
    expect(readFileSync("README.org", "utf8")).toContain("* Theming");
    expect(readFileSync("vite.config.ts", "utf8")).toContain('target: "chrome91"');
  });

  it("styles full-size flex panes, a larger divider hit area, and swipe-friendly tab touch behavior", () => {
    const css = readFileSync("src/style.css", "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(selector)).split("}")[0] ?? "";
    const root = rule(".split-tabs {");
    for (const declaration of ["display: flex", "width: 100%", "height: 100%", "min-width: 0", "min-height: 0", "flex-direction: column"]) {
      expect(root).toContain(declaration);
    }
    expect(rule(".split-tabs--cols {")).toContain("flex-direction: row");
    for (const selector of [".split-tabs-tabset", ".split-tabs-pane", ".split-tabs-pane-content"]) {
      for (const declaration of ["display: flex", "flex-direction: column", "overflow: hidden", "min-width: 0", "min-height: 0"]) {
        expect(declarations(css, selector)).toContain(declaration);
      }
    }
    expect(rule(".split-tabs-divider::before {")).toContain("--split-tabs-divider-hit-extra, 4px");
    expect(rule(".split-tabs--cols > .split-tabs-divider::before {")).toContain("--split-tabs-divider-hit-extra, 4px");
    expect(rule(".split-tabs-divider {")).toContain("touch-action: none");
    expect(rule(".split-tab-strip-tab {")).toContain("touch-action: pan-x");
    expect(css).not.toMatch(/\.split-tab-strip-item--drag-armed[^{}]*\{[^}]*touch-action/);
    expect(rule(".split-tabs-anchor {")).toContain("display: contents");
    expect(rule(".split-tabs-keep-holder {")).toContain("display: none");
    expect(css).not.toContain("split-tab-strip-send");
    expect(declarations(css, ".split-tab-strip-close svg")).toContain("--split-tabs-close-size, 10px");
    const variables = [...css.matchAll(/var\((--split-tabs-[a-z-]+)/g)].map((match) => match[1]);
    const docs = readFileSync("README.org", "utf8");
    for (const variable of variables) expect(docs).toContain(variable);
  });

  it("divider hit areas stack above persistent iframe overlays and below focus marks", () => {
    const css = readFileSync("src/style.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const z = (selector: string) => {
      const match = declarations(css, selector).match(/z-index:\s*var\([^,]+,\s*(\d+)\)/);
      expect(match, `${selector} has an overridable default stacking level`).not.toBeNull();
      return Number(match![1]);
    };
    expect(z(".split-tabs-divider")).toBeGreaterThan(z(".split-tabs-keep-layer"));
    expect(z(".split-tabs-divider")).toBeLessThan(z(".split-tabs-focus"));
  });

  it.each(["close"])("%s icon reveal keeps layout and focusability with its distinct hit size", (action) => {
    const css = readFileSync("src/style.css", "utf8");
    const button = declarations(css, `.split-tab-strip-${action}`);
    expect(button).toMatch(/opacity:\s*0/);
    expect(button).toMatch(/pointer-events:\s*none/);
    expect(button).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    {
      expect(button).toMatch(/width:\s*var\(--split-tabs-close-hit,\s*18px\)/);
      expect(button).toMatch(/height:\s*var\(--split-tabs-close-hit,\s*18px\)/);
      expect(button).toMatch(/padding:\s*0/);
      expect(button).toContain("--split-tabs-close-gap, 2px");
      expect(button).not.toContain("--split-tabs-icon-hit-size");
    }
    expect(button).toMatch(/align-items:\s*center/);
    expect(button).toMatch(/justify-content:\s*center/);
    for (const item of [".split-tab-strip-item--active", ".split-tab-strip-item:hover", ".split-tab-strip-item:focus-within"]) {
      const rule = declarations(css, `${item} .split-tab-strip-${action}`);
      expect(rule).toMatch(/opacity:\s*(?:1|var\(--split-tabs-icon-visible-opacity,\s*1\))/);
      expect(rule).toMatch(/pointer-events:\s*auto/);
    }
  });

  it("groups the active title background and centres the sticky end with host padding", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(declarations(css, ".split-tab-strip-title--active")).toContain("--split-tabs-tab-active-background");
    expect(declarations(css, ".split-tab-strip-tab--active")).not.toContain("--split-tabs-tab-active-background");
    const end = declarations(css, ".split-tab-strip-end");
    for (const rule of ["display: flex", "align-items: center", "position: sticky", "right: 0", "flex: none"]) expect(end).toContain(rule);
    expect(end).toContain("--split-tabs-strip-end-padding, 0");
  });

  it("removes all obsolete menu implementation and label/class APIs", () => {
    const source = ["src/SplitTabStrip.vue", "src/context.ts", "src/style.css", "README.org"].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/split-tab-strip-menu|menuClass|menuItemClass|labels\.split/);
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
    expect(["registry\ngithub-release\n", "registry\ngithub-release\npublished\n",
      "registry\ngithub-release\nannounce\npublished\n"]).toContain(features);
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
    expect(rule(".split-tabs-drop-shade {")).toMatch(/position:\s*absolute/);
  });

  it("readable source lines stay within 160 characters", () => {
    const oversized = [...files(resolve("src")), ...files(resolve("test"))].flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        line.length > 160 ? [`${file}:${index + 1} (${line.length})`] : []));
    expect(oversized).toEqual([]);
  });
});
