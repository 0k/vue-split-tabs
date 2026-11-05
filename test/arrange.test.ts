// Acceptance ledger:
// page keys/pointers and cleanup -> isolates page content only while arranging
// iframe keys/pointers/touch/wheel, no content reports -> frame arrange isolation
// iframe hold release retires fingers during isolation -> frame reports touch release while arranging
// non-cancellable native touch releases -> isolates releases without attempting cancellation
// Q policy and reserved letter -> Q exits and never labels a pane
// every exit clears selection/bar focus -> all arrange exits clear transient targets
// visibility/labels/commands/refusals -> arrange menu uses target commands and host wording
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { expect, it, vi } from "vitest";
import { SplitTabs } from "../src/index.js";
import { connectSplitTabsFrame } from "../src/frame.js";
import { createPanePick } from "../src/pick.js";
import { controller, key, pointer } from "./helpers.js";

// R12-6 ledger: pointer-only drag bin -> no focus stop; Tab/Shift+Tab stay on host controls during drag.
it("the drag bin is not a keyboard stop in the arrange Tab cycle", async () => {
  const { c, w, run } = await fixture();
  try {
    c.split("right"); c.closeTarget();
    run("arrange"); await nextTick();
    pointer(w.get('[data-split-tabs-tab="a"] .split-tab-strip-tab').element, "pointerdown", { clientX: 40, clientY: 20 });
    pointer(window, "pointermove", { clientX: 60, clientY: 20 }); await nextTick();
    const bin = w.get("[data-split-tabs-bin]").element as HTMLElement;
    expect(bin.tabIndex).toBe(-1);
    const undo = w.get(".host-undo").element as HTMLElement, done = w.get(".host-done").element as HTMLElement;
    done.focus();
    key({ code: "Tab", key: "Tab" }, done);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Tab" }));
    expect(document.activeElement).toBe(undo);
    key({ code: "Tab", key: "Tab", shiftKey: true }, undo);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(done);
    pointer(window, "pointercancel");
  } finally { w.unmount(); c.dispose(); }
});

// R12 ledger: E/X at Done/menu/undo/label -> no command, write, tree or keyboard-focus change;
// forwarded E/X -> same isolation; bound arrange toggle -> exits; label reorder/editor/Tab -> existing suites.
it.each([".host-done", ".split-tabs-arrange-menu-button", ".host-undo", ".split-tab-strip-tab"])
  ("arrange controls swallow layout chords at %s", async selector => {
  const { c, w, run } = await fixture();
  try {
    await w.setProps({ alwaysShow: true });
    c.split("right"); c.closeTarget(); c.split("right");
    run("arrange"); await nextTick();
    const target = w.get(selector).element as HTMLElement;
    target.focus();
    const before = JSON.stringify(c.intent.value), commands = w.emitted("command")?.length ?? 0;
    for (const code of ["KeyE", "KeyX"]) {
      key({ code, altKey: true, shiftKey: true }, target);
      target.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      await nextTick();
      expect(JSON.stringify(c.intent.value)).toBe(before);
      expect(w.emitted("command")?.length ?? 0).toBe(commands);
      expect(document.activeElement).toBe(target);
      expect(w.classes()).toContain("split-tabs--arranging");
    }
    key({ code: "KeyA", altKey: true, shiftKey: true }, target);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    await nextTick();
    expect(w.classes()).not.toContain("split-tabs--arranging");
  } finally { w.unmount(); c.dispose(); }
});
it("forwarded layout chords cannot change the tree while arranging", async () => {
  const { c, w, run } = await fixture();
  try {
    const frame = document.createElement("iframe"); w.element.append(frame);
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
    const token = (post.mock.calls.at(-1)![0] as { token: string }).token;
    run("arrange");
    const before = JSON.stringify(c.intent.value);
    for (const code of ["KeyE", "KeyX"]) for (const phase of ["keydown", "keyup"]) {
      window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, token,
        type: "key", phase, code, key: code.slice(3), repeat: false, altKey: true, shiftKey: true, ctrlKey: false, metaKey: false } }));
    }
    expect(JSON.stringify(c.intent.value)).toBe(before);
  } finally { w.unmount(); c.dispose(); }
});

