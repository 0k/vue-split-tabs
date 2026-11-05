// The root's listeners: layout chords, pointer-chord grab, what pane iframes
// report (frame.ts), and four-finger gestures: hold = arrange mode, pinch out
// = zoom the pane under the fingers (or the selection), pinch in = restore.
//
// Touch snapshots count fingers; pointerup retires cross-document ghosts, while pointerdowns provisionally count fingers
// whose touches Chromium routes to the first finger's document. Cancelling a
// pointer never removes a touch-reported finger (Android WebView). From the third finger
// the sequence belongs to the layout: touchstart/touchmove are cancelled so
// the browser never pans, and panes stay covered until every finger lifts.
import type { SplitTabsContext } from "./context.js";
import { watch } from "vue";
import type { SplitTabsResult } from "./controller.js";
import { FRAME_MESSAGE, SHELL_FINGERS, type FrameMessage, type FramePoint, type ShellMessage } from "./frame.js";
import { compileExitKeys, compileKeymap, defaultExitKeys, frameReportTime, handleKey, heldForLayout, isMetaKey, modifiersOf, reportFrameMeta,
  type ModifierLike, type SplitTabsCommand, type SplitTabsKeymap } from "./keymap.js";
import { createModalExit } from "./modal.js";

const FOUR_FINGERS = 4;
const HOLD_MS = 500;
const SLOP_PX = 12;
const PINCH_OUT = 1.35;
const PINCH_IN = 0.75;
/** Silence after which every finger is assumed lifted (a frame may lose its last release). */
const SILENCE_MS = 2500;
const RELEASE_MS = 250;
const RELEASE_RADIUS = 24;
const TOUCH_TYPES = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;

/** What a host that takes keys before the content (a native shell) must take for the layout. */
export interface SplitTabsCapture {
  /** Chords bound to layout commands, canonical form (`Meta+Shift+KeyH`). */
  chords: string[];
  /** Exit chords of the active modal mode; empty outside a mode. */
  exitKeys: string[];
  /** Other chords the active mode takes: digits while pane numbers are displayed, pane letters while arranging. */
  captureKeys: string[];
  /** Arrange mode: every key belongs to the layout. */
  arranging: boolean;
}

export interface ShellOptions {
  keymap: () => SplitTabsKeymap | null;
  exitKeys?: () => readonly string[] | null | undefined;
  arrangeExitKeys?: () => readonly string[] | null | undefined;
  menu?: () => (() => void) | null;
  /** Origins allowed to report from pane iframes. Default: this document's origin. */
  frameOrigins: () => readonly string[] | undefined;
  capture?: (policy: SplitTabsCapture) => void;
  report: (command: SplitTabsCommand | "fourFingerHold" | "pinchOut" | "pinchIn", result: SplitTabsResult) => void;
}

