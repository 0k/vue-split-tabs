import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSplitTabsController } from "../src/index.js";
import * as tree from "../src/tree.js";
import { storage } from "./helpers.js";

it("resize and live ratios reuse cached subtree membership and minima without reindexing", () => {
  const indexed = vi.spyOn(tree, "indexTree");
  const host = ref("a");
  const c = createSplitTabsController({ tabs: ["a", "b", "c", "d"], entryKey: "performance", storageKey: "performance",
    storage: storage(), minPaneWidth: 100, minPaneHeight: 80, active: { get: () => host.value, set: id => { host.value = id; } } });
  c.setContainerSize(906, 606);
  c.split("b", "cols");
  c.place("c", c.paneOf("b")!, null);
  c.split("c", "rows");
  const root = c.layout.value;
  if (root.kind !== "cut") throw new Error("Expected recursive layout");
  indexed.mockClear();
  for (let i = 0; i < 60; i++) {
    c.setContainerSize(906 + i, 606 + i);
    c.setRatioLive(0.4 + i / 1000, root.id);
    expect(c.cuts.value.get(root.id), "Expected the controller's cut-id projection to own the current root geometry").toBe(c.layout.value);
    expect(c.panes.value).toHaveLength(3);
  }
  host.value = "b";
  expect(c.panes.value[1]!.active).toBe("b");
  expect(indexed, "Expected geometry and host selection changes to reuse the size-independent subtree cache").not.toHaveBeenCalled();
  c.commitRatio(0.6, root.id);
  expect(c.panes.value).toHaveLength(3);
  expect(indexed, "Expected one metadata pass after committed intent changes").toHaveBeenCalledTimes(1);
  c.dispose();
});

it("SplitLayout consumes the indexed controller projection instead of searching the effective tree", () => {
  const source = readFileSync("src/SplitLayout.vue", "utf8");
  expect(source).toContain("props.controller.cuts.value.get(props.node.id)");
  expect(source).not.toMatch(/function find\(|controller\.layout\.value/);
});

it("subtree metrics cache ignores empty leaves when combining tabs and axis minima", () => {
  const indexed = tree.indexTree({ kind: "cut", id: "outer", orientation: "cols", ratio: 0.5,
    first: { kind: "pane", id: "first", tabs: [], active: "a" },
    second: { kind: "cut", id: "inner", orientation: "rows", ratio: 0.5,
      first: { kind: "pane", id: "empty", tabs: ["absent"], active: "absent" },
      second: { kind: "pane", id: "last", tabs: ["b"], active: "b" } },
  }, ["a", "b"], 100, 80, 6);
  expect(indexed.metrics.size).toBe(indexed.nodes.size);
  expect(indexed.metrics.get("outer")!.tabs).toEqual(["a", "b"]);
  expect(indexed.metrics.get("outer")!.min).toEqual({ cols: 206, rows: 80 });
  expect(indexed.metrics.get("inner")).toBe(indexed.metrics.get("last"));
});
