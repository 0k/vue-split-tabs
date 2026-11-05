import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { SplitTabs, SplitTabsMenu, type SplitTabsController } from "../src/index.js";
import { parseIntent, tabSet } from "../src/model.js";
import { controller, storage } from "./helpers.js";

// Acceptance ledger (requirement -> specification):
// trim/clear/unknown/one write/reactivity -> rename is an atomic title-only action
// old v3 load/validation -> optional titles validate without a version bump
// close/undo/prune -> close drops titles and undo restores them; stale keys prune on write
// move/group/dissolve/replace -> titles follow stable keys, never new or replaced keys
// default labels/slot -> custom titles render and reach the root tab slot
// editing/keys/blur/cleanup -> inline editing commits or cancels without exiting arrange
// policy/menu/touch -> rename follows the host policy and labelled menu subset
// host-owned menu/ref entry -> startRename edits the current title; unavailable labels return false
// browser/reload -> browser-lib's rename flow (Chromium + WebKit)
const controllers: SplitTabsController[] = [];
const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  for (const c of controllers.splice(0)) c.dispose();
});
function make(options: Parameters<typeof controller>[0] = {}) {
  const c = controller({ tabs: ["a", "b", "c"], ...options });
  controllers.push(c);
  c.setContainerSize(900, 700);
  return c;
}
async function settle() { await nextTick(); await nextTick(); await nextTick(); }
function root(c: SplitTabsController, props = {}, slots = {}) {
  const w = mount(SplitTabs, { attachTo: document.body,
    props: { controller: c, labels: { divider: "Resize", renameInput: "Tab name" }, ...props }, slots });
  wrappers.push(w);
  return w;
}
const label = '[data-split-tabs-tab="a"] .split-tab-strip-tab';
const input = ".split-tab-strip-rename";

