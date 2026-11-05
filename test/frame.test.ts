import { afterEach, expect, it, vi } from "vitest";
import { connectSplitTabsFrame } from "../src/frame";

let disconnect = () => {};
afterEach(() => { disconnect(); vi.useRealTimers(); });

it.each(["mouse", "pen"])("frame forwards a pressed %s through movement and release, but not later hover or blur", pointerType => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const pointer = (type: string, buttons = 1) => window.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType, buttons, clientX: 40, clientY: 60,
  }));
  const reports = () => postMessage.mock.calls.map(([data]) => data).filter(data => data.type === "pointer");
  for (const phase of ["up", "cancel"]) {
    postMessage.mockClear();
    pointer("pointerdown");
    pointer("pointermove");
    pointer(`pointer${phase}`, 0);
    pointer("pointermove", 0);
    expect(reports()).toEqual(["move", phase].map(phase => ({ "split-tabs": 1, token: "", type: "pointer", phase,
      pointerId: 7, pointerType, x: 40, y: 60 })));
  }
  postMessage.mockClear();
  pointer("pointerdown");
  window.dispatchEvent(new Event("blur"));
  pointer("pointermove");
  pointer("pointerup", 0);
  expect(reports()).toEqual([{ "split-tabs": 1, token: "", type: "pointer", phase: "cancel",
    pointerId: 7, pointerType, x: 40, y: 60 }]);
  disconnect();
  postMessage.mockClear();
  pointer("pointerdown");
  pointer("pointermove");
  pointer("pointerup", 0);
  expect(postMessage).not.toHaveBeenCalled();
});

// H2: every lost mouse/pen press reports exactly one cancellation, including cleanup.
it.each(["arrange", "hover", "disconnect"])("H2 frame cancels pressed pointers on %s", loss => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  for (const [pointerId, pointerType] of [[7, "mouse"], [8, "pen"]] as const) {
    window.dispatchEvent(new PointerEvent("pointerdown", { pointerId, pointerType, buttons: 1, clientX: 40, clientY: 60 }));
  }
  if (loss === "arrange") window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "identify", token: "test", chords: [], arranging: true } }));
  else if (loss === "disconnect") disconnect();
  else for (const pointerId of [7, 8]) window.dispatchEvent(new PointerEvent("pointermove", { pointerId, buttons: 0 }));
  const reports = () => postMessage.mock.calls.map(([data]) => data).filter(data => data.type === "pointer");
  expect(reports().map(data => [data.pointerId, data.phase])).toEqual([[7, "cancel"], [8, "cancel"]]);
  window.dispatchEvent(new Event("blur"));
  expect(reports()).toHaveLength(2);
});

