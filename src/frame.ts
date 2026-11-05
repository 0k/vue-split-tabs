// Run INSIDE a pane's iframe (`@0k/vue-split-tabs/frame`).  An iframe's events
// never reach the page holding it, so this reports what the layout needs to
// the shell: presses (focus, Alt+Shift selection), keys (layout chords) and
// fingers (four-finger hold and pinch).  From the third finger it cancels
// touchstart/touchmove so the browser never takes the gesture over and this
// content does not scroll under it.  When the shell claims a
// gesture, a `split-tabs-claimed` event is dispatched on `window`.
//
// Reports carry the token the shell handed to this iframe (`identify`): some
// engines (WebKit) give the RECEIVING window as `MessageEvent.source`, so the
// shell cannot tell its iframes apart by `source`.  Messages from the shell are
// accepted by origin for the same reason.
export const FRAME_MESSAGE = "split-tabs";
/** Fingers from which a gesture belongs to the shell, not to the content. */
export const SHELL_FINGERS = 3;
const SILENCE_MS = 2500;
/** A blur drops held Win only when focus has not returned by then (mirrors keymap.ts: Unity/compiz refocus after ~30 ms). */
const META_BLUR_MS = 500;
export interface FramePoint { x: number; y: number; x0: number; y0: number; otherDocument?: boolean; identifier?: number }
/** A report from a pane iframe; `token` is the one the shell sent it ("" until then). */
export type FrameMessage = { [FRAME_MESSAGE]: 1; token?: string } & (
  | { type: "hello" }
  | { type: "down"; button: number; pointerType: string; isPrimary?: boolean; pointerId?: number; x?: number; y?: number;
    ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; altGraph?: boolean }
  | { type: "pointer"; phase: "move" | "up" | "cancel"; pointerId: number; pointerType: string; x: number; y: number }
  | { type: "key"; phase: "keydown" | "keyup"; key: string; code: string; repeat: boolean; at?: number;
    ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; altGraph?: boolean }
  | { type: "touches"; points: FramePoint[] }
  | { type: "touch-pointer"; pointerId: number; phase: "up" | "cancel"; x?: number; y?: number; at?: number }
  | { type: "mods"; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; altGraph?: boolean; at?: number });
/** A message from the shell to a pane iframe. */
export type ShellMessage = { [FRAME_MESSAGE]: 1 } & (
   { type: "identify"; token: string; chords: string[]; exitKeys?: string[]; captureKeys?: string[]; heldKeys?: string[]; arranging?: boolean }
  | { type: "claimed"; what: string }
  | { type: "own-touch"; count: number });
export interface ConnectFrameOptions {
  /** Origin of the page holding the iframe. Default: this document's origin. */
  origin?: string;
  /** The page holding the iframe. Default: `window.parent`. */
  parent?: Window;
}