const types = ["keydown", "keyup", "pointerdown", "pointerup", "pointermove", "pointercancel", "mousedown", "mouseup", "mousemove",
  "click", "dblclick", "contextmenu", "wheel", "touchstart", "touchmove", "touchend", "touchcancel"];
function send(target: EventTarget, type: string, code = "KeyX") {
  const e = type.startsWith("key") ? new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true })
    : type.startsWith("touch") ? new TouchEvent(type, { bubbles: true, cancelable: true, touches: [] })
      : type.startsWith("pointer") ? new PointerEvent(type, { bubbles: true, cancelable: true })
      : new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}
async function fixture() {
  const c = controller();
  c.setContainerSize(800, 600);
  c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
  const w = mount(SplitTabs, { attachTo: document.body, props: { controller: c, labels: { divider: "Resize", arrangeMenu: "Arrange actions" },
    arrangeMenuLabels: { splitRight: "Split right", splitLeft: "Split left", group: "Group", close: "Close", done: "Done",
      reasons: { "not-closable": "Required content", "no-room": "No room" } } },
    slots: { arrange: ({ done }) => h("button", { class: "host-done", onClick: done }, "Done"),
      undo: ({ undo }) => h("button", { class: "host-undo", onClick: undo }, "Undo") } });
  await nextTick();
  const run = (command: string) => w.vm.$.exposed!.run(command);
  return { c, w, run };
}
it("isolates page content only while arranging, including keyup and later capture listeners", async () => {
  const { w, run } = await fixture();
  for (const tag of ["input", "div"]) {
    const target = document.createElement(tag);
    target.contentEditable = "true";
    document.body.append(target);
    const seen = vi.fn();
    types.forEach(type => target.addEventListener(type, seen));
    run("arrange");
    const later = vi.fn();
    types.forEach(type => window.addEventListener(type, later, true));
    for (const type of types) expect(send(target, type), type).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    types.forEach(type => window.removeEventListener(type, later, true));
    run("arrange");
    for (const type of types) expect(send(target, type), type).toBe(false);
    expect(seen).toHaveBeenCalledTimes(types.length);
    target.remove();
  }
  w.unmount();
});
it("frame arrange isolation cancels content events with only internal touch reports, then restores input", () => {
  const postMessage = vi.fn(), seen = vi.fn();
  const stop = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const target = document.createElement("input");
  document.body.append(target);
  types.forEach(type => target.addEventListener(type, seen));
  const identify = (arranging: boolean) => window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "identify", token: "test", chords: [], arranging } }));
  try {
    identify(true);
    postMessage.mockClear();
    for (const type of types) expect(send(target, type), type).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.map(([message]) => message)).toEqual(Array.from({ length: 4 }, () =>
      ({ "split-tabs": 1, type: "touches", token: "test", points: [] })));
    identify(false);
    for (const type of types) expect(send(target, type), type).toBe(false);
    expect(seen).toHaveBeenCalledTimes(types.length);
  } finally { stop(); target.remove(); }
});
it("frame reports touch release while arranging without leaking content events or claimed noise", () => {
  const postMessage = vi.fn(), seen = vi.fn();
  const stop = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const target = document.createElement("div");
  document.body.append(target);
  for (const type of ["touchend", "split-tabs-claimed"]) target.addEventListener(type, seen);
  const identify = (arranging: boolean) => window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "identify", token: "test", chords: [], arranging } }));
  try {
    identify(false);
    const touches = [0, 1, 2, 3].map(identifier => ({ identifier, target, clientX: 20 + identifier * 20, clientY: 20 }));
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: touches as unknown as Touch[] }));
    expect(postMessage.mock.calls.at(-1)?.[0].points).toHaveLength(4);
    identify(true);
    postMessage.mockClear();
    const end = new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] });
    target.dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      { "split-tabs": 1, type: "touches", token: "test", points: [] },
    ]);
  } finally { stop(); target.remove(); }
});
it.each(["page", "frame"])("isolates non-cancellable touch releases without attempting cancellation in %s", async owner => {
  const target = document.createElement("input"), seen = vi.fn();
  document.body.append(target);
  target.addEventListener("touchend", seen);
  const fixtureState = owner === "page" ? await fixture() : null;
  const stop = owner === "frame" ? connectSplitTabsFrame({ parent: { postMessage: vi.fn() } as unknown as Window }) : null;
  try {
    if (fixtureState) fixtureState.run("arrange");
    else window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
      data: { "split-tabs": 1, type: "identify", token: "test", chords: [], arranging: true } }));
    const event = new TouchEvent("touchend", { bubbles: true, cancelable: false, touches: [] });
    const cancel = vi.spyOn(event, "preventDefault");
    target.dispatchEvent(event);
    expect(cancel).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  } finally { fixtureState?.w.unmount(); stop?.(); target.remove(); }
});
it("Q exits only arrange; its configurable replacement works and q never labels a pane", async () => {
  const { c, w, run } = await fixture();
  run("arrange");
  send(window, "keydown", "KeyA"); send(window, "keyup", "KeyA");
  expect(c.selection.value).toContain(c.panes.value[0]!.id);
  expect(send(window, "keydown", "KeyQ")).toBe(true);
  expect(send(window, "keyup", "KeyQ")).toBe(true);
  await nextTick();
  expect(w.classes()).not.toContain("split-tabs--arranging");
  expect(send(window, "keydown", "KeyQ")).toBe(false);
  await w.setProps({ arrangeExitKeys: ["KeyW"] });
  run("arrange");
  send(window, "keydown", "KeyQ"); send(window, "keyup", "KeyQ");
  await nextTick();
  expect(w.classes()).toContain("split-tabs--arranging");
  send(window, "keydown", "KeyW"); send(window, "keyup", "KeyW");
  await nextTick();
  expect(w.classes()).not.toContain("split-tabs--arranging");
  const many = controller({ tabs: Array.from({ length: 18 }, (_, i) => `v${i}`), minPaneWidth: 1 });
  many.setContainerSize(1000000, 600);
  for (let i = 1; i < 18; i++) many.split("right");
  const pick = createPanePick(many);
  expect(many.panes.value.map(p => pick.letterOf(p.id))).not.toContain("q");
  pick.dispose(); many.dispose(); w.unmount();
});
it.each([null, []])("arrange exit additions can be disabled with %s without disabling isolation", async arrangeExitKeys => {
  const { w, run } = await fixture();
  await w.setProps({ arrangeExitKeys });
  run("arrange");
  send(window, "keydown", "KeyQ"); send(window, "keyup", "KeyQ");
  await nextTick();
  expect(w.classes()).toContain("split-tabs--arranging");
  run("arrange"); w.unmount();
});
it.each(["Escape", "CtrlG", "CtrlD", "Q", "done", "command", "hold"])("all arrange exits clear transient targets: %s", async exit => {
  vi.useFakeTimers();
  const { c, w, run } = await fixture();
  try {
    run("arrange");
    await nextTick();
    c.toggleSelected(c.panes.value[0]!.id);
    c.toggleSelected(c.panes.value[1]!.id);
    c.focusBar(c.focus.value);
    if (exit === "done") { await nextTick(); await w.get(".host-done").trigger("click"); }
    else if (exit === "command") run("arrange");
    else if (exit === "hold") {
      const target = w.get(".split-tabs-pane-cover").element;
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [0, 1, 2, 3].map(identifier =>
        ({ identifier, target, clientX: 20 + identifier * 20, clientY: 20 })) as unknown as Touch[] }));
      vi.advanceTimersByTime(500);
    } else {
      const code = exit === "Escape" ? "Escape" : exit === "Q" ? "KeyQ" : exit === "CtrlG" ? "KeyG" : "KeyD";
      for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { code, ctrlKey: exit.startsWith("Ctrl") }));
    }
    expect(c.selection.value).toEqual([]);
    expect(c.barFocus.value).toBeNull();
  } finally { w.unmount(); vi.useRealTimers(); }
});
it("arrange menu uses target commands, hides label-less items, displays refusal wording and supports Done", async () => {
  const { c, w, run } = await fixture();
  expect(w.find(".split-tabs-arrange-menu-button").exists()).toBe(false);
  run("arrange"); await nextTick();
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  expect(w.find('[data-menu-item="tabNext"]').exists()).toBe(false);
  expect(w.find('[data-menu-item="group"]').exists()).toBe(false);
  expect(w.get('[data-menu-item="close"]').attributes("disabled")).toBeDefined();
  expect(w.get('[data-menu-item="close"] .split-tabs-menu-reason').text()).toBe("Required content");
  const panes = c.panes.value.length;
  await w.get('[data-menu-item="splitRight"]').trigger("click");
  expect(c.panes.value).toHaveLength(panes + 1);
  expect(c.panes.value.find(p => p.id === c.focus.value)!.view).toMatch(/^new:/);
  c.toggleSelected(c.panes.value[0]!.id); c.toggleSelected(c.panes.value[1]!.id);
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  expect(w.find('[data-menu-item="group"]').exists()).toBe(true);
  await w.get('[data-menu-item="group"]').trigger("click");
  expect(c.plan.value?.ok).toBe(true);
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  await w.get('[data-menu-item="done"]').trigger("click");
  expect(w.find(".split-tabs-arrange-menu-button").exists()).toBe(false);
  w.unmount();
});
it.each(["splitRight", "splitLeft", "splitBelow", "splitAbove", "tabNext", "tabInside", "zoom", "barSide", "close"] as const)
  ("arrange menu runs %s on the selected target and previews without writes", async item => {
  const { c, w, run } = await fixture();
  const selected = c.panes.value.map(p => p.id);
  c.setSelection(selected);
  const before = JSON.stringify(c.intent.value);
  c.canTarget(item);
  expect(JSON.stringify(c.intent.value)).toBe(before);
  await w.setProps({ arrangeMenuLabels: { [item]: "Action",
    reasons: { "not-closable": "Required content", "no-bar": "No bar", "fills-area": "Already fills the area" } },
    arrangeMenuItems: [item] });
  run("arrange"); await nextTick();
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  const button = w.get(`[data-menu-item="${item}"]`);
  if (button.attributes("disabled") !== undefined) expect(button.get(".split-tabs-menu-reason").text()).toBeTruthy();
  else {
    await button.trigger("click");
    expect((w.emitted("command")?.at(-1) ?? []).slice(0, 2)).toEqual([item, expect.objectContaining({ ok: true })]);
  }
  w.unmount();
});
it("arrange Q exits even with its menu open and a detached root never owns page input", async () => {
  const { c, w, run } = await fixture();
  const detached = mount(SplitTabs, { props: { controller: controller(), labels: { divider: "Resize" } } });
  detached.vm.$.exposed!.run("arrange");
  run("arrange"); await nextTick();
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  c.setSelection(c.panes.value.map(p => p.id));
  const target = w.get('[data-menu-item="done"]').element;
  send(target, "keydown", "KeyQ"); send(target, "keyup", "KeyQ");
  await nextTick();
  expect(w.classes()).not.toContain("split-tabs--arranging");
  expect(w.find(".split-tabs-menu").exists()).toBe(false);
  expect(c.selection.value).toEqual([]);
  detached.unmount(); w.unmount();
});
it("a missing host label hides the arrange button; menu order follows the supplied subset", async () => {
  const { w, run } = await fixture();
  await w.setProps({ labels: { divider: "Resize" } });
  run("arrange"); await nextTick();
  expect(w.find(".split-tabs-arrange-menu-button").exists()).toBe(false);
  await w.setProps({ labels: { divider: "Resize", arrangeMenu: "Arrange actions" }, arrangeMenuItems: ["done", "splitRight"] });
  await w.get(".split-tabs-arrange-menu-button").trigger("click");
  expect(w.findAll("[data-menu-item]").map(item => item.attributes("data-menu-item"))).toEqual(["done", "splitRight"]);
  w.unmount();
});
it("captured key releases drop modifier covers before arrange exits", async () => {
  const { w } = await fixture();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", altKey: true, shiftKey: true }));
  send(window, "keyup", "KeyA");
  send(window, "keydown", "KeyQ"); send(window, "keyup", "KeyQ");
  await nextTick();
  expect(w.classes()).not.toContain("split-tabs--arranging");
  expect(w.classes()).not.toContain("split-tabs--grab");
  expect(w.find(".split-tabs-pane-cover").exists()).toBe(false);
  w.unmount();
});
