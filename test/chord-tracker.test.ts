// Acceptance ledger: GTK/Chrome and aliases -> physical Meta;
// keyup/hidden and disposal -> immediate reset and lifetime; blur -> reset after 500 ms unless focus returns;
// keymap/exits/pointers/reorder -> shared effective modifiers;
// host helper -> same strict chord validation and AltGraph rule;
// frame normalization -> frame.test.ts physical Meta specification.
// Two roots -> one ordered report clock; page release/blur/hidden -> reject stale reports.
// Recorded Win-first double focus interruption -> covers, host matching and bound command after 500 ms.
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import * as library from "../src/index.js";
import { controller, key, pointer } from "./helpers.js";
import { reportFrameMeta } from "../src/keymap.js";

const testTrackers: library.SplitTabsChordTracker[] = [];
afterEach(() => { for (const tracker of testTrackers.splice(0)) tracker.dispose(); vi.useRealTimers(); });
/** A window blur that lasts: focus does not come back within the 500 ms grace delay. */
function lostFocus() {
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(500);
}

function meta(type: string, code = "OSLeft", name = "Super", metaKey = false) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: name, shiftKey: true, metaKey, bubbles: true }));
}
async function fixture() {
  // jsdom cannot generate trusted input; real trusted sequences also run in browser-lib.mjs.
  testTrackers.push(library.createChordTracker(window, () => true));
  const c = controller();
  c.setContainerSize(800, 600);
  c.move({ view: "b" }, { kind: "split", target: c.focus.value, side: "right" });
  const wrapper = mount(library.SplitTabs, { attachTo: document.body, props: {
    controller: c, labels: { divider: "Resize" }, alwaysShow: true,
    keymap: { focusLeft: ["Shift+Meta+KeyH"] }, exitKeys: ["Shift+Meta+KeyG"],
    pointerChords: { toggle: "Shift+Meta", move: "Shift+Meta", rectangle: null },
  } });
  await nextTick();
  return { c, wrapper };
}

it("synthetic Meta events cannot create or release physical-key state by default", () => {
  const tracker = library.createChordTracker();
  try {
    meta("keydown");
    expect(tracker.matches(new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true }), "Shift+Meta+KeyH")).toBe(false);
    meta("keyup");
  } finally { tracker.dispose(); }
});

// R12-5 ledger: late host predicate -> shared acceptance; disposal -> revocation;
// identical predicates on two leases -> disposing either lease retains the other.
it.each([false, true])("late tracker predicates live exactly as long as their leases (shared=%s)", sharedPredicate => {
  const first = library.createChordTracker(); testTrackers.push(first);
  const replays = new WeakSet<KeyboardEvent>();
  const trusted = (event: KeyboardEvent) => replays.has(event);
  const host = library.createChordTracker(window, trusted); testTrackers.push(host);
  const other = sharedPredicate ? library.createChordTracker(window, trusted) : null;
  if (other) testTrackers.push(other);
  const replay = (type: string) => {
    const event = new KeyboardEvent(type, { code: "OSLeft", key: "Super" });
    replays.add(event); window.dispatchEvent(event);
  };
  const letter = new KeyboardEvent("keydown", { code: "KeyH" });
  replay("keydown");
  expect(first.matches(letter, "Meta+KeyH")).toBe(true);
  replay("keyup");
  expect(first.matches(letter, "Meta+KeyH")).toBe(false);
  host.dispose(); host.dispose();
  replay("keydown");
  expect(first.matches(letter, "Meta+KeyH")).toBe(sharedPredicate);
  replay("keyup"); other?.dispose();
  replay("keydown");
  expect(first.matches(letter, "Meta+KeyH")).toBe(false);
});

it.each([["OSLeft", "Super", false], ["MetaLeft", "Meta", true]] as const)
  ("physical Meta sequence %s matches layout keys even when metaKey is %s", async (code, name, native) => {
    const { c } = await fixture();
    key({ code: "ShiftLeft", key: "Shift", shiftKey: true });
    meta("keydown", code, name, native);
    expect(key({ code: "KeyH", key: "H", shiftKey: true, metaKey: native }).defaultPrevented).toBe(true);
    expect(c.focus.value).toBe(c.panes.value[0]!.id);
    meta("keyup", code, name);
    expect(key({ code: "KeyH", key: "H", shiftKey: true }).defaultPrevented).toBe(false);
  });

