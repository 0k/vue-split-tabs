// Keyboard chords for layout commands.  The host decides every binding:
// `defaultKeymap` provides Alt+Shift bindings; spread and override it, or
// pass `null` to SplitTabs to bind nothing.  Chords name physical keys
// (`KeyboardEvent.code`), so Alt does not change what a letter key means.
import type { SplitTabsContext } from "./context.js";
import type { SplitTabsResult } from "./controller.js";

export type SplitTabsCommand =
  | "focusLeft" | "focusRight" | "focusUp" | "focusDown"
  | "extendLeft" | "extendRight" | "extendUp" | "extendDown"
  | "splitRight" | "splitLeft" | "splitBelow" | "splitAbove" | "tabNext" | "tabInside" | "group" | "barSide"
  | "pick" | "move" | "displayPanes" | "arrange" | "zoom" | "close" | "undo"
  | "previousTab" | "nextTab" | "equalize" | "shrink" | "grow" | "clear";
/** Command -> chords such as `Alt+Shift+KeyE` or `Ctrl+Alt+Shift+ArrowLeft`. */
export type SplitTabsKeymap = Partial<Record<SplitTabsCommand, readonly string[]>>;
export const defaultExitKeys: readonly string[] = Object.freeze(["Escape", "Ctrl+KeyG", "Ctrl+KeyD"]);

const arrows = (mods: string, dir: "Left" | "Right" | "Up" | "Down", vim: string) => [`${mods}+Arrow${dir}`, `${mods}+Key${vim}`];
export const defaultKeymap: Readonly<SplitTabsKeymap> = Object.freeze({
  focusLeft: arrows("Alt+Shift", "Left", "H"), focusDown: arrows("Alt+Shift", "Down", "J"),
  focusUp: arrows("Alt+Shift", "Up", "K"), focusRight: arrows("Alt+Shift", "Right", "L"),
  extendLeft: arrows("Ctrl+Alt+Shift", "Left", "H"), extendDown: arrows("Ctrl+Alt+Shift", "Down", "J"),
  extendUp: arrows("Ctrl+Alt+Shift", "Up", "K"), extendRight: arrows("Ctrl+Alt+Shift", "Right", "L"),
  splitRight: ["Alt+Shift+KeyE"], splitBelow: ["Alt+Shift+KeyO"], tabNext: ["Alt+Shift+KeyT"], tabInside: ["Alt+Shift+KeyI"],
  group: ["Alt+Shift+KeyG"], barSide: ["Alt+Shift+KeyR"], pick: ["Alt+Shift+KeyM"], move: ["Alt+Shift+KeyV"],
  arrange: ["Alt+Shift+KeyA"], zoom: ["Alt+Shift+KeyZ"], close: ["Alt+Shift+KeyX"], undo: ["Alt+Shift+KeyU"],
  previousTab: ["Alt+Shift+BracketLeft"], nextTab: ["Alt+Shift+BracketRight"], equalize: ["Alt+Shift+Equal"],
  shrink: ["Alt+Shift+Comma"], grow: ["Alt+Shift+Period"], clear: ["Escape"],
  displayPanes: ["Alt+Shift+KeyQ"],
});
/**
 * Modifier chords for pointer actions on panes, e.g. `Alt+Shift` or `Ctrl+Alt+Shift`; `null` turns an action off.
 * `toggle`: a click adds or removes the pane from the selection; `rectangle`: a click selects the rectangle from the
 * focused pane; `move`: a drag moves the pane (or the selection holding it). Holding exactly the modifiers of an
 * enabled chord covers the panes, so clicks and drags reach the layout even over iframes.
 */
export interface SplitTabsPointerChords { toggle: string | null; rectangle: string | null; move: string | null }
export const defaultPointerChords: Readonly<SplitTabsPointerChords> = Object.freeze({
  toggle: "Alt+Shift", rectangle: "Ctrl+Alt+Shift", move: "Alt+Shift",
});
const MODIFIERS = ["Ctrl", "Meta", "Alt", "Shift"] as const;
export interface ModifierLike {
  ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  altGraph?: boolean;
  getModifierState?(key: string): boolean;
  /** Internal: an iframe report or tracker already supplied effective modifiers. */
  metaTracked?: boolean;
}
interface MetaState { held: Set<string>; reported: boolean; reportedAt: number;
  predicates: Map<object, (event: KeyboardEvent) => boolean>; stop(): void }
