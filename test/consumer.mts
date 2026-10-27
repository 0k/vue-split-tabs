import {
  createSplitTabsController, SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor,
  type SplitTabsIntent, type SplitSide,
} from "@0k/vue-split-tabs";

const controller = createSplitTabsController({
  tabs: ["a", "b"], entryKey: "type-consumer", storageKey: "type-layouts",
  minPaneWidth: 100, minPaneHeight: 80,
});
const side: SplitSide = "start";
controller.place("b", 0, "a");
controller.splitAt("a", "rows", side);
const order: readonly string[] = controller.intent.value.order;
const ratio: SplitTabsIntent["ratio"] = controller.ratio.value;
void [SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, order, ratio];
controller.dispose();
