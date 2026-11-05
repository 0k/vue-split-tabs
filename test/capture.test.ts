// Acceptance ledger: mount -> canonical bindings; display -> digits/exits/timeout;
// arrange -> letters/all keys; keymap -> new bindings; held-only changes -> no duplicates;
// dispose -> empty policy; iframe identify -> same policy; native replay -> controller focus.
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { SplitTabs, type SplitTabsCapture } from "../src/index.js";
import { controller, key } from "./helpers.js";

afterEach(() => vi.useRealTimers());
const chords = ["Meta+Shift+KeyL"];
const idle = { chords, exitKeys: [], captureKeys: [], arranging: false };
const empty = { chords: [], exitKeys: [], captureKeys: [], arranging: false };
const exits = ["Escape", "Ctrl+KeyG", "Ctrl+KeyD"];

async function fixture() {
  const c = controller();
  c.setContainerSize(800, 600);
  c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
  const emitted: SplitTabsCapture[] = [];
  const wrapper = mount(SplitTabs, { attachTo: document.body, props: {
    controller: c, labels: { divider: "Resize" }, keymap: { focusRight: ["Shift+Meta+KeyL"] },
    onCapture: (policy: SplitTabsCapture) => emitted.push(policy),
  } });
  await nextTick();
  const policies = () => [...emitted];
  const run = (command: string) => wrapper.vm.$.exposed!.run(command);
  return { c, wrapper, policies, run };
}

it("capture on mount emits canonical bound chords exactly once with no mode keys", async () => {
  const { policies } = await fixture();
  expect(policies()).toEqual([idle]);
});

it.each(["exit", "timeout"])("capture display policy takes digits and default exits until %s", async end => {
  vi.useFakeTimers();
  const { policies, run } = await fixture();
  run("displayPanes");
  expect(policies().at(-1)).toEqual({ chords, exitKeys: exits,
    captureKeys: Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`), arranging: false });
  if (end === "exit") {
    key({ code: "Escape", key: "Escape" });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape" }));
  } else vi.advanceTimersByTime(2000);
  expect(policies().at(-1)).toEqual(idle);
});

it("capture arrange policy takes every key with Q exit and pane letters, then restores idle", async () => {
  const { wrapper, policies, run } = await fixture();
  run("arrange");
  await nextTick();
  const letters = wrapper.findAll('.split-tabs-pane-number[data-mode="letter"] .split-tabs-pane-number-badge')
    .map(badge => `Key${badge.text().toUpperCase()}`);
  expect(letters).toHaveLength(2);
  expect(policies().at(-1)).toEqual({ chords, exitKeys: [...exits, "KeyQ"], captureKeys: ["Tab", "Shift+Tab", ...letters], arranging: true });
  run("arrange");
  expect(policies().at(-1)).toEqual(idle);
});

it("capture follows keymap prop changes", async () => {
  const { wrapper, policies } = await fixture();
  await wrapper.setProps({ keymap: { focusLeft: ["Shift+Meta+KeyH"] } });
  expect(policies()).toEqual([idle, { ...idle, chords: ["Meta+Shift+KeyH"] }]);
});

it("capture never repeats a policy for held-only changes or equivalent keymaps", async () => {
  const { wrapper, policies, run } = await fixture();
  run("displayPanes");
  const before = policies();
  key({ code: "Digit9", key: "9" });
  key({ code: "Digit9", key: "9", repeat: true });
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Digit9" }));
  await wrapper.setProps({ keymap: { focusRight: ["Meta+Shift+KeyL"] } });
  expect(before).toHaveLength(2);
  expect(policies()).toEqual(before);
  run("arrange");
  run("arrange");
  const emitted = policies();
  for (let i = 1; i < emitted.length; i++) expect(emitted[i]).not.toEqual(emitted[i - 1]);
});

it.each([false, true])("capture unmount ends with one empty policy (already empty=%s)", async alreadyEmpty => {
  const { wrapper, policies } = await fixture();
  if (alreadyEmpty) await wrapper.setProps({ keymap: null });
  wrapper.unmount();
  expect(policies()).toEqual([idle, empty]);
});

it("capture equals iframe identify through idle, display, arrange, keymap change and disposal", async () => {
  const { wrapper, policies, run } = await fixture();
  const frame = document.createElement("iframe");
  wrapper.element.append(frame);
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
  const samePolicy = () => {
    const message = post.mock.calls.filter(([data]) => data.type === "identify").at(-1)![0];
    const { chords, exitKeys, captureKeys, arranging } = message;
    expect(policies().at(-1)).toEqual({ chords, exitKeys, captureKeys, arranging });
  };
  samePolicy();
  run("displayPanes"); samePolicy();
  run("arrange"); samePolicy();
  run("arrange"); samePolicy();
  await wrapper.setProps({ keymap: { focusLeft: ["Meta+Shift+KeyH"] } });
  samePolicy();
  wrapper.unmount(); samePolicy();
});

it("native untrusted Meta+Shift+KeyL replay on the focused element moves controller focus right", async () => {
  const { c, wrapper } = await fixture();
  c.focusPane(c.paneOf("a")!);
  const pane = wrapper.get(`[data-pane-id="${c.focus.value}"]`).element as HTMLElement;
  pane.focus();
  expect(document.activeElement).toBe(pane);
  const event = key({ code: "KeyL", key: "L", metaKey: true, shiftKey: true }, document.activeElement!);
  expect(event.isTrusted).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(c.focus.value).toBe(c.paneOf("b"));
});