const metaStates = new WeakMap<Window, MetaState>();
function effectiveMeta(event: ModifierLike): boolean {
  const state = typeof window === "undefined" ? undefined : metaStates.get(window);
  return event.metaKey || (!event.metaTracked && ((state?.held.size ?? 0) > 0 || state?.reported === true));
}
/** Compare cross-document reports without allowing a sender's clock to freeze later input. */
export function frameReportTime(at: number): number {
  const now = performance.timeOrigin + performance.now();
  return Number.isFinite(at) ? Math.min(at, now) : now;
}
/** Accepted, time-ordered iframe modifier reports also govern shell pointer events. */
export function reportFrameMeta(held: boolean, at: number, release = true): boolean {
  const state = metaStates.get(window);
  // Older helpers omit timestamps; order those reports at receipt time.
  const time = frameReportTime(at);
  if (state === undefined || time < state.reportedAt) return false;
  if (held || release) state.reported = held;
  state.reportedAt = time;
  return true;
}
export function isMetaKey(event: Pick<KeyLike, "code" | "key">): boolean {
  return /^(Meta|OS)(Left|Right)$/.test(event.code) || /^(Meta|Super|OS|Hyper)$/.test(event.key);
}
/**
 * How long a window blur may last before held Win/Super is dropped (the frame helper mirrors it). Some window
 * managers (Unity/compiz) blur and refocus the window about 30 ms after a Win press, while its keyup still arrives
 * later; a focus within this delay keeps it held. Keyup and hidden visibility still release at once.
 */
const META_BLUR_MS = 500;
export interface SplitTabsChordTracker {
  /** Strict physical chord matching, including the observed Win/Super key on WebKitGTK. */
  matches(event: KeyLike, chord: string): boolean;
  /** Effective modifier flags for this document; does not mutate the event. */
  modifiers(event: ModifierLike): ModifierLike;
  /** Release this tracker. Observers are shared per window and removed with the last tracker. */
  dispose(): void;
}
/**
 * Share this window's physical Win/Super tracking. Any live tracker's `trusted` predicate may vouch for an event;
 * disposing its lease removes that predicate. Create host trackers before the key presses they must observe.
 */
