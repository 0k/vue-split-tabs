import { connectSplitTabsFrame } from "@0k/vue-split-tabs/frame";
import { meter, watchGestures } from "./gesture.js";
import "./style.css";

const number = Number(new URLSearchParams(location.search).get("n"));
document.documentElement.style.setProperty("--pane-color", `var(--wb-view-${(number - 1) % 6 + 1})`);
document.querySelector("#number")!.textContent = String(number);
document.querySelector("#log-title")!.textContent = `Pane ${number} · received here`;
document.querySelector("#content")!.textContent = Array.from({ length: 36 }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`).join("\n");
const meterEl = document.querySelector<HTMLOutputElement>("#meter")!;
const log = document.querySelector<HTMLOListElement>("#event-log")!;
const panel = document.querySelector<HTMLElement>("#event-panel")!;
const keyboard = document.querySelector<HTMLOutputElement>("#keyboard")!;
const show = meter(meterEl);
const CLAIM_MIN_MS = 1500, LOG_LIMIT = 12, KEY_FLASH_MS = 240;
let claimed = "", claimedAt = -Infinity, ended = true, lastText = "", count = 0;
let epoch = performance.now(), firstEvent = true;
let flash: ReturnType<typeof setTimeout> | undefined;
const removers: (() => void)[] = [];
function listen(type: string, handler: EventListener): void {
  window.addEventListener(type, handler, { passive: true, capture: true });
  removers.push(() => window.removeEventListener(type, handler, true));
}
function draw(text: string, live: boolean): void {
  if (live && ended && performance.now() - claimedAt > CLAIM_MIN_MS) claimed = "";
  ended = !live;
  lastText = text;
  meterEl.classList.toggle("claimed", !!claimed);
  const note = claimed ? `\n${claimed}: claimed by the shell (this pane received it anyway)` : "";
  show(text + note, live || !!claimed);
  if (!live && claimed) show(text + note, false);
}
// Our observers run before the helper, without preventing or stopping any event.
const stopGestures = watchGestures(window, draw, info => { count = info.count; });
const pointers = new Set<number>(), touches = new Set<number>();
function modifiers(event: MouseEvent | KeyboardEvent): string {
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"].filter(Boolean).join("+");
}
function record(event: Event): void {
  const now = performance.now();
  if (firstEvent || (event.type === "pointerdown" && pointers.size === 0 && touches.size === 0)
    || (event.type === "touchstart" && pointers.size === 0 && touches.size === 0)) {
    epoch = now; firstEvent = false;
  }
  let detail = "";
  if (event instanceof PointerEvent) {
    if (event.type === "pointerdown") pointers.add(event.pointerId);
    if (event.type === "pointerup" || event.type === "pointercancel") pointers.delete(event.pointerId);
    detail = `${event.pointerType} #${event.pointerId}`;
  } else if (event instanceof TouchEvent) {
    touches.clear();
    for (const touch of Array.from(event.touches)) touches.add(touch.identifier);
    detail = `touch #${Array.from(event.changedTouches, touch => touch.identifier).join(",")}`;
  } else if (event instanceof KeyboardEvent) {
    detail = `${modifiers(event)} ${event.code} (${event.key})`.trim();
    document.body.setAttribute("data-key-flash", "");
    clearTimeout(flash);
    flash = setTimeout(() => document.body.removeAttribute("data-key-flash"), KEY_FLASH_MS);
  } else if (event instanceof MouseEvent) {
    detail = `mouse ${modifiers(event)}`.trim();
    if (event instanceof WheelEvent) detail += ` Δ${Math.round(event.deltaX)},${Math.round(event.deltaY)}`;
  }
  const fingers = Math.max(pointers.size, touches.size);
  const previous = log.lastElementChild as HTMLLIElement | null;
  const fold = event.type.endsWith("move") && previous?.dataset.type === event.type;
  const row = fold ? previous! : document.createElement("li");
  const repetitions = fold ? Number(row.dataset.count) + 1 : 1;
  row.dataset.type = event.type;
  row.dataset.count = String(repetitions);
  row.textContent = `${Math.round(now - epoch)}ms ${event.type}${repetitions > 1 ? ` ×${repetitions}` : ""} ${detail} · ${fingers} down`;
  if (!fold) log.append(row);
  while (log.children.length > LOG_LIMIT) log.firstElementChild!.remove();
  log.scrollTop = log.scrollHeight;
}
for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel",
  "keydown", "keyup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel"]) listen(type, record);
function focus(event?: Event): void {
  // Capture sees element focus too; only window focus/blur belongs in this log.
  if (event && event.target !== window) return;
  keyboard.textContent = document.hasFocus() ? "keyboard: here" : "keyboard: elsewhere";
  if (event) record(event);
}
listen("focus", focus); listen("blur", focus); focus();
listen("split-tabs-claimed", event => {
  claimed = (event as CustomEvent<{ what: string }>).detail.what;
  claimedAt = performance.now();
  draw(lastText, count > 0);
  record(event);
});
listen("message", event => {
  const e = event as MessageEvent;
  if (e.source !== parent || e.origin !== location.origin || e.data?.type !== "workbench-event-logs") return;
  if (typeof e.data.visible === "boolean") panel.hidden = !e.data.visible;
});
const disconnect = connectSplitTabsFrame();
window.addEventListener("pagehide", () => {
  disconnect(); stopGestures(); show.dispose(); clearTimeout(flash);
  for (const remove of removers) remove();
}, { once: true });
Object.assign(window, { ready: true, marker: `${number}:${Math.random()}` });
