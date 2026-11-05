// Acceptance ledger: H1 -> undo slot is usable while arranging; M1 -> arrange toggle and contained Tab navigation;
// M4 -> picker leaves editor typing alone; M5 -> editor releases modifier covers; M6 -> moving/unmounting commits once;
// M7 -> invalid arrange exits fail at mount. Browser counterparts live in browser-lib.mjs.
import { mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { afterEach, expect, it } from "vitest";
import { SplitTabs, type SplitTabsController } from "../src/index.js";
import { createPanePick } from "../src/pick.js";
import { controller, key, storage } from "./helpers.js";

const wrappers: VueWrapper[] = [], controllers: SplitTabsController[] = [];
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
  for (const c of controllers.splice(0)) c.dispose();
});
async function fixture() {
  const s = storage(), c = controller({ tabs: ["a", "b", "c"], storage: s });
  controllers.push(c);
  c.setContainerSize(900, 700);
  const w = mount(SplitTabs, { attachTo: document.body, props: { controller: c,
    labels: { divider: "Resize", arrangeMenu: "Arrange actions" } }, slots: {
    arrange: ({ done }) => [h("button", { class: "host-done", onClick: done }, "Done"),
      h("button", { disabled: true }, "Disabled"), h("button", { hidden: true }, "Hidden"),
      h("button", { style: "display: none" }, "Invisible")],
    undo: ({ undo }) => h("button", { class: "host-undo", onClick: undo }, "Undo"),
  } });
  wrappers.push(w);
  await nextTick();
  return { s, c, w, run: (command: string) => w.vm.$.exposed!.run(command) };
}
async function edit(w: VueWrapper) {
  w.vm.$.exposed!.startRename("a");
  await nextTick(); await nextTick();
  const editor = w.get<HTMLInputElement>(".split-tab-strip-rename");
  await editor.setValue("Draft title");
  return editor;
}
it("H1 undo slot is usable while arranging", async () => {
  const { c, w, run } = await fixture();
  c.split("right");
  const before = c.notation.value;
  c.closeTarget();
  run("arrange"); await nextTick();
  await w.get(".host-undo").trigger("click");
  expect(c.notation.value).toBe(before);
  expect(w.classes()).toContain("split-tabs--arranging");
});
it("M1 bound arrange chord exits while other layout chords stay isolated", async () => {
  const { c, w, run } = await fixture();
  run("arrange"); await nextTick();
  const before = c.intent.value;
  expect(key({ code: "KeyH", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(c.intent.value).toBe(before);
  expect(key({ code: "KeyA", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  await nextTick();
  expect(w.classes()).not.toContain("split-tabs--arranging");
});
it("M1 Tab and Shift Tab cycle only the library arrange controls from content", async () => {
  const { w, run } = await fixture();
  const content = document.createElement("input"); document.body.append(content);
  try {
    content.focus(); run("arrange"); await nextTick();
    key({ key: "Tab", code: "Tab" }, content);
    expect(document.activeElement).toBe(w.get(".split-tabs-arrange-menu-button").element);
    key({ key: "Tab", code: "Tab", shiftKey: true }, document.activeElement!);
    expect(document.activeElement).toBe(w.get(".host-done").element);
    key({ key: "Tab", code: "Tab" }, document.activeElement!);
    expect(document.activeElement).toBe(w.get(".split-tabs-arrange-menu-button").element);
  } finally { content.remove(); }
});
it.each(["select", "pick", "move"] as const)("M4 %s picker leaves rename typing and Enter alone", async mode => {
  const { c, w } = await fixture();
  c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: "right" });
  const editor = await edit(w), pick = createPanePick(c);
  try {
    if (mode === "select") pick.select(); else if (mode === "pick") pick.start("a"); else pick.keyboardMove();
    const before = JSON.stringify([c.intent.value, c.selection.value]);
    expect(key({ key: mode === "pick" ? "2" : "a", code: mode === "pick" ? "Digit2" : "KeyA" }, editor.element)
      .defaultPrevented).toBe(false);
    expect(JSON.stringify([c.intent.value, c.selection.value])).toBe(before);
    await editor.trigger("keydown", { key: "Enter", code: "Enter" });
    expect(c.titleOf("a")).toBe("Draft title");
    expect(pick.mode.value).toBe(mode);
  } finally { pick.dispose(); }
});
it("M1 Tab from the inline editor stays inside arrange controls", async () => {
  const { w, run } = await fixture(), editor = await edit(w);
  run("arrange"); await nextTick();
  expect(key({ key: "Tab", code: "Tab" }, editor.element).defaultPrevented).toBe(true);
  await nextTick(); await nextTick();
  expect(document.activeElement).toBe(w.get(".split-tabs-arrange-menu-button").element);
});
it("M5 modifier releases inside rename remove covers without pointer movement", async () => {
  const { w } = await fixture(), editor = await edit(w);
  key({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true }, editor.element);
  await nextTick(); expect(w.classes()).toContain("split-tabs--grab");
  await editor.trigger("keyup", { key: "Alt", code: "AltLeft", shiftKey: true });
  await nextTick(); expect(w.classes()).not.toContain("split-tabs--grab");
});
it.each(["split", "bar"])("M6 moving an edited tab to a %s commits once and removes the editor", async kind => {
  const { c, w, s } = await fixture();
  if (kind === "bar") c.move({ view: "c" }, { kind: "split", target: c.focus.value, side: "right" });
  s.setItem.mockClear();
  await edit(w);
  c.move({ view: "a" }, kind === "bar" ? { kind: "bar", target: c.paneOf("c")!, index: null }
    : { kind: "split", target: c.focus.value, side: "right" });
  await nextTick(); await nextTick();
  expect(c.titleOf("a")).toBe("Draft title");
  expect(w.find(".split-tab-strip-rename").exists()).toBe(false);
  expect(s.setItem).toHaveBeenCalledTimes(2);
  expect(w.emitted("command")?.filter(([name]) => name === "rename")).toHaveLength(1);
});
it("M7 invalid arrangeExitKeys fails at mount before arranging", () => {
  const c = controller(); controllers.push(c);
  expect(() => mount(SplitTabs, { props: { controller: c, labels: { divider: "Resize" }, arrangeExitKeys: ["bad"] } }))
    .toThrow(/split-tabs:.*chord/);
});