describe("tab titles", () => {
  it("rename is an atomic title-only action: trim, clear, unknown, one write and reactive reads", () => {
    const s = storage(), c = make({ storage: s });
    const title = computed(() => c.titleOf("a"));
    expect(title.value).toBeNull();
    const layout = c.layout.value;
    expect(c.rename("a", "  Workspace  ")).toEqual({ ok: true });
    expect(title.value).toBe("Workspace");
    expect(c.layout.value).toBe(layout);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(c.rename("a", "Workspace")).toEqual({ ok: true });
    expect(c.rename("missing", "No")).toEqual({ ok: false, reason: "unknown" });
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(c.rename("a", " \n ")).toEqual({ ok: true });
    expect(title.value).toBeNull();
    expect(s.setItem).toHaveBeenCalledTimes(2);
    expect(c.rename("a", "")).toEqual({ ok: true });
    expect(s.setItem).toHaveBeenCalledTimes(2);
  });

  it("optional titles validate without a version bump and malformed maps reject at parseIntent", () => {
    const old = { version: 3, tree: tabSet("tabs", ["a"]), focus: "a", opened: [] };
    expect(parseIntent(old)).toEqual(old);
    const titled = { ...old, titles: { a: "Work", missing: "Stale" } };
    expect(parseIntent(titled)).toEqual({ ...old, titles: { a: "Work" } });
    for (const titles of [null, [], "title", { a: 1 }, { a: null }, { a: ["x"] }]) {
      expect(parseIntent({ ...old, titles })).toBeNull();
    }
  });

  // M2: sanitize at the read boundary, before a new placeholder can reuse an orphan title key.
  it("M2 stored blank and orphan titles are pruned before allocating placeholders", () => {
    const s = storage();
    const intent = { version: 3, tree: tabSet("tabs", ["a", "b", "c"], "a"), focus: "a", opened: [],
      titles: { a: " \n ", b: "Work", "new:1": "Orphan" } };
    expect(parseIntent(intent)?.titles).toEqual({ b: "Work" });
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent }] }));
    const c = make({ storage: s });
    const created = c.split("right");
    expect(created.ok && created.view).toBeTruthy();
    if (!created.ok || !created.view) throw new Error("Expected placeholder");
    expect(c.titleOf(created.view)).toBeNull();
    expect(c.intent.value.titles).toEqual({ b: "Work" });
  });

  it("old stored intents load and stale keys prune on the next write", () => {
    const s = storage();
    const old = { version: 3, tree: tabSet("tabs", ["a", "b", "c"], "a"), focus: "a", opened: [] };
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: old }] }));
    const c = make({ storage: s });
    expect(c.intent.value.tree).toEqual(old.tree);
    expect(c.titleOf("a")).toBeNull();
    c.dispose();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 2,
      intent: { ...old, titles: { a: "Work", missing: "Stale" } } }] }));
    const restored = make({ storage: s });
    expect(restored.titleOf("a")).toBe("Work");
    restored.rename("b", "Other");
    expect(restored.intent.value.titles).toEqual({ a: "Work", b: "Other" });
    const saved = JSON.parse(s.values.get("layouts")!).entries[0].intent;
    expect(saved.titles).toEqual({ a: "Work", b: "Other" });
    expect(saved.version).toBe(3);
  });

  it("close drops titles and undo restores them, including after reloading", () => {
    const s = storage(), c = make({ storage: s, optional: ["a"] });
    c.open("a");
    c.rename("a", "Work");
    expect(c.close("a").ok).toBe(true);
    expect(c.titleOf("a")).toBeNull();
    expect(c.intent.value.titles?.a).toBeUndefined();
    expect(c.undo().ok).toBe(true);
    expect(c.titleOf("a")).toBe("Work");
    expect(make({ storage: s, optional: ["a"] }).titleOf("a")).toBe("Work");
  });

  it("titles follow moves and grouping; dissolved and replaced keys lose theirs", () => {
    const tabs = ref(["a", "b", "c"]), c = make({ tabs });
    c.rename("a", "Work");
    expect(c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" }).ok).toBe(true);
    c.setSelection(c.panes.value.map(p => p.id));
    const result = c.tabNext();
    expect(result.ok).toBe(true);
    const frame = [...c.tabSets.value.values()].find(set => set.tabs.some(k => c.describe(k)?.kind === "layout"))!;
    const group = frame.tabs.find(k => c.describe(k)?.kind === "layout")!;
    expect(c.titleOf(group)).toBeNull();
    c.rename(group, "Layout");
    expect(c.titleOf("a")).toBe("Work");
    expect(result.ok && result.view).toBeTruthy();
    if (!result.ok || !result.view) throw new Error("Expected placeholder");
    c.rename(result.view, "Temporary");
    tabs.value.push("filled");
    c.replace(result.view, "filled");
    expect(c.titleOf(result.view)).toBeNull();
    expect(c.titleOf("filled")).toBeNull();
    // Closing the placeholder sibling dissolves the surrounding frame, not its retained layout.
    const second = c.tabNext();
    if (!second.ok || !second.view) throw new Error("Expected placeholder");
    c.rename(second.view, "Discard");
    c.close(second.view);
    expect(c.titleOf(second.view)).toBeNull();
    c.merge();
    expect(c.titleOf(group)).toBeNull();
    expect(c.titleOf("a")).toBe("Work");
  });

  it("a dissolved inner bar loses its title without renaming its surviving view", () => {
    const s = storage();
    s.values.set("layouts", JSON.stringify({ entries: [{ key: "page", stamp: 1, intent: {
      version: 3, tree: tabSet("outer", [tabSet("inner", ["a", "b"], "a"), "c"], "inner"),
      focus: "a", opened: ["b"], titles: { inner: "Inner bar", a: "Work" },
    } }] }));
    const c = make({ storage: s, optional: ["b"] });
    expect(c.close("b").ok).toBe(true);
    expect(c.intent.value.titles).toEqual({ a: "Work" });
    expect(c.titleOf("inner")).toBeNull();
    expect(c.undo().ok).toBe(true);
    expect(c.titleOf("inner")).toBe("Inner bar");
  });

  it("arbitrary view keys, including object prototype names, are valid title keys", () => {
    const c = make({ tabs: ["__proto__", "constructor"] });
    expect(c.rename("__proto__", "Prototype")).toEqual({ ok: true });
    expect(c.rename("constructor", "Constructor")).toEqual({ ok: true });
    expect(c.titleOf("__proto__")).toBe("Prototype");
    expect(c.titleOf("constructor")).toBe("Constructor");
    expect(parseIntent(JSON.parse(JSON.stringify(c.intent.value)))).toEqual(c.intent.value);
  });
});

