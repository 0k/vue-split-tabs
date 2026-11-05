import type { SplitTabsController, SplitTabsReason, SplitTabsResult, SplitTabsSource, SplitTabsTargetCommand, SplitTabsZone } from "./controller.js";

export type SplitTabsMenuItem = "right" | "left" | "down" | "up" | "inside" | "move" | "rename" | "close";
/** Every visible string belongs to the host. Missing item labels hide their controls. */
export type SplitTabsMenuLabels = Partial<Record<SplitTabsMenuItem | "menu" | "otherPane" | "noRoom" | "onlyTab", string>>;
export interface SplitTabsMenuRequest {
  tab: string;
  tabSet: string;
  anchor: HTMLElement;
  point: { x: number; y: number } | null;
}
export const defaultMenuItems: readonly SplitTabsMenuItem[] = ["right", "left", "down", "up", "inside", "move", "rename", "close"];
export type SplitTabsArrangeMenuItem = SplitTabsTargetCommand | "undo" | "done";
export type SplitTabsArrangeMenuLabels = Partial<Record<SplitTabsArrangeMenuItem | "restore", string>> & {
  reasons?: Partial<Record<SplitTabsReason, string>>;
};
export const defaultArrangeMenuItems: readonly SplitTabsArrangeMenuItem[] = ["splitRight", "splitLeft", "splitBelow", "splitAbove",
  "tabNext", "tabInside", "group", "zoom", "barSide", "close", "undo", "done"];
export interface ArrangeMenuOptions {
  labels: SplitTabsArrangeMenuLabels;
  items?: readonly SplitTabsArrangeMenuItem[];
  run(item: SplitTabsArrangeMenuItem): void;
}
export function arrangeMenuEntries(c: SplitTabsController, options: ArrangeMenuOptions) {
  return (options.items ?? defaultArrangeMenuItems).flatMap(item => {
    const label = options.labels[item === "zoom" && c.zoomed.value !== null ? "restore" : item];
    if (!label || (item === "group" && c.selection.value.length < 2) || (item === "undo" && !c.canUndo.value)) return [];
    const result = item === "done" || item === "undo" ? { ok: true } as const : c.canTarget(item);
    return [{ item, label, zone: null, disabled: !result.ok, reason: result.ok ? undefined : options.labels.reasons?.[result.reason] }];
  });
}
export function menuSource(controller: SplitTabsController, tab: string): SplitTabsSource {
  return controller.describe(tab)?.kind === "view" ? { view: tab } : { node: tab };
}
export function menuEntries(c: SplitTabsController, tab: string, tabSet: string,
  labels: SplitTabsMenuLabels = {}, items: readonly SplitTabsMenuItem[] = defaultMenuItems, renamable = true) {
  const source = menuSource(c, tab);
  return items.flatMap(item => {
    if (item === "rename" && (!renamable || c.describe(tab) === null)) return [];
    const other = c.panes.value.length === 2 ? c.panes.value.find(p => p.id !== tabSet) : undefined;
    const label = item === "move" && other !== undefined ? labels.otherPane : labels[item];
    if (label === undefined || (item === "close" && !c.isClosable(tab)) || (item === "move" && c.panes.value.length < 2)) return [];
    const side = item === "down" ? "bottom" : item === "up" ? "top" : item;
    const zone: SplitTabsZone | null = side === "right" || side === "left" || side === "top" || side === "bottom"
      ? { kind: "split", target: tabSet, side } : item === "inside" ? { kind: "inside", target: tabSet }
        : item === "move" && other !== undefined ? { kind: "bar", target: other.id, index: null } : null;
    const result: SplitTabsResult = zone !== null ? c.canMove(source, zone) : item === "move"
      ? c.panes.value.some(p => c.canMove(source, { kind: "bar", target: p.id, index: null }).ok)
        ? { ok: true } : { ok: false, reason: "nothing-to-move" } : { ok: true };
    const reason = result.ok ? undefined : result.reason === "no-room" ? labels.noRoom
      : result.reason === "nothing-to-move" || result.reason === "into-itself" ? labels.onlyTab : undefined;
    return [{ item, label, zone, disabled: !result.ok, reason }];
  });
}

/** Fixed-position placement of a menu at a point or under an anchor, kept inside the viewport. */
interface MenuBox { left: number; right: number; top: number; bottom: number }
export function pointBox(x: number, y: number): MenuBox { return { left: x, right: x, top: y, bottom: y }; }
export function placeMenu(box: MenuBox, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 0) {
  const margin = 8;
  const left = box.left + size.width <= viewport.width - margin ? box.left : box.right - size.width;
  const top = box.bottom + gap + size.height <= viewport.height - margin ? box.bottom + gap : box.top - gap - size.height;
  return {
    left: Math.round(Math.max(margin, Math.min(left, viewport.width - margin - size.width))),
    top: Math.round(Math.max(margin, Math.min(top, viewport.height - margin - size.height))),
    maxHeight: Math.max(0, Math.round(viewport.height - 2 * margin)),
  };
}