export function createShell(context: SplitTabsContext, options: ShellOptions): () => void {
  let table = compileKeymap(options.keymap());
  const holds = new Map<string, boolean>();
  const doneArranging = () => {
    context.drag.cancel(); context.pick.cancel(); options.menu?.()?.();
    context.modes.arranging.value = false;
  };
  const arrangeUI = (target: EventTarget | null): boolean => target instanceof Element
    && !!context.root.value?.contains(target) && !!target.closest(
      ".split-tabs-pane-cover, .split-tabs-pane-number, .split-tabs-divider, .split-tab-strip-tab, .split-tab-strip-rename, "
      + ".split-tab-strip-close, .split-tab-strip-resize, .split-tabs-arrange, .split-tabs-menu, .split-tabs-arrange-menu-button, "
      + ".split-tabs-selection-close, .split-tabs-bin, .split-tabs-undo");
  function arrangeControl(el: HTMLElement): boolean {
    if (el.closest("[data-split-tabs-bin]")
      || !el.closest(".split-tabs-arrange, .split-tabs-menu, .split-tabs-arrange-menu-button, .split-tabs-undo") || el.tabIndex < 0
      || el.matches(":disabled") || el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    if (["hidden", "collapse"].includes(getComputedStyle(el).visibility)) return false;
    for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).display === "none") return false;
    }
    return true;
  }
  function innermost(): (() => void) | null {
    if (!context.root.value?.isConnected) return null;
    if (context.modes.arranging.value) return doneArranging;
    if (context.drag.active.value) return context.drag.cancel;
    const menu = options.menu?.();
    if (menu) return menu;
    if (context.pick.mode.value !== null && context.pick.mode.value !== "preview") return context.pick.cancel;
    return null;
  }
  const displaying = () => context.pick.mode.value === "display" && !context.drag.active.value && !options.menu?.();
  const digits = Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`);
  let pendingFocus: { code: string; pane: string } | null = null;
  const arrangeExits = () => options.arrangeExitKeys?.() === undefined ? ["KeyQ"] : options.arrangeExitKeys?.() ?? [];
  compileExitKeys(arrangeExits());
  const arrangeToggles = () => [...compileKeymap(options.keymap())].filter(([, command]) => command === "arrange").map(([chord]) => chord);
  const exitPolicy = () => context.modes.arranging.value
    ? [...(options.exitKeys?.() === undefined ? defaultExitKeys : options.exitKeys?.() ?? []), ...arrangeExits(), ...arrangeToggles()]
    : options.exitKeys?.();
  const modal = createModalExit(exitPolicy, innermost, {
    keys: () => displaying() ? digits : context.modes.arranging.value
      ? ["Tab", "Shift+Tab", ...context.controller.panes.value.flatMap(p => {
        const letter = context.pick.letterOf(p.id); return letter ? [`Key${letter.toUpperCase()}`] : [];
      })] : [],
    run: event => {
      if (displaying()) context.pick.chooseNumber(Number(event.code.slice(5)));
      else if (event.code === "Tab") {
        const controls = [...(context.root.value?.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])") ?? [])]
          .filter(arrangeControl);
        const at = controls.indexOf(document.activeElement as HTMLElement);
        const next = at < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (at + (event.shiftKey ? controls.length - 1 : 1)) % controls.length;
        controls[next]?.focus({ preventScroll: true });
      } else {
        const pane = context.controller.panes.value.find(p => `Key${context.pick.letterOf(p.id)?.toUpperCase()}` === event.code);
        if (pane) context.controller.toggleSelected(pane.id);
      }
    },
    captureAll: () => context.modes.arranging.value,
    allowTarget: target => arrangeUI(target),
    other: () => { if (displaying()) context.pick.cancel(); },
    released: event => {
      holds.delete(event.code);
      grab(event, "at" in event && typeof event.at === "number" ? event.at : Number.NaN);
      if (pendingFocus?.code !== event.code) return;
      const pane = pendingFocus.pane;
      pendingFocus = null;
      if (context.controller.focus.value === pane) context.focusKeyboard(pane);
    },
    keepHeldOnBlur: () => document.activeElement instanceof HTMLIFrameElement && frames().includes(document.activeElement),
  });
  const previousFocus = context.pick.onFocus;
  context.pick.onFocus = pane => {
    const code = modal.heldCodes().find(key => digits.includes(key));
    // Keep the keyup in the document that captured its down. Move the keyboard only after consuming release.
    if (code !== undefined) pendingFocus = { code, pane }; else context.focusKeyboard(pane);
  };
  // Modifier states come from this page's events and, later, from pane iframes' reports: keep the newest.
  let modsAt = 0;
  const metaFrames = new Set<HTMLIFrameElement>();
  const replayed = new WeakSet<Event>();
  const grab = (e: ModifierLike, at: number = Number.NaN) => {
    const time = frameReportTime(at);
    if (time < modsAt) return;
    modsAt = time;
    context.modes.grab.value = heldForLayout(context.chords.value, e);
  };
  const now = (e: Event) => performance.timeOrigin + e.timeStamp;
  function frameMeta(frame: HTMLIFrameElement, data: ModifierLike & { at?: number }, release = false): void {
    // A hover in a different document cannot know that Win is up (notably on WebKitGTK).
    if (!reportFrameMeta(data.metaKey, data.at ?? Number.NaN, release || metaFrames.has(frame))) return;
    if (data.metaKey) metaFrames.add(frame);
    else if (release) metaFrames.clear(); else metaFrames.delete(frame);
  }
  function keydown(event: KeyboardEvent): void {
    if (!context.root.value?.isConnected) return;
    // A key replayed from a pane iframe (picker modes) carries old modifier state: it already counted.
    if (!replayed.has(event)) grab(event, now(event));
    if (event.defaultPrevented || context.modes.arranging.value) return;
    handleKey(context, table, event, options.report, holds);
  }
  function keyup(event: KeyboardEvent): void {
    holds.delete(event.code);
    grab(event, now(event));
  }
  function blur(): void { holds.clear(); context.modes.grab.value = false; }
  function hidden(): void { if (document.visibilityState === "hidden") blur(); }

  const shellFingers = new Map<number, FramePoint>();
  const frameFingers = new Map<HTMLIFrameElement, FramePoint[]>();
  // Only unmatched hints live here; touch snapshots take over as soon as they report those fingers.
  const provisional = new Map<string, { point: FramePoint; frame: HTMLIFrameElement | null }>();
  // Pointer ids and touch identifiers differ. Match a lift once per reporting document,
  // then retire its touch identifier only until that document omits it or reports a new start for it.
  const liftedIds = new Map<HTMLIFrameElement | null, Set<number>>();
  let releases: { x: number; y: number; at: number; matched: Set<HTMLIFrameElement | null> }[] = [];
  function withoutLifted(points: FramePoint[], owner: HTMLIFrameElement | null, snapshot = false): FramePoint[] {
    const ids = liftedIds.get(owner) ?? new Set<number>();
    liftedIds.set(owner, ids);
    if (snapshot) for (const id of ids) if (!points.some(p => p.identifier === id)) ids.delete(id);
    const remaining = points.filter(p => p.identifier === undefined || !ids.has(p.identifier));
    const time = performance.timeOrigin + performance.now();
    releases = releases.filter(r => time - r.at <= RELEASE_MS);
    for (const release of releases) {
      if (release.matched.has(owner)) continue;
      const closest = remaining.reduce<FramePoint | undefined>((best, p) =>
        !best || Math.hypot(p.x - release.x, p.y - release.y) < Math.hypot(best.x - release.x, best.y - release.y) ? p : best, undefined);
      if (!closest || Math.hypot(closest.x - release.x, closest.y - release.y) > RELEASE_RADIUS) continue;
      release.matched.add(owner);
      if (closest.identifier !== undefined) ids.add(closest.identifier);
      remaining.splice(remaining.indexOf(closest), 1);
    }
    return remaining;
  }
  function pointerLift(x: number, y: number, at: number): void {
    releases.push({ x, y, at: frameReportTime(at), matched: new Set() });
    const kept = new Set(withoutLifted([...shellFingers.values()], null));
    for (const [id, p] of shellFingers) if (!kept.has(p)) shellFingers.delete(id);
    for (const [frame, points] of frameFingers) {
      const remaining = withoutLifted(points, frame);
      if (remaining.length) frameFingers.set(frame, remaining); else frameFingers.delete(frame);
    }
  }
  const blockingFrames = new Map<HTMLIFrameElement, number>();
  let sequenceFrame: HTMLIFrameElement | null = null;
  let touchCount = 0;
  const pointerKey = (frame: HTMLIFrameElement | null, id: number) => `${frame === null ? "shell" : tokens.get(frame)}:${id}`;
  function reconcile(points: FramePoint[]): void {
    const unmatched = [...provisional];
    for (const p of points) {
      // A foreign-document touch is first reported on movement, not at its landing position.
      // Match each newly seen touch to the closest unmatched pointer landing, once.
      unmatched.sort(([, a], [, b]) => Math.hypot(a.point.x - p.x, a.point.y - p.y) - Math.hypot(b.point.x - p.x, b.point.y - p.y));
      const match = unmatched.shift();
      if (match) { p.x0 = match[1].point.x0; p.y0 = match[1].point.y0; provisional.delete(match[0]); }
    }
  }
  function hint(frame: HTMLIFrameElement | null, id: number, x: number, y: number): void {
    const point = { x, y, x0: x, y0: y };
    const reported = [...shellFingers.values(), ...[...frameFingers.values()].flat()];
    if (!reported.some(p => Math.hypot(p.x0 - x, p.y0 - y) < 2) && !(frame === null && shellFingers.has(id))) {
      provisional.set(pointerKey(frame, id), { point, frame });
    }
    heard();
    evaluate();
  }
  // Each pane iframe gets a random token; its reports carry it (see frame.ts for why `source` is not enough).
  const tokens = new WeakMap<HTMLIFrameElement, string>();
  const byToken = new Map<string, HTMLIFrameElement>();
  let frameDrag: { frame: HTMLIFrameElement; pointerId: number } | null = null;
  function freshToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function send(frame: HTMLIFrameElement, message: ShellMessage): void {
    if (message.type === "own-touch") {
      try {
        // Apply ownership before this input handler returns, not after another document's next paint.
        // A helper acknowledges by cancelling; without one, or across origins, retain postMessage.
        if (frame.contentWindow?.dispatchEvent(new MessageEvent("message", {
          data: message, origin: location.origin, source: window, cancelable: true,
        })) === false) return;
      } catch { /* Cross-origin WindowProxy access requires asynchronous delivery. */ }
    }
    try { frame.contentWindow?.postMessage(message, "*"); } catch { /* A detached frame has nothing to tell. */ }
  }
  function capturePolicy(): SplitTabsCapture {
    return { chords: [...table.keys()], exitKeys: modal.chords(), captureKeys: [...modal.captureChords()],
      arranging: context.modes.arranging.value };
  }
  let lastCapture: string | undefined;
  function capture(policy = capturePolicy()): void {
    const serialized = JSON.stringify(policy);
    if (serialized === lastCapture) return;
    lastCapture = serialized;
    options.capture?.(policy);
  }
  function identify(frame: HTMLIFrameElement): void {
    let token = tokens.get(frame);
    if (token === undefined) { token = freshToken(); tokens.set(frame, token); byToken.set(token, frame); }
    send(frame, { [FRAME_MESSAGE]: 1, type: "identify", token, ...capturePolicy(), heldKeys: modal.heldCodes() });
  }
  function frameLoaded(event: Event): void {
    if (!(event.target instanceof HTMLIFrameElement)) return;
    if (frameDrag?.frame === event.target) context.drag.cancel();
    identify(event.target);
  }
  let four: { spread0: number; cx: number; cy: number; done: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let silence: ReturnType<typeof setTimeout> | null = null;
  function frames(): HTMLIFrameElement[] {
    const root = context.root.value;
    return root === null ? [] : [...root.querySelectorAll("iframe")];
  }
  function frameOf(win: MessageEventSource | null, token: unknown): HTMLIFrameElement | null {
    if (typeof token === "string" && token !== "") {
      const frame = byToken.get(token);
      return frame !== undefined && frame.isConnected && frames().includes(frame) ? frame : null;
    }
    return frames().find(f => f.contentWindow !== null && f.contentWindow === win) ?? null;
  }
  function paneOfFrame(frame: HTMLIFrameElement): string | null {
    const pane = frame.closest<HTMLElement>("[data-pane-id]");
    if (pane !== null) return pane.dataset.paneId ?? null;
    const keep = frame.closest<HTMLElement>("[data-split-tabs-keep]");
    return keep === null ? null : context.controller.paneOf(keep.dataset.splitTabsKeep ?? "");
  }
  function claim(what: string): void {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(25);
    for (const f of frames()) send(f, { [FRAME_MESSAGE]: 1, type: "claimed", what });
  }
  function heard(): void {
    if (silence !== null) clearTimeout(silence);
    // A touch whose target left the document (a zoom) may never report its release here either.
    silence = setTimeout(() => {
      silence = null;
      shellFingers.clear(); frameFingers.clear(); provisional.clear(); liftedIds.clear(); releases = []; evaluate();
    }, SILENCE_MS);
  }
  function paneAt(x: number, y: number): string | null {
    const root = context.root.value;
    if (root === null) return null;
    const hit = [...root.querySelectorAll<HTMLElement>("[data-pane-id]")].find(el => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    return hit?.dataset.paneId ?? null;
  }
  function evaluate(): void {
    const points = [...shellFingers.values(), ...[...frameFingers.values()].flat(), ...[...provisional.values()].map(h => h.point)];
    touchCount = points.length;
    setBlocking(points.length >= SHELL_FINGERS - 1);
    for (const frame of new Set([...blockingFrames.keys(), ...frameFingers.keys(), ...(sequenceFrame ? [sequenceFrame] : [])])) {
      const count = frameFingers.has(frame) || frame === sequenceFrame ? points.length : 0;
      if (blockingFrames.get(frame) !== count) send(frame, { [FRAME_MESSAGE]: 1, type: "own-touch", count });
      if (count > 0) blockingFrames.set(frame, count); else blockingFrames.delete(frame);
    }
    if (points.length === 0) {
      sequenceFrame = null;
      if (silence !== null) { clearTimeout(silence); silence = null; }
    }
    if (points.length === 0) context.modes.gesture.value = false;
    else if (points.length >= SHELL_FINGERS && !context.modes.gesture.value) {
      // A third finger ends whatever the first ones had started; the content no longer gets this sequence.
      context.drag.cancel();
      context.modes.gesture.value = true;
    }
    if (points.length < FOUR_FINGERS) {
      if (four?.timer != null) clearTimeout(four.timer);
      four = null;
      return;
    }
    const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
    const spread = points.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
    if (four === null) {
      four = { spread0: Math.max(spread, 1), cx, cy, done: false, timer: null };
      four.timer = setTimeout(() => {
        if (four === null || four.done) return;
        four.done = true;
        if (!context.modes.arranging.value) claim("hold");
        context.modes.arranging.value = !context.modes.arranging.value;
        options.report("fourFingerHold", { ok: true });
      }, HOLD_MS);
      return;
    }
    if (four.done) return;
    const ratio = spread / four.spread0;
    if (ratio > PINCH_OUT || ratio < PINCH_IN) {
      if (four.timer !== null) clearTimeout(four.timer);
      four.done = true;
      const out = ratio > PINCH_OUT;
      claim(out ? "pinch-out" : "pinch-in");
      const c = context.controller;
      if (out) {
        const pane = c.selection.value.length > 0 ? undefined : paneAt(four.cx, four.cy) ?? undefined;
        options.report("pinchOut", c.zoomed.value !== null ? { ok: false, reason: "zoomed" } : c.zoom(pane));
      } else options.report("pinchIn", c.restore());
      return;
    }
    if (points.some(p => Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP_PX) && four.timer !== null) { clearTimeout(four.timer); four.timer = null; }
  }
  function message(event: MessageEvent): void {
    const allowed = options.frameOrigins() ?? [location.origin];
    if (!allowed.includes(event.origin)) return;
    const data = event.data as FrameMessage | null;
    if (typeof data !== "object" || data === null || data[FRAME_MESSAGE] !== 1) return;
    // A new iframe says hello before it has a token: identify every pane iframe.
    if (data.type === "hello") { for (const f of frames()) identify(f); return; }
    const frame = frameOf(event.source, data.token);
    if (frame === null) return;
    if (data.type === "down") {
      if (context.pick.mode.value === "display") context.pick.cancel();
      // A primary pointer starts a fresh native sequence, even if a removed target stranded its old touches.
      if (data.pointerType === "touch" && data.isPrimary) {
        liftedIds.clear(); releases = [];
        shellFingers.clear(); frameFingers.clear(); provisional.clear(); evaluate();
      }
      if (data.pointerType === "touch" && data.pointerId !== undefined && data.x !== undefined && data.y !== undefined) {
        if (data.isPrimary) sequenceFrame = frame;
        const r = frame.getBoundingClientRect();
        hint(frame, data.pointerId, data.x + r.left, data.y + r.top);
      }
      const pane = paneOfFrame(frame);
      if (pane === null || data.button !== 0 || context.modes.arranging.value || context.modes.gesture.value) return;
      if (heldForLayout(context.chords.value, data)) {
        // A layout chord reached the content: the keys were held where this shell could not see them,
        // or its reports have not arrived yet. Reuse the pane's press path even before its cover renders.
        if (["mouse", "pen"].includes(data.pointerType) && data.pointerId !== undefined && data.x !== undefined && data.y !== undefined) {
          const element = [...(context.root.value?.querySelectorAll<HTMLElement>("[data-pane-id]") ?? [])]
            .find(el => el.dataset.paneId === pane);
          if (element && !context.drag.active.value) {
            const r = frame.getBoundingClientRect();
            element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true,
              pointerId: data.pointerId, pointerType: data.pointerType, isPrimary: data.isPrimary ?? true,
              button: data.button, buttons: 1, clientX: r.left + data.x, clientY: r.top + data.y,
              ctrlKey: data.ctrlKey, altKey: data.altKey, shiftKey: data.shiftKey, metaKey: data.metaKey,
              modifierAltGraph: data.altGraph ?? false }));
            if (context.drag.active.value) frameDrag = { frame, pointerId: data.pointerId };
          }
          return;
        }
        const held = modifiersOf(data), chords = context.chords.value;
        if (held === chords.toggle) context.controller.toggleSelected(pane);
        else if (held === chords.rectangle) context.controller.selectRectangle(pane);
        return;
      }
      context.controller.focusPane(pane);
    } else if (data.type === "pointer") {
      if (!context.drag.active.value || frameDrag?.frame !== frame || frameDrag.pointerId !== data.pointerId) return;
      const r = frame.getBoundingClientRect();
      context.drag.capture(new PointerEvent(`pointer${data.phase}`, { pointerId: data.pointerId, pointerType: data.pointerType,
        clientX: r.left + data.x, clientY: r.top + data.y }));
    } else if (data.type === "key") {
      if (data.phase === "keyup") holds.delete(data.code);
      frameMeta(frame, data, data.phase === "keyup" && isMetaKey(data));
      const forwarded = { ...data,
        preventDefault() { /* The iframe already handled its own default. */ },
        stopPropagation() { /* No page event was dispatched. */ },
        stopImmediatePropagation() { /* No page event was dispatched. */ },
      };
      grab(forwarded, data.at ?? Number.NaN);
      if (modal.handle(forwarded, data.phase)) return;
      if (context.modes.arranging.value) return;
      if (data.phase !== "keydown") { holds.delete(data.code); return; }
      // While a pane picker or menu listens, replay its non-exit keys on this window
      // so they hear it before the layout keys, exactly as for a key typed on this page: their capture
      // listener runs first, then this shell's own keydown listener runs the layout chords.
      if (context.pick.mode.value !== null || options.menu?.()) {
        if (isMetaKey(data) || /^(Control|Alt|Shift|AltGraph)$/.test(data.key)) return;
        const replay = new KeyboardEvent("keydown", { key: data.key, code: data.code, repeat: data.repeat, ctrlKey: data.ctrlKey,
          altKey: data.altKey, shiftKey: data.shiftKey, metaKey: data.metaKey, modifierAltGraph: data.altGraph ?? false,
          bubbles: true, cancelable: true });
        replayed.add(replay);
        window.dispatchEvent(replay);
        return;
      }
      handleKey(context, table, forwarded, options.report, holds);
    } else if (data.type === "mods") {
      frameMeta(frame, data);
      grab(data, data.at ?? Number.NaN);
    } else if (data.type === "touches") {
      const r = frame.getBoundingClientRect();
      const rootBox = context.root.value?.getBoundingClientRect();
      const points = withoutLifted(data.points.map(p => ({ ...p,
        x: p.x + r.left, y: p.y + r.top, x0: p.x0 + r.left, y0: p.y0 + r.top }))
        .filter(p => rootBox && p.x0 >= rootBox.left && p.x0 < rootBox.right && p.y0 >= rootBox.top && p.y0 < rootBox.bottom), frame, true);
      const fresh: FramePoint[] = [];
      for (const p of points) {
        const known = p.identifier === undefined ? undefined : frameFingers.get(frame)?.find(old => old.identifier === p.identifier);
        if (known) { p.x0 = known.x0; p.y0 = known.y0; } else fresh.push(p);
      }
      reconcile(fresh);
      // Include even an empty/filtered snapshot once, so its helper learns the root's zero count.
      frameFingers.set(frame, points);
      heard();
      evaluate();
      if (points.length === 0) frameFingers.delete(frame);
    } else if (data.type === "touch-pointer") {
      provisional.delete(pointerKey(frame, data.pointerId));
      if (data.phase === "up" && data.x !== undefined && data.y !== undefined) {
        const r = frame.getBoundingClientRect();
        pointerLift(data.x + r.left, data.y + r.top, data.at ?? performance.timeOrigin + performance.now());
      }
      evaluate();
    }
  }
  // Modifiers held while the keyboard is in another document still show the covers when the pointer moves.
  function pointerMods(e: PointerEvent): void {
    if (e.pointerType === "mouse" || e.pointerType === "pen") grab(e, now(e));
  }
  function pointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch" || !(e.target instanceof Node) || !context.root.value?.contains(e.target)) return;
    if (e.isPrimary) { liftedIds.clear(); releases = []; }
    hint(null, e.pointerId, e.clientX, e.clientY);
  }
  function pointerRelease(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    provisional.delete(pointerKey(null, e.pointerId));
    if (e.type === "pointerup") pointerLift(e.clientX, e.clientY, now(e));
    evaluate();
  }
  // Cancels touchstart/touchmove from the third finger, so the browser never starts its pan (no pointercancel,
  // no content scroll). Non-passive touch listeners make the browser wait for this page before it may scroll,
  // so it is registered only from the SECOND finger (the third finger's touchstart is then cancellable) until
  // fewer than two fingers remain, and removed with that exact identity: one-finger scrolling stays passive.
  let blocking = false;
  const ownTouches = (e: TouchEvent) => Array.from(e.touches).filter(t => {
    const root = context.root.value;
    if (!(t.target instanceof Node) || root === null) return false;
    if (root.contains(t.target)) return true;
    if (t.target.ownerDocument === document) return false;
    const p = shellFingers.get(t.identifier), r = root.getBoundingClientRect();
    const x = p?.x0 ?? t.clientX, y = p?.y0 ?? t.clientY;
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  });
  const block = (e: TouchEvent) => {
    if (e.touches != null && ownTouches(e).length > 0 && touchCount >= SHELL_FINGERS && e.cancelable) e.preventDefault();
  };
  function setBlocking(on: boolean): void {
    if (on === blocking) return;
    blocking = on;
    for (const type of ["touchstart", "touchmove"] as const) {
      if (on) window.addEventListener(type, block, { capture: true, passive: false });
      else window.removeEventListener(type, block, { capture: true });
    }
  }
  // Touch targets stay with their starting root, even when fingers move outside it.
  function touches(e: TouchEvent): void {
    // A synthetic `Event` named like a touch event carries no finger list: nothing to learn from it.
    if (e.touches == null) return;
    const list = ownTouches(e);
    if (e.type === "touchstart") for (const t of Array.from(e.changedTouches)) liftedIds.get(null)?.delete(t.identifier);
    // A zoom can remove a touch's target before its release reaches this window.
    // A first finger starts a new native sequence: no old fingers are still down.
    if (e.type === "touchstart" && list.length > 0 && e.touches.length === e.changedTouches.length) {
      shellFingers.clear(); frameFingers.clear();
      if (four?.timer != null) clearTimeout(four.timer);
      four = null;
    }
    const seen = new Set<number>();
    const fresh: FramePoint[] = [];
    const accepted = new Set(withoutLifted(list.map(t => ({ identifier: t.identifier,
      x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY })), null, true).map(p => p.identifier));
    for (const t of list) {
      seen.add(t.identifier);
      if (!accepted.has(t.identifier)) continue;
      const known = shellFingers.get(t.identifier);
      if (known === undefined) {
        const point = { identifier: t.identifier, x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY };
        shellFingers.set(t.identifier, point);
        fresh.push(point);
      }
      else { known.x = t.clientX; known.y = t.clientY; }
    }
    for (const id of [...shellFingers.keys()]) if (!seen.has(id)) shellFingers.delete(id);
    reconcile(fresh);
    if (list.length > 0) heard();
    evaluate();
  }

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("message", message);
  // `load` does not bubble, but a capturing listener on the root sees every iframe load inside it.
  const root = context.root.value;
  const stopKeys = watch(options.keymap, current => {
    table = compileKeymap(current);
    for (const frame of frames()) identify(frame);
    capture();
  }, { deep: true, flush: "sync" });
  const stopModes = watch([innermost, exitPolicy, () => context.modes.arranging.value,
    () => modal.captureChords().join(" "), () => modal.heldCodes().join(" ")], () => {
    for (const frame of frames()) identify(frame);
    capture();
  }, { deep: true, flush: "sync" });
  const stopFrameDrag = watch(context.drag.active, active => { if (!active) frameDrag = null; }, { flush: "sync" });
  const observer = new MutationObserver(() => {
    for (const [token, frame] of byToken) {
      if (root?.contains(frame)) continue;
      if (frameDrag?.frame === frame) context.drag.cancel();
      byToken.delete(token);
      tokens.delete(frame);
      frameFingers.delete(frame);
      liftedIds.delete(frame);
      for (const release of releases) release.matched.delete(frame);
      for (const [id, h] of provisional) if (h.frame === frame) provisional.delete(id);
      if (sequenceFrame === frame) sequenceFrame = null;
      blockingFrames.delete(frame);
      if (metaFrames.delete(frame)) {
        reportFrameMeta(false, Number.NaN);
        context.modes.grab.value = false;
      }
    }
    evaluate();
  });
  if (root !== null) observer.observe(root, { childList: true, subtree: true });
  root?.addEventListener("load", frameLoaded, true);
  for (const f of frames()) identify(f);
  capture();
  window.addEventListener("pointermove", pointerMods, { capture: true, passive: true });
  window.addEventListener("pointerdown", pointerDown, { capture: true, passive: true });
  window.addEventListener("pointerup", pointerRelease, true);
  window.addEventListener("pointercancel", pointerRelease, true);
  for (const type of TOUCH_TYPES) window.addEventListener(type, touches, { capture: true, passive: true });
  const isolatedTypes = ["pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave",
    "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "auxclick", "dblclick", "contextmenu", "wheel",
    ...TOUCH_TYPES];
  function isolate(event: Event): void {
    if (!context.root.value?.isConnected) return;
    if (arrangeUI(event.target)) return;
    if (event instanceof PointerEvent) context.drag.capture(event);
    if (event.cancelable) event.preventDefault();
    event.stopPropagation(); event.stopImmediatePropagation();
  }
  const stopIsolation = watch(() => context.modes.arranging.value, on => {
    if (on) context.drag.cancel();
    for (const type of isolatedTypes) {
      if (on) window.addEventListener(type, isolate, { capture: true, passive: false });
      else window.removeEventListener(type, isolate, true);
    }
    if (!on) {
      context.drag.cancel(); context.pick.cancel(); options.menu?.()?.();
      context.controller.clearSelection(); context.controller.focusBar(null);
    }
  }, { flush: "sync" });
  return () => {
    stopIsolation();
    for (const type of isolatedTypes) window.removeEventListener(type, isolate, true);
    holds.clear();
    stopKeys();
    stopModes();
    stopFrameDrag();
    modal.dispose();
    pendingFocus = null;
    context.pick.onFocus = previousFocus;
    // Connected helpers must not keep modal exits after the root unmounts.
    const empty: SplitTabsCapture = { chords: [], exitKeys: [], captureKeys: [], arranging: false };
    for (const frame of frames()) {
      send(frame, { [FRAME_MESSAGE]: 1, type: "own-touch", count: 0 });
      send(frame, { [FRAME_MESSAGE]: 1, type: "identify", token: tokens.get(frame) ?? "", ...empty, heldKeys: [] });
    }
    capture(empty);
    observer.disconnect();
    byToken.clear();
    frameFingers.clear();
    provisional.clear();
    liftedIds.clear(); releases = [];
    blockingFrames.clear();
    if (metaFrames.size > 0) reportFrameMeta(false, Number.NaN);
    metaFrames.clear();
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", blur);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("message", message);
    root?.removeEventListener("load", frameLoaded, true);
    window.removeEventListener("pointermove", pointerMods, { capture: true });
    window.removeEventListener("pointerdown", pointerDown, { capture: true });
    window.removeEventListener("pointerup", pointerRelease, true);
    window.removeEventListener("pointercancel", pointerRelease, true);
    for (const type of TOUCH_TYPES) window.removeEventListener(type, touches, { capture: true });
    setBlocking(false);
    shellFingers.clear();
    context.modes.gesture.value = false;
    if (four?.timer != null) clearTimeout(four.timer);
    if (silence !== null) clearTimeout(silence);
  };
}
