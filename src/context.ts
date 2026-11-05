import type { InjectionKey, Ref } from "vue";
import type { SplitTabsController } from "./controller.js";
import type { TabDrag } from "./drag.js";
import type { PanePick } from "./pick.js";
import type { SplitTabsPointerChords } from "./keymap.js";
import type { SplitTabsMenuRequest } from "./menu.js";
import type { SplitTabsTabSet } from "./projection.js";

export interface SplitTabsTabScope { id: string; active: boolean; kind: "view" | "layout" | "tabs"; views: readonly string[]; title: string | null }
export type SplitTabsRenamable = boolean | ((key: string) => boolean);
export interface SplitTabsBarSlots {
  tab?: (scope: SplitTabsTabScope) => unknown;
  "bar-start"?: (scope: { tabSet: SplitTabsTabSet }) => unknown;
  "bar-end"?: (scope: { tabSet: SplitTabsTabSet }) => unknown;
}

/** Host-supplied labels of the root's own controls. A missing label hides its control. */
export interface SplitTabsLabels {
  divider: string;
  /** The ✕ on a selection outline: closes the selection. */
  closeSelection?: string;
  /** Optional wording over the new, opposite half of a self-drop preview. */
  newPane?: string;
  /** Accessible name of the inline tab-title input; never a built-in string. */
  renameInput?: string;
  /** Accessible name of the arrange-mode menu button. Missing hides the button. */
  arrangeMenu?: string;
}
export interface SplitTabsModes {
  /** A divider or side bar owns the pointer; overlays must not intercept it. */
  resizing: Ref<boolean>;
  /** Arrange mode: pointer and touch gestures act on the layout, not on pane content. */
  arranging: Ref<boolean>;
  /** A pointer chord's modifiers held: panes are covered so a click or a drag reaches the layout even over iframes. */
  grab: Ref<boolean>;
  /** Three fingers or more went down (this page or a pane iframe): the touch sequence belongs to the layout, panes are covered until every finger lifts. */
  gesture: Ref<boolean>;
}
export interface SplitTabsContext {
  controller: SplitTabsController;
  root: Ref<HTMLElement | null>;
  /** Selector of the layer holding overlay Keep content (iframes): never moved, only positioned. */
  layer: string;
  /** Bumped whenever rendered geometry may have changed. */
  geometry: Ref<number>;
  anchors: Map<string, HTMLElement>;
  /** Reference counts of anchor parts that position persistent overlays. */
  overlayParts: Map<string, number>;
  drag: TabDrag;
  pick: PanePick;
  modes: SplitTabsModes;
  closeButton: Ref<SplitTabsCloseButton>;
  bar?: { labels: Ref<SplitTabStripLabels | undefined>; tabClass: Ref<string | undefined>; iconClass: Ref<string | undefined>;
    slots: SplitTabsBarSlots };
  openMenu(request: SplitTabsMenuRequest): boolean;
  canOpenMenu(tab: string, tabSet: string): boolean;
  rename?: { key: Ref<string | null>; allowed(key: string): boolean; label: Ref<string | undefined>;
    commit(key: string, title: string): void };
  /** Give the keyboard to a pane: its iframe, else the first focusable element of its content, else the pane itself. */
  focusKeyboard(pane: string): void;
  /** The host's pointer chords, canonical. */
  chords: Ref<SplitTabsPointerChords>;
  /** A dragged divider snapped to this line (root coordinates), drawn as a guide. */
  guide: Ref<{ axis: "x" | "y"; at: number } | null>;
}
/**
 * When a tab shows its close button (✕), for closable tabs only:
 * `never`; `active` (only the shown tab, so a click on another tab never closes it);
 * `hover` (the shown tab, and any tab under the pointer or keyboard focus); `always`.
 */
export type SplitTabsCloseButton = "never" | "active" | "hover" | "always";
export const splitTabsKey: InjectionKey<SplitTabsContext> = Symbol("split-tabs");
/** The tab set (pane or frame) a strip or anchor belongs to. */
export const tabSetKey: InjectionKey<string> = Symbol("split-tabs-tab-set");
export interface SplitTabStripLabels { close?: string; resize?: string; renameInput?: string }
interface StripHooks {
  alwaysShow?: boolean;
  /** Overrides the root's `closeButton` for this strip. */
  closeButton?: SplitTabsCloseButton;
  tabClass?: string;
  iconClass?: string;
  renamable?: SplitTabsRenamable;
}
export type SplitTabStripProps = StripHooks & ({
  controller: SplitTabsController;
  tabSet?: string;
  labels?: SplitTabStripLabels;
  tabs?: never;
  active?: never;
} | {
  controller?: undefined;
  tabSet?: undefined;
  labels?: undefined;
  tabs: readonly string[];
  active: string;
});
