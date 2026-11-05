// One exit decision per physical press, before content or layout commands.
import { ref, watch } from "vue";
import { compileExitKeys, createChordTracker, defaultExitKeys, chordOf, type KeyLike } from "./keymap.js";

type ExitEvent = KeyLike & { preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void };
interface ModalInput {
  keys(): readonly string[];
  run(event: KeyLike): void;
  other(): void;
  released?(event: KeyLike): void;
  keepHeldOnBlur?(): boolean;
  captureAll?(): boolean;
  allowTarget?(target: EventTarget | null): boolean;
}
export function createModalExit(keys: () => readonly string[] | null | undefined, current: () => (() => void) | null, input?: ModalInput) {
  const tracker = createChordTracker();
  let chords = compileExitKeys(keys() === undefined ? defaultExitKeys : keys()!);
  const consumed = new Set<string>();
  const serial = ref(0);
  let listening = false;
  function sync(): void {
    // A consumed press still owns its repeats and release after the last mode ends.
    // Keep capture order stable even when a disabled exit policy is enabled mid-mode.
    const needed = current() !== null || consumed.size > 0;
    if (needed === listening) return;
    listening = needed;
    if (needed) {
      window.addEventListener("keydown", down, true);
      window.addEventListener("keyup", up, true);
      window.addEventListener("blur", blur);
    } else {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    }
  }
  function handle(event: ExitEvent, phase: "keydown" | "keyup"): boolean {
    const all = input?.captureAll?.() ?? false;
    // The editor owns typing and Escape; arrange Tab navigation still cannot reach content.
    if ("target" in event && event.target instanceof Element && event.target.closest(".split-tab-strip-rename")
      && (!all || event.code !== "Tab")) return false;
    const release = phase === "keyup";
    const held = consumed.has(event.code);
    const exit = current();
    const matches = !release && exit !== null && !event.altGraph && !event.getModifierState?.("AltGraph") && chords.has(chordOf(event));
    const action = !release && exit !== null && !event.altGraph && !event.getModifierState?.("AltGraph")
      && (input?.keys().includes(chordOf(event)) ?? false);
    if (all && !matches && !action && !held && "target" in event && input?.allowTarget?.(event.target as EventTarget | null)) return false;
    if (!(held && (release || event.repeat)) && !matches && !action && !all) {
      if (!release && !event.repeat) input?.other();
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (release) { consumed.delete(event.code); serial.value++; input?.released?.(event); }
    else {
      consumed.add(event.code);
      serial.value++;
      if (!event.repeat) { if (matches) exit?.(); else if (action) input?.run(event); }
    }
    sync();
    return true;
  }
  function down(event: KeyboardEvent): void { handle(event, "keydown"); }
  function up(event: KeyboardEvent): void { handle(event, "keyup"); }
  function blur(): void {
    if (input?.keepHeldOnBlur?.()) return;
    consumed.clear(); serial.value++; sync();
  }
  const stopKeys = watch(keys, value => { chords = compileExitKeys(value === undefined ? defaultExitKeys : value); sync(); }, { deep: true, flush: "sync" });
  const stopMode = watch(current, sync, { flush: "sync", immediate: true });
  return {
    handle,
    chords: () => current() === null ? [] : [...chords],
    captureChords: () => input?.keys() ?? [],
    heldCodes: () => { void serial.value; return [...consumed]; },
    dispose() {
      stopKeys();
      stopMode();
      consumed.clear();
      tracker.dispose();
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
      listening = false;
    },
  };
}
