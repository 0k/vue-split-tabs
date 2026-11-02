import type { InjectionKey, Ref } from "vue";
import type { PaneId, SplitTabsController } from "./controller.js";
import type { TabDrag } from "./drag.js";
import type { PanePick } from "./pick.js";

export interface SplitTabsContext {
  controller: SplitTabsController;
  root: Ref<HTMLElement | null>;
  anchors: Map<string, HTMLElement>;
  drag: TabDrag;
  pick: PanePick;
}
export const splitTabsKey: InjectionKey<SplitTabsContext> = Symbol("split-tabs");
export const paneKey: InjectionKey<PaneId> = Symbol("split-tabs-pane");
export interface SplitTabStripLabels { rows: string; cols: string; close?: string }
interface StripHooks {
  alwaysShow?: boolean;
  splitButtons?: boolean;
  tabClass?: string;
  iconClass?: string;
}
export type SplitTabStripProps = StripHooks & ({
  controller: SplitTabsController;
  pane: PaneId;
  labels: SplitTabStripLabels;
  tabs?: never;
  active?: never;
} | {
  controller?: undefined;
  pane?: undefined;
  labels?: undefined;
  tabs: readonly string[];
  active: string;
});
