import {
  createSplitTabsController, SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor,
  type SplitTabsIntent, type SplitSide, type ExternalTabGhost, type TabDropTarget,
} from "@0k/vue-split-tabs";

const controller = createSplitTabsController({
  tabs: ["a", "b"], entryKey: "type-consumer", storageKey: "type-layouts",
  minPaneWidth: 100, minPaneHeight: 80,
});
const side: SplitSide = "start";
controller.place("b", 0, "a");
controller.splitAt("a", "rows", side);
controller.insert("b", 0, null);
controller.insertSplit("b", "cols", side);
const ghost: ExternalTabGhost = { label: "External" };
function external(view: InstanceType<typeof SplitTabs>, event: PointerEvent) {
  view.startExternalDrag(event, "incoming", ghost, { rows: "Rows", cols: "Cols" }, (target: TabDropTarget) => {
    void target.kind;
  });
}
const order: readonly string[] = controller.intent.value.order;
const ratio: SplitTabsIntent["ratio"] = controller.ratio.value;
void [SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, order, ratio, external];
controller.dispose();
