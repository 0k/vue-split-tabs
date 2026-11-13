// A drag preview bar tells the host which root edges it touches, so a host
// that draws controls over the root's corners (window Back, Close) can keep
// the previewed label clear of them, as it does for real bars.
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { SplitTabs, SplitTabsKeep } from "../src/index";
import { controller, pointer, storage } from "./helpers";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function previewFixture() {
  const s = storage();
  const c = controller({ storage: s, tabs: ["a", "b", "c"] });
  c.setContainerSize(600, 400);
  const wrapper = mount(SplitTabs, {
    attachTo: document.body,
    props: { controller: c, labels: { divider: "Resize" } },
    slots: { keep: () => ["a", "b", "c"].map(tab => h(SplitTabsKeep, { key: tab, tab, part: "body" }, () => h("div", tab))) },
  });
  // H[V[a c] b]: a top-left, c bottom-left, b on the right; every bar hidden.
  c.move({ view: "b" }, { kind: "split", target: c.paneOf("a")!, side: "right" });
  c.move({ view: "c" }, { kind: "split", target: c.paneOf("a")!, side: "bottom" });
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 2));
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  const rects: Record<string, DOMRect> = { a: new DOMRect(0, 0, 297, 197), c: new DOMRect(0, 203, 297, 197), b: new DOMRect(303, 0, 297, 400) };
  for (const p of c.panes.value) {
    for (const selector of [`[data-pane-id="${p.id}"]`, `.split-tabs-tabset[data-tabset-id="${p.id}"]`]) {
      vi.spyOn(wrapper.get(selector).element, "getBoundingClientRect").mockReturnValue(rects[p.view]!);
    }
  }
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  const drag = (view: string, x: number, y: number) => {
    const api = wrapper.vm.$.exposed!.startExternalDrag as (e: PointerEvent, id: string, ghost: { label: string }) => void;
    api(new PointerEvent("pointerdown", { pointerId: 3, pointerType: "mouse", clientX: x, clientY: y }), view, { label: view });
  };
  return { c, wrapper, drag };
}

it("names the root edges a previewed bar touches, and nothing when it touches none", async () => {
  const { c, wrapper, drag } = await previewFixture();
  // Dragging c: hidden strip of the top-left pane a touches the top and left edges of the root.
  drag("c", 150, 20); await nextTick();
  expect(wrapper.get(".split-tabs-bar-preview").attributes("data-root-edges")).toBe("top left");
  // Hidden strip of the right pane b: top and right edges.
  pointer(window, "pointermove", { clientX: 450, clientY: 20 }); await nextTick();
  expect(wrapper.get(".split-tabs-bar-preview").attributes("data-root-edges")).toBe("top right");
  pointer(window, "pointercancel", { clientX: 450, clientY: 20 }); await nextTick();
  expect(wrapper.find(".split-tabs-bar-preview").exists()).toBe(false);
  // Dragging a: hidden strip of the bottom-left pane c touches only the left edge.
  drag("a", 150, 220); await nextTick();
  expect(wrapper.get(".split-tabs-bar-preview").attributes("data-root-edges")).toBe("left");
  pointer(window, "pointercancel", { clientX: 150, clientY: 220 }); await nextTick();
  // A cluster spanning the whole left column pops its bar at the top-left corner.
  c.setSelection([c.paneOf("a")!, c.paneOf("c")!]); await nextTick();
  drag("b", 150, 300); await nextTick();
  expect(wrapper.get(".split-tabs-bar-preview").attributes("data-root-edges")).toBe("top left");
  pointer(window, "pointercancel", { clientX: 150, clientY: 300 });
  wrapper.unmount(); c.dispose();
});

it("omits the attribute when the previewed bar touches no root edge", async () => {
  const { c, wrapper, drag } = await previewFixture();
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue(new DOMRect(-50, -50, 700, 500));
  drag("c", 150, 20); await nextTick();
  const preview = wrapper.get(".split-tabs-bar-preview");
  expect(preview.attributes()).not.toHaveProperty("data-root-edges");
  pointer(window, "pointercancel", { clientX: 150, clientY: 20 });
  wrapper.unmount(); c.dispose();
});