// Recorded on WebKitGTK under Unity/compiz: keydown OSLeft at 4355 ms, window blur at 4356, focus at 4388.
it.each(["window", "pane"] as const)("recorded Win-first double blur keeps covers, matching and commands after %s refocus", async focusTarget => {
  vi.useFakeTimers();
  const { c, wrapper } = await fixture();
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const focused = focusTarget === "window" ? window : wrapper.get(".split-tabs-pane").element;
  let clock = 352365;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const dispatch = (at: number, event: Event) => {
    vi.advanceTimersByTime(at - clock);
    clock = at;
    Object.defineProperty(event, "timeStamp", { value: at });
    (event.type === "focus" && at >= 352431 ? focused : window).dispatchEvent(event);
  };
  dispatch(352365, new Event("blur"));
  dispatch(352369, new KeyboardEvent("keydown", { code: "OSLeft", key: "Super" }));
  dispatch(352378, new Event("focus"));
  dispatch(352386, new Event("focus"));
  dispatch(352431, new Event("blur"));
  dispatch(352443, new KeyboardEvent("keydown", { code: "ShiftLeft", key: "Shift", shiftKey: true }));
  dispatch(352453, new Event("focus"));
  dispatch(352462, new Event("focus"));
  dispatch(353000, new PointerEvent("pointermove", { pointerType: "mouse", shiftKey: true }));
  await nextTick();
  const letter = new KeyboardEvent("keydown", { code: "KeyH", key: "H", shiftKey: true, cancelable: true });
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(true);
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
  dispatch(353010, letter);
  expect(letter.defaultPrevented).toBe(true);
  expect(c.focus.value).toBe(c.panes.value[0]!.id);
  dispatch(353422, new KeyboardEvent("keyup", { code: "ShiftLeft", key: "Shift" }));
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
  dispatch(353444, new KeyboardEvent("keyup", { code: "OSLeft", key: "Super" }));
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(false);
});

it("a Win press that blurs and refocuses the window within 500 ms keeps Win held until its keyup", async () => {
  vi.useFakeTimers();
  const { c } = await fixture();
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const letter = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
  meta("keydown");
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(30);
  window.dispatchEvent(new Event("focus"));
  vi.advanceTimersByTime(1000);
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(true);
  expect(key({ code: "KeyH", key: "H", shiftKey: true }).defaultPrevented).toBe(true);
  expect(c.focus.value).toBe(c.panes.value[0]!.id);
  meta("keyup");
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(false);
});

it("a window blur lasting 600 ms releases Win at 500 ms, and a late focus does not bring it back", async () => {
  vi.useFakeTimers();
  await fixture();
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const letter = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
  meta("keydown");
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(499);
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(true);
  vi.advanceTimersByTime(101);
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(false);
  window.dispatchEvent(new Event("focus"));
  expect(tracker.matches(letter, "Shift+Meta+KeyH")).toBe(false);
});

// R12-4 ledger: a vouched-for keydown of the SAME held id after blur supersedes that blur; keyup still releases.
it.each(["new id", "released and repressed id", "still held id"])("native Win replay after blur survives its pending clear: %s", sequence => {
  vi.useFakeTimers();
  const replays = new WeakSet<KeyboardEvent>();
  const tracker = library.createChordTracker(window, event => event.isTrusted || replays.has(event));
  testTrackers.push(tracker);
  const replay = (type: string) => {
    const event = new KeyboardEvent(type, { code: "OSLeft", key: "Super", metaKey: type === "keydown" });
    replays.add(event);
    window.dispatchEvent(event);
  };
  if (sequence !== "new id") replay("keydown");
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(100);
  if (sequence === "released and repressed id") replay("keyup");
  replay("keydown");
  vi.advanceTimersByTime(500);
  const modifiers = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: true };
  expect(tracker.modifiers(modifiers).metaKey).toBe(true);
  replay("keyup");
  expect(tracker.modifiers(modifiers).metaKey).toBe(false);
});

