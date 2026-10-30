# @0k/vue-split-tabs

Content-agnostic split-tab layout. The controller owns intent and effective
layout; components render it and handle gestures. Hosts own tab content, labels,
storage keys, routing, data, and themes.

## Rules

- Users may freely reorder tabs. Persist each page's custom `order`; both panes
  and collapsed layout use that effective order. Natural host order is only the
  default and the insertion reference for newly present ids: insert after the
  nearest already-placed natural predecessor, otherwise at the start. Keep absent
  ids in saved order; collapse, restoration and merge must not reset it.
- Persist intent, not effective layout. Size and tab-list changes never write
  storage or forget absent tab ids; collapse automatically restores when it fits.
- Optional tabs are visible only when opened: visible = present non-optional ids
  union present opened ids. All layout and restoration use visible ids, not present ids.
  `open` on an already-visible tab only focuses it in its own pane, NEVER moves it.
  Persist `opened` per entry like `order`, retaining absent ids. Derived changes never write.
- `replace(oldId, newId)` is one atomic action, never close + open/select writes.
  A hidden present target takes the visible source's order slot, opened state and
  pane membership, preserving the shown tab unless the source was shown. Remove
  any older target position/membership. An already-visible target NEVER moves:
  dismiss the source, use normal history/last-tab merge rules, then focus the
  target in its own pane. Host placeholders that must disappear are optional ids.
- Merge (explicit or required by moving/closing the last visible tab) clears pane
  membership. Opening a closed tab in pane 0 removes its old pane-1 membership;
  replacement removes the consumed source membership and transfers the slot as above.
  Preserve ratio, order and opened ids on merge. LRU eviction may forget an entry.
- Keep the host's empty active id untouched. Deep links into pane 1 display there.
- Record `firstActive` only in controller user actions: primary selection and
  every host active setter call, in the same single intent write as the action.
  Never learn it from host navigation or derived size/tab changes. Explicit
  merge clears it; a merge-by-drop records the dropped id, a merge-by-move the
  tab the destination pane was showing. `restoredActive` is a
  host-consumed request, not an automatic host selection, and remains available
  for valid pane-0 membership in split intent while collapsed for size.
  Splitting off or moving a tab other than the shown one records the shown tab as
  `firstActive`, overriding any older request.
- `moveTo`/`moveToOther` (the move icon) put the tab away: it goes behind the
  destination pane's shown tab, which stays shown, in both directions and after
  a merge. Only drag-and-drop (`place`) reveals the moved tab where it is dropped.
- When the shown tab leaves its pane (split, move, cross-pane place, start-side
  split, close, replacement by an already-visible target), the replacement is the most recently viewed tab still in that pane,
  falling back to the order neighbor. The view history is memory-only, one per
  pane and entry key, cleared on key change, never persisted; it is learned only inside
  controller actions (the tabs shown when acting, and each tab the controller
  selects), never from host navigation between actions.
- The per-page intent table is bounded LRU; existing-entry reads and committed
  user actions bump monotonically increasing recency stamps.
- Refresh and validate shared storage before writing; replace only this
  controller's current entry and preserve other entries. Stamp with the maximum
  local/stored stamp plus one. Storage errors retain in-memory intent and pending
  writes; do not resurrect stale cached entries over newer persisted ones.
- Storage failures never break in-memory use; validate stored JSON at the boundary.
- Stored intent without `firstActive`, `order` or `opened` loads them as empty. Drop only invalid entries;
  duplicate keys keep the highest-stamp valid entry, not a whole-table reset.
- Keep content never remounts on pane moves, collapse, or restore. Use Teleport
  retargeting, never conditional mounting of the persistent content.
- Labels are always host-supplied; never introduce built-in visible strings.
- By default, single-layout split controls are direct per-orientation buttons for
  fitting axes, labelled by `rows` and `cols`; split mode shows the directional
  move button labelled `sendToOther`. A host may disable all these buttons with
  `SplitTabStrip`'s `splitButtons: false` (default true). Keep controller labels
  required: labelled edge-drop shades still use rows/cols. Close, end-slot,
  drag/drop and keyboard reordering remain available. No orientation popup.
- Keep enabled icon buttons in layout and keyboard order on every tab. Reveal only on
  active, hovered or focus-containing items; hide with opacity/pointer-events,
  never display:none. Split/move glyph/hit sizes default to 18px/24px with stroke width 2.
- Close buttons require host `labels.close` and an optional tab. Put selection
  then close inside `.split-tab-strip-title`, BEFORE the split/move icons, never
  nesting buttons. Close defaults to a 10px glyph in an 18px hit box, stroke 2
  with round caps, 2px from the label; use the close-specific size/hit/gap variables.
  Keep the same reveal rules; close never selects or drags. The active background
  belongs to `.split-tab-strip-title--active`; keep the selection button's active
  class and aria-pressed too. Hosts can underline the combined title span.