describe("rename editing", () => {
  it("startRename opens the current title and Enter commits through rename with command reporting", async () => {
    const s = storage(), c = make({ storage: s });
    c.rename("a", "Current title");
    const w = root(c), writes = s.setItem.mock.calls.length;
    expect(w.vm.$.exposed!.startRename("a")).toBe(true);
    await settle();
    const editor = w.get<HTMLInputElement>(input);
    expect(editor.element.value).toBe("Current title");
    expect(document.activeElement).toBe(editor.element);
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    await editor.setValue("  Host menu title  ");
    await editor.trigger("keydown", { key: "Enter", code: "Enter" });
    await settle();
    expect(w.find(input).exists()).toBe(false);
    expect(c.titleOf("a")).toBe("Host menu title");
    expect(w.emitted("command")).toEqual([["rename", { ok: true }]]);
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it.each(["unknown", "disabled", "per-key disabled", "hidden bar"])("startRename refuses %s without changing state", async reason => {
    const s = storage(), c = make({ storage: s, ...(reason === "hidden bar" ? { tabs: ["a"] } : {}) });
    const w = root(c, { renamable: reason === "disabled" ? false : reason === "per-key disabled" ? (key: string) => key !== "a" : true });
    const before = c.intent.value;
    expect(w.vm.$.exposed!.startRename(reason === "unknown" ? "unknown" : "a")).toBe(false);
    await settle();
    expect(w.find(input).exists()).toBe(false);
    expect(c.intent.value).toBe(before);
    expect(s.setItem).toHaveBeenCalledTimes(0);
    expect(w.emitted("command")).toBeUndefined();
  });

  it("startRename supports an explicitly shown single-tab bar", async () => {
    const c = make({ tabs: ["a"] }), w = root(c, { alwaysShow: true });
    expect(w.vm.$.exposed!.startRename("a")).toBe(true);
    await settle();
    expect(w.get<HTMLInputElement>(input).element.value).toBe("");
  });

  it("custom titles render and reach the root tab slot reactively", async () => {
    const c = make(), w = root(c);
    c.rename("a", "Workspace");
    await settle();
    expect(w.get(label).text()).toBe("Workspace");
    const slotted = root(c, {}, { tab: ({ id, title }: { id: string; title: string | null }) => h("span", title ?? id) });
    expect(slotted.get(label).text()).toBe("Workspace");
    c.rename("a", "");
    await settle();
    expect(slotted.get(label).text()).toBe("a");
  });

  it("inline editing commits Enter and blur once, Escape cancels without exiting arrange", async () => {
    const s = storage(), c = make({ storage: s }), w = root(c);
    w.vm.$.exposed!.run("arrange");
    await settle();
    await w.get(label).trigger("dblclick");
    expect(w.get<HTMLInputElement>(input).element.value).toBe("");
    expect(w.get(input).attributes("aria-label")).toBe("Tab name");
    expect(document.activeElement).toBe(w.get(input).element);
    await w.get(input).setValue("First");
    await w.get(input).trigger("keydown", { key: "Enter", code: "Enter" });
    await settle();
    expect(c.titleOf("a")).toBe("First");
    expect(w.emitted("command")?.at(-1)).toEqual(["rename", { ok: true }]);
    const writes = s.setItem.mock.calls.length;
    await w.get(label).trigger("dblclick");
    await w.get(input).setValue("Cancelled");
    await w.get(input).trigger("keydown", { key: "Escape", code: "Escape" });
    await settle();
    expect(w.find(input).exists()).toBe(false);
    expect(w.classes()).toContain("split-tabs--arranging");
    expect(c.titleOf("a")).toBe("First");
    expect(s.setItem).toHaveBeenCalledTimes(writes);
    await w.get(label).trigger("dblclick");
    await w.get(input).setValue("Blurred");
    await w.get(input).trigger("blur");
    expect(c.titleOf("a")).toBe("Blurred");
    expect(s.setItem).toHaveBeenCalledTimes(writes + 1);
  });

  it("rename follows boolean/per-key host policy and labelled menu subset", async () => {
    const c = make(), w = root(c, { renamable: false, menuLabels: { rename: "Rename" }, menuItems: ["rename"] });
    await w.get(label).trigger("dblclick");
    expect(w.find(input).exists()).toBe(false);
    await w.get(label).trigger("contextmenu");
    expect(w.find('[data-menu-item="rename"]').exists()).toBe(false);
    await w.setProps({ renamable: (key: string) => key === "a" });
    await w.get('[data-split-tabs-tab="b"] .split-tab-strip-tab').trigger("dblclick");
    expect(w.find(input).exists()).toBe(false);
    await w.get(label).trigger("contextmenu");
    await settle();
    await w.get('[data-menu-item="rename"]').trigger("click");
    await settle();
    expect(document.activeElement).toBe(w.get(input).element);
    await w.get(input).trigger("keydown", { key: "Escape", code: "Escape" });
    await w.setProps({ menuLabels: {} });
    await w.get(label).trigger("contextmenu");
    expect(w.find('[data-menu-item="rename"]').exists()).toBe(false);
  });

  it("standalone menu emits rename only when labelled and allowed", async () => {
    const c = make(), anchor = document.createElement("button");
    const w = mount(SplitTabsMenu, { props: { controller: c, tab: "a", tabSet: c.focus.value, anchor,
      labels: { rename: "Rename" }, items: ["rename"] } });
    wrappers.push(w);
    await w.get('[data-menu-item="rename"]').trigger("click");
    expect(w.emitted("rename")).toEqual([["a"]]);
    expect(w.emitted("close")).toEqual([[]]);
  });

  it("unmount commits an unfinished edit and no host label invents input wording", async () => {
    const s = storage(), c = make({ storage: s }), w = root(c, { labels: { divider: "Resize" } });
    await w.get(label).trigger("dblclick");
    expect(w.get(input).attributes("aria-label")).toBeUndefined();
    await w.get(input).setValue("Uncommitted");
    w.unmount();
    wrappers.splice(wrappers.indexOf(w), 1);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(c.titleOf("a")).toBe("Uncommitted");
  });
});
