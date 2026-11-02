export { createSplitTabsController } from "./controller.js";
export type {
  Orientation, PaneId, PaneNode, CutNode, LayoutNode, EffectiveNode, EffectiveCut, SplitSide, SplitTabsController, SplitTabsIntent,
  SplitTabsOptions, SplitTabsPane, SplitTabsStorage,
} from "./controller.js";
export type { SplitTabStripLabels, SplitTabStripProps } from "./context.js";
export type { ExternalTabGhost, TabDropTarget } from "./drag.js";
export { default as SplitTabs } from "./SplitTabs.vue";
export { default as SplitTabStrip } from "./SplitTabStrip.vue";
export { default as SplitTabsAnchor } from "./SplitTabsAnchor.vue";
export { default as SplitTabsKeep } from "./SplitTabsKeep.vue";
