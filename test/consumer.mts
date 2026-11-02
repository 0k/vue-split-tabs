import {
  createSplitTabsController, SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, SplitTabsGlyph, useSplitTabsPick,
  type SplitTabsIntent, type SplitSide, type ExternalTabGhost, type TabDropTarget, type EffectiveCut,
  type SplitTabsPick,
} from "@0k/vue-split-tabs";

const controller = createSplitTabsController({
  tabs: ["a", "b"], entryKey: "type-consumer", storageKey: "type-layouts",
  minPaneWidth: 100, minPaneHeight: 80,
});
const side: SplitSide = "start";
const pick: SplitTabsPick | undefined = useSplitTabsPick();
if (pick !== undefined) {
  const started: boolean = pick.start("a");
  const previewed: boolean = pick.preview("a");
  const mode: null | "preview" | "pick" = pick.mode.value;
  const tab: string | null = pick.tab.value;
  const source: string | null = pick.source.value;
  const number: number | null = pick.numberOf("pane-0");
  pick.choose("pane-0"); pick.chooseNumber(1); pick.cancel();
  // @ts-expect-error transient picker state is read-only to consumers
  pick.mode.value = "pick";
  void [started, previewed, mode, tab, source, number];
}
const glyphProps: InstanceType<typeof SplitTabsGlyph>["$props"] = { kind: "split", orientation: "cols", side };
void glyphProps;
const pane = controller.panes.value[0]!.id;
controller.place("b", pane, "a");
controller.splitAt("a", "rows", side);
controller.insert("b", pane, null);
controller.insertSplit("b", "cols", side);
controller.insert("b", pane, null, () => undefined);
controller.insertSplit("b", "cols", side, pane, () => undefined);
const ghost: ExternalTabGhost = { label: "External" };
function external(view: InstanceType<typeof SplitTabs>, event: PointerEvent) {
  view.startExternalDrag(event, "incoming", ghost, { rows: "Rows", cols: "Cols" }, (target: TabDropTarget) => {
    void target.kind;
  });
}
const order: readonly string[] = controller.intent.value.order;
const ratio: SplitTabsIntent["ratio"] = controller.ratio.value;
const cuts: ReadonlyMap<string, EffectiveCut> = controller.cuts.value;
void [SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, order, ratio, external, cuts];
controller.dispose();
