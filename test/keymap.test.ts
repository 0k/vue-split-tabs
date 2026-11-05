import { describe, expect, it } from "vitest";
import { compileExitKeys, compileKeymap, compilePointerChords, defaultPointerChords } from "../src/keymap";

describe("chord validation", () => {
  it("exit keys share strict keymap validation and canonical physical codes", () => {
    expect([...compileExitKeys(["Shift+Ctrl+KeyQ", "Escape"])]).toEqual(["Ctrl+Shift+KeyQ", "Escape"]);
    expect([...compileExitKeys(null)]).toEqual([]);
    for (const chord of ["Control+KeyG", "Cmd+KeyD", "Option+KeyQ", "Ctrl+Ctrl+KeyG", "Ctrl+g", "Ctrl"]) {
      let expected: unknown;
      try { compileKeymap({ clear: [chord] }); } catch (error) { expected = error; }
      expect(expected).toBeInstanceOf(Error);
      expect(() => compileExitKeys([chord])).toThrowError(expected as Error);
    }
  });
  it.each(["Control", "Cmd", "Option"])("keymap rejects unknown modifier %s rather than binding a plain typing key", modifier => {
    const chord = `${modifier}+KeyE`;
    expect(() => compileKeymap({ splitRight: [chord] })).toThrowError(
      `split-tabs: unknown modifier "${modifier}" in chord "${chord}"; accepted modifiers: Ctrl, Meta, Alt, Shift`,
    );
  });

  it.each(["Control", "Cmd", "Option"])("pointer chords reject unknown modifier %s with accepted names", modifier => {
    expect(() => compilePointerChords({ ...defaultPointerChords, toggle: `${modifier}+Shift` })).toThrowError(
      `split-tabs: unknown modifier "${modifier}" in chord "${modifier}+Shift"; accepted modifiers: Ctrl, Meta, Alt, Shift`,
    );
  });

  it.each(["t", "T", "=", "1"])("keymap rejects the character %s where a physical key code belongs", key => {
    expect(() => compileKeymap({ splitRight: [`Alt+Shift+${key}`] })).toThrowError(
      `split-tabs: key chord "Alt+Shift+${key}" must end with a physical KeyboardEvent.code (such as KeyT, Digit1, Equal), not a character`,
    );
  });

  it("keymap rejects one chord bound to two commands, whatever its modifier order", () => {
    expect(() => compileKeymap({ splitRight: ["Alt+Shift+KeyE"], tabNext: ["Shift+Alt+KeyE"] })).toThrowError(
      'split-tabs: chord "Alt+Shift+KeyE" is bound to both splitRight and tabNext',
    );
    expect([...compileKeymap({ splitRight: ["Alt+Shift+KeyE", "Shift+Alt+KeyE"] })]).toEqual([["Alt+Shift+KeyE", "splitRight"]]);
  });

  it("Option+Shift+KeyE is rejected rather than silently becoming Shift+KeyE", () => {
    expect(() => compileKeymap({ splitRight: ["Option+Shift+KeyE"] })).toThrowError(/unknown modifier "Option"/);
  });

  it("both chord kinds canonicalize documented modifiers while bare physical keys remain allowed", () => {
    expect([...compileKeymap({ splitRight: ["Shift+Alt+Meta+Ctrl+KeyE"], clear: ["Escape"], arrange: ["KeyA"] })]).toEqual([
      ["Ctrl+Meta+Alt+Shift+KeyE", "splitRight"], ["Escape", "clear"], ["KeyA", "arrange"],
    ]);
    expect(compilePointerChords({ toggle: "Shift+Alt+Meta+Ctrl", rectangle: null, move: "Shift+Alt" })).toEqual({
      toggle: "Ctrl+Meta+Alt+Shift", rectangle: null, move: "Alt+Shift",
    });
  });
});
