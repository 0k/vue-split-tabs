import type { InjectionKey, Ref } from "vue";
import type { PaneIndex, SplitTabsController } from "./controller.js";
import type { TabDrag } from "./drag.js";

export interface SplitTabsContext {
  controller: SplitTabsController;
  root: Ref<HTMLElement | null>;
  anchors: Map<string, HTMLElement>;
  drag: TabDrag;
}
export const splitTabsKey: InjectionKey<SplitTabsContext> = Symbol("split-tabs");
export const paneKey: InjectionKey<PaneIndex> = Symbol("split-tabs-pane");
export interface SplitTabStripLabels { rows: string; cols: string; sendToOther: string; close?: string }
interface StripHooks {
  alwaysShow?: boolean;
  splitButtons?: boolean;
  tabClass?: string;
  iconClass?: string;
}
export type SplitTabStripProps = StripHooks & ({
  controller: SplitTabsController;
  pane: PaneIndex;
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
