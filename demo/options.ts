import type { SplitTabsCloseButton, SplitTabsMenuItem } from "@0k/vue-split-tabs";

export const menuChoices = ["right", "left", "down", "up", "inside", "move", "rename", "close"] as const satisfies readonly SplitTabsMenuItem[];

export interface WorkbenchOptions {
  closeButton: SplitTabsCloseButton;
  focus: "border" | "dim" | "both";
  opacity: number;
  dividerSize: 1 | 2 | 6 | 10;
  pointerChord: "Ctrl+Alt+Shift" | "Alt+Shift";
  oneTabBar: "hidden" | "always";
  menuItems: SplitTabsMenuItem[];
  layoutKeys: boolean;
  eventLogs: boolean;
}
export const OPTIONS_KEY = "split-tabs.demo.options.v1";
const defaults: WorkbenchOptions = { closeButton: "active", focus: "border", opacity: 0.5, dividerSize: 6,
  pointerChord: "Ctrl+Alt+Shift", oneTabBar: "hidden", menuItems: [...menuChoices], layoutKeys: true, eventLogs: true };
const choice = (...values: unknown[]) => (value: unknown) => values.includes(value);
const boolean = (value: unknown) => typeof value === "boolean";
const validators: Record<keyof WorkbenchOptions, (value: unknown) => boolean> = {
  closeButton: choice("never", "active", "hover", "always"), focus: choice("border", "dim", "both"),
  opacity: value => typeof value === "number" && Number.isFinite(value) && value >= 0.2 && value <= 1,
  dividerSize: choice(1, 2, 6, 10), pointerChord: choice("Ctrl+Alt+Shift", "Alt+Shift"), oneTabBar: choice("hidden", "always"),
  menuItems: value => Array.isArray(value) && value.every(item => menuChoices.includes(item)) && new Set(value).size === value.length,
  layoutKeys: boolean, eventLogs: boolean,
};
export function loadOptions(): { options: WorkbenchOptions; notice: string } {
  const options = { ...defaults, menuItems: [...defaults.menuItems] };
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw === null) return { options, notice: "" };
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) throw new Error("Expected an options object");
    let invalid = false;
    for (const key of Object.keys(defaults) as (keyof WorkbenchOptions)[]) {
      const value = (stored as Record<string, unknown>)[key];
      if (validators[key](value)) Object.assign(options, { [key]: value });
      else if (value !== undefined) invalid = true;
    }
    return { options, notice: invalid ? "Invalid saved options were replaced with defaults." : "" };
  } catch (error) {
    return { options, notice: `Could not load saved options: ${String(error)}` };
  }
}
export function saveOptions(options: WorkbenchOptions): string {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); return ""; }
  catch (error) { return `Options work for this page but could not be saved: ${String(error)}`; }
}