export function createChordTracker(
  target: Window = window,
  /** Accept native-shell key replays vouched for by the host; defaults to `event.isTrusted`. */
  trusted: (event: KeyboardEvent) => boolean = event => event.isTrusted,
): SplitTabsChordTracker {
  let state = metaStates.get(target);
  if (state === undefined) {
    const held = new Set<string>();
    const predicates = new Map<object, (event: KeyboardEvent) => boolean>();
    let heldAtBlur = new Set<string>();
    const now = () => target.performance.timeOrigin + target.performance.now();
    // A delayed blur clear acts as of the blur: iframe reports accepted since then are newer and stand.
    const release = (at: number, keepNewer = false) => {
      const current = metaStates.get(target);
      if (current === undefined) return;
      if (!keepNewer || current.reportedAt <= at) current.reported = false;
      current.reportedAt = Math.max(current.reportedAt, at);
    };
    const key = (e: KeyboardEvent) => {
      if (![...predicates.values()].some(accept => accept(e))) return;
      if (!isMetaKey(e)) return;
      const id = e.code || e.key;
      if (e.type === "keydown") { held.add(id); heldAtBlur.delete(id); }
      else { held.delete(id); heldAtBlur.delete(id); release(target.performance.timeOrigin + e.timeStamp); }
    };
    let blurred: ReturnType<typeof setTimeout> | null = null;
    const focus = () => { if (blurred !== null) clearTimeout(blurred); blurred = null; heldAtBlur.clear(); };
    const clear = () => { focus(); held.clear(); release(now()); };
    const blur = () => {
      if (blurred !== null) return;
      const at = now();
      heldAtBlur = new Set(held);
      blurred = setTimeout(() => {
        blurred = null;
        for (const id of heldAtBlur) held.delete(id);
        heldAtBlur.clear();
        release(at, true);
      }, META_BLUR_MS);
    };
    const hidden = () => { if (target.document.visibilityState === "hidden") clear(); };
    target.addEventListener("keydown", key, true);
    target.addEventListener("keyup", key, true);
    target.addEventListener("blur", blur);
    // Element focus does not bubble; WebKit may refocus content without a window-targeted focus event.
    target.addEventListener("focus", focus, true);
    target.document.addEventListener("visibilitychange", hidden);
    state = { held, reported: false, reportedAt: 0, predicates, stop() {
      clear();
      target.removeEventListener("keydown", key, true);
      target.removeEventListener("keyup", key, true);
      target.removeEventListener("blur", blur);
      target.removeEventListener("focus", focus, true);
      target.document.removeEventListener("visibilitychange", hidden);
    } };
    metaStates.set(target, state);
  }
  const shared = state;
  const lease = {};
  shared.predicates.set(lease, trusted);
  let disposed = false;
  const modifiers = (event: ModifierLike): ModifierLike => ({
    ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey,
    metaKey: event.metaKey || (!event.metaTracked && (shared.held.size > 0 || shared.reported)), metaTracked: true,
    altGraph: event.altGraph || event.getModifierState?.("AltGraph") || false,
  });
  return {
    modifiers,
    matches(event, chord) {
      const expected = canonical(chord, true), effective = modifiers(event);
      return !effective.altGraph && [modifiersOf(effective), event.code].filter(Boolean).join("+") === expected;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.predicates.delete(lease);
      if (shared.predicates.size === 0) { shared.stop(); metaStates.delete(target); }
    },
  };
}
/** The modifiers held, in canonical order (`Ctrl+Meta+Alt+Shift`), "" for none. */
export function modifiersOf(event: ModifierLike): string {
  return [event.ctrlKey && "Ctrl", effectiveMeta(event) && "Meta", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean).join("+");
}
const PHYSICAL_CODE = /^[A-Z][A-Za-z0-9]+$/;
function canonical(chord: string, withKey: boolean): string {
  const parts = chord.split("+").map(part => part.trim()).filter(Boolean);
  const code = withKey ? parts.pop() : undefined;
  for (const part of parts) {
    if (!MODIFIERS.some(modifier => modifier === part)) {
      throw new Error(`split-tabs: unknown modifier "${part}" in chord "${chord}"; accepted modifiers: ${MODIFIERS.join(", ")}`);
    }
  }
  const known = MODIFIERS.filter(m => parts.includes(m));
  if (known.length !== parts.length) throw new Error(`split-tabs: chord "${chord}" repeats a modifier`);
  if (withKey) {
    if (code === undefined || MODIFIERS.some(modifier => modifier === code)) {
      throw new Error(`split-tabs: key chord "${chord}" must end with a physical key code`);
    }
    // Codes are words (KeyT, Digit1, Equal, ArrowLeft, F1); a character such as "t" or "=" would never match.
    if (!PHYSICAL_CODE.test(code)) {
      throw new Error(`split-tabs: key chord "${chord}" must end with a physical KeyboardEvent.code (such as KeyT, Digit1, Equal), not a character`);
    }
    return [...known, code].join("+");
  }
  if (known.length === 0) throw new Error(`split-tabs: pointer chord "${chord}" must name modifiers only`);
  return known.join("+");
}
export function compilePointerChords(chords: SplitTabsPointerChords): SplitTabsPointerChords {
  const pointer = (chord: string | null) => chord === null ? null : canonical(chord, false);
  return { toggle: pointer(chords.toggle), rectangle: pointer(chords.rectangle), move: pointer(chords.move) };
}
/** Whether the held modifiers belong to the layout rather than to pane content. */
export function heldForLayout(chords: SplitTabsPointerChords, event: ModifierLike): boolean {
  if (event.altGraph || event.getModifierState?.("AltGraph")) return false;
  const held = modifiersOf(event);
  return held !== "" && (held === chords.toggle || held === chords.rectangle || held === chords.move);
}
/** Commands a held key repeats. */
const REPEATABLE = new Set<SplitTabsCommand>(["focusLeft", "focusRight", "focusUp", "focusDown", "extendLeft", "extendRight",
  "extendUp", "extendDown", "previousTab", "nextTab", "shrink", "grow"]);
export const NUDGE_PX = 24;

export interface KeyLike extends ModifierLike {
  code: string; key: string; repeat: boolean;
}
export function chordOf(event: KeyLike): string {
  return [modifiersOf(event), event.code].filter(Boolean).join("+");
}
/** Modal exit keys use exactly the same validation and canonical form as command chords. */
export function compileExitKeys(keys: readonly string[] | null): Set<string> {
  return new Set((keys ?? []).map(key => canonical(key, true)));
}
export function compileKeymap(keymap: SplitTabsKeymap | null): Map<string, SplitTabsCommand> {
  const table = new Map<string, SplitTabsCommand>();
  if (keymap === null) return table;
  for (const [command, chords] of Object.entries(keymap) as [SplitTabsCommand, readonly string[]][]) {
    for (const chord of chords) {
      const key = canonical(chord, true);
      const bound = table.get(key);
      if (bound !== undefined && bound !== command) throw new Error(`split-tabs: chord "${key}" is bound to both ${bound} and ${command}`);
      table.set(key, command);
    }
  }
  return table;
}

