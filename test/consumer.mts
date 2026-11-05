import {
  createChordTracker, createSplitTabsController, defaultExitKeys, defaultKeymap, notation,
  SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, SplitTabsGlyph,
  useSplitTabsPick, type SplitTabsIntent, type Side, type ExternalTabGhost, type TabDropTarget, type EffectiveCut,
  type SplitTabsPick, type SplitTabsKeymap, type SplitTabsResult, type SplitTabsZone, type LayoutNode,
  SplitTabsMenu, type SplitTabsMenuItem, type SplitTabsMenuLabels, type SplitTabsBarVisibility, type SplitTabsBarSlots,
  type SplitTabsArrangeMenuItem, type SplitTabsArrangeMenuLabels, type SplitTabsCapture,
} from "@0k/vue-split-tabs";
import { connectSplitTabsFrame } from "@0k/vue-split-tabs/frame";

const controller = createSplitTabsController({
  tabs: ["a", "b"], entryKey: "type-consumer", storageKey: "type-layouts",
  minPaneWidth: 100, minPaneHeight: 80,
});
const side: Side = "right";
const pick: SplitTabsPick | undefined = useSplitTabsPick();
if (pick !== undefined) {
  const started: boolean = pick.start("a");
  const selecting: boolean = pick.select();
  const displaying: boolean = pick.displayPanes();
  const letter: string | null = pick.letterOf("pane-0");
  pick.choose("pane-0"); pick.chooseNumber(1); pick.cancel();
  // @ts-expect-error transient picker state is read-only to consumers
  pick.mode.value = "pick";
  void [started, selecting, displaying, letter];
}
const glyphProps: InstanceType<typeof SplitTabsGlyph>["$props"] = { kind: "split", orientation: "cols", side: "start" };
void glyphProps;
const menuLabels: SplitTabsMenuLabels = { menu: "Tab options", right: "Split right", noRoom: "No room", rename: "Rename" };
const menuItems: readonly SplitTabsMenuItem[] = ["right", "rename", "close"];
const arrangeMenuItems: readonly SplitTabsArrangeMenuItem[] = ["splitLeft", "splitAbove", "tabNext", "done"];
const arrangeMenuLabels: SplitTabsArrangeMenuLabels = { splitLeft: "Split left", splitAbove: "Split above", done: "Done",
  reasons: { "no-room": "No room" } };
const alwaysShow: SplitTabsBarVisibility = tabSet => tabSet.tabs.length === 1;
const rootProps: InstanceType<typeof SplitTabs>["$props"] = {
  onCapture: (policy: SplitTabsCapture) => { const arranging: boolean = policy.arranging; void arranging; },
  controller, labels: { divider: "Resize", newPane: "New pane", renameInput: "Tab name", arrangeMenu: "Arrange" }, menuLabels, menuItems,
  arrangeMenuItems, arrangeMenuLabels, arrangeExitKeys: ["KeyQ"], renamable: (key: string) => key !== "fixed",
  exitKeys: defaultExitKeys, displayPanesTimeout: 1200, alwaysShow, stripLabels: { close: "Close", resize: "Resize bar" },
  closeButton: "active", tabClass: "host-tab", iconClass: "host-icon" };
const nullExitProps: typeof rootProps = { ...rootProps, exitKeys: null };
const emptyExitProps: typeof rootProps = { ...rootProps, exitKeys: [] };
// @ts-expect-error exit keys are physical chord strings, not command maps
const invalidExitKeys: typeof defaultExitKeys = { clear: ["Escape"] };
void [nullExitProps, emptyExitProps, invalidExitKeys];
const barSlots: SplitTabsBarSlots = {
  tab: ({ id, active, kind, views, title }) => {
    const custom: string | null = title;
    return [id, active, kind, views, custom];
  },
  "bar-start": ({ tabSet }) => tabSet.id,
  "bar-end": ({ tabSet }) => tabSet.showsBar,
};
controller.setAlwaysShow(alwaysShow);
const barThickness: number = controller.barThickness;
const menuProps: InstanceType<typeof SplitTabsMenu>["$props"] = {
  controller, tab: "a", tabSet: "pane", anchor: document.createElement("button"), labels: menuLabels, items: menuItems,
};
void [rootProps, menuProps, barSlots, barThickness];
const pane = controller.panes.value[0]!.id;
const zone: SplitTabsZone = { kind: "split", target: pane, side };
const moved: SplitTabsResult = controller.move({ view: "b" }, zone);
const selfSplit: true | undefined = moved.selfSplit;
void selfSplit;
const preview: SplitTabsResult = controller.canTarget("splitLeft");
void preview;
const renamed: SplitTabsResult = controller.rename("a", "Work");
const customTitle: string | null = controller.titleOf("a");
void [renamed, customTitle];
controller.insert("b", { kind: "bar", target: pane, index: null }, () => undefined);
const keymap: SplitTabsKeymap = { ...defaultKeymap, splitRight: ["Ctrl+Alt+KeyS"] };
const ghost: ExternalTabGhost = { label: "External" };
const tracker = createChordTracker(window, event => event.isTrusted);
const matched: boolean = tracker.matches(new KeyboardEvent("keydown", { code: "KeyW" }), "Shift+Meta+KeyW");
tracker.modifiers(new MouseEvent("pointerdown"));
tracker.dispose();
void matched;
function external(view: InstanceType<typeof SplitTabs>, event: PointerEvent) {
  view.startExternalDrag(event, "incoming", ghost, (target: TabDropTarget) => {
    const width: number | undefined = target.newPane?.width;
    void [target.result.ok, width];
  });
  const editing: boolean = view.startRename("a");
  void editing;
}
const intent: SplitTabsIntent["tree"] = controller.intent.value.tree as LayoutNode;
const cuts: ReadonlyMap<string, EffectiveCut> = controller.cuts.value;
const stop: () => void = connectSplitTabsFrame();
void [SplitTabs, SplitTabStrip, SplitTabsKeep, SplitTabsAnchor, moved, keymap, external, cuts, notation(intent), stop];
controller.dispose();
