// Observe and display gestures without claiming input from the layout.
export const SLOP_PX = 10;
export const LONG_MS = 450;
interface Point { x0: number; y0: number; x: number; y: number }
interface Gesture {
  t0: number; pointerType: string; max: number; maxTouches: number; moved: boolean; pinch: boolean;
  spread0: number | null; touchSpread0?: number; touchesNow: number; cancelled: boolean; pointerEvents: number; touchEvents: number;
}
export interface GestureInfo { count: number; moved: boolean; pointerType: string | null; points: Point[] }
type Show = (text: string, live: boolean) => void;
const plural = (n: number) => `${n} finger${n === 1 ? "" : "s"}`;
export function classify(g: Gesture): string {
  const n = Math.max(g.max, g.maxTouches), ms = Math.round(performance.now() - g.t0);
  if (g.pointerType === "mouse") return g.moved ? "mouse drag" : "mouse click";
  let what: string;
  if (n <= 1) what = g.moved ? "drag / swipe" : ms > LONG_MS ? "long press" : "tap";
  else if (n === 2) what = g.pinch ? "pinch" : g.moved ? "two-finger drag" : "two-finger tap";
  else what = `${n}-finger ${g.moved ? "swipe" : "hold"}`;
  if (g.cancelled) what += " — cancelled by the browser (it took over: scroll/zoom)";
  return `${plural(n)} · ${what} · ${ms} ms`;
}
function begin(pointerType: string): Gesture {
  return { t0: performance.now(), pointerType, max: 0, maxTouches: 0, moved: false, pinch: false,
    spread0: null, cancelled: false, pointerEvents: 0, touchEvents: 0, touchesNow: 0 };
}
export function watchGestures(target: Window, show: Show, report: (info: GestureInfo) => void = () => {}): () => void {
  const active = new Map<number, Point>(), touches = new Map<number, Point>();
  let g: Gesture | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  const removers: (() => void)[] = [];
  function listen<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void): void {
    target.addEventListener(type, handler, { capture: true, passive: true });
    removers.push(() => target.removeEventListener(type, handler, true));
  }
  const spread = (map: Map<number, Point>) => {
    const [a, b] = [...map.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  const send = () => report({ count: Math.max(active.size, touches.size), moved: g?.moved ?? false,
    pointerType: touches.size ? "touch" : g?.pointerType ?? null, points: [...(touches.size ? touches : active).values()] });
  const families = () => `events: pointer ${g!.pointerEvents} · touch ${g!.touchEvents}`;
  const draw = () => {
    if (!g) return;
    const n = Math.max(active.size, g.touchesNow);
    show(`${plural(n)}${g.moved ? " · moving" : " · holding"}\n${classify(g)}\n${families()}`, true);
  };
  const live = () => { draw(); send(); };
  const start = (pointerType: string) => {
    if (g) return;
    g = begin(pointerType);
    clock = setInterval(draw, 50);
  };
  const finish = () => {
    if (!g) return;
    const mouse = g.pointerType === "mouse" ? ` · ${Math.round(performance.now() - g.t0)} ms` : "";
    show(`${classify(g)}${mouse}\n${families()}`, false);
    g = null;
    clearInterval(clock);
    send();
  };
  listen("pointerdown", e => {
    start(e.pointerType);
    g!.pointerEvents++;
    active.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    g!.max = Math.max(g!.max, active.size);
    if (active.size === 2) g!.spread0 = spread(active);
    live();
  });
  listen("pointermove", e => {
    const p = active.get(e.pointerId);
    if (!p || !g) return;
    g.pointerEvents++;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP_PX) g.moved = true;
    const s = spread(active);
    if (s !== null && g.spread0 !== null && Math.abs(s - g.spread0) > 2 * SLOP_PX) g.pinch = true;
    live();
  });
  for (const type of ["pointerup", "pointercancel"] as const) listen(type, e => {
    if (!active.delete(e.pointerId) || !g) return;
    g.pointerEvents++;
    if (type === "pointercancel") g.cancelled = true;
    // Preserve the gesture while touch events continue after browser takeover.
    if (active.size === 0 && touches.size === 0) finish(); else live();
  });
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) listen(type, e => {
    start("touch");
    const gesture = g!;
    gesture.touchEvents++;
    gesture.touchesNow = e.touches.length;
    const seen = new Set<number>();
    for (const t of Array.from(e.touches)) {
      seen.add(t.identifier);
      const known = touches.get(t.identifier);
      if (known) { known.x = t.clientX; known.y = t.clientY; }
      else touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
      const p = touches.get(t.identifier)!;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP_PX) gesture.moved = true;
    }
    for (const id of touches.keys()) if (!seen.has(id)) touches.delete(id);
    const s = spread(touches);
    if (s !== null) {
      if (gesture.touchSpread0 === undefined) gesture.touchSpread0 = s;
      else if (Math.abs(s - gesture.touchSpread0) > 2 * SLOP_PX) gesture.pinch = true;
    }
    gesture.maxTouches = Math.max(gesture.maxTouches, e.touches.length);
    if (type === "touchcancel") gesture.cancelled = true;
    if (touches.size === 0 && active.size === 0) finish(); else live();
  });
  return () => { clearInterval(clock); for (const remove of removers) remove(); };
}
export function meter(el: HTMLElement, holdMs = 1600): Show & { dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show: Show = (text, live) => {
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(timer);
    if (!live) timer = setTimeout(() => el.classList.remove("on"), holdMs);
  };
  return Object.assign(show, { dispose: () => clearTimeout(timer) });
}