/** Run one command; `null` when it had nothing to do (the key is then left to the page). */
export function runCommand(context: SplitTabsContext, command: SplitTabsCommand): SplitTabsResult | null {
  const c = context.controller;
  const focus = (side: "left" | "right" | "top" | "bottom", extend: boolean) => c.focusDirection(side, extend);
  switch (command) {
    case "focusLeft": return focus("left", false);
    case "focusRight": return focus("right", false);
    case "focusUp": return focus("top", false);
    case "focusDown": return focus("bottom", false);
    case "extendLeft": return focus("left", true);
    case "extendRight": return focus("right", true);
    case "extendUp": return focus("top", true);
    case "extendDown": return focus("bottom", true);
    case "splitRight": return c.split("right");
    case "splitLeft": return c.split("left");
    case "splitAbove": return c.split("top");
    case "splitBelow": return c.split("bottom");
    case "tabNext": return c.tabNext();
    case "tabInside": return c.tabInside();
    case "group": return c.group();
    case "barSide": return c.cycleBarSide();
    case "pick":
      if (context.pick.mode.value === "select") context.pick.cancel(); else context.pick.select();
      return { ok: true };
    case "move": context.pick.keyboardMove(); return { ok: true };
    case "displayPanes": context.pick.displayPanes(); return { ok: true };
    case "arrange": context.modes.arranging.value = !context.modes.arranging.value; return { ok: true };
    case "zoom": return c.toggleZoom();
    case "close": return c.closeTarget();
    case "undo": return c.undo();
    case "previousTab": return c.switchTab(-1);
    case "nextTab": return c.switchTab(1);
    case "equalize": {
      const cut = nearestCut(context);
      if (cut === null) return { ok: false, reason: "no-split" };
      c.equalize(cut);
      return { ok: true, node: cut };
    }
    case "shrink": return c.nudge(-NUDGE_PX);
    case "grow": return c.nudge(NUDGE_PX);
    case "clear":
      if (c.selection.value.length > 0) c.clearSelection();
      else if (c.barFocus.value !== null) c.focusBar(null);
      else return null;
      return { ok: true };
  }
}
// The rendered cut nearest above the focused pane.
function nearestCut(context: SplitTabsContext): string | null {
  const scopes = context.controller.scopes(context.controller.focus.value);
  return scopes.find(id => context.controller.cuts.value.has(id)) ?? null;
}

/** Handle a page or forwarded key. Returns whether its default was taken, not whether a command was reported. */
export function handleKey(context: SplitTabsContext, table: Map<string, SplitTabsCommand>, event: KeyLike & { preventDefault(): void },
  report: (command: SplitTabsCommand, result: SplitTabsResult) => void, holds: Map<string, boolean>): boolean {
  // Non-repeatable/unbound holds keep their initial decision even if modifiers or the keymap change.
  // Repeatable commands remove their entry so each repeat can run normally. The shell clears holds on release/blur.
  if (!event.repeat) holds.set(event.code, false);
  if (event.altGraph || event.getModifierState?.("AltGraph")) return false;
  if (event.repeat && holds.has(event.code)) {
    const taken = holds.get(event.code)!;
    if (taken) event.preventDefault();
    return taken;
  }
  const command = table.get(chordOf(event));
  if (command === undefined) return false;
  // A repeat without an observed initial press must not start a non-repeatable command.
  if (event.repeat && !REPEATABLE.has(command)) return false;
  if (!event.repeat && REPEATABLE.has(command)) holds.delete(event.code);
  const before = context.controller.focus.value;
  const result = runCommand(context, command);
  if (result === null) return false;
  if (!event.repeat && !REPEATABLE.has(command)) holds.set(event.code, result.ok);
  if (result.ok) event.preventDefault();
  // The blue focus and the keyboard must agree: a layout key that moved the focus moves the typing too.
  const after = context.controller.focus.value;
  if (after !== before && after !== "") context.focusKeyboard(after);
  report(command, result);
  return result.ok;
}