/** Start reporting; returns the function that stops it. */
export function connectSplitTabsFrame(options: ConnectFrameOptions = {}): () => void {
  const shell = options.parent ?? (window.parent === window ? null : window.parent);
  if (shell === null) return () => undefined;
  const origin = options.origin ?? location.origin;
  let token = "";
  let arranging = false;
  const isolatedTypes = ["keydown", "keyup", "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout",
    "pointerenter", "pointerleave", "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave",
    "click", "auxclick", "dblclick", "contextmenu", "wheel", "touchstart", "touchmove", "touchend", "touchcancel"];
  const isolate = (event: Event) => {
    if (!arranging) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation(); event.stopImmediatePropagation();
  };
  let chords = new Set<string>();
  let exitKeys = new Set<string>();
  let captureKeys = new Set<string>();
  let heldKeys = new Set<string>();
  const consumed = new Set<string>();
  // Mirror the shell tracker here: this standalone entry must remain import-free.
  const metaHeld = new Set<string>();
  // Wall-clock time of an event, comparable across documents: the shell must not let a report that
  // arrives late override newer modifier states it saw itself.
  const when = (e: Event) => performance.timeOrigin + e.timeStamp;
  const post = (message: FrameMessage) => shell.postMessage({ ...message, token }, origin);
  const fingers = new Map<number, FramePoint>();
  let ownedCount = 0;
  let silence: ReturnType<typeof setTimeout> | null = null;
  const sendTouches = () => post({ [FRAME_MESSAGE]: 1, type: "touches", points: [...fingers.values()] });
  const mods = (e: MouseEvent | KeyboardEvent) => ({ ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
    metaKey: e.metaKey || metaHeld.size > 0,
    altGraph: e.getModifierState("AltGraph") });
  const pressedPointers = new Map<number, { pointerType: string; x: number; y: number }>();
  const cancelPointer = (pointerId: number) => {
    const point = pressedPointers.get(pointerId);
    if (point === undefined) return;
    pressedPointers.delete(pointerId);
    post({ [FRAME_MESSAGE]: 1, type: "pointer", phase: "cancel", pointerId, ...point });
  };
  const cancelPointers = () => { for (const id of pressedPointers.keys()) cancelPointer(id); };
  const down = (e: PointerEvent) => {
    if (arranging) return;
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      pressedPointers.set(e.pointerId, { pointerType: e.pointerType, x: e.clientX, y: e.clientY });
    }
    post({ [FRAME_MESSAGE]: 1, type: "down", button: e.button,
      pointerType: e.pointerType, isPrimary: e.isPrimary, pointerId: e.pointerId, x: e.clientX, y: e.clientY, ...mods(e) });
  };
  const release = (e: PointerEvent) => {
    if (arranging) { cancelPointer(e.pointerId); return; }
    if (pressedPointers.delete(e.pointerId)) post({ [FRAME_MESSAGE]: 1, type: "pointer",
      phase: e.type === "pointerup" ? "up" : "cancel", pointerId: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") post({ [FRAME_MESSAGE]: 1, type: "touch-pointer", pointerId: e.pointerId,
      phase: e.type === "pointerup" ? "up" : "cancel", x: e.clientX, y: e.clientY, at: when(e) });
  };
  // Modifiers held while the pointer moves here, even when the keyboard is in another document:
  // the shell can then show its layout covers before a click.
  let held = "";
  const hover = (e: PointerEvent) => {
    if (arranging) { cancelPointers(); return; }
    if (pressedPointers.has(e.pointerId)) {
      if (e.buttons === 0) cancelPointer(e.pointerId);
      else {
        pressedPointers.set(e.pointerId, { pointerType: e.pointerType, x: e.clientX, y: e.clientY });
        post({ [FRAME_MESSAGE]: 1, type: "pointer", phase: "move", pointerId: e.pointerId,
          pointerType: e.pointerType, x: e.clientX, y: e.clientY });
      }
    }
    const m = mods(e);
    const now = `${+m.ctrlKey}${+m.shiftKey}${+m.altKey}${+m.metaKey}${+m.altGraph}`;
    if (now === held) return;
    held = now;
    post({ [FRAME_MESSAGE]: 1, type: "mods", ...mods(e), at: when(e) });
  };
  const key = (e: KeyboardEvent) => {
    if (/^(Meta|OS)(Left|Right)$/.test(e.code) || /^(Meta|Super|OS|Hyper)$/.test(e.key)) {
      const id = e.code || e.key;
      if (e.type === "keydown") metaHeld.add(id); else metaHeld.delete(id);
    }
    // This entry stays import-free. Use the same canonical modifier order as the shell's keymap.
    const m = mods(e);
    const chord = [m.ctrlKey && "Ctrl", m.metaKey && "Meta", m.altKey && "Alt", m.shiftKey && "Shift", e.code].filter(Boolean).join("+");
    const release = e.type === "keyup";
    if (arranging) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      // Only arrange controls cross to the shell; no content-facing reports or claimed event.
      if (exitKeys.has(chord) || captureKeys.has(chord) || consumed.has(e.code) || heldKeys.has(e.code)) {
        if (release) { consumed.delete(e.code); heldKeys.delete(e.code); } else consumed.add(e.code);
        post({ [FRAME_MESSAGE]: 1, type: "key", phase: release ? "keyup" : "keydown", key: e.key, code: e.code,
          repeat: e.repeat, ...m, at: when(e) });
      }
      return;
    }
    const exit = !release && !m.altGraph && (exitKeys.has(chord) || captureKeys.has(chord));
    if (exit || ((consumed.has(e.code) || heldKeys.has(e.code)) && (release || e.repeat))) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (release) { consumed.delete(e.code); heldKeys.delete(e.code); } else consumed.add(e.code);
    } else if (!release && !e.getModifierState("AltGraph") && chords.has(chord)) e.preventDefault();
    post({ [FRAME_MESSAGE]: 1, type: "key", phase: e.type as "keydown" | "keyup", key: e.key, code: e.code, repeat: e.repeat, ...mods(e),
      at: when(e) });
  };
  // Touch events keep coming after the browser cancels the pointers of a gesture it took over.
  const touches = (e: TouchEvent) => {
    // Internal snapshots must retire fingers even while arrange isolation blocks content input.
    const seen = new Set<number>();
    for (const t of Array.from(e.touches)) {
      seen.add(t.identifier);
      const known = fingers.get(t.identifier);
      if (known === undefined) fingers.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY,
        identifier: t.identifier,
        ...(t.target instanceof Node && t.target.ownerDocument !== document ? { otherDocument: true } : {}) });
      else { known.x = t.clientX; known.y = t.clientY; }
    }
    for (const id of [...fingers.keys()]) if (!seen.has(id)) fingers.delete(id);
    setBlocking(Math.max(localCount(), ownedCount) >= SHELL_FINGERS - 1);
    if (silence !== null) clearTimeout(silence);
    silence = fingers.size === 0 ? null : setTimeout(() => {
      silence = null;
      fingers.clear();
      ownedCount = 0;
      setBlocking(false);
      sendTouches();
    }, SILENCE_MS);
    sendTouches();
  };
  // From the third finger the sequence belongs to the shell: cancel touchstart/touchmove so this document never
  // pans or scrolls under it. What the first one or two fingers already did (a scroll, a press) cannot be undone.
  // Non-passive touch listeners make the browser wait before scrolling: registered from the second finger only,
  // removed with that exact identity when fewer than two fingers remain, or after silence.
  // Isolated Chromium frames can label outside-viewport fingers as their own HTML touches.
  const localCount = () => [...fingers.values()].filter(p => !p.otherDocument
    && p.x0 >= 0 && p.x0 < window.innerWidth && p.y0 >= 0 && p.y0 < window.innerHeight).length;
  const block = (e: TouchEvent) => { if (Math.max(localCount(), ownedCount) >= SHELL_FINGERS && e.cancelable) e.preventDefault(); };
  let blocking = false;
  function setBlocking(on: boolean): void {
    if (on === blocking) return;
    blocking = on;
    for (const type of ["touchstart", "touchmove"] as const) {
      if (on) window.addEventListener(type, block, { capture: true, passive: false });
      else window.removeEventListener(type, block, { capture: true });
    }
  }
  const message = (e: MessageEvent) => {
    const data: unknown = e.data;
    if (e.origin !== origin || typeof data !== "object" || data === null || (data as Record<string, unknown>)[FRAME_MESSAGE] !== 1) return;
    const d = data as { type?: unknown; what?: unknown; token?: unknown; chords?: unknown; exitKeys?: unknown;
      captureKeys?: unknown; heldKeys?: unknown; count?: unknown; arranging?: unknown };
    if (d.type === "identify" && typeof d.token === "string") {
      token = d.token;
      const nextArranging = d.arranging === true;
      if (nextArranging !== arranging) {
        if (nextArranging) cancelPointers();
        arranging = nextArranging;
        for (const type of isolatedTypes) {
          if (arranging) window.addEventListener(type, isolate, { capture: true, passive: false });
          else window.removeEventListener(type, isolate, true);
        }
      }
      chords = new Set(Array.isArray(d.chords) ? d.chords.filter((c): c is string => typeof c === "string") : []);
      exitKeys = new Set(Array.isArray(d.exitKeys) ? d.exitKeys.filter((c): c is string => typeof c === "string") : []);
      captureKeys = new Set(Array.isArray(d.captureKeys) ? d.captureKeys.filter((c): c is string => typeof c === "string") : []);
      heldKeys = new Set(Array.isArray(d.heldKeys) ? d.heldKeys.filter((c): c is string => typeof c === "string") : []);
    }
    else if (d.type === "own-touch" && typeof d.count === "number" && Number.isFinite(d.count) && d.count >= 0) {
      ownedCount = d.count;
      if (ownedCount === 0) {
        // The shell saw the last real lift; Chromium may strand foreign touches here.
        fingers.clear();
        if (silence !== null) { clearTimeout(silence); silence = null; }
      }
      setBlocking(Math.max(localCount(), ownedCount) >= SHELL_FINGERS - 1);
      // The same-origin shell can deliver ownership synchronously; acknowledge only after applying it.
      if (e.cancelable) e.preventDefault();
    } else if (d.type === "claimed" && !arranging) window.dispatchEvent(new CustomEvent("split-tabs-claimed", { detail: { what: String(d.what ?? "") } }));
  };
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("pointermove", hover, { capture: true, passive: true });
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", key, true);
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) window.addEventListener(type, touches, { capture: true, passive: true });
  window.addEventListener("message", message);
  // Reset reports release every other modifier at once (the shell drops its covers); held Win survives a short blur.
  const released = () => post({ [FRAME_MESSAGE]: 1, type: "mods", ctrlKey: false, shiftKey: false, altKey: false,
    metaKey: metaHeld.size > 0, at: performance.timeOrigin + performance.now() });
  let metaBlur: ReturnType<typeof setTimeout> | null = null;
  const focus = () => { if (metaBlur !== null) clearTimeout(metaBlur); metaBlur = null; };
  const dropMeta = () => { focus(); metaHeld.clear(); held = ""; };
  const blur = () => {
    cancelPointers();
    consumed.clear(); heldKeys.clear(); held = "";
    released();
    if (metaHeld.size > 0 && metaBlur === null) metaBlur = setTimeout(() => { dropMeta(); released(); }, META_BLUR_MS);
  };
  const hidden = () => { if (document.visibilityState === "hidden") { dropMeta(); blur(); } };
  window.addEventListener("blur", blur);
  // Content focus is non-bubbling, but still ends a transient window-manager blur.
  window.addEventListener("focus", focus, true);
  document.addEventListener("visibilitychange", hidden);
  post({ [FRAME_MESSAGE]: 1, type: "hello" });
  return () => {
    cancelPointers();
    for (const type of isolatedTypes) window.removeEventListener(type, isolate, true);
    consumed.clear();
    dropMeta(); heldKeys.clear();
    window.removeEventListener("blur", blur);
    window.removeEventListener("focus", focus, true);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("pointermove", hover, { capture: true });
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("keyup", key, true);
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) window.removeEventListener(type, touches, { capture: true });
    setBlocking(false);
    if (silence !== null) clearTimeout(silence);
    fingers.clear();
    window.removeEventListener("message", message);
  };
}