it.each(["hidden", "dispose"])("%s clears Win at once and cancels a pending blur clear", reset => {
  vi.useFakeTimers();
  const tracker = library.createChordTracker(window, () => true);
  testTrackers.push(tracker);
  meta("keydown");
  window.dispatchEvent(new Event("blur"));
  expect(vi.getTimerCount()).toBe(1);
  if (reset === "hidden") {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tracker.matches(new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true }), "Shift+Meta+KeyH")).toBe(false);
  } else tracker.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("an iframe Win report newer than the page blur survives the page's delayed clear", async () => {
  vi.useFakeTimers();
  const { wrapper } = await fixture();
  const report = iframeReports(wrapper);
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  // The keyboard moves into a pane iframe (page blur), where Win is then pressed.
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(100);
  report(true, { type: "key", phase: "keydown", code: "OSLeft", key: "Super", repeat: false, at: performance.timeOrigin + performance.now() });
  vi.advanceTimersByTime(500);
  expect(tracker.matches(new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true }), "Shift+Meta+KeyH")).toBe(true);
});

it("physical Meta applies to modal exits, pointer chords and exact label reorder modifiers", async () => {
  const { c, wrapper } = await fixture();
  meta("keydown");
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
  pointer(wrapper.findAll(".split-tabs-pane-cover")[0]!.element, "pointerdown", { shiftKey: true });
  pointer(window, "pointerup");
  expect(c.selection.value.length).toBeGreaterThan(0);
  const reorder = vi.spyOn(c, "reorder");
  key({ code: "ArrowRight", key: "ArrowRight", altKey: true, shiftKey: true }, wrapper.get(".split-tab-strip-tab").element);
  expect(reorder).not.toHaveBeenCalled();
  const api = wrapper.vm as unknown as { run(command: string): void };
  api.run("arrange");
  expect(key({ code: "KeyG", key: "G", shiftKey: true }).defaultPrevented).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG" }));
  await nextTick();
  expect(wrapper.classes()).not.toContain("split-tabs--arranging");
});

it("effective iframe Meta reports keep shell pointer chords active until the physical release", async () => {
  const { c, wrapper } = await fixture();
  const frame = document.createElement("iframe");
  wrapper.element.append(frame);
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
  const token = (post.mock.calls.at(-1)?.[0] as { token: string }).token;
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: {
    "split-tabs": 1, token, type: "key", phase: "keydown", code: "OSLeft", key: "Super", repeat: false,
    ctrlKey: false, altKey: false, shiftKey: true, metaKey: true,
  } }));
  await nextTick();
  pointer(window, "pointermove", { shiftKey: true });
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
  pointer(wrapper.findAll(".split-tabs-pane-cover")[0]!.element, "pointerdown", { shiftKey: true });
  pointer(window, "pointerup", { shiftKey: true });
  expect(c.selection.value.length).toBeGreaterThan(0);
  meta("keyup");
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
});

function iframeReports(wrapper: Awaited<ReturnType<typeof fixture>>["wrapper"]) {
  const frame = document.createElement("iframe");
  wrapper.element.append(frame);
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
  const token = (post.mock.calls.at(-1)?.[0] as { token: string }).token;
  return (metaKey: boolean, extra: Record<string, unknown> = {}) => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, data: { "split-tabs": 1, token, type: "mods", ctrlKey: false, altKey: false,
      shiftKey: true, metaKey, ...extra },
  }));
}