- The strip `end` slot is sticky at the right edge, non-draggable, never a drop
  target and never an item for insertion midpoint/marker calculations. Centre its
  child vertically with flex alignment; expose optional end padding for host underlines.
  No wrapper without a slot.
- Do not add domain navigation, routing, fetching, or application themes.
- Pointer gestures use window listeners and clean up on up, cancel, and unmount.
  Tab dragging works in single and split layouts and cannot target another
  SplitTabs root. Mouse uses a >6px threshold. Touch/pen must hold 350ms first;
  movement >6px before arming cancels drag and allows native scrolling. Clean up
  hold timers too. When touch/pen arms, register a non-passive window touchmove
  handler that prevents default while armed; remove that exact handler on every
  exit/unmount. Never rely on pointermove.preventDefault or changing touch-action
  after touch start to stop native panning. Never use HTML5 drag-and-drop.
- Share transient drag state through the root context. Show a cloned-content
  ghost, midpoint-based strip insertion marker, fitting-edge half-pane shade for
  a new split, or other-pane body shade plus end marker. No valid target means
  cancel. Escape/cancel/unmount remove ghost, previews and all gesture listeners.
- Strips scroll horizontally with nonshrinking items and nowrap selection labels.
  Tab buttons keep touch-action:pan-x; the armed touchmove handler cancels panning.
  Plain taps must still select. Markers are absolute in strip content coordinates,
  never viewport-fixed, and must account for scrolling and transforms.
- Use ordinary named selection buttons with aria-pressed, not tablist/tab roles
  containing non-tab action controls. Preserve host slot text as the accessible
  name; do not replace it with a technical id. Keep native button keyboard access.
- Selected buttons use split-tab-strip-tab--active, never a generic active class;
  keep aria-pressed. Alt+Shift+Left/Right reorders one slot within the focused
  button's strip without selecting it, and restores focus after the DOM move.
- Suppress only immediate pointer clicks (detail > 0) after mouse drags and expire
  the guard after the current task, even when no click is delivered. Never
  suppress keyboard activation (detail 0). Clear suppression timers on disposal.
- Same-pane `place` is pure reorder (current-slot drop is a no-op). Cross-pane
  placement combines order, membership and selection in one persisted write.
  `splitAt` creates a centred start/end split matching the half-pane preview;
  explicit `split` retains its saved-ratio behavior. Merges preserve order.
- Divider press/release without axis movement must not change or commit the
  ratio. Actual drag up/cancel commits once. Double-click and focused Enter
  centre via `commitRatio(0.5)`; the preceding click pairs must not commit.
- Committing without measurement or fit preserves the normalized [0,1] request,
  not the display default. Collapse aborts a live resize without committing it
  and clears the live override so restoration uses committed intent.
- Use CSS custom properties with the `--split-tabs-` prefix and host class hooks.
  No 1px borders and no imposed palette or typography.
- Android System WebView 91 is the compatibility floor. Do not use newer
  runtime APIs without a compatible implementation; keep compatibility tests.
- Keep source lines readable (at most 160 characters). Write specification tests
  first and run `npm run check` before delivery, including the post-build artifact
  smoke test, consumer type probes, and real-browser acceptance. Build output is
  ESM-only with types/default exports; Vue stays external. CSS is explicitly
  copied/exported and must not be imported by the JavaScript/declaration entry.
  Clear dist before build so stale output cannot ship.
- Relative TypeScript-module imports use .js extensions. Published component
  types target moduleResolution:bundler; verify the strict NodeNext consumer
  probe but do not claim support while Vue SFC exports remain unresolved.
- Keep pinned Playwright browser acceptance in npm run check. Test the built
  artifact with real CDP touch input: hold-horizontal reorder must end on
  pointerup, hold-vertical must split, quick swipes must scroll without drag,
  and mouse ordering/keyboard activation must work. Synthetic pointer tests alone
  cannot validate the compositor's touch-action/pointercancel behavior.
- Releases are published publicly to npm with the `pkg` release workflow from
  a tagged commit; `package.json` keeps `%%version%%`, substituted from the tag.
- Release/tag/publish only with explicit authorization. Install release helpers
  with `pkg vendor`, never by hand-copying. Run `pkg check` for setup validation;
  keep the registry/github-release feature declarations and canonical changelog
  configuration.
- Consumers depend on the npm release. Local path dependencies used to test
  unreleased changes are never committed, here or in consumers.
- `README.md` is generated from `README.org` at release; never commit it.