it("shell ownership primes the owning frame blocker at two, cancels at three, and clears on release/disconnect", () => {
  const postMessage = vi.fn();
  const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const own = (count: number, origin = location.origin) => window.dispatchEvent(new MessageEvent("message", {
    origin, data: { "split-tabs": 1, type: "own-touch", count },
  }));
  const move = () => {
    const e = new TouchEvent("touchmove", { cancelable: true, touches: [] });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  own(3, "https://elsewhere.example");
  expect(move()).toBe(false);
  own(2);
  const blocker = add.mock.calls.find(([type, , options]) => type === "touchmove"
    && typeof options === "object" && options.passive === false)![1];
  expect(move()).toBe(false);
  own(3);
  expect(move()).toBe(true);
  own(1);
  expect(remove.mock.calls.some(([type, listener]) => type === "touchmove" && listener === blocker)).toBe(true);
  expect(move()).toBe(false);
  own(3);
  disconnect();
  expect(move()).toBe(false);
});

it("isolated-frame html touches outside its viewport do not claim one or two local fingers", () => {
  disconnect = connectSplitTabsFrame({ parent: { postMessage: vi.fn() } as unknown as Window });
  for (const count of [1, 2]) {
    const points = Array.from({ length: count }, (_, identifier) => ({ identifier, target: document.documentElement,
      clientX: 50 + identifier * 30, clientY: 50 }));
    points.push({ identifier: 9, target: document.documentElement, clientX: window.innerWidth + 50, clientY: window.innerHeight + 50 });
    const event = new TouchEvent("touchstart", { cancelable: true, touches: points as unknown as Touch[] });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});

it("a shell zero clears stale foreign touches and their blocker immediately", () => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  const remove = vi.spyOn(window, "removeEventListener");
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  window.dispatchEvent(new TouchEvent("touchmove", { touches: [0, 1, 2].map(identifier => ({
    identifier, clientX: 20, clientY: 20,
  })) as unknown as Touch[] }));
  remove.mockClear();
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "own-touch", count: 0 } }));
  expect(remove.mock.calls.some(([type]) => type === "touchmove")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("same-origin ownership delivery acknowledges application before returning, including the final release", () => {
  const postMessage = vi.fn();
  const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const own = (count: number, origin = location.origin) => window.dispatchEvent(new MessageEvent("message", {
    cancelable: true, origin, data: { "split-tabs": 1, type: "own-touch", count },
  }));
  expect(own(3, "https://elsewhere.example")).toBe(true);
  expect(own(3)).toBe(false);
  const blocker = add.mock.calls.find(([type, , options]) => type === "touchmove"
    && typeof options === "object" && options.passive === false)![1];
  expect(own(0)).toBe(false);
  expect(remove.mock.calls.some(([type, listener]) => type === "touchmove" && listener === blocker)).toBe(true);
  disconnect();
  expect(own(3)).toBe(true);
});

it("touch pointer releases report coordinates and comparable event time", () => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const event = new PointerEvent("pointerup", { pointerType: "touch", pointerId: 12, clientX: 40, clientY: 60 });
  window.dispatchEvent(event);
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "touch-pointer", pointerId: 12, phase: "up",
    x: 40, y: 60, at: performance.timeOrigin + event.timeStamp });
});

it("touch blocker lifetime ends below two fingers, on refreshed silence and on disconnect", () => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const touch = (n: number) => window.dispatchEvent(new TouchEvent("touchmove", { cancelable: true,
    touches: Array.from({ length: n }, (_, identifier) => ({ identifier, clientX: 20, clientY: 20 })) as unknown as Touch[] }));
  const blocker = () => add.mock.calls.find(([type, , options]) => type === "touchmove"
    && typeof options === "object" && options.passive === false)![1];
  touch(2);
  const first = blocker();
  touch(1);
  expect(remove.mock.calls.some(([type, listener]) => type === "touchmove" && listener === first)).toBe(true);
  touch(2);
  remove.mockClear();
  vi.advanceTimersByTime(2400);
  touch(3);
  vi.advanceTimersByTime(2400);
  expect(remove.mock.calls.some(([type, listener]) => type === "touchmove" && listener === first)).toBe(false);
  vi.advanceTimersByTime(100);
  expect(remove.mock.calls.some(([type, listener]) => type === "touchmove" && listener === first)).toBe(true);
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "touches", points: [] });
  expect(vi.getTimerCount()).toBe(0);
  touch(2);
  disconnect();
  expect(vi.getTimerCount()).toBe(0);
  remove.mockClear();
  vi.advanceTimersByTime(2500);
  expect(remove).not.toHaveBeenCalled();
});

it("frame captures starts/moves only from three touches and reports through pointer cancellation", () => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const target = document.createElement("div");
  document.body.append(target);
  const touch = (type: string, n: number) => {
    const touches = Array.from({ length: n }, (_, identifier) => ({ identifier, clientX: identifier * 20, clientY: 50 }));
    const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches as unknown as Touch[] });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  for (const n of [1, 2, 3, 4]) {
    expect(touch("touchstart", n)).toBe(n >= 3);
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerType: "touch" }));
    expect(touch("touchmove", n)).toBe(n >= 3);
    expect(postMessage.mock.calls.at(-1)?.[0]).toEqual({ "split-tabs": 1, token: "", type: "touches",
      points: Array.from({ length: n }, (_, i) => ({ identifier: i, x: i * 20, y: 50, x0: i * 20, y0: 50 })) });
  }
  touch("touchend", 0);
  expect(postMessage.mock.calls.at(-1)?.[0].points).toEqual([]);
  disconnect();
  expect(touch("touchstart", 4)).toBe(false);
  expect(touch("touchmove", 4)).toBe(false);
});

