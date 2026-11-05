// Acceptance ledger: defaults/keymap independence and page isolation -> capture exits;
// pick/select/move, tab/pane/armed drags and menu -> innermost exits;
// strict chords, opt-out and live updates -> exit policy;
// held releases/repeats and exit/unmount cleanup -> listener lifetime;
// iframe policy and real input -> frame.test.ts and browser-lib.mjs modal cases.
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { defaultKeymap, SplitTabs, useSplitTabsPick } from "../src/index.js";
import type { SplitTabsPick } from "../src/pick.js";
import { controller, pointer } from "./helpers.js";

const exits = [
  { key: "Escape", code: "Escape" },
  { key: "g", code: "KeyG", ctrlKey: true },
  { key: "d", code: "KeyD", ctrlKey: true },
];
function event(type: string, init: KeyboardEventInit, target: EventTarget = window) {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
async function fixture(iframes = false) {
  const c = controller();
  c.setContainerSize(800, 600);
  c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
  let pick!: SplitTabsPick;
  const Probe = defineComponent({ setup() { pick = useSplitTabsPick()!; return () => h("div"); } });
  const wrapper = mount(SplitTabs, { attachTo: document.body, props: {
    controller: c, labels: { divider: "Resize" }, keymap: { zoom: ["Alt+Shift+KeyZ"] },
    alwaysShow: true, menuLabels: { right: "Right", move: "Move", otherPane: "Other" },
  }, slots: { pane: () => [h(Probe), ...(iframes ? [h("iframe")] : [])] } });
  await nextTick();
  const api = wrapper.vm as unknown as { run(command: "arrange" | "pick" | "move"): void };
  const run = (command: "arrange" | "pick" | "move") => api.run(command);
  return { c, wrapper, run, pick };
}

describe("modal capture exits", () => {
  it("iframe modifier replay during selection cannot leave physical Meta held on the page", async () => {
    const { c, wrapper, pick } = await fixture(true);
    await wrapper.setProps({ keymap: defaultKeymap });
    c.focusPane(c.panes.value[0]!.id);
    const frame = wrapper.get("iframe").element as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
    const token = (post.mock.calls.at(-1)?.[0] as { token: string }).token;
    pick.select();
    for (const phase of ["keydown", "keyup"]) {
      window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: {
        "split-tabs": 1, token, type: "key", phase, code: "OSLeft", key: "Super", repeat: false,
        ctrlKey: false, altKey: false, shiftKey: false, metaKey: phase === "keydown",
      } }));
    }
    pick.cancel();
    expect(event("keydown", { key: "L", code: "KeyL", altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.focus.value).toBe(c.panes.value[1]!.id);
  });
  it.each(exits)("$code exits arrange without clear and consumes down/up before page targets or window bubble", async init => {
    const { wrapper, run } = await fixture();
    const seen: string[] = [];
    const bubble = (e: Event) => seen.push(`window:${e.type}`);
    window.addEventListener("keydown", bubble);
    window.addEventListener("keyup", bubble);
    try {
      for (const tag of ["input", "div"]) {
        const target = document.createElement(tag);
        target.contentEditable = "true";
        document.body.append(target);
        target.addEventListener("keydown", e => seen.push(e.type));
        target.addEventListener("keyup", e => seen.push(e.type));
        run("arrange");
        const laterCapture = vi.fn();
        window.addEventListener("keydown", laterCapture, true);
        expect(event("keydown", init, target).defaultPrevented).toBe(true);
        expect(laterCapture).not.toHaveBeenCalled();
        window.removeEventListener("keydown", laterCapture, true);
        await nextTick();
        expect(wrapper.classes()).not.toContain("split-tabs--arranging");
        expect(event("keyup", init, target).defaultPrevented).toBe(true);
        expect(seen).toEqual([]);
        expect(event("keydown", init, target).defaultPrevented).toBe(false);
        expect(event("keyup", init, target).defaultPrevented).toBe(false);
        expect(seen).toEqual(["keydown", "window:keydown", "keyup", "window:keyup"]);
        seen.length = 0;
        target.remove();
      }
    } finally {
      window.removeEventListener("keydown", bubble);
      window.removeEventListener("keyup", bubble);
    }
  });

  it.each(exits)("$code leaves arrange together with nested picker, menu and drags, without changing layout", async init => {
    const { c, wrapper, run, pick } = await fixture();
    const before = c.notation.value;
    for (const mode of ["pick", "select", "move", "menu", "tab", "pane", "armed"] as const) {
      run("arrange"); await nextTick();
      if (mode === "pick") pick.start("a");
      else if (mode === "select") pick.select();
      else if (mode === "move") pick.keyboardMove();
      else if (mode === "menu") await wrapper.get(".split-tab-strip-tab").trigger("contextmenu");
      else {
        const target = mode === "pane" ? wrapper.get(".split-tabs-pane-cover") : wrapper.get(".split-tab-strip-tab");
        pointer(target.element, "pointerdown", { pointerType: mode === "armed" ? "touch" : "mouse" });
        if (mode === "armed") await new Promise(resolve => setTimeout(resolve, 360));
        else pointer(window, "pointermove", { clientX: 20, clientY: 20 });
      }
      expect(event("keydown", init).defaultPrevented).toBe(true);
      event("keyup", init);
      await nextTick();
      expect(pick.mode.value).toBeNull();
      expect(wrapper.find(".split-tabs-menu").exists()).toBe(false);
      expect(document.querySelector(".split-tabs-drag-ghost")).toBeNull();
      expect(wrapper.find(".split-tab-strip-item--drag-armed").exists()).toBe(false);
      expect(wrapper.classes()).not.toContain("split-tabs--arranging");
      expect(c.notation.value).toBe(before);
      expect(c.selection.value).toEqual([]);
    }
  });

  it("matches physical codes and exact modifiers, excludes AltGraph, validates and updates the exit policy", async () => {
    const { wrapper, run } = await fixture();
    run("arrange");
    for (const extra of [{ shiftKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(event("keydown", { ...exits[1], ...extra }).defaultPrevented).toBe(true);
      event("keyup", { code: "KeyG" });
    }
    const graph = new KeyboardEvent("keydown", { ...exits[1], cancelable: true });
    Object.defineProperty(graph, "getModifierState", { value: (name: string) => name === "AltGraph" });
    window.dispatchEvent(graph);
    expect(graph.defaultPrevented).toBe(true);
    event("keyup", { code: "KeyG" });
    for (const exitKeys of [null, []]) {
      await wrapper.setProps({ exitKeys });
      for (const init of exits) {
        expect(event("keydown", init).defaultPrevented).toBe(true);
        event("keyup", init);
      }
      expect(wrapper.classes()).toContain("split-tabs--arranging");
    }
    await wrapper.setProps({ exitKeys: ["Shift+Ctrl+KeyQ"] });
    expect(event("keydown", { key: "not-q", code: "KeyQ", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    event("keyup", { code: "KeyQ" });
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--arranging");
  });

  it("enabling custom exits during a mode still wins over picker letters and menu navigation", async () => {
    const { c, wrapper, pick } = await fixture();
    await wrapper.setProps({ exitKeys: [] });
    pick.select();
    await wrapper.setProps({ exitKeys: ["KeyA"] });
    expect(event("keydown", { key: "a", code: "KeyA" }).defaultPrevented).toBe(true);
    event("keyup", { code: "KeyA" });
    expect(pick.mode.value).toBeNull();
    expect(c.selection.value).toEqual([]);
    await wrapper.setProps({ exitKeys: null });
    await wrapper.get(".split-tab-strip-tab").trigger("contextmenu");
    await wrapper.setProps({ exitKeys: ["ArrowDown"] });
    event("keydown", { key: "ArrowDown", code: "ArrowDown" });
    event("keyup", { code: "ArrowDown" });
    await nextTick();
    expect(wrapper.find(".split-tabs-menu").exists()).toBe(false);
  });

  it("holds one exit decision through repeats and removes capture listeners on release and unmount", async () => {
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    const { wrapper, run, pick } = await fixture();
    const baseline = add.mock.calls.length; // Physical modifier tracking belongs to the mounted root, not an active mode.
    run("arrange");
    pick.select();
    event("keydown", exits[0]!);
    event("keydown", { ...exits[0], repeat: true });
    await nextTick();
    expect(wrapper.classes()).not.toContain("split-tabs--arranging");
    event("keyup", exits[0]!);
    event("keydown", exits[0]!);
    event("keyup", exits[0]!);
    const captures = (from = baseline) => add.mock.calls.slice(from)
      .filter(([type, , capture]) => ["keydown", "keyup"].includes(type) && capture === true);
    for (const [type, listener, capture] of captures()) expect(remove.mock.calls).toContainEqual([type, listener, capture]);
    run("arrange");
    wrapper.unmount();
    for (const [type, listener, capture] of captures(0)) expect(remove.mock.calls).toContainEqual([type, listener, capture]);
    expect(event("keydown", exits[0]!).defaultPrevented).toBe(false);
    expect(event("keyup", exits[0]!).defaultPrevented).toBe(false);
  });

  it("resends active exit chords to every iframe on mode/policy changes and clears them on unmount", async () => {
    const { wrapper, run, pick } = await fixture(true);
    const posts = wrapper.findAll("iframe").map(frame => vi.spyOn((frame.element as HTMLIFrameElement).contentWindow!, "postMessage"));
    const identify = () => window.dispatchEvent(new MessageEvent("message", {
      origin: location.origin, data: { "split-tabs": 1, type: "hello" },
    }));
    const expectPolicy = (exitKeys: string[]) => {
      for (const post of posts) expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: "identify", exitKeys });
    };
    identify();
    expectPolicy([]);
    run("arrange");
    expectPolicy(["Escape", "Ctrl+KeyG", "Ctrl+KeyD", "KeyQ"]);
    run("arrange");
    expectPolicy([]);
    pick.keyboardMove();
    expectPolicy(["Escape", "Ctrl+KeyG", "Ctrl+KeyD"]);
    await wrapper.setProps({ exitKeys: ["Shift+Ctrl+KeyQ"] });
    expectPolicy(["Ctrl+Shift+KeyQ"]);
    pick.cancel();
    expectPolicy([]);
    run("arrange");
    wrapper.unmount();
    expectPolicy([]);
  });

  it("exiting arrange clears selection and bar focus", async () => {
    const { c, wrapper, run } = await fixture();
    c.toggleSelected(c.panes.value[0]!.id);
    c.focusBar(c.panes.value[0]!.id);
    await wrapper.setProps({ keymap: { clear: ["Escape"] } });
    run("arrange");
    event("keydown", exits[0]!);
    event("keyup", exits[0]!);
    expect(c.selection.value).toEqual([]);
    expect(c.barFocus.value).toBeNull();
  });
});