it.each([false, true])("non-keyboard iframe hover cannot release another iframe Meta (two roots=%s)", async twoRoots => {
  const a = await fixture(), b = twoRoots ? await fixture() : a;
  const fromA = iframeReports(a.wrapper), fromB = iframeReports(b.wrapper);
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const event = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
  for (const release of ["keyup", "blur"]) {
    fromA(true, { type: "key", phase: "keydown", code: "OSLeft", key: "Super", repeat: false });
    fromB(false);
    expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(true);
    pointer(window, "pointermove", { shiftKey: true });
    await nextTick();
    expect(a.wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
    expect(b.wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
    fromA(false, release === "keyup" ? { type: "key", phase: "keyup", code: "OSLeft", key: "Super", repeat: false } : {});
    expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(false);
  }
});

it.each([1e15, Infinity, -Infinity, NaN])("bounded iframe report clocks recover after timestamp %s", async at => {
  const { wrapper } = await fixture();
  const report = iframeReports(wrapper);
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  let clock = 10000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const event = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
  report(true, { at });
  clock++;
  report(false, { at: performance.timeOrigin + clock });
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(false);
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
  report(false, { at });
  clock++;
  report(true, { at: performance.timeOrigin + clock });
  await nextTick();
  expect(wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(2);
  reportFrameMeta(false, at);
  clock++;
  reportFrameMeta(true, performance.timeOrigin + clock);
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(true);
});

it("a stale iframe release cannot revoke the owner's ability to release Meta", async () => {
  const { wrapper } = await fixture();
  const report = iframeReports(wrapper);
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const at = performance.timeOrigin + performance.now() - 1000;
  report(true, { at: at + 100 });
  report(false, { at });
  report(false, { at: at + 200 });
  expect(tracker.matches(new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true }), "Shift+Meta+KeyH")).toBe(false);
});

it.each(["release", "blur", "hidden"])("two roots order frame Meta globally, including after %s", async reset => {
  vi.useFakeTimers();
  const a = await fixture(), b = await fixture();
  const tracker = library.createChordTracker();
  testTrackers.push(tracker);
  const report = (wrapper: typeof a.wrapper) => {
    const frame = document.createElement("iframe");
    wrapper.element.append(frame);
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: { "split-tabs": 1, type: "hello" } }));
    const token = (post.mock.calls.at(-1)?.[0] as { token: string }).token;
    return (held: boolean, at: number) => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, data: {
      "split-tabs": 1, token, type: "mods", ctrlKey: false, altKey: false, shiftKey: true, metaKey: held, at,
    } }));
  };
  const fromA = report(a.wrapper), fromB = report(b.wrapper);
  const at = performance.timeOrigin + performance.now() - 1000;
  const event = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
  fromA(false, at + 200);
  fromB(true, at + 100);
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(false);
  fromB(true, at + 200);
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(true);
  fromA(false, at + 150);
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(true);
  if (reset === "release") meta("keyup");
  else if (reset === "blur") lostFocus();
  else {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  }
  fromB(true, at + 300);
  expect(tracker.matches(event, "Shift+Meta+KeyH")).toBe(false);
  pointer(window, "pointermove", { shiftKey: true });
  await nextTick();
  expect(a.wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
  expect(b.wrapper.findAll(".split-tabs-pane-cover")).toHaveLength(0);
});

it.each(["release", "blur", "hidden"])("host trackers share strict matching and clear Meta on %s", async reset => {
  vi.useFakeTimers();
  const { wrapper } = await fixture();
  const tracker = library.createChordTracker();
  const other = library.createChordTracker();
  try {
    for (const [code, name] of [["MetaLeft", "Meta"], ["MetaRight", "Meta"], ["OSLeft", "Super"], ["OSRight", "OS"], ["", "Hyper"]]) {
      meta("keydown", code, name);
      const e = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true });
      expect(tracker.matches(e, "Shift+Meta+KeyH")).toBe(true);
      expect(other.matches(e, "Shift+Meta+KeyH")).toBe(true);
      expect(tracker.matches(e, "Shift+KeyH")).toBe(false);
      const graph = new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true, modifierAltGraph: true });
      expect(tracker.matches(graph, "Shift+Meta+KeyH")).toBe(false);
      if (reset === "release") meta("keyup", code, name);
      else if (reset === "blur") lostFocus();
      else {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      }
      expect(tracker.matches(e, "Shift+Meta+KeyH")).toBe(false);
      expect(tracker.matches(new KeyboardEvent("keydown", { code: "KeyH" }), "Meta+KeyH")).toBe(false);
    }
    expect(() => tracker.matches(new KeyboardEvent("keydown"), "Control+H")).toThrow();
    wrapper.unmount();
    meta("keydown");
    tracker.dispose();
    expect(other.matches(new KeyboardEvent("keydown", { code: "KeyH", shiftKey: true }), "Shift+Meta+KeyH")).toBe(true);
  } finally { tracker.dispose(); other.dispose(); }
});