it.each([["OSLeft", "Super", false], ["MetaLeft", "Meta", true]] as const)
  ("frame helper normalizes %s Meta and clears it on release, 500 ms of blur and hidden", (metaCode, metaName, native) => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "identify", token: "pane", chords: ["Meta+Shift+KeyH"] } }));
  const press = (type: string, code: string, key: string, metaKey = false) => {
    const e = new KeyboardEvent(type, { code, key, shiftKey: true, metaKey, cancelable: true });
    window.dispatchEvent(e);
    return e;
  };
  for (const reset of ["release", "blur", "hidden"]) {
    press("keydown", "ShiftLeft", "Shift");
    press("keydown", metaCode, metaName, native);
    expect(press("keydown", "KeyH", "H", native).defaultPrevented).toBe(true);
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "key", metaKey: true, code: "KeyH" });
    if (reset === "release") press("keyup", metaCode, metaName);
    else if (reset === "blur") { window.dispatchEvent(new Event("blur")); vi.advanceTimersByTime(500); }
    else {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    }
    expect(press("keydown", "KeyH", "H").defaultPrevented).toBe(false);
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "key", metaKey: false });
  }
});

// Unity/compiz blur and refocus the window ~30 ms after a Win press; the keyup still arrives later.
it.each(["window", "content"] as const)("frame helper keeps Win through short %s refocus and releases it after 500 ms of blur", focusTarget => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  const content = document.createElement("input");
  document.body.append(content);
  const focused = focusTarget === "window" ? window : content;
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
    data: { "split-tabs": 1, type: "identify", token: "pane", chords: ["Meta+Shift+KeyH"] } }));
  const press = (type: string, code: string, key: string) => {
    const e = new KeyboardEvent(type, { code, key, shiftKey: true, cancelable: true });
    window.dispatchEvent(e);
    return e;
  };
  const last = () => postMessage.mock.calls.at(-1)?.[0];
  const released = { type: "mods", ctrlKey: false, shiftKey: false, altKey: false };
  press("keydown", "OSLeft", "Super");
  window.dispatchEvent(new Event("blur"));
  expect(last()).toMatchObject({ ...released, metaKey: true });
  vi.advanceTimersByTime(30);
  focused.dispatchEvent(new Event("focus"));
  vi.advanceTimersByTime(1000);
  expect(press("keydown", "KeyH", "H").defaultPrevented).toBe(true);
  expect(last()).toMatchObject({ type: "key", code: "KeyH", metaKey: true });
  window.dispatchEvent(new Event("blur"));
  vi.advanceTimersByTime(499);
  expect(last()).toMatchObject({ ...released, metaKey: true });
  vi.advanceTimersByTime(101);
  expect(last()).toMatchObject({ ...released, metaKey: false });
  expect(vi.getTimerCount()).toBe(0);
  focused.dispatchEvent(new Event("focus"));
  expect(press("keydown", "KeyH", "H").defaultPrevented).toBe(false);
  expect(last()).toMatchObject({ type: "key", metaKey: false });
  for (const reset of ["hidden", "disconnect"]) {
    press("keydown", "OSLeft", "Super");
    window.dispatchEvent(new Event("blur"));
    expect(vi.getTimerCount()).toBe(1);
    if (reset === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(last()).toMatchObject({ ...released, metaKey: false });
    } else disconnect();
    expect(vi.getTimerCount()).toBe(0);
  }
});

it("frame digit capture is mode-scoped and keeps a consumed keyup blocked after keyboard focus changes documents", () => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const identify = (captureKeys: string[], heldKeys: string[] = []) => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, data: { "split-tabs": 1, type: "identify", token: "pane", chords: [], exitKeys: [], captureKeys, heldKeys },
  }));
  const input = document.createElement("input");
  document.body.append(input);
  const seen = vi.fn();
  input.addEventListener("keydown", seen);
  input.addEventListener("keyup", seen);
  const press = (phase: string) => {
    const e = new KeyboardEvent(phase, { code: "Digit2", key: "2", bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    return e.defaultPrevented;
  };
  identify([]);
  expect(press("keydown")).toBe(false);
  expect(press("keyup")).toBe(false);
  seen.mockClear();
  identify(["Digit2"]);
  expect(press("keydown")).toBe(true);
  identify([], ["Digit2"]);
  expect(press("keyup")).toBe(true);
  expect(seen).not.toHaveBeenCalled();
  identify([]);
  disconnect();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  identify([], ["Digit2"]);
  expect(press("keyup")).toBe(true); // This destination iframe did not see the original keydown.
});

it("frame helper cancels only bound exact keydowns, updates bindings and forwards every key", () => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const identify = (chords: string[]) => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, data: { "split-tabs": 1, type: "identify", token: "pane", chords },
  }));
  const press = (code: string, extra: KeyboardEventInit = {}, altGraph = false, type = "keydown") => {
    const e = new KeyboardEvent(type, { code, altKey: true, shiftKey: true, cancelable: true, ...extra });
    Object.defineProperty(e, "getModifierState", { value: (name: string) => name === "AltGraph" && altGraph });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  identify(["Alt+Shift+KeyL", "Ctrl+Alt+Shift+KeyL"]);
  expect(press("KeyQ")).toBe(false);
  expect(press("KeyL")).toBe(true);
  expect(press("KeyL", { repeat: true })).toBe(true);
  expect(press("KeyL", { metaKey: true })).toBe(false);
  expect(press("KeyL", { ctrlKey: true }, true)).toBe(false);
  expect(press("KeyL", {}, false, "keyup")).toBe(false);
  identify(["Alt+Shift+KeyQ"]);
  expect(press("KeyL")).toBe(false);
  expect(press("KeyQ", { ctrlKey: true })).toBe(false);
  expect(press("KeyQ")).toBe(true);
  expect(postMessage.mock.calls.filter(([m]) => m.type === "key")).toHaveLength(9);
  expect(postMessage.mock.calls.find(([m]) => m.type === "key" && m.ctrlKey)?.[0]).toMatchObject({ altGraph: true, token: "pane" });
});

it("frame exit chords stop down/up only during modes, retain consumed releases, and update with the mode", () => {
  const postMessage = vi.fn();
  disconnect = connectSplitTabsFrame({ parent: { postMessage } as unknown as Window });
  const identify = (exitKeys: string[]) => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, data: { "split-tabs": 1, type: "identify", token: "pane", chords: [], exitKeys },
  }));
  const target = document.createElement("input");
  document.body.append(target);
  const seen = vi.fn();
  target.addEventListener("keydown", seen);
  target.addEventListener("keyup", seen);
  const press = (type: string, code: string, ctrlKey: boolean) => {
    const e = new KeyboardEvent(type, { code, ctrlKey, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  for (const [code, ctrl] of [["Escape", false], ["KeyG", true], ["KeyD", true]] as const) {
    identify([]);
    expect(press("keydown", code, ctrl)).toBe(false);
    expect(press("keyup", code, ctrl)).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    seen.mockClear();
    identify(["Escape", "Ctrl+KeyG", "Ctrl+KeyD"]);
    expect(press("keydown", code, ctrl)).toBe(true);
    identify([]);
    expect(press("keyup", code, false)).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "key", phase: "keyup", code, token: "pane" });
  }
});
